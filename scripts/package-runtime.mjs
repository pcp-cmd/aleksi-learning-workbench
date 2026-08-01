#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { auditRuntimeZipFile } from "./audit-runtime.mjs";
import {
  createRuntimeContentBuildId,
  normalizeRuntimeEntryName,
  runtimeArchiveEntryName,
  RUNTIME_BUILD_DIR,
  RUNTIME_MANIFEST_NAME,
  RUNTIME_IDENTITY_VALUE_PATTERN,
  RUNTIME_PACKAGE_DIR,
  RUNTIME_PACKAGE_PATH
} from "./runtime-package-rules.mjs";
import { writeStoredZip } from "./zip-store.mjs";

const root = process.cwd();
const outputDirectory = resolve(root, RUNTIME_PACKAGE_DIR);
const outputPath = resolve(root, process.argv[2] ?? RUNTIME_PACKAGE_PATH);
const runtimeBuildDirectory = resolve(root, RUNTIME_BUILD_DIR);
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

function startWorkbenchPowerShell(identity) {
  return `param(
  [switch]$NoBrowser,
  [switch]$Foreground,
  [ValidateRange(1, 600)]
  [int]$HealthWaitSeconds = 60
)

$ErrorActionPreference = 'Stop'
chcp 65001 | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

$AppVersion = '${identity.version}'
$BuildId = '${identity.buildId}'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $Root 'runtime\\node.exe'
$App = Join-Path $Root 'app\\server.cjs'
$Dist = Join-Path $Root 'app\\dist'
$Data = Join-Path $Root 'data'
$Logs = Join-Path $Root 'logs'
$Log = Join-Path $Logs 'latest.log'
$DateLog = Join-Path $Logs ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$ServerOut = Join-Path $Logs 'server.stdout.log'
$ServerErr = Join-Path $Logs 'server.stderr.log'
$PidFile = Join-Path $Logs 'runtime.pid'
$InstanceFile = Join-Path $Logs 'runtime.instance.json'
$LaunchLock = Join-Path $Logs 'runtime.launch.lock'
$Documents = [Environment]::GetFolderPath('MyDocuments')
$LearningLibrary = Join-Path $Documents 'Aleksi Learning Workbench'
$Process = $null
$LockHandle = $null

function Write-StartupLog([string]$Message) {
  $Line = ('[{0}] {1}' -f (Get-Date).ToString('s'), $Message)
  Add-Content -LiteralPath $Log -Value $Line -Encoding UTF8
  Add-Content -LiteralPath $DateLog -Value $Line -Encoding UTF8
}

function Remove-ExpiredDateLogs {
  $Cutoff = (Get-Date).AddDays(-30)
  Get-ChildItem -LiteralPath $Logs -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^\\d{4}-\\d{2}-\\d{2}\\.log$' -and
      $_.LastWriteTime -lt $Cutoff
    } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
}

function Open-WorkbenchBrowser([string]$BaseUrl, [string]$Action) {
  $LaunchNonce = [guid]::NewGuid().ToString('N')
  $LaunchUrl = $BaseUrl + '?launch=' + $LaunchNonce
  Start-Process $LaunchUrl
  Write-StartupLog "browser open result: $Action $LaunchUrl"
}

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing: $Path"
  }
}

function Assert-Directory([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Label is missing: $Path"
  }
}

function Test-PortAvailable([int]$Candidate) {
  $Listener = $null
  try {
    $Address = [System.Net.IPAddress]::Parse('127.0.0.1')
    $Listener = [System.Net.Sockets.TcpListener]::new($Address, $Candidate)
    $Listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $Listener) {
      $Listener.Stop()
    }
  }
}

function Get-RuntimePort {
  foreach ($Candidate in 17817..17880) {
    if (Test-PortAvailable $Candidate) {
      return $Candidate
    }
  }
  throw 'No available Aleksi Workbench runtime port in 17817-17880.'
}

function Remove-RuntimeIdentity {
  Remove-Item -LiteralPath $PidFile, $InstanceFile -Force -ErrorAction SilentlyContinue
}

function Acquire-LaunchLock {
  $Deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $Deadline) {
    try {
      return [System.IO.File]::Open(
        $LaunchLock,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
      )
    } catch [System.IO.IOException] {
      if (Test-Path -LiteralPath $LaunchLock) {
        $LockAge = (Get-Date) - (Get-Item -LiteralPath $LaunchLock).LastWriteTime
        if ($LockAge.TotalSeconds -gt 90) {
          Remove-Item -LiteralPath $LaunchLock -Force -ErrorAction SilentlyContinue
        }
      }
      Start-Sleep -Milliseconds 150
    }
  }
  throw 'Timed out waiting for the Aleksi Workbench launch lock.'
}

function Release-LaunchLock {
  if ($null -ne $script:LockHandle) {
    $script:LockHandle.Dispose()
    $script:LockHandle = $null
  }
  Remove-Item -LiteralPath $LaunchLock -Force -ErrorAction SilentlyContinue
}

function Get-HealthyRuntime {
  if (
    -not (Test-Path -LiteralPath $PidFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $InstanceFile -PathType Leaf)
  ) {
    Remove-RuntimeIdentity
    return $null
  }

  try {
    [int]$SavedPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $Instance = Get-Content -LiteralPath $InstanceFile -Raw | ConvertFrom-Json
    if ([int]$Instance.pid -ne $SavedPid) {
      throw 'PID metadata mismatch'
    }
    if ([string]$Instance.version -ne $AppVersion -or [string]$Instance.buildId -ne $BuildId) {
      throw 'Runtime instance build identity mismatch'
    }
    [int]$SavedPort = $Instance.port
    if ($SavedPort -lt 17817 -or $SavedPort -gt 17880) {
      throw 'Runtime metadata port is invalid'
    }

    $ExistingProcess = Get-Process -Id $SavedPid -ErrorAction Stop
    $ExpectedStart = [string]$Instance.startedAt
    $ActualStart = $ExistingProcess.StartTime.ToUniversalTime().ToString('o')
    if ($ActualStart -ne $ExpectedStart) {
      throw 'Process start time does not match runtime metadata'
    }

    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $SavedPid" -ErrorAction Stop
    [string]$ExecutablePath = $ProcessInfo.ExecutablePath
    [string]$CommandLine = $ProcessInfo.CommandLine
    if (-not [string]::Equals($ExecutablePath, $Node, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'PID belongs to a different executable'
    }
    if ($CommandLine.IndexOf($App, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
      throw 'PID command line does not contain this runtime app'
    }

    $HealthUrl = "http://127.0.0.1:$SavedPort/api/health"
    $Response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if (
      $Response.ok -ne $true -or
      $Response.service -ne 'aleksi-workbench' -or
      $Response.version -ne $AppVersion -or
      $Response.buildId -ne $BuildId
    ) {
      throw 'Saved runtime health endpoint is not Aleksi Workbench'
    }

    return [PSCustomObject]@{
      Process = $ExistingProcess
      Port = $SavedPort
      Url = "http://127.0.0.1:$SavedPort/"
    }
  } catch {
    Write-StartupLog ("stale runtime identity removed: " + $_.Exception.Message)
    Remove-RuntimeIdentity
    return $null
  }
}

function Write-RuntimeIdentity([System.Diagnostics.Process]$RuntimeProcess, [int]$RuntimePort) {
  $RuntimeProcess.Refresh()
  $Identity = [ordered]@{
    pid = $RuntimeProcess.Id
    port = $RuntimePort
    startedAt = $RuntimeProcess.StartTime.ToUniversalTime().ToString('o')
    nodePath = $Node
    appPath = $App
    version = $AppVersion
    buildId = $BuildId
  }
  [System.IO.File]::WriteAllText($PidFile, [string]$RuntimeProcess.Id, $Utf8NoBom)
  [System.IO.File]::WriteAllText(
    $InstanceFile,
    ($Identity | ConvertTo-Json),
    $Utf8NoBom
  )
}

function Stop-RuntimeProcess {
  if ($null -eq $Process) {
    return
  }

  try {
    $Process.Refresh()
    if ($Process.HasExited) {
      return
    }
  } catch {
    return
  }

  try {
    Stop-Process -InputObject $Process -Force -ErrorAction Stop
    $Process.WaitForExit(5000) | Out-Null
  } catch {
  }
}

function Write-ServerErrorTail {
  if (-not (Test-Path -LiteralPath $ServerErr)) {
    return
  }

  [string]$ServerErrorText = Get-Content -LiteralPath $ServerErr -Raw -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace($ServerErrorText)) {
    Write-StartupLog ("server stderr tail: " + $ServerErrorText.Replace([Environment]::NewLine, " | "))
  }
}

try {
  New-Item -ItemType Directory -Force -Path $Data, $Logs | Out-Null
  Remove-ExpiredDateLogs
  Set-Content -LiteralPath $Log -Value '' -Encoding UTF8

  Assert-File $Node 'Bundled runtime/node.exe'
  Assert-File $App 'Runtime app/server.cjs'
  Assert-File (Join-Path $Dist 'index.html') 'Runtime app/dist/index.html'
  Assert-Directory $Documents 'Documents folder'

  $LockHandle = Acquire-LaunchLock
  $ExistingRuntime = Get-HealthyRuntime
  if ($null -ne $ExistingRuntime) {
    $Port = $ExistingRuntime.Port
    $Url = $ExistingRuntime.Url
    Write-StartupLog 'Aleksi Learning Workbench startup'
    Write-StartupLog "selected port: 127.0.0.1:$Port"
    Write-StartupLog "healthy existing runtime reused: process id=$($ExistingRuntime.Process.Id)"
    Release-LaunchLock
    if (-not $NoBrowser) {
      Open-WorkbenchBrowser $Url 'reopened'
    } else {
      Write-StartupLog 'browser open result: skipped by -NoBrowser'
    }
    Write-Output "Aleksi Learning Workbench: $Url"
    exit 0
  }

  $Port = Get-RuntimePort
  $Url = "http://127.0.0.1:$Port/"
  $HealthUrl = "http://127.0.0.1:$Port/api/health"

  $env:ALEKSI_RUNTIME_MODE = 'friend-preview'
  $env:ALEKSI_SERVER_PORT = [string]$Port
  $env:ALEKSI_STATIC_DIST_DIR = $Dist
  $env:ALEKSI_APP_SETTINGS_DIR = $Data
  $env:ALEKSI_DEFAULT_VAULT_PATH = $LearningLibrary
  $env:ALEKSI_APP_VERSION = $AppVersion
  $env:ALEKSI_BUILD_ID = $BuildId
  $env:ALEKSI_RUNTIME_LOG_DIR = $Logs

  Write-StartupLog 'Aleksi Learning Workbench startup'
  Write-StartupLog "app version: $AppVersion"
  Write-StartupLog "build id: $BuildId"
  Write-StartupLog 'runtime mode: friend-preview'
  Write-StartupLog "node version: $(& $Node --version)"
  Write-StartupLog "server path: $App"
  Write-StartupLog "dist path: $Dist"
  Write-StartupLog "data directory: $Data"
  Write-StartupLog "logs directory: $Logs"
  Write-StartupLog "server stdout log: $ServerOut"
  Write-StartupLog "server stderr log: $ServerErr"
  Write-StartupLog "learning library: $LearningLibrary"
  Write-StartupLog "selected port: 127.0.0.1:$Port"

  if ($Foreground) {
    Release-LaunchLock
    & $Node $App *>&1 | Tee-Object -FilePath $Log -Append | Tee-Object -FilePath $DateLog -Append
    exit $LASTEXITCODE
  }

  $AppArgument = '"' + $App + '"'
  $Process = Start-Process -FilePath $Node -ArgumentList $AppArgument -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr -PassThru
  Write-RuntimeIdentity $Process $Port
  Write-StartupLog "server process id: $($Process.Id)"

  $HealthDeadline = (Get-Date).AddSeconds($HealthWaitSeconds)
  while ((Get-Date) -lt $HealthDeadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      $Process.WaitForExit() | Out-Null
      Write-ServerErrorTail
      throw 'Aleksi Learning Workbench server exited before health check passed.'
    }

    try {
      $Response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 1
      if (
        $Response.ok -ne $true -or
        $Response.service -ne 'aleksi-workbench' -or
        $Response.version -ne $AppVersion -or
        $Response.buildId -ne $BuildId
      ) {
        throw 'Health endpoint returned an unexpected response.'
      }
      Write-StartupLog "health check result: service=$($Response.service) version=$($Response.version) buildId=$($Response.buildId)"
      Release-LaunchLock
      if (-not $NoBrowser) {
        Open-WorkbenchBrowser $Url 'opened'
      } else {
        Write-StartupLog 'browser open result: skipped by -NoBrowser'
      }
      Write-Output "Aleksi Learning Workbench: $Url"
      exit 0
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  Write-ServerErrorTail
  Stop-RuntimeProcess
  throw "Aleksi Learning Workbench did not become ready at $HealthUrl"
} catch {
  Write-StartupLog ("uncaught error: " + $_.Exception.Message)
  Stop-RuntimeProcess
  if ($null -ne $Process) {
    Remove-RuntimeIdentity
  }
  Release-LaunchLock
  Write-Host 'Aleksi Learning Workbench startup failed. See logs/latest.log, or unzip again and retry.'
  Write-Host $_.Exception.Message
  exit 1
}
`;
}

