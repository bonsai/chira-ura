using Microsoft.Data.Sqlite;
using System.Text.Json;

namespace ChiraUra.Core;

public class NoteRepository : IDisposable
{
    public const string SchemaSql = @"
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
";

    private readonly string _dbPath;
    private readonly SqliteConnection _connection;

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

        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = "PRAGMA journal_mode = DELETE;";
            cmd.ExecuteNonQuery();
        }

        using (var cmd = _connection.CreateCommand())
        {
            cmd.CommandText = SchemaSql;
            cmd.ExecuteNonQuery();
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

    public List<Note> ListNotes(string query = "")
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

    private static string EscapeLike(string q)
    {
        var escaped = q.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");
        return $"%{escaped}%";
    }

    public bool UpsertNote(Note note)
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

    public bool RemoveNote(string id)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "DELETE FROM notes WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        return cmd.ExecuteNonQuery() > 0;
    }

    public string? GetMeta(string key)
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

    public void SetMeta(string key, string? value)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "INSERT OR REPLACE INTO meta (key, value) VALUES (@key, @value)";
        cmd.Parameters.AddWithValue("@key", key);
        var jsonValue = JsonSerializer.Serialize(value);
        cmd.Parameters.AddWithValue("@value", jsonValue);
        cmd.ExecuteNonQuery();
    }

    public void Dispose()
    {
        _connection.Dispose();
    }
}
