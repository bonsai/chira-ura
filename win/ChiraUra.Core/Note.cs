using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChiraUra.Core;

public class Note
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("updatedAt")]
    public long UpdatedAt { get; set; }

    public static string DeriveTitle(string? content)
    {
        if (string.IsNullOrEmpty(content)) return "無題";

        var lines = content.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (!string.IsNullOrEmpty(trimmed))
            {
                return trimmed.Length <= 30 ? trimmed : trimmed[..30];
            }
        }
        return "無題";
    }

    private const string Base36Chars = "0123456789abcdefghijklmnopqrstuvwxyz";

    public static string ToBase36(int value, int minDigits = 4)
    {
        if (value == 0) return new string('0', minDigits);
        var sb = new System.Text.StringBuilder();
        while (value > 0)
        {
            sb.Insert(0, Base36Chars[value % 36]);
            value /= 36;
        }
        while (sb.Length < minDigits)
        {
            sb.Insert(0, '0');
        }
        return sb.ToString();
    }

    public static string NewNoteId(long? now = null)
    {
        var timestamp = now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var rand = ToBase36(Random.Shared.Next(0, 1679616), 4);
        return $"note-{timestamp}-{rand}";
    }

    public static Note Create(string content, long? now = null)
    {
        var timestamp = now ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new Note
        {
            Id = NewNoteId(timestamp),
            Title = DeriveTitle(content),
            Content = content ?? string.Empty,
            UpdatedAt = timestamp
        };
    }
}
