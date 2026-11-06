using System.Text.Json;

namespace ChiraUra.Core;

public class SyncResult
{
    public int PushedBatches { get; set; }
    public int PushedItems { get; set; }
    public int RemainingItems { get; set; }
    public string? LastError { get; set; }
}

public class SyncService
{
    private readonly NoteRepository _repository;
    private readonly WikiGitHubClient _wikiClient;
    private readonly GitHubOAuth _oauth;
    private readonly ChiraApiClient? _apiClient;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    public const int DefaultBatchSize = 10;

    public SyncService(
        NoteRepository repository,
        WikiGitHubClient? wikiClient = null,
        GitHubOAuth? oauth = null,
        ChiraApiClient? apiClient = null)
    {
        _repository = repository;
        _wikiClient = wikiClient ?? new WikiGitHubClient();
        _oauth = oauth ?? new GitHubOAuth();
        _apiClient = apiClient;
    }

    public SyncService(NoteRepository repository, ChiraApiClient apiClient)
        : this(repository, null, null, apiClient)
    {
    }

    public WikiGitHubClient WikiClient => _wikiClient;
    public GitHubOAuth OAuth => _oauth;
    public ChiraApiClient? ApiClient => _apiClient;

    /// <summary>
    /// Generates timestamp-based file name: yyyyMMdd_HHmmss.txt.
    /// Matches formatSessionName in crx/scripts/inbox.js.
    /// </summary>
    public static string FormatNoteFileName(long updatedAt)
    {
        var dt = DateTimeOffset.FromUnixTimeMilliseconds(updatedAt).ToLocalTime();
        return $"{dt:yyyyMMdd_HHmmss}.txt";
    }

    /// <summary>
    /// オフライン即時保存:
    /// 1. notes テーブルへ即座に Upsert
    /// 2. closed=true または非空メモの場合、wiki_queue テーブルに未送信メモとして蓄積（タイムスタンプ付き）
    /// 3. 送信処理（PushPendingWikiBatchesAsync）を試みる（オンラインなら送信、オフラインなら安全にローカル保持）
    /// </summary>
    public async Task<bool> SaveAndSyncAsync(Note note, bool closed = false, CancellationToken ct = default)
    {
        // 1. ローカル SQLite へ即時保存（オフライン蓄積・即保存）
        _repository.UpsertNote(note);

        // 2. 空でないメモまたは closed 時に wiki_queue へ積む
        // タイムスタンプ順のファイル名（yyyyMMdd_HHmmss.txt）
        var fileName = FormatNoteFileName(note.UpdatedAt);
        _repository.EnqueueWikiMemo(note.Id, fileName, note.Content, note.UpdatedAt);

        bool feSent = false;
        // レガシー /inbox クライアントが渡されている場合は /inbox 送信も実行
        if (_apiClient != null)
        {
            feSent = await _apiClient.SendInboxPayloadAsync(
                $"{note.Id}.txt",
                new InboxPayload { Title = note.Title, Content = note.Content, UpdatedAt = note.UpdatedAt, Closed = closed },
                ct).ConfigureAwait(false);

            if (!feSent)
            {
                var json = JsonSerializer.Serialize(new InboxPayload { Title = note.Title, Content = note.Content, UpdatedAt = note.UpdatedAt, Closed = closed });
                _repository.EnqueueOutbox(note.Id, $"{note.Id}.txt", json);
            }
            else
            {
                var pending = _repository.GetPendingOutbox();
                foreach (var item in pending)
                {
                    if (item.NoteId == note.Id) _repository.RemoveOutboxItem(item.Id);
                }
            }
        }

        // 3. オンラインであればバッチ送信を試行（失敗してもローカルに残る）
        try
        {
            var result = await PushPendingWikiBatchesAsync(flushAll: closed, ct: ct).ConfigureAwait(false);
            if (_apiClient != null)
            {
                return feSent;
            }
            return result.LastError == null;
        }
        catch
        {
            // オフラインまたは通信失敗時はローカル SQLite に残り、次回オンライン時にリトライ
            return _apiClient != null && feSent;
        }
    }

    /// <summary>
    /// レガシー /inbox の outbox フラッシュ互換
    /// </summary>
    public async Task<int> FlushOutboxAsync(CancellationToken ct = default)
    {
        if (_apiClient == null) return 0;
        var pending = _repository.GetPendingOutbox();
        int sentCount = 0;

        foreach (var item in pending)
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                var payload = JsonSerializer.Deserialize<InboxPayload>(item.Payload);
                if (payload != null)
                {
                    var sent = await _apiClient.SendInboxPayloadAsync(item.Name, payload, ct).ConfigureAwait(false);
                    if (sent)
                    {
                        _repository.RemoveOutboxItem(item.Id);
                        sentCount++;
                    }
                }
            }
            catch
            {
                // keep in outbox for next attempt
            }
        }

        return sentCount;
    }

    /// <summary>
    /// 未送信分を 10 件単位のバッチで push（各バッチ = 1 コミット）。
    /// flushAll = false の場合: 10 件以上ある分のみ 10 件ずつ送信（端数 < 10 は次回に持ち越し）。
    /// flushAll = true の場合（オンライン復帰時・アプリ終了時・手動フラッシュ）: 端数（< 10 件）も送信。
    /// 成功分は MarkWikiMemosPushed で送信済みフラグを立て再送しない（冪等）。
    /// 失敗バッチはローカルに残り、次回リトライされる。
    /// </summary>
    public async Task<SyncResult> PushPendingWikiBatchesAsync(
        int batchSize = DefaultBatchSize,
        bool flushAll = false,
        CancellationToken ct = default)
    {
        await _syncLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var result = new SyncResult();
            var token = _oauth.GetSavedToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                result.LastError = "No GitHub token configured";
                result.RemainingItems = _repository.GetPendingWikiMemos(int.MaxValue).Count;
                return result;
            }

            while (!ct.IsCancellationRequested)
            {
                // 未送信分を古い順（FIFO）で取得
                var pending = _repository.GetPendingWikiMemos(batchSize);
                if (pending.Count == 0)
                {
                    break;
                }

                // 端数（< batchSize）の処理: flushAll が false の場合は送らず終了
                if (pending.Count < batchSize && !flushAll)
                {
                    break;
                }

                var files = pending.Select(p => new WikiFile(p.FileName, p.Content, p.UpdatedAt)).ToList();

                try
                {
                    var pushResult = await _wikiClient.PushFilesBatchAsync(files, token, ct).ConfigureAwait(false);
                    if (pushResult != null)
                    {
                        // 成功分は送信済みとしてマーク（再送しない・冪等）
                        var ids = pending.Select(p => p.Id);
                        _repository.MarkWikiMemosPushed(ids);
                        result.PushedBatches++;
                        result.PushedItems += pushResult.FileCount;
                    }
                }
                catch (Exception ex)
                {
                    // 失敗したバッチはキューに残し、次回リトライ
                    result.LastError = ex.Message;
                    break;
                }
            }

            result.RemainingItems = _repository.GetPendingWikiMemos(int.MaxValue).Count;
            return result;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    /// <summary>
    /// オンライン復帰時やアプリ終了時の端数フラッシュ（10件ごと + 残りの端数も push）
    /// </summary>
    public Task<SyncResult> FlushAllAsync(CancellationToken ct = default)
    {
        return PushPendingWikiBatchesAsync(batchSize: DefaultBatchSize, flushAll: true, ct: ct);
    }
}
