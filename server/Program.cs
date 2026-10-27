// Azure Echo server — accounts, cloud progress and the global leaderboard.
//
//   GET  /api/health                       -> { status: "ok" }
//   POST /api/register {username,password} -> { token, username, progress }
//   POST /api/login    {username,password} -> { token, username, progress }
//   POST /api/logout                       (needs token)
//   GET  /api/me                           (needs token) -> { username, progress }
//   PUT  /api/progress {progress}          (needs token) -> merged progress
//   GET  /api/scores                       -> top 10 divers (best score each)
//   POST /api/scores {score,zone,round}    (needs token) -> top 10
//
// "needs token" = header  Authorization: Bearer <token>
// Everything is stored in data.json next to the program (see DATA_DIR below).

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
builder.Services.AddSingleton<Store>();

// CORS lets your Vercel website talk to this server.
// When you host this server, set ALLOWED_ORIGIN to your Vercel address,
// e.g. https://azure-echo.vercel.app  (several can be separated by commas).
var allowedOrigin = Environment.GetEnvironmentVariable("ALLOWED_ORIGIN");
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    if (string.IsNullOrWhiteSpace(allowedOrigin))
        policy.AllowAnyOrigin();
    else
        policy.WithOrigins(allowedOrigin.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    policy.WithMethods("GET", "POST", "PUT").WithHeaders("Content-Type", "Authorization");
}));

var app = builder.Build();
app.UseCors();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

// ---------- accounts ----------

app.MapPost("/api/register", (Credentials c, Store store) =>
{
    var username = (c.Username ?? "").Trim();
    var password = c.Password ?? "";
    if (!Regex.IsMatch(username, @"^[A-Za-z0-9_.-]{3,20}$"))
        return Results.BadRequest(new { error = "Name must be 3-20 letters, numbers, dots, dashes or underscores." });
    if (password.Length < 8 || password.Length > 100)
        return Results.BadRequest(new { error = "Password must be 8 to 100 characters." });

    var user = store.CreateUser(username, password);
    if (user is null) return Results.Conflict(new { error = "That diver name is already taken." });
    return Results.Ok(new { token = store.IssueToken(user), username = user.Username, progress = user.Progress });
});

app.MapPost("/api/login", (Credentials c, Store store) =>
{
    var result = store.CheckLogin((c.Username ?? "").Trim(), c.Password ?? "", out var user);
    if (result == LoginResult.Locked)
        return Results.Json(new { error = "Too many tries. Wait 15 minutes and try again." }, statusCode: 429);
    if (result != LoginResult.Ok || user is null)
        return Results.Json(new { error = "Wrong name or password." }, statusCode: 401);
    return Results.Ok(new { token = store.IssueToken(user), username = user.Username, progress = user.Progress });
});

app.MapPost("/api/logout", (HttpRequest req, Store store) =>
{
    store.RevokeToken(Bearer(req));
    return Results.Ok(new { ok = true });
});

app.MapGet("/api/me", (HttpRequest req, Store store) =>
{
    var user = store.UserByToken(Bearer(req));
    return user is null ? Results.Unauthorized() : Results.Ok(new { username = user.Username, progress = user.Progress });
});

app.MapPut("/api/progress", (ProgressRequest body, HttpRequest req, Store store) =>
{
    var user = store.UserByToken(Bearer(req));
    if (user is null) return Results.Unauthorized();
    return Results.Ok(store.MergeProgress(user, body.Progress));
});

// ---------- leaderboard ----------

app.MapGet("/api/scores", (Store store) => Results.Ok(store.TopScores(10)));

app.MapPost("/api/scores", (ScoreSubmission s, HttpRequest req, Store store) =>
{
    var user = store.UserByToken(Bearer(req));
    if (user is null) return Results.Unauthorized();
    if (s.Score < 1 || s.Score > 1_000_000 || s.Round < 0 || s.Round > 999)
        return Results.BadRequest(new { error = "Invalid score." });

    var zone = (s.Zone ?? "").Trim();
    if (zone.Length > 30) zone = zone[..30];
    store.AddScore(new ScoreEntry(user.Username, s.Score, zone, s.Round, DateTime.UtcNow));
    return Results.Ok(store.TopScores(10));
});

app.Run();

static string Bearer(HttpRequest req)
{
    var header = req.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : "";
}

// ---------- types (must stay below the top-level code above) ----------

record Credentials(string? Username, string? Password);
record ProgressRequest(Progress? Progress);
record ScoreSubmission(int Score, string? Zone, int Round);
record ScoreEntry(string Name, int Score, string Zone, int Round, DateTime CreatedAt);

class Progress
{
    public int UnlockedZone { get; set; }
    public bool EndlessUnlocked { get; set; }
    public int[] BestRounds { get; set; } = new int[4];
    public int BestScore { get; set; }
}

class TokenRecord
{
    public string Hash { get; set; } = "";
    public DateTime Created { get; set; }
}

class User
{
    public string Username { get; set; } = "";
    public string Salt { get; set; } = "";       // base64
    public string PasswordHash { get; set; } = ""; // base64 (PBKDF2, never the real password)
    public int FailedLogins { get; set; }
    public DateTime? LockedUntil { get; set; }
    public Progress Progress { get; set; } = new();
    public List<TokenRecord> Tokens { get; set; } = new();
}

