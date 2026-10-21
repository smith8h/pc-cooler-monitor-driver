"""
Cooler display test tool  -  USB HID  VID 0x5131 / PID 0x2007

Protocol (recovered from the vendor app's own code):
  * Standard HID output report, sent every ~200 ms.
  * Report = [report_id] + 64 payload bytes (65 bytes total).
  * Payload = 00 01 02 + 24 value bytes + zero padding.
  * Shutdown/idle command on app exit: payload[1] = 0x0F.

Setup (PowerShell):
    py -m pip install hidapi psutil

Run (CLOSE the vendor "PC Monitoring.exe" first, from Task Manager too):
    py zeus_display_test.py --list
    py zeus_display_test.py --temp 45.5
    py zeus_display_test.py --temp 62 --fahrenheit
"""
import argparse
import math
import time

import hid
import psutil

VID, PID = 0x5131, 0x2007


def split_frac(x):
    """Integer part + hundredths, one byte each (vendor: floor(x), (x-floor)*100)."""
    i = math.floor(x)
    return i & 0xFF, int(round((x - i) * 100)) & 0xFF


def split100(v):
    """Hundreds + remainder, e.g. 2235 rpm -> (22, 35)."""
    v = int(v)
    return (v // 100) & 0xFF, (v % 100) & 0xFF


def build_payload(cpu_temp, cpu_usage, cpu_power=0, cpu_mhz=0, cpu_volt=0,
                  gpu_temp=0, gpu_usage=0, gpu_power=0, gpu_mhz=0,
                  fan_rpm=0, pump_rpm=0, fahrenheit=False):
    unit = 1 if fahrenheit else 0          # 0 = Celsius, 1 = Fahrenheit
    v = [0] * 24
    v[0], v[1] = split_frac(cpu_temp)
    v[2] = unit
    v[3] = int(cpu_usage)
    v[4], v[5] = split_frac(cpu_power)
    v[6], v[7] = split100(cpu_mhz)
    v[8] = int(math.floor(cpu_volt))
    v[9] = int(math.floor(cpu_volt) * 100)  # vendor quirk, replicated as-is
    v[10], v[11] = split_frac(gpu_temp)
    v[12] = unit
    v[13] = int(gpu_usage)
    v[14], v[15] = split_frac(gpu_power)
    v[16], v[17] = split100(gpu_mhz)
    v[18], v[19] = split100(fan_rpm)
    v[20], v[21] = split100(pump_rpm)
    payload = bytes([0, 1, 2] + [x & 0xFF for x in v])
    return payload.ljust(64, b"\x00")


def shutdown_payload():
    return bytes([0, 0x0F]).ljust(64, b"\x00")


def list_devices():
    found = hid.enumerate(VID, PID)
    if not found:
        print(f"No HID device {VID:04X}:{PID:04X} found. Is the cooler's USB cable plugged in?")
    for i, d in enumerate(found):
        print(f"[{i}] path={d['path']!r} usage_page=0x{d['usage_page']:04X} "
              f"usage=0x{d['usage']:04X} interface={d['interface_number']}")
    return found


def open_working_device(report_id):
    """Try each HID collection of the device until one accepts a 65-byte write."""
    for d in hid.enumerate(VID, PID):
        dev = hid.device()
        try:
            dev.open_path(d["path"])
            if dev.write(bytes([report_id]) + build_payload(0, 0)) > 0:
                print(f"Using interface {d['interface_number']} "
                      f"(usage_page=0x{d['usage_page']:04X})")
                return dev
            dev.close()
        except OSError:
            pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list matching HID interfaces and exit")
    ap.add_argument("--temp", type=float, default=40.0, help="CPU temperature to show")
    ap.add_argument("--fahrenheit", action="store_true", help="set the unit flag to Fahrenheit")
    ap.add_argument("--report-id", type=int, default=0, help="HID report id (0 if the device has none)")
    args = ap.parse_args()

    if args.list:
        list_devices()
        return

    dev = open_working_device(args.report_id)
    if dev is None:
        print("Could not write to the device. Close the vendor app and try --list / --report-id.")
        return

    print("Sending... press Ctrl+C to stop.")
    try:
        while True:
            usage = psutil.cpu_percent(interval=None)
            payload = build_payload(args.temp, usage, fahrenheit=args.fahrenheit)
            dev.write(bytes([args.report_id]) + payload)
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        dev.write(bytes([args.report_id]) + shutdown_payload())
        dev.close()


if __name__ == "__main__":
    main()
