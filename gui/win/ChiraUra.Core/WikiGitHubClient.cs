using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ChiraUra.Core;

public record WikiFile(string FileName, string Content, long UpdatedAt);

public record WikiPushResult(string CommitSha, int FileCount);

public class WikiGitHubClient
{
    private const string DefaultApiBase = "https://api.github.com";
    private const string DefaultOwner = "bonsai";
    private const string DefaultRepo = "wiki";
    private const string DefaultBranch = "master";

    private readonly HttpClient _httpClient;
    private readonly string _apiBase;
    private readonly string _owner;
    private readonly string _repo;
    private readonly string _branch;
    private readonly string? _token;

    public WikiGitHubClient(
        HttpClient? httpClient = null,
        string? token = null,
        string? owner = null,
        string? repo = null,
        string? branch = null,
        string? apiBase = null)
    {
        _httpClient = httpClient ?? new HttpClient();
        _token = token ?? Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        _owner = owner ?? Environment.GetEnvironmentVariable("GITHUB_REPO_OWNER") ?? DefaultOwner;
        _repo = repo ?? Environment.GetEnvironmentVariable("GITHUB_REPO_NAME") ?? DefaultRepo;
        _branch = branch ?? Environment.GetEnvironmentVariable("GITHUB_BRANCH") ?? DefaultBranch;
        _apiBase = (apiBase ?? Environment.GetEnvironmentVariable("GITHUB_API_BASE") ?? DefaultApiBase).TrimEnd('/');
    }

    /// <summary>
    /// Derives 2-digit month string &lt;MM&gt; (01-12) from filename or updatedAt timestamp.
    /// Follows api/src/wiki-push.js getMonthDir logic.
    /// </summary>
    public static string GetMonthDir(string filename, long updatedAt = 0)
    {
        var match = Regex.Match(filename, @"\d{4}(\d{2})\d{2}[-_]\d{6}");
        if (match.Success)
        {
            return match.Groups[1].Value;
        }

        DateTimeOffset dt = updatedAt > 0
            ? DateTimeOffset.FromUnixTimeMilliseconds(updatedAt)
            : DateTimeOffset.UtcNow;
        return dt.Month.ToString("D2");
    }

    /// <summary>
    /// Pushes multiple files to bonsai/wiki (Git Data API) in a single commit under raw/&lt;MM&gt;/&lt;filename&gt;.
    /// Returns WikiPushResult on success, or null if files collection is empty.
    /// Throws InvalidOperationException on GitHub API errors.
    /// </summary>
    public async Task<WikiPushResult?> PushFilesBatchAsync(
        IReadOnlyList<WikiFile> files,
        string? tokenOverride = null,
        CancellationToken ct = default)
    {
        if (files == null || files.Count == 0)
        {
            return null;
        }

        var token = tokenOverride ?? _token;
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new InvalidOperationException("GitHub token is not configured.");
        }

        // 1. Get branch ref -> latest commit SHA
        var refUrl = $"{_apiBase}/repos/{_owner}/{_repo}/git/ref/heads/{_branch}";
        using var refReq = CreateRequest(HttpMethod.Get, refUrl, token);
        var refRes = await _httpClient.SendAsync(refReq, ct).ConfigureAwait(false);
        var refContent = await refRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!refRes.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to get git ref for {_branch} ({(int)refRes.StatusCode}): {refContent}");
        }

        using var refDoc = JsonDocument.Parse(refContent);
        var latestCommitSha = refDoc.RootElement.GetProperty("object").GetProperty("sha").GetString()
            ?? throw new InvalidOperationException("Failed to parse latest commit SHA.");

        // 2. Get latest commit -> base tree SHA
        var commitUrl = $"{_apiBase}/repos/{_owner}/{_repo}/git/commits/{latestCommitSha}";
        using var commitReq = CreateRequest(HttpMethod.Get, commitUrl, token);
        var commitRes = await _httpClient.SendAsync(commitReq, ct).ConfigureAwait(false);
        var commitContent = await commitRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!commitRes.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to get commit {latestCommitSha} ({(int)commitRes.StatusCode}): {commitContent}");
        }

        using var commitDoc = JsonDocument.Parse(commitContent);
        var baseTreeSha = commitDoc.RootElement.GetProperty("tree").GetProperty("sha").GetString()
            ?? throw new InvalidOperationException("Failed to parse base tree SHA.");

        // 3. Build tree items
        var treeItems = files.Select(file =>
        {
            var mm = GetMonthDir(file.FileName, file.UpdatedAt);
            var path = $"raw/{mm}/{file.FileName}";
            return new
            {
                path,
                mode = "100644",
                type = "blob",
                content = file.Content
            };
        }).ToArray();

        // 4. Create new tree
        var treeUrl = $"{_apiBase}/repos/{_owner}/{_repo}/git/trees";
        var treePayload = JsonSerializer.Serialize(new
        {
            base_tree = baseTreeSha,
            tree = treeItems
        });
        using var treeReq = CreateRequest(HttpMethod.Post, treeUrl, token, treePayload);
        var treeRes = await _httpClient.SendAsync(treeReq, ct).ConfigureAwait(false);
        var treeContent = await treeRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!treeRes.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to create tree ({(int)treeRes.StatusCode}): {treeContent}");
        }

        using var newTreeDoc = JsonDocument.Parse(treeContent);
        var newTreeSha = newTreeDoc.RootElement.GetProperty("sha").GetString()
            ?? throw new InvalidOperationException("Failed to parse new tree SHA.");

        // 5. Create new commit
        var summary = string.Join(", ", files.Select(f => f.FileName));
        var commitMessage = $"chore(wiki): add {files.Count} memo(s) [{summary}]";

        var newCommitUrl = $"{_apiBase}/repos/{_owner}/{_repo}/git/commits";
        var newCommitPayload = JsonSerializer.Serialize(new
        {
            message = commitMessage,
            tree = newTreeSha,
            parents = new[] { latestCommitSha }
        });
        using var newCommitReq = CreateRequest(HttpMethod.Post, newCommitUrl, token, newCommitPayload);
        var newCommitRes = await _httpClient.SendAsync(newCommitReq, ct).ConfigureAwait(false);
        var newCommitContent = await newCommitRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!newCommitRes.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to create commit ({(int)newCommitRes.StatusCode}): {newCommitContent}");
        }

        using var newCommitDoc = JsonDocument.Parse(newCommitContent);
        var newCommitSha = newCommitDoc.RootElement.GetProperty("sha").GetString()
            ?? throw new InvalidOperationException("Failed to parse new commit SHA.");

        // 6. Update branch ref
        var updateRefPayload = JsonSerializer.Serialize(new
        {
            sha = newCommitSha
        });
        using var updateRefReq = CreateRequest(HttpMethod.Patch, refUrl, token, updateRefPayload);
        var updateRefRes = await _httpClient.SendAsync(updateRefReq, ct).ConfigureAwait(false);
        var updateRefContent = await updateRefRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!updateRefRes.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Failed to update ref {_branch} ({(int)updateRefRes.StatusCode}): {updateRefContent}");
        }

        return new WikiPushResult(newCommitSha, files.Count);
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, string url, string token, string? jsonContent = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        req.Headers.UserAgent.Add(new ProductInfoHeaderValue("chira-ura-win", "0.2.0"));
        if (jsonContent != null)
        {
            req.Content = new StringContent(jsonContent, Encoding.UTF8, "application/json");
        }
        return req;
    }
}
