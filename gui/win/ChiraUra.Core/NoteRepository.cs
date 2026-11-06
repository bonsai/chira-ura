using Microsoft.Data.Sqlite;
using System.Text.Json;

namespace ChiraUra.Core;

public class OutboxItem
{
    public long Id { get; set; }
    public string NoteId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Payload { get; set; } = string.Empty;
    public long CreatedAt { get; set; }
}

public class WikiQueueItem
{
    public long Id { get; set; }
    public string NoteId { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public long UpdatedAt { get; set; }
    public int Status { get; set; } // 0 = pending, 1 = pushed
    public long CreatedAt { get; set; }
    public long? PushedAt { get; set; }
}

public class NoteRepository : IDisposable
{
    private readonly string _dbPath;
    private readonly SqliteConnection _connection;
    private readonly object _lock = new();

    public NoteRepository(string? dbPath = null)
    {
        _dbPath = dbPath ?? GetDefaultDbPath();
        var dir = Path.GetDirectoryName(_dbPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate
        }.ToString();

        _connection = new SqliteConnection(connectionString);
        _connection.Open();

        lock (_lock)
        {
            using (var cmd = _connection.CreateCommand())
            {
                cmd.CommandText = "PRAGMA journal_mode = DELETE;";
                cmd.ExecuteNonQuery();
            }

            using (var cmd = _connection.CreateCommand())
            {
                cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS notes (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL DEFAULT '',
  content   TEXT NOT NULL DEFAULT '',
  updatedAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notes_updated ON notes(updatedAt);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  noteId    TEXT NOT NULL,
  name      TEXT NOT NULL,
  payload   TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_noteId ON outbox(noteId);

CREATE TABLE IF NOT EXISTS wiki_queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  noteId    TEXT NOT NULL,
  fileName  TEXT NOT NULL,
  content   TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  status    INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  pushedAt  INTEGER
);
CREATE INDEX IF NOT EXISTS wiki_queue_status_time ON wiki_queue(status, updatedAt, id);
";
                cmd.ExecuteNonQuery();
            }
        }
    }

    public static string GetDefaultDbPath()
    {
        var chiraDb = Environment.GetEnvironmentVariable("CHIRA_DB");
        if (!string.IsNullOrEmpty(chiraDb))
        {
            if (Directory.Exists(chiraDb))
            {
                return Path.Combine(chiraDb, "ura.db");
            }
            return chiraDb;
        }

        var loadDir = Environment.GetEnvironmentVariable("CHIRA_LOAD_DIR");
        if (!string.IsNullOrEmpty(loadDir))
        {
            return Path.Combine(loadDir, "ura.db");
        }

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(userProfile))
        {
            userProfile = Environment.GetEnvironmentVariable("HOME") ?? ".";
        }
        return Path.Combine(userProfile, ".chira", "ura.db");
    }

    public Note? GetNote(string id)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, title, content, updatedAt FROM notes WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", id);

            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                return new Note
                {
                    Id = reader.GetString(0),
                    Title = reader.GetString(1),
                    Content = reader.GetString(2),
                    UpdatedAt = reader.GetInt64(3)
                };
            }
            return null;
        }
    }

    public List<Note> ListNotes(string query = "")
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            if (string.IsNullOrWhiteSpace(query))
            {
                cmd.CommandText = "SELECT id, title, content, updatedAt FROM notes ORDER BY updatedAt DESC, id DESC";
            }
            else
            {
                cmd.CommandText = @"
SELECT id, title, content, updatedAt FROM notes
WHERE title LIKE @q ESCAPE '\' OR content LIKE @q ESCAPE '\'
ORDER BY updatedAt DESC, id DESC";
                cmd.Parameters.AddWithValue("@q", EscapeLike(query));
            }

            var list = new List<Note>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new Note
                {
                    Id = reader.GetString(0),
                    Title = reader.GetString(1),
                    Content = reader.GetString(2),
                    UpdatedAt = reader.GetInt64(3)
                });
            }
            return list;
        }
    }

    private static string EscapeLike(string q)
    {
        var escaped = q.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");
        return $"%{escaped}%";
    }

    public bool UpsertNote(Note note)
    {
        lock (_lock)
        {
            var existing = GetNote(note.Id);
            if (existing != null && existing.UpdatedAt >= note.UpdatedAt)
            {
                return false;
            }

            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
INSERT OR REPLACE INTO notes (id, title, content, updatedAt)
VALUES (@id, @title, @content, @updatedAt)";
            cmd.Parameters.AddWithValue("@id", note.Id);
            cmd.Parameters.AddWithValue("@title", note.Title ?? string.Empty);
            cmd.Parameters.AddWithValue("@content", note.Content ?? string.Empty);
            cmd.Parameters.AddWithValue("@updatedAt", note.UpdatedAt);

            cmd.ExecuteNonQuery();
            return true;
        }
    }

    public bool RemoveNote(string id)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM notes WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", id);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public void EnqueueOutbox(string noteId, string name, string payload)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
