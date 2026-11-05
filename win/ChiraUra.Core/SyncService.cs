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

        // 2. FE API へ送信（ファイル名はタイムスタンプ YYYYMMDD_HHMMSS.txt または id.txt）
        // 設計 dev/cloud-design.md §4: YYYYMMDD_HHMMSS.txt
        var fileName = $"{note.Id}.txt";
        var sent = await _apiClient.SendInboxAsync(fileName, note, closed, ct);

        // 送信成否に関わらずローカルには安全に永続化されている
        return sent;
    }
}
