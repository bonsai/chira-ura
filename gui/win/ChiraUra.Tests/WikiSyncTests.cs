using System.Net;
using System.Text;
using System.Text.Json;
using ChiraUra.Core;
using Xunit;

namespace ChiraUra.Tests;

public class WikiSyncTests : IDisposable
{
    private readonly string _tempDbFile;
    private readonly NoteRepository _repository;

    public WikiSyncTests()
    {
        _tempDbFile = Path.Combine(Path.GetTempPath(), $"chira_wikitest_{Guid.NewGuid():N}.db");
        _repository = new NoteRepository(_tempDbFile);
    }

    [Fact]
    public void GetMonthDir_ExtractsFromFilename_OrTimestamp()
    {
        // 1. From filename pattern YYYYMMDD_HHMMSS
        Assert.Equal("11", WikiGitHubClient.GetMonthDir("20261105_123456.txt"));
        Assert.Equal("04", WikiGitHubClient.GetMonthDir("無題1_20260415_090000.txt"));

        // 2. From timestamp (2026-07-20T10:00:00Z = month 07)
        var dto = new DateTimeOffset(2026, 7, 20, 10, 0, 0, TimeSpan.Zero);
        Assert.Equal("07", WikiGitHubClient.GetMonthDir("random_note.txt", dto.ToUnixTimeMilliseconds()));
    }

    [Fact]
    public void OfflineAccumulation_PersistsMemosInTimestampOrder()
    {
        _repository.EnqueueWikiMemo("n1", "20261101_100000.txt", "Content 1", 1000);
        _repository.EnqueueWikiMemo("n3", "20261101_120000.txt", "Content 3", 3000);
        _repository.EnqueueWikiMemo("n2", "20261101_110000.txt", "Content 2", 2000);

        var pending = _repository.GetPendingWikiMemos(10);
        Assert.Equal(3, pending.Count);
        Assert.Equal("n1", pending[0].NoteId);
        Assert.Equal("n2", pending[1].NoteId);
        Assert.Equal("n3", pending[2].NoteId);
    }

