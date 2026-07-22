param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [string]$ExpectedVersion = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Find-InstalledExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Aleksi Workbench\aleksi-workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Aleksi Workbench\aleksi-workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\aleksi-workbench.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $matches = @(
    Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Recurse -File -Filter 'aleksi-workbench.exe' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending
  )
  if ($matches.Count -eq 0) {
    throw 'Silent NSIS install completed, but aleksi-workbench.exe was not found under LOCALAPPDATA.'
  }
  return $matches[0].FullName
}

function Get-RecentSidecarStderr {
  $stderrCandidates = @(
    Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Recurse -File -Filter 'sidecar.stderr.log' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTimeUtc -Descending
  )
  if ($stderrCandidates.Count -eq 0) {
    return ''
  }
  return (Get-Content -LiteralPath $stderrCandidates[0].FullName -Raw -ErrorAction SilentlyContinue)
}

function Wait-ForReadyRecord([string]$LogPath, $AppProcess, $Identity) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      $stderr = Get-RecentSidecarStderr
      throw "Installed app exited before sidecar readiness. ExitCode=$($AppProcess.ExitCode). stderr=$stderr"
    }

    if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
      $line = Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue |
        Where-Object { $_ -like 'ALEKSI_READY *' } |
        Select-Object -Last 1
      if ($null -ne $line) {
        $ready = (($line -replace '^ALEKSI_READY\s+', '') | ConvertFrom-Json)
        if (
          [string]$ready.host -ne '127.0.0.1' -or
          [int]$ready.port -lt 1 -or
          [int]$ready.port -gt 65535 -or
          [string]$ready.version -ne [string]$Identity.version -or
          [string]$ready.buildId -ne [string]$Identity.buildId
        ) {
          throw "Installed sidecar returned a mismatched readiness record: $($ready | ConvertTo-Json -Compress)"
        }
        return $ready
      }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  $stdout = if (Test-Path -LiteralPath $LogPath) {
    Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
  } else { '' }
  $stderr = Get-RecentSidecarStderr
  throw "Timed out waiting for installed sidecar readiness. stdout=$stdout stderr=$stderr"
}

function Get-HealthyRuntime($Ready, $Identity) {
  $baseUrl = "http://127.0.0.1:$([int]$Ready.port)"
  $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health" -TimeoutSec 5
  if (
    $health.ok -ne $true -or
    [string]$health.version -ne [string]$Identity.version -or
    [string]$health.buildId -ne [string]$Identity.buildId
  ) {
    throw "Installed sidecar health identity mismatch: $($health | ConvertTo-Json -Compress)"
  }
  return @{ BaseUrl = $baseUrl; Health = $health }
}

function Assert-StartupRitualSurvival($AppProcess, [string]$BaseUrl, $Identity, [datetime]$ProcessStartedAt) {
  # The product intentionally keeps a 20-second startup ritual. Verify the installed
  # shell and local API survive beyond that gate, rather than only becoming ready briefly.
  $survivalDeadline = $ProcessStartedAt.AddSeconds(23)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      $stderr = Get-RecentSidecarStderr
      throw "Installed app exited during the 20-second startup ritual. ExitCode=$($AppProcess.ExitCode). stderr=$stderr"
    }
    $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 5
    if (
      $health.ok -ne $true -or
      [string]$health.version -ne [string]$Identity.version -or
      [string]$health.buildId -ne [string]$Identity.buildId
    ) {
      throw "Installed sidecar became unhealthy during startup ritual: $($health | ConvertTo-Json -Compress)"
    }
    if ((Get-Date) -lt $survivalDeadline) {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $survivalDeadline)
}

function Stop-AppProcess($AppProcess) {
  $AppProcess.Refresh()
  if ($AppProcess.HasExited) {
    return
  }
  Stop-Process -Id $AppProcess.Id -Force
  $AppProcess.WaitForExit(5000) | Out-Null
}

function Assert-SidecarStopped([string]$BaseUrl) {
  Start-Sleep -Milliseconds 750
  try {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/health" -TimeoutSec 2 | Out-Null
    throw 'Installed sidecar remained reachable after graceful exit.'
  } catch {
    if ($_.Exception.Message -eq 'Installed sidecar remained reachable after graceful exit.') {
      throw
    }
  }
}

