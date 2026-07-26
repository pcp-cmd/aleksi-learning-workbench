param(
  [Parameter(Mandatory = $true)]
  [string]$BackupRoot,

  [string]$ActiveLearningLibraryPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-ExactPath([string]$Actual, [string]$Expected, [string]$Label) {
  $actualFull = [System.IO.Path]::GetFullPath($Actual).TrimEnd('\')
  $expectedFull = [System.IO.Path]::GetFullPath($Expected).TrimEnd('\')
  if (-not [string]::Equals(
    $actualFull,
    $expectedFull,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$Label path mismatch. Expected '$expectedFull', got '$actualFull'."
  }
  return $actualFull
}

function Assert-NoReparseAncestors([string]$Path, [string]$Label) {
  $absolute = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($absolute)
  $current = $root
  foreach ($segment in @($absolute.Substring($root.Length).Split('\') | Where-Object { $_ -ne '' })) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) {
      continue
    }
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "$Label contains a reparse-point ancestor: $current"
    }
  }
}

function Assert-Inventory([string]$Root, $Files, [string]$Label) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
  $actualFiles = @(
    if (Test-Path -LiteralPath $rootFull -PathType Container) {
      Get-ChildItem -LiteralPath $rootFull -Recurse -File -Force
    }
  )
  if ($actualFiles.Count -ne @($Files).Count) {
    throw "$Label file count mismatch. Expected $(@($Files).Count), got $($actualFiles.Count)."
  }
  foreach ($file in @($Files)) {
    $relative = [string]$file.path
    if ([System.IO.Path]::IsPathRooted($relative) -or $relative.Split('/').Contains('..')) {
      throw "$Label contains an unsafe manifest path: $relative"
    }
    $path = [System.IO.Path]::GetFullPath(
      (Join-Path $rootFull ($relative -replace '/', '\'))
    )
    if (-not $path.StartsWith(
      "$rootFull\",
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
      throw "$Label manifest path escapes its root: $relative"
    }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.PSIsContainer -or
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "$Label contains a non-regular backup file: $path"
    }
    if ([int64]$item.Length -ne [int64]$file.bytes) {
      throw "$Label byte count mismatch: $relative"
    }
    if ((Get-Sha256Lower $path) -cne [string]$file.sha256) {
      throw "$Label SHA-256 mismatch: $relative"
    }
  }
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupRoot).Path
Assert-NoReparseAncestors $resolvedBackup 'Backup root'
$manifestPath = Join-Path $resolvedBackup 'manifest.json'
$manifest = [System.IO.File]::ReadAllText(
  $manifestPath,
  [System.Text.UTF8Encoding]::new($false)
) | ConvertFrom-Json
if ([int]$manifest.schemaVersion -ne 1 -or
  [string]$manifest.inventorySemantics -ne 'regular-file-relative-path-byte-length-sha256') {
  throw 'Backup manifest schema or inventory semantics are invalid.'
}

$expected = [ordered]@{
  '%APPDATA%\Aleksi Learning Workbench' = Join-Path $env:APPDATA 'Aleksi Learning Workbench'
  '%APPDATA%\io.aleksi.workbench' = Join-Path $env:APPDATA 'io.aleksi.workbench'
  '%LOCALAPPDATA%\io.aleksi.workbench' = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench'
  '%USERPROFILE%\Documents\Aleksi Learning Workbench' = Join-Path $env:USERPROFILE 'Documents\Aleksi Learning Workbench'
}
if (@($manifest.roots | Where-Object {
  [string]$_.label -eq '<ACTIVE_LEARNING_LIBRARY>'
}).Count -eq 1) {
  if ([string]::IsNullOrWhiteSpace($ActiveLearningLibraryPath)) {
    throw 'Backup contains an active learning library but no recovery path was supplied.'
  }
  $expected['<ACTIVE_LEARNING_LIBRARY>'] =
    [System.IO.Path]::GetFullPath($ActiveLearningLibraryPath)
}

if (@($manifest.roots).Count -ne $expected.Count) {
  throw "Backup root count mismatch. Expected $($expected.Count), got $(@($manifest.roots).Count)."
}
if (@(Get-Process -Name 'aleksi-workbench' -ErrorAction SilentlyContinue).Count -ne 0) {
  throw 'Aleksi Workbench must be stopped before recovery.'
}

foreach ($rootRecord in @($manifest.roots)) {
  $label = [string]$rootRecord.label
  if (-not $expected.Contains($label)) {
    throw "Backup contains an unexpected protected root: $label"
  }
  $target = Assert-ExactPath ([string]$expected[$label]) ([string]$expected[$label]) $label
  Assert-NoReparseAncestors (Split-Path -Parent $target) "$label parent"
  if (Test-Path -LiteralPath $target) {
    Assert-NoReparseAncestors $target $label
  }

  $backupDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path $resolvedBackup ([string]$rootRecord.directory -replace '/', '\'))
  )
  if (-not $backupDirectory.StartsWith(
    "$resolvedBackup\",
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$label backup directory escapes the verified backup root."
  }
  Assert-Inventory $backupDirectory $rootRecord.files "$label backup"

  if (-not [bool]$rootRecord.exists) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
    if (Test-Path -LiteralPath $target) {
      throw "$label should be absent after verified recovery."
    }
    continue
  }

  $staging = "$target.aleksi-restore-$([guid]::NewGuid().ToString('N'))"
  $parent = Split-Path -Parent $target
  if (-not $staging.StartsWith(
    "$parent\",
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$label staging path escapes the target parent."
  }
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    foreach ($file in @($rootRecord.files)) {
      $relative = [string]$file.path -replace '/', '\'
      $source = Join-Path $backupDirectory $relative
      $destination = Join-Path $staging $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force |
        Out-Null
      [System.IO.File]::Copy($source, $destination, $false)
    }
    Assert-Inventory $staging $rootRecord.files "$label staged recovery"

    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
    Move-Item -LiteralPath $staging -Destination $target
    Assert-Inventory $target $rootRecord.files "$label restored root"
  } finally {
    if (Test-Path -LiteralPath $staging) {
      Remove-Item -LiteralPath $staging -Recurse -Force
    }
  }
}

Write-Host "Verified user-data recovery completed from: $resolvedBackup"
