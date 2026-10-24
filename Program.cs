using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace ZeusDisplay;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, @"Global\ZeusDisplay.SingleInstance", out bool isFirst);
        if (!isFirst) return;                       // already running

        bool startInTray = args.Contains("--tray"); // used by the logon task so it starts silently

        ApplicationConfiguration.Initialize();
        using var context = new TrayContext(startInTray);
        Application.Run(context);
    }
}

internal sealed class TrayContext : ApplicationContext
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern bool SetProcessWorkingSetSize(IntPtr process, IntPtr minimum, IntPtr maximum);

    private readonly Settings _settings = Settings.Load();
    private readonly Icon _appIcon = new(typeof(TrayContext), "Assets.app.ico");
    private readonly NotifyIcon _icon;
    private readonly DisplayDevice _device = new();
    private readonly SensorReader _sensors = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly System.Windows.Forms.Timer _trimTimer = new() { Interval = 3000 };

    private DashboardForm? _dashboard;
    private Reading _last;
    private int _tick;
    private DateTime _nextOpenAttempt = DateTime.MinValue;
    private bool _disposed;

    public TrayContext(bool startInTray)
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open dashboard", null, (_, _) => ShowDashboard());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());

        _icon = new NotifyIcon
        {
            Icon = _appIcon,
            Visible = true,
            Text = "Zeus Display",
            ContextMenuStrip = menu
        };
        _icon.DoubleClick += (_, _) => ShowDashboard();

        _trimTimer.Tick += (_, _) => { _trimTimer.Stop(); TrimMemory(); };

        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        _timer.Tick += OnTick;
        _timer.Start();

        if (startInTray) ScheduleTrim(); else ShowDashboard();
    }

    private void ShowDashboard()
    {
        if (_dashboard == null || _dashboard.IsDisposed)
        {
            _dashboard = new DashboardForm(_settings) { Icon = _appIcon };
            _dashboard.FormClosed += (_, _) =>
            {
                _dashboard = null;      // window and its WebView2 processes are gone; the tray app stays
                ScheduleTrim();
            };
        }
        _dashboard.ShowAndFocus();
    }

    private void OnPowerModeChanged(object? sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode != PowerModes.Resume) return;
        _device.Close();                                    // handle is stale after sleep
        _nextOpenAttempt = DateTime.Now.AddSeconds(3);      // let USB wake up first
    }

    private void OnTick(object? sender, EventArgs e)
    {
        bool secondTick = _tick++ % 4 == 0;                 // sensors, tray text and dashboard once a second
        if (secondTick) _last = _sensors.Read();

        if (!_device.IsOpen && DateTime.Now >= _nextOpenAttempt && !_device.TryOpen())
            _nextOpenAttempt = DateTime.Now.AddSeconds(2);

        bool sent = _device.IsOpen && _device.Send(Protocol.BuildFrame(_last, _settings.Fahrenheit));   // frames ~4/s

        if (!secondTick) return;
        SetText(sent ? TrayText() : _device.IsOpen ? "Display write failed" : "Display not found");
        _dashboard?.Push(_last, sent);
    }

    private string TrayText()
    {
        double t = _settings.Fahrenheit ? _last.CpuTemp * 9 / 5 + 32 : _last.CpuTemp;
        return $"CPU {t:0}\u00B0{(_settings.Fahrenheit ? 'F' : 'C')}  {_last.CpuUsage:0}%";
    }

    private void SetText(string text)
    {
        text = text.Length > 63 ? text[..63] : text;
        if (_icon.Text != text) _icon.Text = text;
    }

    private void ScheduleTrim() { _trimTimer.Stop(); _trimTimer.Start(); }

    /// <summary>
    /// Returns unused pages to Windows so the number Task Manager shows is the real working set.
    /// Pages that are needed again are simply loaded back on demand.
    /// </summary>
    private static void TrimMemory()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        SetProcessWorkingSetSize(GetCurrentProcess(), (IntPtr)(-1), (IntPtr)(-1));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            _timer.Stop();
            _trimTimer.Stop();
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            _dashboard?.Dispose();
            _device.Send(Protocol.ShutdownFrame());         // same idle packet the vendor app sends
            _device.Dispose();
            _sensors.Dispose();
            _icon.Visible = false;
            _icon.Dispose();
            _appIcon.Dispose();
        }
        base.Dispose(disposing);
    }
}
