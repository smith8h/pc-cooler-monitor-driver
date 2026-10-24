using System.Text.Json;

namespace ZeusDisplay;

public sealed class Settings
{
    public bool Fahrenheit { get; set; }

    /// <summary>"system" (follow Windows), "light" or "dark".</summary>
    public string Theme { get; set; } = "system";

    public static string NormalizeTheme(string? theme) =>
        theme is "light" or "dark" ? theme : "system";

    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "ZeusDisplay", "settings.json");

    public static Settings Load()
    {
        try
        {
            var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
            settings.Theme = NormalizeTheme(settings.Theme);
            return settings;
        }
        catch { return new Settings(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
        }
        catch { /* settings are a convenience; never crash the display loop over them */ }
    }
}
