# Islet media helper. Prints one JSON line per second describing what Windows says is playing
# (Spotify, YouTube in a browser, video players: anything that shows in the Windows media overlay).
# Commands on stdin: toggle | next | prev | shuffle | repeat | seek <seconds> | select <app id>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Media.MediaPlaybackAutoRepeatMode, Windows.Media, ContentType = WindowsRuntime]

# media keys, used when an app refuses the normal play/pause/next/previous request
Add-Type -Namespace Islet -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
function Press-Key([byte]$vk) { [Islet.Keys]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [Islet.Keys]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(-1)
  $t.Result
}
# AsStreamForRead cannot be called directly from PowerShell on a WinRT stream ("Cannot find an overload"), so call it by reflection.
$asStream = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream' })[0]
function Say($t) { [Console]::Out.WriteLine($t); [Console]::Out.Flush() }

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType

function Is-Playing($s) { [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing' }

# The session the person chose in the notch (when two or more apps have media open). It wins until something else starts playing.
$script:pin = ''
$script:pinGrace = [DateTime]::UtcNow

# Prefer the session that is actually playing (so YouTube and Spotify can both be open), then the one Windows calls current.
function Pick-Session {
  $all = @($mgr.GetSessions())
  if ($script:pin) {
    $pinned = $null
    foreach ($x in $all) { if ([string]$x.SourceAppUserModelId -eq $script:pin) { $pinned = $x; break } }
    if ($pinned) {
      if ([DateTime]::UtcNow -lt $script:pinGrace) { return $pinned }        # just chosen: the others are still being paused
      if (Is-Playing $pinned) { return $pinned }
      foreach ($x in $all) { if (Is-Playing $x) { $script:pin = ''; return $x } }   # something else started: follow it
      return $pinned
    } else { $script:pin = '' }
  }
  $cur = $mgr.GetCurrentSession()
  if ($cur -and (Is-Playing $cur)) { return $cur }
  foreach ($x in $all) { if (Is-Playing $x) { return $x } }
  if ($cur) { return $cur }
  if ($all.Count) { return $all[0] }
  return $null
}

# Find the program file behind a media session so the notch can show its icon.
$exeCache = @{}
$alias = @{ 'chrome' = 'chrome'; 'msedge' = 'msedge'; 'edge' = 'msedge'; 'firefox' = 'firefox'; 'brave' = 'brave'; 'opera' = 'opera'; 'vivaldi' = 'vivaldi'; 'spotify' = 'spotify'; 'vlc' = 'vlc' }
function Resolve-Exe($aumid) {
  if (-not $aumid) { return '' }
  if ($exeCache[$aumid]) { return $exeCache[$aumid] }
  $name = [string]$aumid
  if ($name.Contains('!')) { $name = $name.Split('!')[-1] }
  $name = $name -replace '\.exe$', ''
  $cands = @($name, $name.ToLower(), ($name.Split('.')[-1]), ($name.Split('_')[0]))
  if ($alias.ContainsKey($name.ToLower())) { $cands = @($alias[$name.ToLower()]) + $cands }
  foreach ($c in ($cands | Where-Object { $_ } | Select-Object -Unique)) {
    try {
      $p = Get-Process -Name $c -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
      if ($p) { $exeCache[$aumid] = $p.Path; return $p.Path }
    } catch {}
  }
  return ''
}

# The cover picture or video thumbnail, as a data: URL ('' when the app does not provide one).
function Log($t) { try { Add-Content -Path (Join-Path $env:TEMP 'islet-media.log') -Value ((Get-Date -Format 's') + ' ' + $t) } catch {} }
function Get-Thumb($p) {
  try {
    if (-not $p.Thumbnail) { Log 'no thumbnail offered by this app'; return '' }
    [void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $mime = if ($st.ContentType) { [string]$st.ContentType } else { 'image/jpeg' }
    if (-not $asStream) { Log 'AsStreamForRead helper not found'; return '' }
    $net = $asStream.Invoke($null, @($st))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $bytes = $ms.ToArray()
    $ms.Dispose(); $net.Dispose()   # closing $net also closes the WinRT stream underneath (calling Dispose on the stream itself fails in PowerShell)
    if ($bytes.Length -le 0 -or $bytes.Length -gt 3000000) { Log ('thumbnail size not usable: ' + $bytes.Length); return '' }
    return 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
  } catch { Log ('thumbnail failed: ' + $_.Exception.Message); return '' }
}

$script:artKey = ''
$script:artTries = 0


# Every open media session, so the notch can offer a switch when two or more apps have media open.
function Get-Sessions {
  $list = @()
  foreach ($x in @($mgr.GetSessions())) {
    try {
      $pp = Await ($x.TryGetMediaPropertiesAsync()) $propsType
      $id = [string]$x.SourceAppUserModelId
      $list += [pscustomobject]@{ id = $id; exe = (Resolve-Exe $id); title = [string]$pp.Title; artist = [string]$pp.Artist; playing = (Is-Playing $x) }
    } catch {}
  }
  return $list
}

# VLC (and a few other players) do not report to Windows' media controls, so no session exists for them.
# Fallback: read the title of the running VLC window. Pause state cannot be read, so Islet tracks it from your clicks.
$script:vlcKey = ''
$script:vlcPlaying = $true
function Get-Vlc {
  try {
    $p = Get-Process -Name vlc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
    if (-not $p) { return $null }
    $t = [string]$p.MainWindowTitle
    $t = ($t -replace '\s*-\s*VLC media player\s*$', '').Trim()
    if (-not $t -or $t -eq 'VLC media player') { return $null }
    return @{ title = $t; exe = [string]$p.Path }
  } catch { return $null }
}
function Poll-Vlc {
  $v = Get-Vlc
  if ($null -eq $v) { $script:vlcKey = ''; return '{"none":true}' }
  $key = 'vlc|' + $v.title
  if ($key -ne $script:vlcKey) { $script:vlcKey = $key; $script:vlcPlaying = $true }
  $o = [ordered]@{ none = $false; key = $key; app = 'vlc.exe'; exe = $v.exe; title = $v.title; artist = 'VLC'; playing = $script:vlcPlaying; pos = 0; dur = 0; canSeek = $false }
  $o | ConvertTo-Json -Compress
}

function Poll {
  $s = Pick-Session
  if ($null -eq $s) { return (Poll-Vlc) }
  $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
  $info = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $playing = Is-Playing $s
  $start = $tl.StartTime.TotalSeconds
  $dur = [math]::Max(0, $tl.EndTime.TotalSeconds - $start)
  $pos = $tl.Position.TotalSeconds - $start
  if ($playing) {                       # the position is a snapshot, so add the time since it was taken
    $age = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
    if ($age -gt 0 -and $age -lt 86400) { $pos += $age }
  }
  if ($dur -gt 0) { $pos = [math]::Min($pos, $dur) }
  $pos = [math]::Max(0, $pos)
  $key = [string]$s.SourceAppUserModelId + '|' + [string]$p.Title + '|' + [string]$p.Artist
  $shuf = $null; if ($null -ne $info.IsShuffleActive) { $shuf = [bool]$info.IsShuffleActive }
  $rep = ''; if ($null -ne $info.AutoRepeatMode) { $rep = [string]$info.AutoRepeatMode }      # None | Track | List
  $o = [ordered]@{
    none = $false
    key = $key
    app = [string]$s.SourceAppUserModelId
    exe = (Resolve-Exe $s.SourceAppUserModelId)
    title = [string]$p.Title
    artist = [string]$p.Artist
    playing = $playing
    pos = [math]::Round($pos, 1)
    dur = [math]::Round($dur, 1)
    canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
    shuffle = $shuf
    canShuffle = [bool]$info.Controls.IsShuffleEnabled
    repeat = $rep
    canRepeat = [bool]$info.Controls.IsRepeatEnabled
  }
  $sess = @(Get-Sessions)
  if ($sess.Count -ge 2) { $o['sessions'] = $sess }
  $o['sid'] = [string]$s.SourceAppUserModelId
  # send the cover once per track (retry a few times, some apps load it a moment after the title)
  if ($key -ne $script:artKey) { $script:artKey = $key; $script:artTries = 0; $o['art'] = (Get-Thumb $p); if (-not $o['art']) { $script:artTries = 1 } }
  elseif ($script:artTries -gt 0 -and $script:artTries -lt 15) {
    $script:artTries++
    $a = Get-Thumb $p
    if ($a) { $o['art'] = $a; $script:artTries = 0 }
  }
  $o | ConvertTo-Json -Compress -Depth 4
}

function Handle($line) {
  $parts = $line.Split(' ')
  $c = $parts[0]
  if ($c -eq 'select') {                # switch source: the chosen app plays, every other one is paused
    $want = $line.Substring(6).Trim()
    $script:pin = $want; $script:pinGrace = [DateTime]::UtcNow.AddSeconds(3)
    foreach ($x in @($mgr.GetSessions())) {
      if ([string]$x.SourceAppUserModelId -ne $want) { if (Is-Playing $x) { try { [void](Await ($x.TryPauseAsync()) ([bool])) } catch {} } }
    }
    foreach ($x in @($mgr.GetSessions())) {
      if ([string]$x.SourceAppUserModelId -eq $want -and -not (Is-Playing $x)) { try { [void](Await ($x.TryPlayAsync()) ([bool])) } catch {} }
    }
    return
  }
  $s = Pick-Session
  if ($null -eq $s) {                   # no Windows media session: VLC fallback, controlled with the media keys
    if ($null -ne (Get-Vlc)) {
      switch ($c) {
        'toggle' { Press-Key 0xB3; $script:vlcPlaying = -not $script:vlcPlaying }
        'next' { Press-Key 0xB0 }
        'prev' { Press-Key 0xB1 }
      }
    }
    return
  }
  $ok = $false
  switch ($c) {
    'toggle' {
      if (Is-Playing $s) { $ok = Await ($s.TryPauseAsync()) ([bool]) } else { $ok = Await ($s.TryPlayAsync()) ([bool]) }
      if (-not $ok) { $ok = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
      if (-not $ok) { Press-Key 0xB3 }
    }
    'next' { $ok = Await ($s.TrySkipNextAsync()) ([bool]); if (-not $ok) { Press-Key 0xB0 } }
    'prev' { $ok = Await ($s.TrySkipPreviousAsync()) ([bool]); if (-not $ok) { Press-Key 0xB1 } }
    'shuffle' {
      $cur = $false; if ($null -ne $s.GetPlaybackInfo().IsShuffleActive) { $cur = [bool]$s.GetPlaybackInfo().IsShuffleActive }
      [void](Await ($s.TryChangeShuffleActiveAsync(-not $cur)) ([bool]))
    }
    'repeat' {                          # off -> repeat all -> repeat one -> off
      $m = [string]$s.GetPlaybackInfo().AutoRepeatMode
      $next = switch ($m) { 'None' { 'List' } 'List' { 'Track' } default { 'None' } }
      $mode = [Enum]::Parse([Windows.Media.MediaPlaybackAutoRepeatMode], $next)
      [void](Await ($s.TryChangeAutoRepeatModeAsync($mode)) ([bool]))
    }
    'seek' {
      $sec = [double]$parts[1]
      $start = $s.GetTimelineProperties().StartTime.TotalSeconds
      [void](Await ($s.TryChangePlaybackPositionAsync([long](($start + $sec) * 10000000))) ([bool]))
    }
  }
}

# read commands without blocking the polling loop
$stdin = [Console]::OpenStandardInput()
$buf = New-Object byte[] 256
$read = $stdin.BeginRead($buf, 0, 256, $null, $null)
$pending = ''
$clock = [Diagnostics.Stopwatch]::StartNew()
$force = $true
$fast = 0                               # after a command, check a few times quickly so the screen follows right away

while ($true) {
  if ($read.IsCompleted) {
    $n = $stdin.EndRead($read)
    if ($n -le 0) { break }
    $pending += [Text.Encoding]::UTF8.GetString($buf, 0, $n)
    $read = $stdin.BeginRead($buf, 0, 256, $null, $null)
    while (($i = $pending.IndexOf("`n")) -ge 0) {
      $cmd = $pending.Substring(0, $i).Trim(); $pending = $pending.Substring($i + 1)
      try { Handle $cmd } catch {}
      $force = $true; $fast = 5
    }
  }
  $every = if ($fast -gt 0) { 300 } else { 1000 }
  if ($force -or $clock.ElapsedMilliseconds -ge $every) {
    $force = $false; $clock.Restart()
    if ($fast -gt 0) { $fast-- }
    try { Say (Poll) } catch { Say '{"none":true}' }
  }
  Start-Sleep -Milliseconds 100
}