class DataFile
{
    public List<User> Users { get; set; } = new();
    public List<ScoreEntry> Scores { get; set; } = new();
}

enum LoginResult { Ok, Wrong, Locked }

class Store
{
    private const int Iterations = 210_000;
    private static readonly TimeSpan TokenLife = TimeSpan.FromDays(30);

    private readonly object _lock = new();
    private readonly string _path;
    private DataFile _data = new();

    public Store()
    {
        var dir = Environment.GetEnvironmentVariable("DATA_DIR") ?? AppContext.BaseDirectory;
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "data.json");
        try
        {
            if (File.Exists(_path))
                _data = JsonSerializer.Deserialize<DataFile>(File.ReadAllText(_path)) ?? new();
        }
        catch { _data = new(); } // a damaged file starts fresh instead of crashing
    }

    private void Save()
    {
        try { File.WriteAllText(_path, JsonSerializer.Serialize(_data)); }
        catch { /* keep running even if the disk is read-only */ }
    }

    private static byte[] Hash(string password, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);

    private static string TokenHash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static User? Find(DataFile data, string username) =>
        data.Users.FirstOrDefault(u => u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));

    public User? CreateUser(string username, string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Hash(password, salt);
        lock (_lock)
        {
            if (Find(_data, username) is not null) return null;
            var user = new User { Username = username, Salt = Convert.ToBase64String(salt), PasswordHash = Convert.ToBase64String(hash) };
            _data.Users.Add(user);
            Save();
            return user;
        }
    }

    public LoginResult CheckLogin(string username, string password, out User? user)
    {
        User? found;
        lock (_lock) found = Find(_data, username);
        user = null;

        if (found is null)
        {
            Hash(password, new byte[16]); // same work as a real check, so timing does not reveal which names exist
            return LoginResult.Wrong;
        }

        lock (_lock)
        {
            if (found.LockedUntil is DateTime until && until > DateTime.UtcNow) return LoginResult.Locked;
        }

        var expected = Convert.FromBase64String(found.PasswordHash);
        var actual = Hash(password, Convert.FromBase64String(found.Salt));
        var ok = CryptographicOperations.FixedTimeEquals(expected, actual);

        lock (_lock)
        {
            if (ok)
            {
                found.FailedLogins = 0;
                found.LockedUntil = null;
                Save();
                user = found;
                return LoginResult.Ok;
            }
            found.FailedLogins += 1;
            if (found.FailedLogins >= 5)
            {
                found.LockedUntil = DateTime.UtcNow.AddMinutes(15);
                found.FailedLogins = 0;
            }
            Save();
            return LoginResult.Wrong;
        }
    }

    public string IssueToken(User user)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        lock (_lock)
        {
            user.Tokens.RemoveAll(t => DateTime.UtcNow - t.Created > TokenLife);
            user.Tokens.Add(new TokenRecord { Hash = TokenHash(token), Created = DateTime.UtcNow });
            if (user.Tokens.Count > 5) user.Tokens.RemoveRange(0, user.Tokens.Count - 5); // keep the 5 newest devices
            Save();
        }
        return token;
    }

    public User? UserByToken(string token)
    {
        if (string.IsNullOrEmpty(token)) return null;
        var hash = TokenHash(token);
        lock (_lock)
        {
            return _data.Users.FirstOrDefault(u =>
                u.Tokens.Any(t => t.Hash == hash && DateTime.UtcNow - t.Created <= TokenLife));
        }
    }

    public void RevokeToken(string token)
    {
        if (string.IsNullOrEmpty(token)) return;
        var hash = TokenHash(token);
        lock (_lock)
        {
            foreach (var u in _data.Users) u.Tokens.RemoveAll(t => t.Hash == hash);
            Save();
        }
    }

    /// Keeps the best of what the server has and what the phone/computer sends.
    public Progress MergeProgress(User user, Progress? incoming)
    {
        lock (_lock)
        {
            var p = user.Progress;
            if (incoming is not null)
            {
                p.UnlockedZone = Math.Clamp(Math.Max(p.UnlockedZone, incoming.UnlockedZone), 0, 3);
                p.EndlessUnlocked = p.EndlessUnlocked || incoming.EndlessUnlocked;
                p.BestScore = Math.Clamp(Math.Max(p.BestScore, incoming.BestScore), 0, 1_000_000);
                var rounds = incoming.BestRounds ?? new int[4];
                for (var i = 0; i < 4; i++)
                {
                    var theirs = i < rounds.Length ? rounds[i] : 0;
                    p.BestRounds[i] = Math.Clamp(Math.Max(p.BestRounds[i], theirs), 0, 999);
                }
                Save();
            }
            return p;
        }
    }

    public void AddScore(ScoreEntry entry)
    {
        lock (_lock)
        {
            _data.Scores.Add(entry);
            // keep only each diver's 5 best, so the file never grows forever
            _data.Scores = _data.Scores
                .GroupBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .SelectMany(g => g.OrderByDescending(s => s.Score).Take(5))
                .ToList();
            Save();
        }
    }

    /// One row per diver (their best score).
    public List<ScoreEntry> TopScores(int count)
    {
        lock (_lock)
        {
            return _data.Scores
                .GroupBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.OrderByDescending(s => s.Score).First())
                .OrderByDescending(s => s.Score)
                .Take(count)
                .ToList();
        }
    }
}
