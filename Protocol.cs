namespace ZeusDisplay;

public readonly record struct Reading(double CpuTemp, double CpuUsage);

/// <summary>
/// Frame format recovered from the vendor app:
/// HID output report = [report id = 0] + 64 payload bytes.
/// Payload = 00 01 02 + 24 value slots + zero padding.
/// Slots used here: 0/1 = CPU temp in Celsius (whole, hundredths), 2 = unit flag (0 = C, 1 = F), 3 = CPU usage %.
/// Exit/idle command: payload[1] = 0x0F.
/// </summary>
public static class Protocol
{
    public const int VendorId = 0x5131;
    public const int ProductId = 0x2007;

    private const int PayloadLength = 64;

    public static byte[] BuildFrame(Reading r, bool fahrenheit = false)
    {
        var frame = new byte[1 + PayloadLength];   // frame[0] = report ID (0)
        frame[1] = 0;
        frame[2] = 1;
        frame[3] = 2;

        const int v = 4;                            // first of the 24 value slots
        (frame[v + 0], frame[v + 1]) = SplitHundredths(r.CpuTemp);
        frame[v + 2] = (byte)(fahrenheit ? 1 : 0);  // unit flag: 0 = Celsius, 1 = Fahrenheit
        frame[v + 3] = ToByte(Math.Min(r.CpuUsage, 100));
        return frame;
    }

    public static byte[] ShutdownFrame()
    {
        var frame = new byte[1 + PayloadLength];
        frame[2] = 0x0F;                            // payload[1]
        return frame;
    }

    private static (byte whole, byte hundredths) SplitHundredths(double x)
    {
        if (double.IsNaN(x) || x < 0) x = 0;
        double whole = Math.Floor(x);
        int hundredths = (int)Math.Round((x - whole) * 100);
        return (ToByte(whole), (byte)Math.Min(hundredths, 99));
    }

    private static byte ToByte(double x)
    {
        if (double.IsNaN(x)) x = 0;
        return (byte)Math.Clamp((int)Math.Floor(x), 0, 255);
    }
}