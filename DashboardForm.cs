using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace ZeusDisplay;

/// <summary>Hosts wwwroot/index.html in a WebView2 window. Closing it only hides it.</summary>
public sealed class DashboardForm : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly Settings _settings;
    private bool _ready;

    public DashboardForm(Settings settings)
    {
        _settings = settings;
        Text = "Zeus Display";
        ClientSize = new Size(560, 740);
        MinimumSize = new Size(440, 560);
        StartPosition = FormStartPosition.CenterScreen;

        BackColor = IsDarkTheme() ? Color.FromArgb(13, 18, 21) : Color.FromArgb(243, 245, 246);
        _web.DefaultBackgroundColor = BackColor;     // avoids a white flash before the page loads
        Controls.Add(_web);

        Load += async (_, _) => await InitAsync();
        FormClosing += (_, e) =>
        {
            if (e.CloseReason != CloseReason.UserClosing) return;
            e.Cancel = true;                         // keep the tray app running, just hide the window
            Hide();
        };
    }

    public void ShowAndFocus()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    /// <summary>Sends the latest reading (Celsius) to the page. Skipped while hidden.</summary>
    public void Push(Reading reading, bool displayConnected)
    {
        if (!_ready || !Visible || _web.CoreWebView2 == null) return;

        var json = JsonSerializer.Serialize(new
        {
            type = "state",
            temp = Finite(reading.CpuTemp),
            usage = Finite(reading.CpuUsage),
            connected = displayConnected,
            fahrenheit = _settings.Fahrenheit
        });
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    private async Task InitAsync()
    {
        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ZeusDisplay", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, userData);
            await _web.EnsureCoreWebView2Async(env);

            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.SetVirtualHostNameToFolderMapping(
                "zeus.local",
                Path.Combine(AppContext.BaseDirectory, "wwwroot"),
                CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += (_, _) => _ready = true;
            core.Navigate("https://zeus.local/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "The dashboard needs the Microsoft Edge WebView2 Runtime.\n\n" +
                "Install it with:  winget install Microsoft.EdgeWebView2Runtime\n\n" + ex.Message,
                "Zeus Display", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() == "setUnit")
            {
                _settings.Fahrenheit = root.GetProperty("fahrenheit").GetBoolean();
                _settings.Save();
            }
        }
        catch { /* ignore malformed messages */ }
    }

    private static double Finite(double x) => double.IsFinite(x) ? x : 0;

    private static bool IsDarkTheme() =>
        Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is int v && v == 0;
}