function Start-And-VerifyInstalledApp(
  [string]$AppExe,
  [string]$InstallRoot,
  [string]$StdoutLog,
  $Identity,
  [string]$Round,
  [string]$ExpectedReadingId,
  [ValidateSet('api', 'window')]
  [string]$ExitMode
) {
  $startedAt = Get-Date
  $stderrLog = Join-Path (Split-Path -Parent $StdoutLog) 'sidecar.stderr.log'
  foreach ($logPath in @($StdoutLog, $stderrLog)) {
    if (Test-Path -LiteralPath $logPath -PathType Leaf) {
      Remove-Item -LiteralPath $logPath -Force
    }
  }
  $appProcess = Start-Process -FilePath $AppExe -WorkingDirectory $InstallRoot -PassThru
  try {
    $ready = Wait-ForReadyRecord $StdoutLog $appProcess $Identity
    $runtime = Get-HealthyRuntime $ready $Identity
    $baseUrl = [string]$runtime.BaseUrl

    Assert-StartupRitualSurvival $appProcess $baseUrl $Identity $startedAt

    $prepared = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/vault/auto-prepare" -TimeoutSec 10
    if ($prepared.status.initialized -ne $true -or $prepared.status.writable -ne $true) {
      throw "Installed app did not prepare a writable learning library: $($prepared | ConvertTo-Json -Compress -Depth 8)"
    }

    $today = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/today/next" -TimeoutSec 10
    if ([string]::IsNullOrWhiteSpace([string]$today.nextAction.href)) {
      throw "Installed app Today API is unavailable: $($today | ConvertTo-Json -Compress -Depth 8)"
    }

    $readingId = $ExpectedReadingId
    if ([string]::IsNullOrWhiteSpace($readingId)) {
      $body = @{
        title = "安装链路验证 $Round"
        concept = 'InstalledDesktopSmoke'
        body = '这是一段用于验证首次启动、中文路径、持久化与二次启动的 Markdown。'
        source = 'manual-paste'
      } | ConvertTo-Json -Compress
      $reading = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/readings" -ContentType 'application/json' -Body $body -TimeoutSec 10
      $readingId = [string]$reading.reading.id
      if ([string]::IsNullOrWhiteSpace($readingId)) {
        throw "Installed reading persistence failed: $($reading | ConvertTo-Json -Compress -Depth 8)"
      }
    } else {
      $persisted = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/readings/$readingId" -TimeoutSec 10
      if ([string]$persisted.reading.id -ne $readingId) {
        throw "Reading did not persist across installed app restart: $($persisted | ConvertTo-Json -Compress -Depth 8)"
      }
    }

    $diagnostics = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/runtime/diagnostics" -TimeoutSec 10
    $diagnosticNames = @($diagnostics.logs | ForEach-Object { [string]$_.name })
    foreach ($name in @('sidecar.stdout.log', 'sidecar.stderr.log')) {
      if ($diagnosticNames -notcontains $name) {
        throw "Installed diagnostics omitted $name. Found: $($diagnosticNames -join ', ')"
      }
    }

    if ($ExitMode -eq 'api') {
      Invoke-RestMethod -Method Post -Uri "$baseUrl/api/runtime/exit" -ContentType 'application/json' -Body '{"confirmed":true}' -TimeoutSec 10 | Out-Null
      Assert-SidecarStopped $baseUrl
    } else {
      if (-not $appProcess.CloseMainWindow()) {
        throw 'Installed app did not expose a closeable main window after the startup ritual.'
      }
      if (-not $appProcess.WaitForExit(10000)) {
        throw 'Installed app did not exit within 10 seconds after closing its main window.'
      }
      Assert-SidecarStopped $baseUrl
    }

    return @{
      AppProcess = $appProcess
      BaseUrl = $baseUrl
      LibraryPath = [string]$prepared.status.path
      Port = [int]$ready.port
      ReadingId = $readingId
    }
  } catch {
    Stop-AppProcess $appProcess
    throw
  }
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$installResult = Start-Process -FilePath $installer -ArgumentList @('/S') -Wait -PassThru
if ($installResult.ExitCode -ne 0) {
  throw "Silent NSIS install failed with exit code $($installResult.ExitCode)."
}

$appExe = Find-InstalledExecutable
$installRoot = Split-Path -Parent $appExe
$identityPath = Join-Path $installRoot 'resources\identity.json'
$nodePath = Join-Path $installRoot 'resources\sidecar\node.exe'
$serverPath = Join-Path $installRoot 'resources\sidecar\server.cjs'
$legacyServerPath = Join-Path $installRoot 'resources\sidecar\server.js'
if (Test-Path -LiteralPath $legacyServerPath -PathType Leaf) {
  throw "Upgrade left the broken legacy sidecar in place: $legacyServerPath"
}

foreach ($resource in @($identityPath, $nodePath, $serverPath)) {
  if (-not (Test-Path -LiteralPath $resource -PathType Leaf)) {
    throw "Installed desktop resource is missing: $resource"
  }
}

$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion) -and [string]$identity.version -ne $ExpectedVersion) {
  throw "Installed version mismatch. Expected $ExpectedVersion, got $([string]$identity.version)."
}
if ([string]$identity.buildId -notmatch '^desktop-[a-f0-9]{20}$') {
  throw "Installed build ID is invalid: $([string]$identity.buildId)"
}