function startWorkbenchCmd() {
  return [
    "@echo off",
    "setlocal",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Start Aleksi Workbench.ps1\" %*",
    "if errorlevel 1 (",
    "  echo.",
    "  echo Aleksi Learning Workbench failed to start. See logs\\latest.log.",
    "  pause",
    "  exit /b 1",
    ")",
    ""
  ].join("\r\n");
}

function stopWorkbenchPowerShell() {
  return `$ErrorActionPreference = 'Stop'
chcp 65001 | Out-Null

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $Root 'runtime\\node.exe'
$App = Join-Path $Root 'app\\server.cjs'
$Logs = Join-Path $Root 'logs'
$PidFile = Join-Path $Logs 'runtime.pid'
$InstanceFile = Join-Path $Logs 'runtime.instance.json'

function Remove-RuntimeIdentity {
  Remove-Item -LiteralPath $PidFile, $InstanceFile -Force -ErrorAction SilentlyContinue
}

if (
  -not (Test-Path -LiteralPath $PidFile -PathType Leaf) -or
  -not (Test-Path -LiteralPath $InstanceFile -PathType Leaf)
) {
  Remove-RuntimeIdentity
  Write-Output 'Aleksi Learning Workbench is not running from this package.'
  exit 0
}

try {
  [int]$SavedPid = (Get-Content -LiteralPath $PidFile -Raw).Trim()
  $Instance = Get-Content -LiteralPath $InstanceFile -Raw | ConvertFrom-Json
  if ([int]$Instance.pid -ne $SavedPid) { throw 'PID metadata mismatch' }
  $Process = Get-Process -Id $SavedPid -ErrorAction Stop
  if ($Process.StartTime.ToUniversalTime().ToString('o') -ne [string]$Instance.startedAt) {
    throw 'Process start time mismatch'
  }
  $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $SavedPid" -ErrorAction Stop
  [string]$ExecutablePath = $ProcessInfo.ExecutablePath
  [string]$CommandLine = $ProcessInfo.CommandLine
  if (-not [string]::Equals($ExecutablePath, $Node, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'PID belongs to another executable'
  }
  if ($CommandLine.IndexOf($App, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'PID command line does not match this runtime'
  }
} catch {
  Remove-RuntimeIdentity
  Write-Output ('Removed stale runtime identity without stopping any process: ' + $_.Exception.Message)
  exit 0
}

try {
  Stop-Process -InputObject $Process -Force -ErrorAction Stop
  $Process.WaitForExit(5000) | Out-Null
  Remove-RuntimeIdentity
  Write-Output 'Aleksi Learning Workbench stopped.'
  exit 0
} catch {
  Write-Host ('Unable to stop the verified Aleksi Workbench process: ' + $_.Exception.Message)
  exit 1
}
`;
}

