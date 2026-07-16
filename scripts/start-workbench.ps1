param(
  [switch]$NoBrowser,
  [switch]$VerifyStartup
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
  chcp 65001 > $null
} catch {}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false

[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$project = Split-Path -Parent $PSScriptRoot
$process = $null

function Stop-SourceProcess {
  if ($null -eq $process) {
    return
  }

  try {
    & taskkill.exe /PID $process.Id /T /F *> $null
  } catch {
  }

  try {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  } catch {
  }
}

try {
  Set-Location $project

  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw 'Node.js 22 or newer is required.'
  }

  $nodeMajorText = & $node.Source -p "process.versions.node.split('.')[0]"
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the installed Node.js version.'
  }

  $nodeMajor = [int]$nodeMajorText
  if ($nodeMajor -lt 22) {
    $nodeVersion = & $node.Source -v
    throw "Node.js 22 or newer is required. Found $nodeVersion."
  }

  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $npm) {
    throw 'npm is required to install dependencies and start the workbench.'
  }

  $firstRun = -not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))
  if ($firstRun) {
    Write-Host 'First source startup: installing dependencies. This may take a few minutes.'
    & $npm.Source install
    if ($LASTEXITCODE -ne 0) {
      throw 'npm install failed.'
    }
  }

  $commandLine = ('/d /s /c ""{0}" run dev"' -f $npm.Source)
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList $commandLine -WorkingDirectory $project -NoNewWindow -PassThru

  $waitSeconds = if ($firstRun) { 180 } else { 60 }
  $healthUrl = 'http://127.0.0.1:5173/api/health'
  $appUrl = 'http://127.0.0.1:5173/'
  $deadline = (Get-Date).AddSeconds($waitSeconds)
  $healthy = $false

  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "npm run dev exited before the workbench became ready (exit $($process.ExitCode))."
    }

    try {
      $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($response.ok -eq $true -and $response.service -eq 'aleksi-workbench') {
        $healthy = $true
        break
      }
    } catch {
    }

    Start-Sleep -Milliseconds 500
  }

  if (-not $healthy) {
    throw "Workbench did not become ready at $healthUrl within $waitSeconds seconds."
  }

  Write-Host "Aleksi Learning Workbench: $appUrl"
  if ($VerifyStartup) {
    Stop-SourceProcess
    Write-Host 'Source launcher startup verification passed.'
    exit 0
  }

  if (-not $NoBrowser) {
    Start-Process $appUrl
  }

  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "npm run dev failed with exit code $($process.ExitCode)."
  }
} catch {
  Stop-SourceProcess
  Write-Host 'Aleksi Learning Workbench startup failed.'
  Write-Host $_.Exception.Message
  exit 1
}
