using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChiraUra.Core;

public class InboxPayload
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("updatedAt")]
    public long UpdatedAt { get; set; }

    [JsonPropertyName("closed")]
    public bool Closed { get; set; }
}

public class ChiraApiClient
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private readonly string? _token;

    public ChiraApiClient(HttpClient? httpClient = null, string? baseUrl = null, string? token = null)
    {
        _httpClient = httpClient ?? new HttpClient();
        _baseUrl = (baseUrl ?? Environment.GetEnvironmentVariable("CHIRA_API_URL") ?? "http://127.0.0.1:8787").TrimEnd('/');
        _token = token ?? Environment.GetEnvironmentVariable("CHIRA_TOKEN");
    }

    public async Task<bool> SendInboxAsync(string name, Note note, bool closed = false, CancellationToken ct = default)
    {
        var requestUrl = $"{_baseUrl}/inbox/{Uri.EscapeDataString(name)}";
        var payload = new InboxPayload
        {
            Title = note.Title,
            Content = note.Content,
            UpdatedAt = note.UpdatedAt,
            Closed = closed
        };

        var json = JsonSerializer.Serialize(payload);
        using var request = new HttpRequestMessage(HttpMethod.Put, requestUrl)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };

        if (!string.IsNullOrEmpty(_token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
            request.Headers.TryAddWithoutValidation("X-Chira-Token", _token);
        }

        try
        {
            var response = await _httpClient.SendAsync(request, ct);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }
}