    [Fact]
    public async Task WikiGitHubClient_PushesFilesInOneCommit_ViaGitDataApi()
    {
        var requests = new List<(string Method, string Url, string? Body)>();

        var handler = new MockHttpMessageHandler(req =>
        {
            var url = req.RequestUri?.ToString() ?? "";
            var method = req.Method.ToString();
            var body = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult();
            requests.Add((method, url, body));

            if (method == "GET" && url.EndsWith("/git/ref/heads/master"))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"object\":{\"sha\":\"base_commit_111\"}}")
                };
            }
            if (method == "GET" && url.EndsWith("/git/commits/base_commit_111"))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"tree\":{\"sha\":\"base_tree_222\"}}")
                };
            }
            if (method == "POST" && url.EndsWith("/git/trees"))
            {
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{\"sha\":\"new_tree_333\"}")
                };
            }
            if (method == "POST" && url.EndsWith("/git/commits"))
            {
                return new HttpResponseMessage(HttpStatusCode.Created)
                {
                    Content = new StringContent("{\"sha\":\"new_commit_444\"}")
                };
            }
            if (method == "PATCH" && url.EndsWith("/git/ref/heads/master"))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"object\":{\"sha\":\"new_commit_444\"}}")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.BadRequest);
        });

        var client = new WikiGitHubClient(
            httpClient: new HttpClient(handler),
            token: "test_token_123",
            owner: "bonsai",
            repo: "wiki",
            branch: "master",
            apiBase: "https://api.github.com");

        var files = new List<WikiFile>
        {
            new("20261106_100000.txt", "Memo 1 body", 1730887200000),
            new("20261106_110000.txt", "Memo 2 body", 1730890800000)
        };

        var result = await client.PushFilesBatchAsync(files);
        Assert.NotNull(result);
        Assert.Equal("new_commit_444", result.CommitSha);
        Assert.Equal(2, result.FileCount);

        // Verify POST /git/trees payload contains raw/<MM>/
        var treePost = requests.First(r => r.Method == "POST" && r.Url.EndsWith("/git/trees"));
        using var treeDoc = JsonDocument.Parse(treePost.Body!);
        Assert.Equal("base_tree_222", treeDoc.RootElement.GetProperty("base_tree").GetString());
        var treeArray = treeDoc.RootElement.GetProperty("tree");
        Assert.Equal(2, treeArray.GetArrayLength());
        Assert.Equal("raw/11/20261106_100000.txt", treeArray[0].GetProperty("path").GetString());
        Assert.Equal("raw/11/20261106_110000.txt", treeArray[1].GetProperty("path").GetString());

        // Verify commit message
        var commitPost = requests.First(r => r.Method == "POST" && r.Url.EndsWith("/git/commits"));
        using var commitDoc = JsonDocument.Parse(commitPost.Body!);
        var msg = commitDoc.RootElement.GetProperty("message").GetString();
        Assert.Contains("chore(wiki): add 2 memo(s)", msg);
    }

    [Fact]
    public async Task SyncService_Batches10ItemsAtATime_Idempotent_AndRetainsFractionsUntilFlushAll()
    {
        // Enqueue 23 notes offline
        for (int i = 1; i <= 23; i++)
        {
            var note = Note.Create($"Content #{i}", 10000 + i);
            _repository.UpsertNote(note);
            _repository.EnqueueWikiMemo(note.Id, $"20261106_00{i:D2}00.txt", note.Content, note.UpdatedAt);
        }

        var batchCommitCount = 0;
        var pushedFileCounts = new List<int>();

        var handler = new MockHttpMessageHandler(req =>
        {
            var url = req.RequestUri?.ToString() ?? "";
            var method = req.Method.ToString();

            if (method == "GET" && url.EndsWith("/git/ref/heads/master"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"object\":{\"sha\":\"base_c\"}}") };
            if (method == "GET" && url.EndsWith("/git/commits/base_c"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"tree\":{\"sha\":\"base_t\"}}") };
            if (method == "POST" && url.EndsWith("/git/trees"))
            {
                var body = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult();
                using var doc = JsonDocument.Parse(body!);
                pushedFileCounts.Add(doc.RootElement.GetProperty("tree").GetArrayLength());
                return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"sha\":\"tree_x\"}") };
            }
            if (method == "POST" && url.EndsWith("/git/commits"))
            {
                batchCommitCount++;
                return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"sha\":\"commit_x\"}") };
            }
            if (method == "PATCH" && url.EndsWith("/git/ref/heads/master"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"object\":{\"sha\":\"commit_x\"}}") };

            return new HttpResponseMessage(HttpStatusCode.BadRequest);
        });

        var wikiClient = new WikiGitHubClient(new HttpClient(handler), "test_token");
        var oauth = new GitHubOAuth(tokenStore: new MemoryTokenStore("test_token"));
        var syncService = new SyncService(_repository, wikiClient, oauth);

        // 1. Regular push (flushAll = false): only full batches of 10 are sent
        // 23 items -> 2 batches of 10 = 20 pushed, 3 remain
        var res1 = await syncService.PushPendingWikiBatchesAsync(batchSize: 10, flushAll: false);
        Assert.Equal(2, res1.PushedBatches);
        Assert.Equal(20, res1.PushedItems);
        Assert.Equal(3, res1.RemainingItems);
        Assert.Equal(new[] { 10, 10 }, pushedFileCounts);

        // Check SQLite pending count
        var pending1 = _repository.GetPendingWikiMemos(100);
        Assert.Equal(3, pending1.Count);

        // 2. Online return / app exit: FlushAll (flushAll = true)
        // 3 remaining items are pushed in 1 commit
        var res2 = await syncService.FlushAllAsync();
        Assert.Equal(1, res2.PushedBatches);
        Assert.Equal(3, res2.PushedItems);
        Assert.Equal(0, res2.RemainingItems);
        Assert.Equal(new[] { 10, 10, 3 }, pushedFileCounts);
        Assert.Equal(3, batchCommitCount);

        // Queue is completely empty
        Assert.Empty(_repository.GetPendingWikiMemos(100));

        // 3. Re-running flush does not resend (Idempotent)
        var res3 = await syncService.FlushAllAsync();
        Assert.Equal(0, res3.PushedBatches);
        Assert.Equal(0, res3.PushedItems);
        Assert.Equal(3, batchCommitCount);
    }

    [Fact]
    public async Task SyncService_FailedBatchRemainsInQueue_ForRetry()
    {
        // Enqueue 12 notes
        for (int i = 1; i <= 12; i++)
        {
            var note = Note.Create($"Content #{i}", 20000 + i);
            _repository.UpsertNote(note);
            _repository.EnqueueWikiMemo(note.Id, $"20261106_12{i:D2}00.txt", note.Content, note.UpdatedAt);
        }

        var shouldFail = true;
        var handler = new MockHttpMessageHandler(req =>
        {
            if (shouldFail)
            {
                return new HttpResponseMessage(HttpStatusCode.InternalServerError)
                {
                    Content = new StringContent("GitHub API Error 500")
                };
            }
            var url = req.RequestUri?.ToString() ?? "";
            var method = req.Method.ToString();
            if (method == "GET" && url.EndsWith("/git/ref/heads/master"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"object\":{\"sha\":\"base_c\"}}") };
            if (method == "GET" && url.EndsWith("/git/commits/base_c"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"tree\":{\"sha\":\"base_t\"}}") };
            if (method == "POST" && url.EndsWith("/git/trees"))
                return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"sha\":\"tree_x\"}") };
            if (method == "POST" && url.EndsWith("/git/commits"))
                return new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"sha\":\"commit_x\"}") };
            if (method == "PATCH" && url.EndsWith("/git/ref/heads/master"))
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"object\":{\"sha\":\"commit_x\"}}") };

            return new HttpResponseMessage(HttpStatusCode.BadRequest);
        });

        var wikiClient = new WikiGitHubClient(new HttpClient(handler), "test_token");
        var oauth = new GitHubOAuth(tokenStore: new MemoryTokenStore("test_token"));
        var syncService = new SyncService(_repository, wikiClient, oauth);

        // Attempt sync while offline / failing
        var failedResult = await syncService.PushPendingWikiBatchesAsync(batchSize: 10, flushAll: true);
        Assert.NotNull(failedResult.LastError);
        Assert.Equal(0, failedResult.PushedBatches);
        Assert.Equal(12, failedResult.RemainingItems);

        // All 12 items remain in local SQLite
        Assert.Equal(12, _repository.GetPendingWikiMemos(100).Count);

        // Network recovers
        shouldFail = false;
        var successResult = await syncService.FlushAllAsync();
        Assert.Null(successResult.LastError);
        Assert.Equal(2, successResult.PushedBatches); // 10 + 2
        Assert.Equal(12, successResult.PushedItems);
        Assert.Equal(0, successResult.RemainingItems);
        Assert.Empty(_repository.GetPendingWikiMemos(100));
    }

    [Fact]
    public async Task GitHubOAuth_DeviceFlow_RequestsCodeAndPollsUntilApproved()
    {
        var pollCount = 0;
        var handler = new MockHttpMessageHandler(req =>
        {
            var url = req.RequestUri?.ToString() ?? "";
            if (url.EndsWith("/login/device/code"))
            {
                var json = JsonSerializer.Serialize(new
                {
                    device_code = "mock_device_code_123",
                    user_code = "WDJB-MJHT",
                    verification_uri = "https://github.com/login/device",
                    expires_in = 900,
                    interval = 1
                });
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) };
            }
            if (url.EndsWith("/login/oauth/access_token"))
            {
                pollCount++;
                if (pollCount < 2)
                {
                    // First poll: authorization pending
                    var pendingJson = JsonSerializer.Serialize(new
                    {
                        error = "authorization_pending",
                        error_description = "The authorization request is still pending."
                    });
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(pendingJson) };
                }
                // Second poll: approved
                var approvedJson = JsonSerializer.Serialize(new
                {
                    access_token = "gho_mock_access_token_xyz",
                    token_type = "bearer",
                    scope = "repo"
                });
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(approvedJson) };
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        });

        var tokenStore = new MemoryTokenStore();
        var oauth = new GitHubOAuth(
            httpClient: new HttpClient(handler),
            tokenStore: tokenStore,
            deviceCodeUrl: "https://github.local/login/device/code",
            accessTokenUrl: "https://github.local/login/oauth/access_token");

        // 1. Request device code
        var codeResp = await oauth.RequestDeviceCodeAsync("client_id_test");
        Assert.Equal("mock_device_code_123", codeResp.DeviceCode);
        Assert.Equal("WDJB-MJHT", codeResp.UserCode);
        Assert.Equal("https://github.com/login/device", codeResp.VerificationUri);

        // 2. Poll for access token (instant mock delay)
        var token = await oauth.PollForAccessTokenAsync("client_id_test", codeResp, delayFunc: _ => Task.CompletedTask);
        Assert.Equal("gho_mock_access_token_xyz", token);
        Assert.Equal("gho_mock_access_token_xyz", tokenStore.GetToken());

        // 3. Logout
        oauth.Logout();
        Assert.Null(tokenStore.GetToken());
    }

    public void Dispose()
    {
        _repository.Dispose();
        if (File.Exists(_tempDbFile))
        {
            try { File.Delete(_tempDbFile); } catch { }
        }
    }
}

public class MemoryTokenStore : ITokenStore
{
    private string? _token;

    public MemoryTokenStore(string? initialToken = null)
    {
        _token = initialToken;
    }

    public string? GetToken() => _token;

    public void SaveToken(string token) => _token = token;

    public void ClearToken() => _token = null;
}
