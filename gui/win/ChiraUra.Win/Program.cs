namespace ChiraUra.Win;

static class Program
{
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".chira", "chira-crash.log");

    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        AppDomain.CurrentDomain.UnhandledException += (s, e) => Log(e.ExceptionObject?.ToString() ?? "unknown");
        Application.ThreadException += (s, e) => Log(e.Exception.ToString());

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new StickyNoteForm());
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            throw;
        }
    }

    private static void Log(string text)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.AppendAllText(LogPath, DateTimeOffset.Now + " " + text + Environment.NewLine + Environment.NewLine);
        }
        catch
        {
            // ログに失敗しても落とさない
        }
    }
}
