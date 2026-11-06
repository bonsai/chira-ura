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
CREATE INDEX IF NOT EXISTS outbox_noteId ON outbox(noteId);";
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
