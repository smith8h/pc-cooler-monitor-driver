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
    private readonly Settings _settings = Settings.Load();
    private readonly Icon _appIcon = new(typeof(TrayContext), "Assets.app.ico");
    private readonly NotifyIcon _icon;
    private readonly DisplayDevice _device = new();
    private readonly SensorReader _sensors = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };

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

        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        _timer.Tick += OnTick;
        _timer.Start();

        if (!startInTray) ShowDashboard();
    }

    private void ShowDashboard()
    {
        _dashboard ??= new DashboardForm(_settings) { Icon = _appIcon };
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
        if (_tick++ % 4 == 0) _last = _sensors.Read();      // sensors ~1/s, frames ~4/s

        if (!_device.IsOpen)
        {
            if (DateTime.Now < _nextOpenAttempt) { _dashboard?.Push(_last, false); return; }
            if (!_device.TryOpen())
            {
                _nextOpenAttempt = DateTime.Now.AddSeconds(2);
                SetText("Display not found");
                _dashboard?.Push(_last, false);
                return;
            }
        }

        bool sent = _device.Send(Protocol.BuildFrame(_last, _settings.Fahrenheit));
        SetText(sent ? TrayText() : "Display write failed");
        _dashboard?.Push(_last, sent);
    }

    private string TrayText()
    {
        double t = _settings.Fahrenheit ? _last.CpuTemp * 9 / 5 + 32 : _last.CpuTemp;
        return $"CPU {t:0}\u00B0{(_settings.Fahrenheit ? 'F' : 'C')}  {_last.CpuUsage:0}%";
    }

    private void SetText(string text) => _icon.Text = text.Length > 63 ? text[..63] : text;

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            _timer.Stop();
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