foreach ($logicalPath in @('sidecar/node.exe', 'sidecar/server.cjs')) {
  $entry = @($identity.files | Where-Object { [string]$_.path -eq $logicalPath })
  if ($entry.Count -ne 1) {
    throw "Installed identity must contain exactly one $logicalPath entry."
  }
  $installedPath = if ($logicalPath -eq 'sidecar/node.exe') { $nodePath } else { $serverPath }
  $bytes = (Get-Item -LiteralPath $installedPath).Length
  $hash = Get-Sha256Lower $installedPath
  if ([int64]$entry[0].bytes -ne $bytes -or [string]$entry[0].sha256 -ne $hash) {
    throw "Installed resource hash mismatch for $logicalPath. Expected $([string]$entry[0].sha256)/$([int64]$entry[0].bytes), got $hash/$bytes."
  }
}

$appDataRoot = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench'
if (Test-Path -LiteralPath $appDataRoot) {
  Remove-Item -LiteralPath $appDataRoot -Recurse -Force
}
$stdoutLog = Join-Path $appDataRoot 'logs\sidecar.stdout.log'
$stderrLog = Join-Path $appDataRoot 'logs\sidecar.stderr.log'

$first = $null
$second = $null
try {
  $first = Start-And-VerifyInstalledApp $appExe $installRoot $stdoutLog $identity 'first-launch' '' 'api'
  Stop-AppProcess $first.AppProcess

  # Preserve app data and verify a genuinely independent second shell/sidecar launch.
  $second = Start-And-VerifyInstalledApp $appExe $installRoot $stdoutLog $identity 'second-launch' $first.ReadingId 'window'
  if ([string]$first.LibraryPath -ne [string]$second.LibraryPath) {
    throw "Second launch changed the active learning library: $([string]$first.LibraryPath) -> $([string]$second.LibraryPath)"
  }
  Stop-AppProcess $second.AppProcess

  Write-Host 'Installed desktop verification passed.'
  Write-Host "Installed executable: $appExe"
  Write-Host "Identity: $([string]$identity.version) $([string]$identity.buildId)"
  Write-Host "First dynamic port: $([int]$first.Port)"
  Write-Host "Second dynamic port: $([int]$second.Port)"
  Write-Host "Learning library: $([string]$first.LibraryPath)"
  Write-Host "Persisted reading: $([string]$first.ReadingId)"
  if (Test-Path -LiteralPath $stderrLog) {
    $stderr = Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      Write-Host "Sidecar stderr (non-fatal): $stderr"
    }
  }
} finally {
  if ($null -ne $first -and $null -ne $first.AppProcess) {
    Stop-AppProcess $first.AppProcess
  }
  if ($null -ne $second -and $null -ne $second.AppProcess) {
    Stop-AppProcess $second.AppProcess
  }
}
