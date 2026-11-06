using System.Text.Json;

namespace ChiraUra.Core;

public class SyncService
{
    private readonly NoteRepository _repository;
    private readonly ChiraApiClient _apiClient;

    public SyncService(NoteRepository repository, ChiraApiClient? apiClient = null)
    {
        _repository = repository;
        _apiClient = apiClient ?? new ChiraApiClient();
    }

    public static string FormatNoteFileName(long updatedAt)
    {
        var dt = DateTimeOffset.FromUnixTimeMilliseconds(updatedAt).ToLocalTime();
        return $"{dt:yyyyMMdd_HHmmss}.txt";
    }

    public async Task<bool> SaveAndSyncAsync(Note note, bool closed = false, CancellationToken ct = default)
    {
        // 1. ローカル SQLite へ即時保存
        _repository.UpsertNote(note);

        // 2. FE API へ送信（ファイル名は id.txt）
        var fileName = $"{note.Id}.txt";
        var payload = new InboxPayload
        {
            Title = note.Title,
            Content = note.Content,
            UpdatedAt = note.UpdatedAt,
            Closed = closed
        };

        var sent = await _apiClient.SendInboxPayloadAsync(fileName, payload, ct).ConfigureAwait(false);
        if (!sent)
        {
            // オフライン時はローカル SQLite の outbox テーブルに積む
            var json = JsonSerializer.Serialize(payload);
            _repository.EnqueueOutbox(note.Id, fileName, json);
        }
        else
        {
            // 送信成功した場合は pending outbox から削除
            var pending = _repository.GetPendingOutbox();
            foreach (var item in pending)
            {
                if (item.NoteId == note.Id)
                {
                    _repository.RemoveOutboxItem(item.Id);
                }
            }
        }

        return sent;
    }

    public async Task<int> FlushOutboxAsync(CancellationToken ct = default)
    {
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
}