function stopWorkbenchCmd() {
  return [
    "@echo off",
    "setlocal",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Stop Aleksi Workbench.ps1\"",
    "if errorlevel 1 pause",
    ""
  ].join("\r\n");
}

function readmeStart() {
  return [
    "Aleksi Learning Workbench Preview",
    "",
    "How to start:",
    "1. Unzip this folder.",
    "2. Double-click \"Start Aleksi Workbench.cmd\".",
    "3. Wait for your browser to open.",
    "4. Start reading and making cards.",
    "",
    "How to stop:",
    "Double-click \"Stop Aleksi Workbench.cmd\". It only stops a process whose PID, start time, executable, and command line match this package.",
    "",
    "Your learning data:",
    "The app stores your learning library in your Documents folder:",
    "Documents/Aleksi Learning Workbench",
    "",
    "Do not delete that folder unless you want to delete your learning data.",
    "",
    "If the app does not start:",
    "1. Close any old Aleksi Workbench windows.",
    "2. Double-click \"Start Aleksi Workbench.cmd\" again.",
    "3. Check logs/latest.log.",
    ""
  ].join("\r\n");
}

async function copyIfFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function collectFiles(directory = outputDirectory) {
  const files = [];
  const children = await readdir(directory, { withFileTypes: true });

  for (const child of children) {
    const absolutePath = resolve(directory, child.name);
    if (child.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
      continue;
    }

    if (child.isFile()) {
      files.push({
        absolutePath,
        relativePath: normalizeRuntimeEntryName(relative(outputDirectory, absolutePath))
      });
    }
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function writeRuntimeManifest(identity) {
  const files = (await collectFiles()).filter(
    (file) => file.relativePath !== RUNTIME_MANIFEST_NAME
  );
  const manifestFiles = [];

  for (const file of files) {
    const data = await readFile(file.absolutePath);
    const information = await stat(file.absolutePath);
    manifestFiles.push({
      path: file.relativePath,
      bytes: information.size,
      sha256: createHash("sha256").update(data).digest("hex")
    });
  }

  const manifest = {
    schemaVersion: 1,
    packageType: "runtime",
    version: identity.version,
    buildId: identity.buildId,
    generatedAtUtc: new Date().toISOString(),
    packageName: "AleksiWorkbench-Preview-win-x64",
    archiveRoot: "AleksiWorkbench-Preview",
    packagePath: normalizeRuntimeEntryName(relative(root, outputPath)),
    node: {
      source: "bundled from current local Node.js executable",
      version: process.version
    },
    launch: {
      host: "127.0.0.1",
      portRange: [17817, 17880],
      scripts: [
        "Start Aleksi Workbench.cmd",
        "Start Aleksi Workbench.ps1",
        "Stop Aleksi Workbench.cmd",
        "Stop Aleksi Workbench.ps1"
      ]
    },
    data: {
      defaultLearningLibrary: "Documents/Aleksi Learning Workbench"
    },
    files: manifestFiles
  };

  await writeFile(
    resolve(outputDirectory, RUNTIME_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function sanitizeFriendPreviewDist(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await sanitizeFriendPreviewDist(absolutePath);
      continue;
    }

    if (!/\.(css|html|js|json|mjs)$/iu.test(entry.name)) {
      continue;
    }

    const original = await readFile(absolutePath, "utf8");
    const sanitized = original
      .replace(/\/\*[\s\S]*?Claude[\s\S]*?\*\//gu, "")
      .replace(/@font-face\s*\{[^{}]*\/fonts\/claude\/[^{}]*\}\s*/gu, "");
    if (sanitized !== original) {
      await writeFile(absolutePath, sanitized, "utf8");
    }
  }
}

async function runtimeContentIdentity() {
  if (!RUNTIME_IDENTITY_VALUE_PATTERN.test(packageJson.version)) {
    throw new Error(`Unsafe package version for runtime identity: ${packageJson.version}`);
  }

  const entries = [];
  for (const file of await collectFiles()) {
    entries.push({
      path: file.relativePath,
      data: await readFile(file.absolutePath)
    });
  }

  return {
    version: packageJson.version,
    buildId: createRuntimeContentBuildId(entries)
  };
}

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  await cp(resolve(root, "dist"), resolve(outputDirectory, "app/dist"), {
    recursive: true
  });
  await rm(resolve(outputDirectory, "app/dist/fonts/claude"), {
    recursive: true,
    force: true
  });
  await sanitizeFriendPreviewDist(resolve(outputDirectory, "app/dist"));
  await copyIfFile(
    resolve(runtimeBuildDirectory, "app/server.cjs"),
    resolve(outputDirectory, "app/server.cjs")
  );
  const identity = await runtimeContentIdentity();
  await copyIfFile(process.execPath, resolve(outputDirectory, "runtime/node.exe"));
  await writeFile(resolve(outputDirectory, "README_START.txt"), readmeStart(), "utf8");
  await writeFile(
    resolve(outputDirectory, "Start Aleksi Workbench.cmd"),
    startWorkbenchCmd(),
    "utf8"
  );
  await writeFile(
    resolve(outputDirectory, "Start Aleksi Workbench.ps1"),
    startWorkbenchPowerShell(identity),
    "utf8"
  );
  await writeFile(
    resolve(outputDirectory, "Stop Aleksi Workbench.cmd"),
    stopWorkbenchCmd(),
    "utf8"
  );
  await writeFile(
    resolve(outputDirectory, "Stop Aleksi Workbench.ps1"),
    stopWorkbenchPowerShell(),
    "utf8"
  );
  await mkdir(resolve(outputDirectory, "logs"), { recursive: true });
  await mkdir(resolve(outputDirectory, "data"), { recursive: true });
  await writeFile(resolve(outputDirectory, "logs/.gitkeep"), "", "utf8");
  await writeFile(resolve(outputDirectory, "data/.gitkeep"), "", "utf8");
  await writeRuntimeManifest(identity);

  const packageEntries = [];
  for (const file of await collectFiles()) {
    packageEntries.push({
      name: runtimeArchiveEntryName(file.relativePath),
      data: await readFile(file.absolutePath)
    });
  }

  await writeStoredZip(outputPath, packageEntries);
  const audit = await auditRuntimeZipFile(outputPath);
  console.log(
    `Created runtime package: ${outputPath} (${audit.entries} entries, ${audit.totalUncompressedBytes} bytes)`
  );
}

await main();