DELETE FROM outbox WHERE noteId = @noteId;
INSERT INTO outbox (noteId, name, payload, createdAt)
VALUES (@noteId, @name, @payload, @createdAt);";
            cmd.Parameters.AddWithValue("@noteId", noteId);
            cmd.Parameters.AddWithValue("@name", name);
            cmd.Parameters.AddWithValue("@payload", payload);
            cmd.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            cmd.ExecuteNonQuery();
        }
    }

    public List<OutboxItem> GetPendingOutbox()
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT id, noteId, name, payload, createdAt FROM outbox ORDER BY id ASC";
            var list = new List<OutboxItem>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new OutboxItem
                {
                    Id = reader.GetInt64(0),
                    NoteId = reader.GetString(1),
                    Name = reader.GetString(2),
                    Payload = reader.GetString(3),
                    CreatedAt = reader.GetInt64(4)
                });
            }
            return list;
        }
    }

    public void RemoveOutboxItem(long outboxId)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM outbox WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", outboxId);
            cmd.ExecuteNonQuery();
        }
    }

    // ---------- wiki_queue（bonsai/wiki/raw/<MM>/<timestamp>.txt 用オフラインキュー） ----------

    /// <summary>
    /// メモを wiki 送信用キューに登録（オフライン時もローカル SQLite に確実に蓄積）
    /// </summary>
    public long EnqueueWikiMemo(string noteId, string fileName, string content, long updatedAt)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
INSERT INTO wiki_queue (noteId, fileName, content, updatedAt, status, createdAt)
VALUES (@noteId, @fileName, @content, @updatedAt, 0, @createdAt);
SELECT last_insert_rowid();";
            cmd.Parameters.AddWithValue("@noteId", noteId);
            cmd.Parameters.AddWithValue("@fileName", fileName);
            cmd.Parameters.AddWithValue("@content", content);
            cmd.Parameters.AddWithValue("@updatedAt", updatedAt);
            cmd.Parameters.AddWithValue("@createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

            var result = cmd.ExecuteScalar();
            return Convert.ToInt64(result);
        }
    }

    /// <summary>
    /// 未送信（status = 0）のメモを古い順（FIFO: updatedAt ASC, id ASC）で最大 limit 件取得
    /// </summary>
    public List<WikiQueueItem> GetPendingWikiMemos(int limit = 10)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
SELECT id, noteId, fileName, content, updatedAt, status, createdAt, pushedAt
FROM wiki_queue
WHERE status = 0
ORDER BY updatedAt ASC, id ASC
LIMIT @limit";
            cmd.Parameters.AddWithValue("@limit", limit);

            var list = new List<WikiQueueItem>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                list.Add(new WikiQueueItem
                {
                    Id = reader.GetInt64(0),
                    NoteId = reader.GetString(1),
                    FileName = reader.GetString(2),
                    Content = reader.GetString(3),
                    UpdatedAt = reader.GetInt64(4),
                    Status = reader.GetInt32(5),
                    CreatedAt = reader.GetInt64(6),
                    PushedAt = reader.IsDBNull(7) ? null : reader.GetInt64(7)
                });
            }
            return list;
        }
    }

    /// <summary>
    /// 送信成功したキュー項目を送信済み（status = 1）にマーク（再送防止・冪等）
    /// </summary>
    public void MarkWikiMemosPushed(IEnumerable<long> ids, long? pushedAt = null)
    {
        var idList = ids.ToList();
        if (idList.Count == 0) return;

        var now = pushedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        lock (_lock)
        {
            using var tx = _connection.BeginTransaction();
            using var cmd = _connection.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE wiki_queue SET status = 1, pushedAt = @pushedAt WHERE id = @id";
            var idParam = cmd.Parameters.Add("@id", SqliteType.Integer);
            cmd.Parameters.AddWithValue("@pushedAt", now);

            foreach (var id in idList)
            {
                idParam.Value = id;
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }

    /// <summary>
    /// 送信完了した項目を削除する場合
    /// </summary>
    public void DeleteWikiMemos(IEnumerable<long> ids)
    {
        var idList = ids.ToList();
        if (idList.Count == 0) return;

        lock (_lock)
        {
            using var tx = _connection.BeginTransaction();
            using var cmd = _connection.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM wiki_queue WHERE id = @id";
            var idParam = cmd.Parameters.Add("@id", SqliteType.Integer);

            foreach (var id in idList)
            {
                idParam.Value = id;
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }

    public string? GetMeta(string key)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT value FROM meta WHERE key = @key";
            cmd.Parameters.AddWithValue("@key", key);

            var result = cmd.ExecuteScalar();
            if (result == null || result is DBNull) return null;

            var str = result.ToString();
            if (str == null) return null;

            try
            {
                using var doc = JsonDocument.Parse(str);
                if (doc.RootElement.ValueKind == JsonValueKind.String)
                {
                    return doc.RootElement.GetString();
                }
            }
            catch
            {
                // not a JSON or raw string
            }
            return str;
        }
    }

    public void SetMeta(string key, string? value)
    {
        lock (_lock)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)";
            cmd.Parameters.AddWithValue("@key", key);
            var jsonValue = JsonSerializer.Serialize(value);
            cmd.Parameters.AddWithValue("@value", jsonValue);
            cmd.ExecuteNonQuery();
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _connection.Dispose();
        }
    }
}
