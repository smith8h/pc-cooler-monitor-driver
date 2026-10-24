using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace ZeusDisplay;

/// <summary>
/// Hosts wwwroot/index.html in a WebView2 window. Closing the window disposes it completely, which
/// ends the WebView2 helper processes; the tray app keeps running and reopens it on demand.
/// </summary>
public sealed class DashboardForm : Form
{
    private const int DwmUseImmersiveDarkMode = 20;
    private const int DwmCaptionColor = 35;
    private const int DwmTextColor = 36;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    // Same values as --bg / --ink in dashboard.css, so the title bar and the page look like one surface.
    private static readonly Color DarkBack = Color.FromArgb(10, 16, 19);
    private static readonly Color LightBack = Color.FromArgb(237, 241, 243);
    private static readonly Color DarkText = Color.FromArgb(233, 241, 244);
    private static readonly Color LightText = Color.FromArgb(20, 33, 42);

    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly Settings _settings;
    private bool _ready;

    public DashboardForm(Settings settings)
    {
        _settings = settings;
        Text = "Zeus Display";
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1040, 760);
        MinimumSize = new Size(820, 560);
        StartPosition = FormStartPosition.CenterScreen;

        SetSurfaceColors();                          // also avoids a flash before the page loads
        Controls.Add(_web);

        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        Load += async (_, _) => { FitToScreen(); await InitAsync(); };
        Resize += (_, _) => UpdateMemoryTarget();
    }

    public void ShowAndFocus()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    /// <summary>Sends the latest reading (Celsius) to the page. Skipped while minimized.</summary>
    public void Push(Reading reading, bool displayConnected)
    {
        if (!_ready || _web.CoreWebView2 == null || WindowState == FormWindowState.Minimized) return;

        var json = JsonSerializer.Serialize(new
        {
            type = "state",
            temp = Finite(reading.CpuTemp),
            usage = Finite(reading.CpuUsage),
            connected = displayConnected,
            fahrenheit = _settings.Fahrenheit,
            theme = _settings.Theme
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
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.SetVirtualHostNameToFolderMapping(
                "zeus.local",
                Path.Combine(AppContext.BaseDirectory, "wwwroot"),
                CoreWebView2HostResourceAccessKind.Allow);

            // The page reads this before it paints, so an explicit Light/Dark choice never flashes the other theme.
            await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__theme = '{_settings.Theme}';");

            core.WebMessageReceived += OnWebMessage;
            core.NavigationCompleted += (_, _) => _ready = true;
            core.Navigate("https://zeus.local/index.html");
            UpdateMemoryTarget();
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
            switch (root.GetProperty("type").GetString())
            {
                case "setUnit":
                    _settings.Fahrenheit = root.GetProperty("fahrenheit").GetBoolean();
                    _settings.Save();
                    break;
                case "setTheme":
                    _settings.Theme = Settings.NormalizeTheme(root.GetProperty("theme").GetString());
                    _settings.Save();
                    ApplyChrome();
                    break;
            }
        }
        catch { /* ignore malformed messages */ }
    }

    /* ---------- Theme: window background and title bar follow Light / Dark / Auto ---------- */

    private bool UseDark => _settings.Theme switch
    {
        "dark" => true,
        "light" => false,
        _ => SystemUsesDark()
    };

    private void SetSurfaceColors()
    {
        BackColor = UseDark ? DarkBack : LightBack;
        _web.DefaultBackgroundColor = BackColor;
    }

    private void ApplyChrome()
    {
        SetSurfaceColors();
        if (!IsHandleCreated) return;

        bool dark = UseDark;
        int immersive = dark ? 1 : 0;
        int caption = ToColorRef(dark ? DarkBack : LightBack);
        int text = ToColorRef(dark ? DarkText : LightText);
        // Windows 10 ignores the last two; Windows 11 uses them to colour the title bar.
        DwmSetWindowAttribute(Handle, DwmUseImmersiveDarkMode, ref immersive, sizeof(int));
        DwmSetWindowAttribute(Handle, DwmCaptionColor, ref caption, sizeof(int));
        DwmSetWindowAttribute(Handle, DwmTextColor, ref text, sizeof(int));
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyChrome();
    }

    private void OnUserPreferenceChanged(object? sender, UserPreferenceChangedEventArgs e)
    {
        if (_settings.Theme != "system" || IsDisposed || !IsHandleCreated) return;
        BeginInvoke(new Action(ApplyChrome));              // Windows switched between light and dark
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        base.Dispose(disposing);
    }

    /* ---------- Small helpers ---------- */

    private void FitToScreen()
    {
        var area = Screen.FromControl(this).WorkingArea;
        int width = Math.Min(Width, area.Width - 24), height = Math.Min(Height, area.Height - 24);
        if (width == Width && height == Height) return;
        Size = new Size(width, height);
        CenterToScreen();
    }

    private void UpdateMemoryTarget()
    {
        var core = _web.CoreWebView2;
        if (core == null) return;
        try
        {
            core.MemoryUsageTargetLevel = WindowState == FormWindowState.Minimized
                ? CoreWebView2MemoryUsageTargetLevel.Low
                : CoreWebView2MemoryUsageTargetLevel.Normal;
        }
        catch { /* older WebView2 runtimes do not have this */ }
    }

    private static int ToColorRef(Color c) => c.R | (c.G << 8) | (c.B << 16);

    private static double Finite(double x) => double.IsFinite(x) ? x : 0;

    private static bool SystemUsesDark() =>
        Registry.GetValue(
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is int v && v == 0;
}
