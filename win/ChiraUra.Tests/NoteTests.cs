using System.Net;
using System.Text.Json;
using ChiraUra.Core;
using Xunit;

namespace ChiraUra.Tests;

public class NoteTests
{
    [Fact]
    public void DeriveTitle_FirstLineUpTo30Chars()
    {
        Assert.Equal("無題", Note.DeriveTitle(""));
        Assert.Equal("無題", Note.DeriveTitle("   \n\n  "));
        Assert.Equal("Short title", Note.DeriveTitle("  Short title  \nSecond line"));
        Assert.Equal("123456789012345678901234567890", Note.DeriveTitle("123456789012345678901234567890Extra Characters"));
    }

    [Fact]
    public void Note_Serialization_MatchesExpectedJson()
    {
        var note = new Note
        {
            Id = "note-12345",
            Title = "Test Title",
            Content = "Test Content",
            UpdatedAt = 1700000000000
        };

        var json = JsonSerializer.Serialize(note);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("note-12345", root.GetProperty("id").GetString());
        Assert.Equal("Test Title", root.GetProperty("title").GetString());
        Assert.Equal("Test Content", root.GetProperty("content").GetString());
        Assert.Equal(1700000000000, root.GetProperty("updatedAt").GetInt64());
    }
}

public class NoteRepositoryTests : IDisposable
{
    private readonly string _tempDbFile;
    private readonly NoteRepository _repository;

    public NoteRepositoryTests()
    {
        _tempDbFile = Path.Combine(Path.GetTempPath(), $"chira_test_{Guid.NewGuid():N}.db");
        _repository = new NoteRepository(_tempDbFile);
    }

    [Fact]
    public void Repository_CanInsert_Get_List_And_Remove()
    {
        var note1 = Note.Create("First line\nSecond line", 1000);
        var note2 = Note.Create("Another note\nDetails", 2000);

        Assert.True(_repository.UpsertNote(note1));
        Assert.True(_repository.UpsertNote(note2));

        var retrieved = _repository.GetNote(note1.Id);
        Assert.NotNull(retrieved);
        Assert.Equal("First line", retrieved.Title);
        Assert.Equal("First line\nSecond line", retrieved.Content);

        var all = _repository.ListNotes();
        Assert.Equal(2, all.Count);
        Assert.Equal(note2.Id, all[0].Id); // newer first

        var filtered = _repository.ListNotes("Another");
        Assert.Single(filtered);
        Assert.Equal(note2.Id, filtered[0].Id);

        Assert.True(_repository.RemoveNote(note1.Id));
        Assert.Null(_repository.GetNote(note1.Id));
    }

    [Fact]
    public void Repository_Meta_StoresAndRetrieves()
    {
        _repository.SetMeta("activeNoteId", "note-999");
        var val = _repository.GetMeta("activeNoteId");
        Assert.Equal("note-999", val);
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

public class SyncServiceTests : IDisposable
{
    private readonly string _tempDbFile;
    private readonly NoteRepository _repository;

    public SyncServiceTests()
    {
        _tempDbFile = Path.Combine(Path.GetTempPath(), $"chira_sync_{Guid.NewGuid():N}.db");
        _repository = new NoteRepository(_tempDbFile);
    }

    [Fact]
    public async Task SyncService_SavesLocally_AndCallsApi()
    {
        string? capturedPath = null;
        string? capturedBody = null;
        string? capturedAuth = null;

        var handler = new MockHttpMessageHandler(req =>
        {
            capturedPath = req.RequestUri?.PathAndQuery;
            capturedAuth = req.Headers.Authorization?.ToString();
            capturedBody = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"ok\":true}")
            };
        });

        var httpClient = new HttpClient(handler);
        var apiClient = new ChiraApiClient(httpClient, "http://api.local:8787", "test-secret-token");
        var sync = new SyncService(_repository, apiClient);

        var note = Note.Create("Hello World\nBody content", 1234567890);
        var success = await sync.SaveAndSyncAsync(note, closed: true);

        Assert.True(success);
        Assert.NotNull(_repository.GetNote(note.Id));
        Assert.Equal($"/inbox/{note.Id}.txt", capturedPath);
        Assert.Equal("Bearer test-secret-token", capturedAuth);

        using var doc = JsonDocument.Parse(capturedBody!);
        Assert.Equal("Hello World", doc.RootElement.GetProperty("title").GetString());
        Assert.True(doc.RootElement.GetProperty("closed").GetBoolean());

        var pending = _repository.GetPendingOutbox();
        Assert.Empty(pending);
    }

    [Fact]
    public async Task SyncService_FallsBackToOutbox_WhenApiFails_AndFlushesWhenBackOnline()
    {
        var shouldSucceed = false;
        var handler = new MockHttpMessageHandler(_ =>
        {
            if (shouldSucceed)
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"ok\":true}")
                };
            }
            return new HttpResponseMessage(HttpStatusCode.InternalServerError);
        });

        var httpClient = new HttpClient(handler);
        var apiClient = new ChiraApiClient(httpClient, "http://api.local:8787", "token");
        var sync = new SyncService(_repository, apiClient);

        var note = Note.Create("Offline note", 5000);
        var success = await sync.SaveAndSyncAsync(note, closed: false);

        Assert.False(success);
        // Note is saved in SQLite
        Assert.NotNull(_repository.GetNote(note.Id));

        // Enqueued in outbox
        var pending = _repository.GetPendingOutbox();
        Assert.Single(pending);
        Assert.Equal(note.Id, pending[0].NoteId);

        // When connection is restored, flushing outbox succeeds and empties queue
        shouldSucceed = true;
        var flushed = await sync.FlushOutboxAsync();
        Assert.Equal(1, flushed);
        Assert.Empty(_repository.GetPendingOutbox());
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

public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public MockHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        _responder = responder;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        return Task.FromResult(_responder(request));
    }
}
