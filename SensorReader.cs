using LibreHardwareMonitor.Hardware;

namespace ZeusDisplay;

public sealed class SensorReader : IDisposable
{
    // Preferred CPU temperature sensors, in order (AMD first, then Intel).
    private static readonly string[] TempPriority =
    {
        "Core (Tctl/Tdie)", "CPU Package", "Core Max", "Core Average", "Core (Tdie)", "Tdie"
    };

    private readonly Computer _computer = new() { IsCpuEnabled = true };
    private readonly IHardware? _cpu;

    public SensorReader()
    {
        _computer.Open();
        _cpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
    }

    public Reading Read()
    {
        if (_cpu == null) return new Reading(0, 0);
        _cpu.Update();

        double usage = _cpu.Sensors
            .FirstOrDefault(s => s.SensorType == SensorType.Load && s.Name == "CPU Total")
            ?.Value ?? 0;

        return new Reading(PickTemperature(), usage);
    }

    private double PickTemperature()
    {
        var temps = _cpu!.Sensors
            .Where(s => s.SensorType == SensorType.Temperature && s.Value.HasValue)
            .ToList();

        foreach (var name in TempPriority)
        {
            var hit = temps.FirstOrDefault(s => s.Name == name);
            if (hit != null) return hit.Value!.Value;
        }
        return temps.FirstOrDefault()?.Value ?? 0;
    }

    public void Dispose() => _computer.Close();
}
