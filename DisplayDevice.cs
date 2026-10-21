using HidSharp;

namespace ZeusDisplay;

public sealed class DisplayDevice : IDisposable
{
    private HidStream? _stream;
    private int _reportLength = 65;

    public bool IsOpen => _stream != null;

    public bool TryOpen()
    {
        Close();
        var device = DeviceList.Local
            .GetHidDevices(Protocol.VendorId, Protocol.ProductId)
            .FirstOrDefault();

        if (device == null || !device.TryOpen(out HidStream stream))
            return false;

        stream.WriteTimeout = 1000;
        _reportLength = Math.Max(device.GetMaxOutputReportLength(), 65);
        _stream = stream;
        return true;
    }

    public bool Send(byte[] frame)
    {
        if (_stream == null) return false;
        try
        {
            var buffer = new byte[_reportLength];
            Array.Copy(frame, buffer, Math.Min(frame.Length, buffer.Length));
            _stream.Write(buffer);
            return true;
        }
        catch (Exception)
        {
            Close();            // unplugged, asleep, or handle went stale
            return false;
        }
    }

    public void Close()
    {
        try { _stream?.Dispose(); } catch { /* ignore */ }
        _stream = null;
    }

    public void Dispose() => Close();
}
