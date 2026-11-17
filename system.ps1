# Islet system helper: reads one command per line from stdin, answers on stdout.
#   get            -> prints "vol N", "mic 0/1", "bri N" (or "err vol" etc.)
#   vol N / bri N  -> set volume or brightness (0-100)
#   mic 0/1        -> 1 = muted
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int _5();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int _7(); int _8(); int _9(); int _10();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public class Audio {
  static IAudioEndpointVolume Vol(int flow) {
    IMMDeviceEnumerator e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice d; e.GetDefaultAudioEndpoint(flow, 1, out d);
    Guid g = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    d.Activate(ref g, 23, 0, out v); return v;
  }
  public static float GetVolume() { float f; Vol(0).GetMasterVolumeLevelScalar(out f); return f; }
  public static void SetVolume(float f) { Vol(0).SetMasterVolumeLevelScalar(f, Guid.Empty); }
  public static bool GetMicMuted() { bool m; Vol(1).GetMute(out m); return m; }
  public static void SetMicMuted(bool m) { Vol(1).SetMute(m, Guid.Empty); }
}
"@

function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }

function Get-All {
  try { Say ("vol " + [int][math]::Round([Audio]::GetVolume() * 100)) } catch { Say "err vol" }
  try { if ([Audio]::GetMicMuted()) { Say "mic 1" } else { Say "mic 0" } } catch { Say "err mic" }
  try {
    $b = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness
    if ($null -eq $b) { throw "none" }
    Say ("bri " + $b)
  } catch { Say "err bri" }
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim().Split(' ')
  try {
    switch ($p[0]) {
      'get' { Get-All }
      'vol' { [Audio]::SetVolume([float]([int]$p[1]) / 100) }
      'mic' { [Audio]::SetMicMuted(([int]$p[1]) -eq 1) }
      'bri' {
        $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
        Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$p[1] } | Out-Null
      }
    }
  } catch { Say ("err " + $p[0]) }
}
