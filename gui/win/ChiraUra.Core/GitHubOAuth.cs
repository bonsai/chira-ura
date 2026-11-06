using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChiraUra.Core;

public record DeviceCodeResponse(
    [property: JsonPropertyName("device_code")] string DeviceCode,
    [property: JsonPropertyName("user_code")] string UserCode,
    [property: JsonPropertyName("verification_uri")] string VerificationUri,
    [property: JsonPropertyName("expires_in")] int ExpiresIn,
    [property: JsonPropertyName("interval")] int Interval
);

public record OAuthTokenResponse(
    [property: JsonPropertyName("access_token")] string? AccessToken,
    [property: JsonPropertyName("token_type")] string? TokenType,
    [property: JsonPropertyName("scope")] string? Scope,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("error_description")] string? ErrorDescription
);

public interface ITokenStore
{
    string? GetToken();
    void SaveToken(string token);
    void ClearToken();
}

/// <summary>
/// Token store implementation: uses Windows DPAPI on Windows,
/// and falls back to encrypted/local storage or memory/file on other systems.
/// </summary>
public class DpapiTokenStore : ITokenStore
{
    private readonly string _storagePath;
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("chira-ura:github:oauth");

    public DpapiTokenStore(string? storagePath = null)
    {
        if (!string.IsNullOrEmpty(storagePath))
        {
            _storagePath = storagePath;
        }
        else
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (string.IsNullOrEmpty(home)) home = Environment.GetEnvironmentVariable("HOME") ?? ".";
            _storagePath = Path.Combine(home, ".chira", "gh_token.bin");
        }
    }

    public string? GetToken()
    {
        // 1. Environment variable override
        var envToken = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (!string.IsNullOrWhiteSpace(envToken)) return envToken;

        if (!File.Exists(_storagePath)) return null;

        try
        {
            var bytes = File.ReadAllBytes(_storagePath);
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
#pragma warning disable CA1416 // Validate platform compatibility
                var decrypted = ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(decrypted);
#pragma warning restore CA1416
            }
            else
            {
                // Fallback for Linux/macOS dev or test environments: base64 encoded
                var plain = Encoding.UTF8.GetString(Convert.FromBase64String(Encoding.UTF8.GetString(bytes)));
                return plain;
            }
        }
        catch
        {
            return null;
        }
    }

    public void SaveToken(string token)
    {
        var dir = Path.GetDirectoryName(_storagePath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var tokenBytes = Encoding.UTF8.GetBytes(token);
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
#pragma warning disable CA1416 // Validate platform compatibility
            var encrypted = ProtectedData.Protect(tokenBytes, Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(_storagePath, encrypted);
#pragma warning restore CA1416
        }
        else
        {
            var b64 = Convert.ToBase64String(tokenBytes);
            File.WriteAllBytes(_storagePath, Encoding.UTF8.GetBytes(b64));
        }
    }

    public void ClearToken()
    {
        if (File.Exists(_storagePath))
        {
            try { File.Delete(_storagePath); } catch { }
        }
    }
}

public class GitHubOAuth
{
    private const string DefaultDeviceCodeEndpoint = "https://github.com/login/device/code";
    private const string DefaultAccessTokenEndpoint = "https://github.com/login/oauth/access_token";

    private readonly HttpClient _httpClient;
    private readonly string _deviceCodeUrl;
    private readonly string _accessTokenUrl;
    private readonly ITokenStore _tokenStore;

    public GitHubOAuth(
        HttpClient? httpClient = null,
        ITokenStore? tokenStore = null,
        string? deviceCodeUrl = null,
        string? accessTokenUrl = null)
    {
        _httpClient = httpClient ?? new HttpClient();
        _tokenStore = tokenStore ?? new DpapiTokenStore();
        _deviceCodeUrl = deviceCodeUrl ?? DefaultDeviceCodeEndpoint;
        _accessTokenUrl = accessTokenUrl ?? DefaultAccessTokenEndpoint;
    }

    public ITokenStore TokenStore => _tokenStore;

    public string? GetSavedToken() => _tokenStore.GetToken();

    public void SaveToken(string token) => _tokenStore.SaveToken(token);

    public void Logout() => _tokenStore.ClearToken();

    /// <summary>
    /// Step 1: Request a device code and user verification code.
    /// POST https://github.com/login/device/code (client_id, scope=repo)
    /// </summary>
    public async Task<DeviceCodeResponse> RequestDeviceCodeAsync(
        string clientId,
        string scope = "repo",
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(clientId))
        {
            throw new ArgumentException("Client ID is required.", nameof(clientId));
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, _deviceCodeUrl);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("chira-ura-win", "0.2.0"));

        var payload = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["scope"] = scope
        };
        request.Content = new FormUrlEncodedContent(payload);

        var response = await _httpClient.SendAsync(request, ct).ConfigureAwait(false);
        var json = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"GitHub Device Flow request failed ({(int)response.StatusCode}): {json}");
        }

        var result = JsonSerializer.Deserialize<DeviceCodeResponse>(json);
        if (result == null || string.IsNullOrEmpty(result.DeviceCode))
        {
            throw new InvalidOperationException($"Invalid device code response from GitHub: {json}");
        }

        return result;
    }

    /// <summary>
    /// Step 2: Poll access token endpoint until approved, expired, or canceled.
    /// POST https://github.com/login/oauth/access_token
    /// </summary>
    public async Task<string> PollForAccessTokenAsync(
        string clientId,
        DeviceCodeResponse deviceCode,
        Func<int, Task>? delayFunc = null,
        CancellationToken ct = default)
    {
        delayFunc ??= async (sec) => await Task.Delay(sec * 1000, ct).ConfigureAwait(false);

        var interval = Math.Max(deviceCode.Interval, 5);
        var expiry = DateTimeOffset.UtcNow.AddSeconds(deviceCode.ExpiresIn > 0 ? deviceCode.ExpiresIn : 900);

        while (DateTimeOffset.UtcNow < expiry && !ct.IsCancellationRequested)
        {
            await delayFunc(interval).ConfigureAwait(false);

            using var request = new HttpRequestMessage(HttpMethod.Post, _accessTokenUrl);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("chira-ura-win", "0.2.0"));

            var payload = new Dictionary<string, string>
            {
                ["client_id"] = clientId,
                ["device_code"] = deviceCode.DeviceCode,
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code"
            };
            request.Content = new FormUrlEncodedContent(payload);

            var response = await _httpClient.SendAsync(request, ct).ConfigureAwait(false);
            var json = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Polling failed ({(int)response.StatusCode}): {json}");
            }

            var tokenResp = JsonSerializer.Deserialize<OAuthTokenResponse>(json);
            if (tokenResp == null)
            {
                continue;
            }

            if (!string.IsNullOrEmpty(tokenResp.AccessToken))
            {
                _tokenStore.SaveToken(tokenResp.AccessToken);
                return tokenResp.AccessToken;
            }

            if (!string.IsNullOrEmpty(tokenResp.Error))
            {
                switch (tokenResp.Error)
                {
                    case "authorization_pending":
                        // Continue waiting
                        break;
                    case "slow_down":
                        interval += 5;
                        break;
                    case "expired_token":
                        throw new TimeoutException("The device code has expired. Please run authorization again.");
                    case "access_denied":
                        throw new UnauthorizedAccessException("Authorization was denied by the user.");
                    default:
                        throw new InvalidOperationException($"GitHub OAuth error: {tokenResp.Error} ({tokenResp.ErrorDescription})");
                }
            }
        }

        ct.ThrowIfCancellationRequested();
        throw new TimeoutException("Timed out waiting for GitHub OAuth authorization.");
    }
}
