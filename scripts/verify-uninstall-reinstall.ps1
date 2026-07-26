param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,

  [string]$CanonicalIdentityPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($CanonicalIdentityPath)) {
  $CanonicalIdentityPath = Join-Path $PSScriptRoot '..\release\identity.json'
}

$script:UninstallRegistryKey =
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Aleksi Workbench'
$script:InstalledEvidenceFilename = 'installed-desktop-evidence.json'
$script:LifecycleEvidenceFilename = 'uninstall-reinstall-evidence.json'
$script:LifecycleReportFilename = 'uninstall-test-report.md'
$script:MaxBackupFiles = 100000
$script:MaxBackupBytes = [int64](20GB)
$script:InventoryTimeoutSeconds = 300
$script:BackupCopyTimeoutSeconds = 1800
$script:BackupFreeSpaceReserveBytes = [int64](512MB)

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-StringSha256([string]$Value) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return (($algorithm.ComputeHash($bytes) | ForEach-Object {
      $_.ToString('x2')
    }) -join '')
  } finally {
    $algorithm.Dispose()
  }
}

function Write-Utf8Json([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText(
    $Path,
    "$json`n",
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Write-Utf8Text([string]$Path, [string]$Value) {
  [System.IO.File]::WriteAllText(
    $Path,
    $Value,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Restore-VerifiedBackupSnapshot($BackupEvidence, $ProtectedRoots) {
  $activeRecoveryRoot = @(
    $ProtectedRoots |
      Where-Object { [string]$_.label -eq '<ACTIVE_LEARNING_LIBRARY>' }
  ) | Select-Object -First 1
  $activeRecoveryPath = if ($null -eq $activeRecoveryRoot) {
    ''
  } else {
    [string]$activeRecoveryRoot.path
  }
  & (Join-Path $PSScriptRoot 'restore-verified-user-data-backup.ps1') `
    -BackupRoot ([string]$BackupEvidence.root) `
    -ActiveLearningLibraryPath $activeRecoveryPath
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ([string]$Actual -cne [string]$Expected) {
    throw "$Label mismatch. Expected '$Expected', got '$Actual'."
  }
}

function Assert-PathEqual([string]$Actual, [string]$Expected, [string]$Label) {
  $actualFull = [System.IO.Path]::GetFullPath($Actual).TrimEnd('\')
  $expectedFull = [System.IO.Path]::GetFullPath($Expected).TrimEnd('\')
  if (-not [string]::Equals(
    $actualFull,
    $expectedFull,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$Label mismatch. Expected '$expectedFull', got '$actualFull'."
  }
}

function Assert-NoReparseAncestors([string]$Path, [string]$Label) {
  $absolute = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($absolute)
  $current = $root
  $relative = $absolute.Substring($root.Length)
  foreach ($segment in @($relative.Split('\') | Where-Object { $_ -ne '' })) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) {
      continue
    }
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "$Label contains a reparse-point ancestor: $current"
    }
  }
}

function Assert-ObjectKeys($Value, [string[]]$Expected, [string]$Label) {
  if ($null -eq $Value) {
    throw "$Label must be an object."
  }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $expectedSorted = @($Expected | Sort-Object)
  if ($actual.Count -ne $expectedSorted.Count) {
    throw "$Label field count mismatch. Expected $($expectedSorted -join ', '), got $($actual -join ', ')."
  }
  for ($index = 0; $index -lt $actual.Count; $index += 1) {
    if ($actual[$index] -cne $expectedSorted[$index]) {
      throw "$Label fields mismatch. Expected $($expectedSorted -join ', '), got $($actual -join ', ')."
    }
  }
}

function Get-PeMachine([string]$Path) {
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    if ($reader.ReadUInt16() -ne 0x5a4d) {
      throw "PE file is missing its MZ header: $Path"
    }
    $stream.Position = 0x3c
    $peOffset = $reader.ReadUInt32()
    if ($peOffset -lt 0x40 -or ($peOffset + 6) -gt $stream.Length) {
      throw "PE file has an invalid header offset: $Path"
    }
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "PE file is missing its PE signature: $Path"
    }
    return $reader.ReadUInt16()
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Assert-UnsignedPe([string]$Path, [string]$Label) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  Assert-Equal ([string]$signature.Status) 'NotSigned' "$Label Authenticode status"
}

function Assert-RegularFileNoReparse([string]$Path, [string]$Label) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.PSIsContainer) {
    throw "$Label is not a regular file: $Path"
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "$Label must not be a reparse point: $Path"
  }
  return $item
}

function Get-ManifestArtifact($Manifest, [string]$RelativePath) {
  $matches = @(
    $Manifest.artifacts |
      Where-Object {
        ([string]$_.path).Replace('\', '/') -ceq $RelativePath
      }
  )
  if ($matches.Count -ne 1) {
    throw "Release manifest must contain exactly one '$RelativePath' artifact."
  }
  return $matches[0]
}

function Assert-ManifestArtifact(
  $Manifest,
  [string]$ReleaseDirectory,
  [string]$RelativePath
) {
  if (
    [string]::IsNullOrWhiteSpace($RelativePath) -or
    [System.IO.Path]::IsPathRooted($RelativePath) -or
    $RelativePath.Replace('/', '\').Split('\') -contains '..'
  ) {
    throw "Unsafe release artifact path: $RelativePath"
  }
  $artifact = Get-ManifestArtifact $Manifest $RelativePath
  $absolute = [System.IO.Path]::GetFullPath(
    (Join-Path $ReleaseDirectory $RelativePath.Replace('/', '\'))
  )
  $prefix = $ReleaseDirectory.TrimEnd('\') + '\'
  if (-not $absolute.StartsWith(
    $prefix,
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Release artifact leaves the canonical directory: $RelativePath"
  }
  if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) {
    throw "Release artifact is missing: $RelativePath"
  }
  $item = Get-Item -LiteralPath $absolute
  Assert-Equal ([int64]$item.Length) ([int64]$artifact.bytes) "$RelativePath bytes"
  Assert-Equal (Get-Sha256Lower $absolute) ([string]$artifact.sha256) "$RelativePath SHA-256"
  return [pscustomobject]@{
    path = $absolute
    bytes = [int64]$item.Length
    sha256 = Get-Sha256Lower $absolute
  }
}

function Get-RegularFileInventory([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    return [pscustomobject]@{
      exists = $false
      entries = @()
      fileCount = 0
      bytes = [int64]0
      digest = Get-StringSha256 ''
    }
  }

  Assert-NoReparseAncestors $Root 'Protected inventory root'
  $rootItem = Get-Item -LiteralPath $Root -Force
  if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Protected root must not be a reparse point: $Root"
  }
  $trimmedRoot = $rootItem.FullName.TrimEnd('\')
  $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
  $pendingDirectories.Push($trimmedRoot)
  $regularFiles = [System.Collections.Generic.List[object]]::new()
  $observedBytes = [int64]0
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  while ($pendingDirectories.Count -ne 0) {
    if ($timer.Elapsed.TotalSeconds -gt $script:InventoryTimeoutSeconds) {
      throw "Protected-root inventory exceeded $($script:InventoryTimeoutSeconds) seconds: $Root"
    }
    $directory = $pendingDirectories.Pop()
    foreach ($entry in @(
      Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop
    )) {
      if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Protected root contains a reparse point and cannot be safely inventoried: $Root"
      }
      if ($entry.PSIsContainer) {
        $pendingDirectories.Push($entry.FullName)
      } else {
        $regularFiles.Add($entry)
        $observedBytes += [int64]$entry.Length
        if ($regularFiles.Count -gt $script:MaxBackupFiles) {
          throw "Protected root exceeds the $($script:MaxBackupFiles)-file backup limit: $Root"
        }
        if ($observedBytes -gt $script:MaxBackupBytes) {
          throw "Protected root exceeds the $($script:MaxBackupBytes)-byte backup limit: $Root"
        }
      }
    }
  }
  $inventoryEntries = [System.Collections.Generic.List[object]]::new()
  foreach ($file in $regularFiles) {
    if ($timer.Elapsed.TotalSeconds -gt $script:InventoryTimeoutSeconds) {
      throw "Protected-root hashing exceeded $($script:InventoryTimeoutSeconds) seconds: $Root"
    }
    $relative = $file.FullName.Substring($trimmedRoot.Length).TrimStart('\')
    $inventoryEntries.Add([pscustomobject]@{
      path = $relative.Replace('\', '/')
      bytes = [int64]$file.Length
      sha256 = Get-Sha256Lower $file.FullName
    })
  }
  $timer.Stop()
  $entries = @($inventoryEntries | Sort-Object path)
  $payload = if ($entries.Count -eq 0) {
    ''
  } else {
    ($entries | ConvertTo-Json -Depth 4 -Compress)
  }
  return [pscustomobject]@{
    exists = $true
    entries = $entries
    fileCount = [int]$entries.Count
    bytes = $observedBytes
    digest = Get-StringSha256 $payload
  }
}

function Get-ProtectedUserDataRoots {
  $roots = @(
    [pscustomobject]@{
      path = (Join-Path $env:APPDATA 'Aleksi Learning Workbench')
      label = '%APPDATA%\Aleksi Learning Workbench'
    }
    [pscustomobject]@{
      path = (Join-Path $env:APPDATA 'io.aleksi.workbench')
      label = '%APPDATA%\io.aleksi.workbench'
    }
    [pscustomobject]@{
      path = (Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench')
      label = '%LOCALAPPDATA%\io.aleksi.workbench'
    }
    [pscustomobject]@{
      path = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Aleksi Learning Workbench')
      label = '%USERPROFILE%\Documents\Aleksi Learning Workbench'
    }
  )

  $settingsPath = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\settings\settings.json'
  if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$settings.activeVaultPath)) {
      $activePath = [System.IO.Path]::GetFullPath([string]$settings.activeVaultPath)
      if (-not (Test-Path -LiteralPath $activePath -PathType Container)) {
        throw "Configured active learning library is not accessible: $activePath"
      }
      $activeTrimmed = $activePath.TrimEnd('\')
      $driveRoot = [System.IO.Path]::GetPathRoot($activeTrimmed).TrimEnd('\')
      $profileRoot = [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
      if (
        [string]::Equals(
          $activeTrimmed,
          $driveRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -or
        [string]::Equals(
          $activeTrimmed,
          $profileRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw "Configured active learning library is too broad for a bounded verified backup: $activePath"
      }
      $roots += [pscustomobject]@{
        path = $activePath
        label = '<ACTIVE_LEARNING_LIBRARY>'
      }
    }
  }

  $seen = @{}
  return @(
    foreach ($root in $roots) {
      $absolute = [System.IO.Path]::GetFullPath([string]$root.path).TrimEnd('\')
      $key = $absolute.ToLowerInvariant()
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        [pscustomobject]@{
          path = $absolute
          label = [string]$root.label
        }
      }
    }
  )
}

function Assert-ProtectedRootsNotOverlapping($Roots) {
  for ($leftIndex = 0; $leftIndex -lt $Roots.Count; $leftIndex += 1) {
    $left = ([string]$Roots[$leftIndex].path).TrimEnd('\')
    for ($rightIndex = $leftIndex + 1; $rightIndex -lt $Roots.Count; $rightIndex += 1) {
      $right = ([string]$Roots[$rightIndex].path).TrimEnd('\')
      if (
        $left.StartsWith(
          "$right\",
          [System.StringComparison]::OrdinalIgnoreCase
        ) -or
        $right.StartsWith(
          "$left\",
          [System.StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw "Protected user-data roots overlap and cannot be backed up independently: '$left' and '$right'."
      }
    }
  }
}

function Get-ProtectedInventories($Roots) {
  return @(
    foreach ($root in $Roots) {
      $inventory = Get-RegularFileInventory ([string]$root.path)
      [pscustomobject]@{
        label = [string]$root.label
        path = [string]$root.path
        exists = [bool]$inventory.exists
        entries = @($inventory.entries)
        fileCount = [int]$inventory.fileCount
        bytes = [int64]$inventory.bytes
        digest = [string]$inventory.digest
      }
    }
  )
}

function Convert-InventoriesToFingerprints($Inventories) {
  return @(
    foreach ($inventory in $Inventories) {
      [ordered]@{
        label = [string]$inventory.label
        exists = [bool]$inventory.exists
        fileCount = [int]$inventory.fileCount
        bytes = [int64]$inventory.bytes
        digest = [string]$inventory.digest
      }
    }
  )
}

function Get-AllUserDataFingerprints($Roots) {
  return Convert-InventoriesToFingerprints (Get-ProtectedInventories $Roots)
}

function Assert-FingerprintsEqual($Before, $After, [string]$Label) {
  $beforeJson = $Before | ConvertTo-Json -Depth 8 -Compress
  $afterJson = $After | ConvertTo-Json -Depth 8 -Compress
  if ($beforeJson -cne $afterJson) {
    throw "$Label changed user data. Before=$beforeJson After=$afterJson"
  }
}

function Get-StableUserDataFingerprints($Roots, [string]$Label) {
  $first = Get-AllUserDataFingerprints $Roots
  Start-Sleep -Milliseconds 1200
  $second = Get-AllUserDataFingerprints $Roots
  Assert-FingerprintsEqual $first $second $Label
  return $second
}

function Get-InventoriesDigest($Inventories) {
  $fingerprints = Convert-InventoriesToFingerprints $Inventories
  $payload = ($fingerprints | ForEach-Object {
    $exists = ([bool]$_.exists).ToString().ToLowerInvariant()
    "$($_.label)`t$exists`t$([int]$_.fileCount)`t$([int64]$_.bytes)`t$($_.digest)"
  }) -join "`n"
  return Get-StringSha256 $payload
}

function Assert-InventoriesEquivalent($Expected, $Actual, [string]$Label) {
  if ($Expected.Count -ne $Actual.Count) {
    throw "$Label root count mismatch."
  }
  for ($rootIndex = 0; $rootIndex -lt $Expected.Count; $rootIndex += 1) {
    $left = $Expected[$rootIndex]
    $right = $Actual[$rootIndex]
    Assert-Equal ([string]$right.label) ([string]$left.label) "$Label root label [$rootIndex]"
    Assert-Equal ([bool]$right.exists) ([bool]$left.exists) "$Label root existence [$rootIndex]"
    $leftJson = @($left.entries) | ConvertTo-Json -Depth 6 -Compress
    $rightJson = @($right.entries) | ConvertTo-Json -Depth 6 -Compress
    if ($leftJson -cne $rightJson) {
      throw "$Label regular-file inventory mismatch at root '$([string]$left.label)'."
    }
  }
}

function New-BackupDirectory([string]$RepositoryRoot) {
  Assert-NoReparseAncestors $RepositoryRoot 'Repository backup root'
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
  for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    $suffix = if ($attempt -eq 0) { '' } else { "-$attempt" }
    $relative = "artifacts/review/pre-uninstall-user-data-backup-$stamp$suffix"
    $absolute = [System.IO.Path]::GetFullPath(
      (Join-Path $RepositoryRoot $relative.Replace('/', '\'))
    )
    if (-not (Test-Path -LiteralPath $absolute)) {
      New-Item -ItemType Directory -Path $absolute -ErrorAction Stop | Out-Null
      Assert-NoReparseAncestors $absolute 'Allocated lifecycle backup'
      return [pscustomobject]@{
        relative = $relative
        absolute = $absolute
      }
    }
  }
  throw 'Could not allocate a new pre-uninstall backup directory.'
}

function New-VerifiedUserDataBackup(
  [string]$RepositoryRoot,
  $Roots,
  $ExpectedFingerprints
) {
  $backup = New-BackupDirectory $RepositoryRoot
  Assert-ProtectedRootsNotOverlapping $Roots
  foreach ($root in $Roots) {
    $protectedPrefix = ([string]$root.path).TrimEnd('\') + '\'
    if (
      $backup.absolute.StartsWith(
        $protectedPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw 'Pre-uninstall backup directory must remain outside protected user-data roots.'
    }
  }
  $incompleteMarker = Join-Path $backup.absolute '.incomplete'
  [System.IO.File]::WriteAllText(
    $incompleteMarker,
    "Backup verification has not completed.`n",
    [System.Text.UTF8Encoding]::new($false)
  )

  $sourceInventories = Get-ProtectedInventories $Roots
  Assert-FingerprintsEqual (
    Convert-InventoriesToFingerprints $sourceInventories
  ) $ExpectedFingerprints 'Pre-backup source stability check'
  $sourceDigest = Get-InventoriesDigest $sourceInventories
  $totalFiles = [int](($sourceInventories | Measure-Object -Property fileCount -Sum).Sum)
  $totalBytes = [int64](($sourceInventories | Measure-Object -Property bytes -Sum).Sum)
  if ($totalFiles -gt $script:MaxBackupFiles) {
    throw "Protected user data exceeds the $($script:MaxBackupFiles)-file backup limit."
  }
  if ($totalBytes -gt $script:MaxBackupBytes) {
    throw "Protected user data exceeds the $($script:MaxBackupBytes)-byte backup limit."
  }
  $backupDriveRoot = [System.IO.Path]::GetPathRoot($backup.absolute)
  $backupDrive = [System.IO.DriveInfo]::new($backupDriveRoot)
  $requiredFreeBytes = $totalBytes + $script:BackupFreeSpaceReserveBytes
  if ([int64]$backupDrive.AvailableFreeSpace -lt $requiredFreeBytes) {
    throw "Backup volume has insufficient free space. Required=$requiredFreeBytes Available=$([int64]$backupDrive.AvailableFreeSpace)."
  }

  $manifestRoots = @()
  $backupInventories = @()
  $copyTimer = [System.Diagnostics.Stopwatch]::StartNew()
  for ($rootIndex = 0; $rootIndex -lt $sourceInventories.Count; $rootIndex += 1) {
    $source = $sourceInventories[$rootIndex]
    $relativeDirectory = "data/root-$('{0:d2}' -f $rootIndex)"
    $destinationRoot = Join-Path $backup.absolute $relativeDirectory.Replace('/', '\')
    if ([bool]$source.exists) {
      New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
      foreach ($entry in $source.entries) {
        if ($copyTimer.Elapsed.TotalSeconds -gt $script:BackupCopyTimeoutSeconds) {
          throw "Verified backup copy exceeded $($script:BackupCopyTimeoutSeconds) seconds."
        }
        $sourceFile = Join-Path ([string]$source.path) ([string]$entry.path).Replace('/', '\')
        $destinationFile = Join-Path $destinationRoot ([string]$entry.path).Replace('/', '\')
        $destinationParent = Split-Path -Parent $destinationFile
        if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
          New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -Force -ErrorAction Stop
      }
    }
    $destinationInventory = Get-RegularFileInventory $destinationRoot
    $backupInventories += [pscustomobject]@{
      label = [string]$source.label
      path = $destinationRoot
      exists = [bool]$destinationInventory.exists
      entries = @($destinationInventory.entries)
      fileCount = [int]$destinationInventory.fileCount
      bytes = [int64]$destinationInventory.bytes
      digest = [string]$destinationInventory.digest
    }
    $manifestRoots += [ordered]@{
      label = [string]$source.label
      exists = [bool]$source.exists
      directory = $relativeDirectory
      files = @($source.entries)
    }
  }
  $copyTimer.Stop()

  Assert-InventoriesEquivalent $sourceInventories $backupInventories 'Backup verification'
  $backupDigest = Get-InventoriesDigest $backupInventories
  Assert-Equal $backupDigest $sourceDigest 'Backup inventory digest'

  $sourceAfterCopy = Get-ProtectedInventories $Roots
  Assert-InventoriesEquivalent $sourceInventories $sourceAfterCopy 'Source stability during backup'
  Assert-FingerprintsEqual (
    Convert-InventoriesToFingerprints $sourceAfterCopy
  ) $ExpectedFingerprints 'Post-backup source stability check'

  $manifest = [ordered]@{
    schemaVersion = 1
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    inventorySemantics = 'regular-file-relative-path-byte-length-sha256'
    roots = $manifestRoots
    summary = [ordered]@{
      fileCount = $totalFiles
      bytes = $totalBytes
      sourceFingerprintDigest = $sourceDigest
      backupFingerprintDigest = $backupDigest
    }
  }
  $manifestPath = Join-Path $backup.absolute 'manifest.json'
  Write-Utf8Json $manifestPath $manifest
  [System.IO.File]::Delete($incompleteMarker)
  $manifestItem = Get-Item -LiteralPath $manifestPath
  return [pscustomobject]@{
    root = [string]$backup.relative
    manifestPath = "$([string]$backup.relative)/manifest.json"
    manifestBytes = [int64]$manifestItem.Length
    manifestSha256 = Get-Sha256Lower $manifestPath
    fileCount = $totalFiles
    bytes = $totalBytes
    sourceFingerprintDigest = $sourceDigest
    backupFingerprintDigest = $backupDigest
  }
}

function Get-ExpectedInstallRoot {
  return [System.IO.Path]::GetFullPath(
    (Join-Path $env:LOCALAPPDATA 'Aleksi Workbench')
  ).TrimEnd('\')
}

function Get-InstallCandidates {
  return @(
    (Join-Path $env:LOCALAPPDATA 'Aleksi Workbench\aleksi-workbench.exe')
    (Join-Path $env:LOCALAPPDATA 'Programs\Aleksi Workbench\aleksi-workbench.exe')
    (Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\aleksi-workbench.exe')
  ) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
}

function Find-ExactInstalledExecutable {
  $expected = Join-Path (Get-ExpectedInstallRoot) 'aleksi-workbench.exe'
  $found = @(
    Get-InstallCandidates |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
      ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
  )
  if ($found.Count -ne 1) {
    throw "Expected exactly one approved Aleksi executable candidate, found $($found.Count)."
  }
  Assert-PathEqual $found[0] $expected 'Installed executable path'
  return $found[0]
}

function Convert-RegistryPath([string]$Value) {
  $trimmed = $Value.Trim()
  if (
    $trimmed.Length -ge 2 -and
    $trimmed.StartsWith('"') -and
    $trimmed.EndsWith('"')
  ) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
  }
  return [System.IO.Path]::GetFullPath($trimmed)
}

function Get-ExactRegistryInstallation($Canonical) {
  if (-not (Test-Path -LiteralPath $script:UninstallRegistryKey)) {
    throw 'The exact HKCU Aleksi Workbench uninstall registry key is absent.'
  }
  $properties = Get-ItemProperty -LiteralPath $script:UninstallRegistryKey
  Assert-Equal ([string]$properties.DisplayName) ([string]$Canonical.displayName) 'Registry DisplayName'
  Assert-Equal ([string]$properties.DisplayVersion) ([string]$Canonical.version) 'Registry DisplayVersion'
  $expectedRoot = Get-ExpectedInstallRoot
  Assert-PathEqual (
    Convert-RegistryPath ([string]$properties.InstallLocation)
  ) $expectedRoot 'Registry InstallLocation'
  $expectedUninstaller = Join-Path $expectedRoot 'uninstall.exe'
  Assert-PathEqual (
    Convert-RegistryPath ([string]$properties.UninstallString)
  ) $expectedUninstaller 'Registry UninstallString'
  return [pscustomobject]@{
    version = [string]$properties.DisplayVersion
    installRoot = $expectedRoot
    uninstaller = $expectedUninstaller
  }
}

function Get-ProcessesAtPath([string]$ExecutablePath) {
  return @(
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          [string]::Equals(
            [string]$_.Path,
            $ExecutablePath,
            [System.StringComparison]::OrdinalIgnoreCase
          )
        } catch {
          $false
        }
      }
  )
}

function Get-AleksiWebViewProcesses {
  $marker = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench'
  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
        ([string]$_.CommandLine).IndexOf(
          $marker,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0
      }
  )
}

function Assert-AleksiProcessesNotRunning(
  [string]$AppExecutablePath,
  [string]$NodeExecutablePath
) {
  $namedApps = @(Get-Process -Name 'aleksi-workbench' -ErrorAction SilentlyContinue)
  $pathApps = @(Get-ProcessesAtPath $AppExecutablePath)
  $sidecars = @(Get-ProcessesAtPath $NodeExecutablePath)
  $webViews = @(Get-AleksiWebViewProcesses)
  if (
    $namedApps.Count -ne 0 -or
    $pathApps.Count -ne 0 -or
    $sidecars.Count -ne 0 -or
    $webViews.Count -ne 0
  ) {
    throw "Aleksi Workbench or its bundled sidecar was already running. Close it normally and rerun the lifecycle verifier; the verifier will not force-close a pre-existing process."
  }
}

function Wait-ForProcessesAtPathAbsent(
  [string]$ExecutablePath,
  [int]$TimeoutSeconds = 8
) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (@(Get-ProcessesAtPath $ExecutablePath).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Process remained active: $ExecutablePath"
}

function Wait-ForAleksiWebViewProcessesAbsent([int]$TimeoutSeconds = 12) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (@(Get-AleksiWebViewProcesses).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'Aleksi WebView2 child processes remained active after the native window closed.'
}

function Wait-ForPathAbsent([string]$Path, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (-not (Test-Path -LiteralPath $Path)) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for path removal: $Path"
}

function Test-LoopbackPort([int]$Port, [int]$TimeoutMilliseconds = 1200) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait($TimeoutMilliseconds)) {
      return $false
    }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ForReadyRecord(
  [string]$LogPath,
  $AppProcess,
  $Identity,
  [datetime]$StartedAt
) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      throw "Reinstalled app exited before sidecar readiness. ExitCode=$($AppProcess.ExitCode)."
    }
    if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
      $log = Get-Item -LiteralPath $LogPath
      if ($log.LastWriteTimeUtc -ge $StartedAt.ToUniversalTime()) {
        $line = Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue |
          Where-Object { $_ -like 'ALEKSI_READY *' } |
          Select-Object -Last 1
        if ($null -ne $line) {
          $payload = [string]($line -replace '^ALEKSI_READY\s+', '')
          if ($payload -match '(?i)secret') {
            throw 'Reinstalled readiness output exposed a protocol-secret field.'
          }
          $ready = $payload | ConvertFrom-Json
          Assert-Equal ([string]$ready.host) '127.0.0.1' 'Reinstalled sidecar host'
          Assert-Equal ([string]$ready.version) ([string]$Identity.version) 'Reinstalled sidecar version'
          Assert-Equal ([int]$ready.protocolVersion) ([int]$Identity.protocolVersion) 'Reinstalled protocol version'
          Assert-Equal ([string]$ready.shellBuildId) ([string]$Identity.shellBuildId) 'Reinstalled shell build ID'
          Assert-Equal ([string]$ready.sidecarBuildId) ([string]$Identity.sidecarBuildId) 'Reinstalled sidecar build ID'
          if ([int]$ready.port -lt 1 -or [int]$ready.port -gt 65535) {
            throw 'Reinstalled sidecar readiness port is invalid.'
          }
          if (-not (Test-LoopbackPort ([int]$ready.port))) {
            throw 'Reinstalled sidecar readiness port is not reachable.'
          }
          return $ready
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'Timed out waiting for reinstalled sidecar readiness.'
}

function Wait-ForMainWindow($AppProcess) {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      throw 'Reinstalled app exited before exposing its native window.'
    }
    if ([int64]$AppProcess.MainWindowHandle -ne 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'Reinstalled app did not expose a native main window.'
}

function Wait-ForPortClosed([int]$Port) {
  $deadline = (Get-Date).AddSeconds(8)
  do {
    if (-not (Test-LoopbackPort $Port 350)) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Reinstalled sidecar remained reachable after normal window close: 127.0.0.1:$Port"
}

function Assert-InstalledEvidence($Evidence, $Canonical, $Manifest, $InstallerItem, [string]$InstallerHash) {
  Assert-ObjectKeys $Evidence @(
    'evidenceBoundary',
    'identity',
    'installation',
    'installer',
    'result',
    'runtime',
    'schemaVersion',
    'testedAtUtc',
    'upgrade'
  ) 'Installed desktop evidence'
  Assert-Equal ([int]$Evidence.schemaVersion) 1 'Installed evidence schema version'
  Assert-Equal ([string]$Evidence.result) 'passed' 'Installed evidence result'
  Assert-Equal (
    [string]$Evidence.evidenceBoundary
  ) 'developer-machine-installed-shell-and-isolated-packaged-sidecar' 'Installed evidence boundary'
  Assert-ObjectKeys $Evidence.installer @(
    'authenticodeStatus',
    'bytes',
    'manifestPath',
    'path',
    'peMachine',
    'sha256'
  ) 'Installed evidence installer'
  Assert-Equal ([string]$Evidence.installer.path) ([string]$Canonical.installerFilename) 'Installed evidence installer path'
  Assert-Equal ([int64]$Evidence.installer.bytes) ([int64]$InstallerItem.Length) 'Installed evidence installer bytes'
  Assert-Equal ([string]$Evidence.installer.sha256) $InstallerHash 'Installed evidence installer SHA-256'
  Assert-Equal ([string]$Evidence.installer.manifestPath) 'release-manifest.json' 'Installed evidence manifest path'
  Assert-ObjectKeys $Evidence.identity @(
    'nodeSha256',
    'nodeVersion',
    'product',
    'protocolVersion',
    'schemaVersion',
    'shellBuildId',
    'sidecarBuildId',
    'version'
  ) 'Installed evidence identity'
  Assert-Equal ([string]$Evidence.identity.product) ([string]$Canonical.displayName) 'Installed evidence product'
  Assert-Equal ([string]$Evidence.identity.version) ([string]$Canonical.version) 'Installed evidence version'
  Assert-Equal ([int]$Evidence.identity.protocolVersion) ([int]$Canonical.localProtocolVersion) 'Installed evidence protocol'
  Assert-Equal ([string]$Evidence.identity.shellBuildId) ([string]$Manifest.shellBuildId) 'Installed evidence shell build ID'
  Assert-Equal ([string]$Evidence.identity.sidecarBuildId) ([string]$Manifest.sidecarBuildId) 'Installed evidence sidecar build ID'
  Assert-Equal ([string]$Evidence.identity.nodeVersion) ([string]$Canonical.nodeRuntime.version) 'Installed evidence Node version'
  Assert-Equal ([string]$Evidence.identity.nodeSha256) ([string]$Canonical.nodeRuntime.sha256) 'Installed evidence Node SHA-256'
  Assert-ObjectKeys $Evidence.installation @(
    'bytes',
    'executableAuthenticodeStatus',
    'executableBytes',
    'executablePath',
    'executableSha256',
    'fileCount',
    'installRoot',
    'uninstallerAuthenticodeStatus',
    'uninstallerBytes',
    'uninstallerPath',
    'uninstallerPeMachine',
    'uninstallerSha256'
  ) 'Installed evidence installation'
  Assert-Equal (
    [string]$Evidence.installation.installRoot
  ) ([string]$Canonical.windowsPathContracts.install) 'Installed evidence install root'
  Assert-Equal (
    [string]$Evidence.installation.executablePath
  ) "$([string]$Canonical.windowsPathContracts.install)\$([string]$Canonical.executableName)" 'Installed evidence executable path'
  if ([int64]$Evidence.installation.executableBytes -lt 1) {
    throw 'Installed evidence executable byte length is invalid.'
  }
  if ([string]$Evidence.installation.executableSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Installed evidence executable SHA-256 is invalid.'
  }
  Assert-Equal (
    [string]$Evidence.installation.uninstallerPath
  ) "$([string]$Canonical.windowsPathContracts.install)\uninstall.exe" 'Installed evidence uninstaller path'
  if ([int64]$Evidence.installation.uninstallerBytes -lt 1) {
    throw 'Installed evidence uninstaller byte length is invalid.'
  }
  if ([string]$Evidence.installation.uninstallerSha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Installed evidence uninstaller SHA-256 is invalid.'
  }
  Assert-Equal (
    [string]$Evidence.installation.uninstallerPeMachine
  ) 'I386' 'Installed evidence uninstaller PE machine'
  Assert-Equal (
    [string]$Evidence.installation.uninstallerAuthenticodeStatus
  ) 'NotSigned' 'Installed evidence uninstaller Authenticode'
}

function Assert-VerifiedUninstaller([string]$Path, $InstalledEvidence) {
  $item = Assert-RegularFileNoReparse $Path 'Registered NSIS uninstaller'
  Assert-Equal (
    [int64]$item.Length
  ) ([int64]$InstalledEvidence.installation.uninstallerBytes) 'Registered uninstaller bytes'
  Assert-Equal (
    Get-Sha256Lower $Path
  ) ([string]$InstalledEvidence.installation.uninstallerSha256) 'Registered uninstaller SHA-256'
  if ((Get-PeMachine $Path) -ne 0x014c) {
    throw 'Registered NSIS uninstaller stub PE architecture is not I386.'
  }
  Assert-UnsignedPe $Path 'Registered NSIS uninstaller'
  return $item
}

function Assert-InstalledPayload(
  [string]$AppExe,
  [int64]$ExpectedExecutableBytes,
  [string]$ExpectedExecutableHash,
  $Canonical,
  $Manifest,
  $RuntimeIdentityProvenance
) {
  $appItem = Get-Item -LiteralPath $AppExe
  Assert-Equal ([int64]$appItem.Length) $ExpectedExecutableBytes 'Installed executable bytes'
  Assert-Equal (Get-Sha256Lower $AppExe) $ExpectedExecutableHash 'Installed executable SHA-256'
  if ((Get-PeMachine $AppExe) -ne 0x8664) {
    throw 'Installed application PE architecture is not AMD64/x64.'
  }
  Assert-UnsignedPe $AppExe 'Installed application'
  $versionInfo = $appItem.VersionInfo
  Assert-Equal ([string]$versionInfo.ProductName) ([string]$Canonical.displayName) 'Installed executable product'
  Assert-Equal ([string]$versionInfo.ProductVersion) ([string]$Canonical.version) 'Installed executable version'

  $installRoot = Split-Path -Parent $AppExe
  Assert-PathEqual $installRoot (Get-ExpectedInstallRoot) 'Installed root'
  $identityPath = Join-Path $installRoot 'resources\identity.json'
  $nodePath = Join-Path $installRoot 'resources\sidecar\node.exe'
  $serverPath = Join-Path $installRoot 'resources\sidecar\server.cjs'
  foreach ($path in @($identityPath, $nodePath, $serverPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Installed resource is missing: $path"
    }
  }
  Assert-Equal (
    Get-Sha256Lower $identityPath
  ) ([string]$RuntimeIdentityProvenance.sha256) 'Installed runtime identity SHA-256'
  Assert-Equal (
    [int64](Get-Item -LiteralPath $identityPath).Length
  ) ([int64]$RuntimeIdentityProvenance.bytes) 'Installed runtime identity bytes'

  $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  Assert-Equal ([string]$identity.product) ([string]$Canonical.displayName) 'Installed identity product'
  Assert-Equal ([string]$identity.version) ([string]$Canonical.version) 'Installed identity version'
  Assert-Equal ([int]$identity.schemaVersion) ([int]$Canonical.projectSchemaVersion) 'Installed schema version'
  Assert-Equal ([int]$identity.protocolVersion) ([int]$Canonical.localProtocolVersion) 'Installed protocol version'
  Assert-Equal ([string]$identity.shellBuildId) ([string]$Manifest.shellBuildId) 'Installed identity shell build ID'
  Assert-Equal ([string]$identity.sidecarBuildId) ([string]$Manifest.sidecarBuildId) 'Installed identity sidecar build ID'
  Assert-Equal ([string]$identity.nodeVersion) ([string]$Canonical.nodeRuntime.version) 'Installed identity Node version'

  foreach ($logicalPath in @('sidecar/node.exe', 'sidecar/server.cjs')) {
    $entries = @(
      $identity.files | Where-Object { [string]$_.path -ceq $logicalPath }
    )
    if ($entries.Count -ne 1) {
      throw "Installed identity must contain exactly one $logicalPath entry."
    }
    $installedPath = if ($logicalPath -eq 'sidecar/node.exe') {
      $nodePath
    } else {
      $serverPath
    }
    Assert-Equal (
      [int64](Get-Item -LiteralPath $installedPath).Length
    ) ([int64]$entries[0].bytes) "Installed $logicalPath bytes"
    Assert-Equal (
      Get-Sha256Lower $installedPath
    ) ([string]$entries[0].sha256) "Installed $logicalPath SHA-256"
  }
  Assert-Equal (
    Get-Sha256Lower $nodePath
  ) ([string]$Canonical.nodeRuntime.sha256) 'Bundled Node canonical SHA-256'
  if ((Get-PeMachine $nodePath) -ne 0x8664) {
    throw 'Bundled Node PE architecture is not AMD64/x64.'
  }
  $nodeVersionOutput = @(& $nodePath --version)
  if ($LASTEXITCODE -ne 0) {
    throw "Bundled Node version command failed with exit code $LASTEXITCODE."
  }
  Assert-Equal (
    ([string]($nodeVersionOutput | Select-Object -First 1)).Trim()
  ) ([string]$Canonical.nodeRuntime.version) 'Bundled Node runtime version'

  return [pscustomobject]@{
    installRoot = $installRoot
    identity = $identity
    identityPath = $identityPath
    nodePath = $nodePath
    executableBytes = [int64]$appItem.Length
    executableSha256 = Get-Sha256Lower $AppExe
  }
}

function Test-InstalledApplicationRestored(
  $Canonical,
  $Manifest,
  $InstalledEvidence,
  $RuntimeIdentityProvenance
) {
  try {
    $appExe = Find-ExactInstalledExecutable
    $registry = Get-ExactRegistryInstallation $Canonical
    if (-not (Test-Path -LiteralPath $registry.uninstaller -PathType Leaf)) {
      return $false
    }
    $null = Assert-VerifiedUninstaller $registry.uninstaller $InstalledEvidence
    $null = Assert-InstalledPayload (
      $appExe
    ) ([int64]$InstalledEvidence.installation.executableBytes) (
      [string]$InstalledEvidence.installation.executableSha256
    ) $Canonical $Manifest $RuntimeIdentityProvenance
    return $true
  } catch {
    return $false
  }
}

function Get-SanitizedFailureMessage(
  [string]$Message,
  [string]$RepositoryRoot,
  [string]$ReleaseDirectory
) {
  $result = $Message
  foreach ($replacement in @(
    [pscustomobject]@{ value = $ReleaseDirectory; token = '<RELEASE_DIRECTORY>' }
    [pscustomobject]@{ value = $RepositoryRoot; token = '<REPOSITORY_ROOT>' }
    [pscustomobject]@{ value = $env:USERPROFILE; token = '<USERPROFILE>' }
  )) {
    if (-not [string]::IsNullOrWhiteSpace([string]$replacement.value)) {
      $result = [System.Text.RegularExpressions.Regex]::Replace(
        $result,
        [System.Text.RegularExpressions.Regex]::Escape(
          [string]$replacement.value
        ),
        [string]$replacement.token,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
      )
    }
  }
  return $result
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$expectedCanonicalPath = Join-Path $repositoryRoot 'release\identity.json'
$canonicalPath = (Resolve-Path -LiteralPath $CanonicalIdentityPath).Path
Assert-PathEqual $canonicalPath $expectedCanonicalPath 'Canonical identity path'
$canonical = Get-Content -LiteralPath $canonicalPath -Raw | ConvertFrom-Json
$releaseDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path $repositoryRoot ([string]$canonical.releaseDirectory))
).TrimEnd('\')
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
Assert-PathEqual (Split-Path -Parent $manifestFile) $releaseDirectory 'Lifecycle manifest directory'
Assert-PathEqual (Split-Path -Parent $installer) $releaseDirectory 'Lifecycle installer directory'
Assert-Equal (Split-Path -Leaf $installer) ([string]$canonical.installerFilename) 'Lifecycle installer filename'

$resolvedEvidence = Join-Path $releaseDirectory $script:LifecycleEvidenceFilename
$resolvedReport = Join-Path $releaseDirectory $script:LifecycleReportFilename
$installedEvidencePath = Join-Path $releaseDirectory $script:InstalledEvidenceFilename
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$installerItem = Get-Item -LiteralPath $installer
$installerHash = Get-Sha256Lower $installer

$stage = 'preflight'
$uninstallAttempted = $false
$uninstallResult = $null
$installResult = $null
$recoveryAttempted = $false
$recoveryInstallerExitCode = $null
$applicationRestored = $false
$userDataRestored = $false
$appProcess = $null
$backupEvidence = $null

try {
  Assert-Equal ([string]$manifest.version) ([string]$canonical.version) 'Lifecycle manifest version'
  Assert-Equal ([string]$manifest.installer.path) ([string]$canonical.installerFilename) 'Manifest installer path'
  Assert-Equal ([int64]$manifest.installer.bytes) ([int64]$installerItem.Length) 'Manifest installer bytes'
  Assert-Equal ([string]$manifest.installer.sha256) $installerHash 'Manifest installer SHA-256'
  if ((Get-PeMachine $installer) -ne 0x014c) {
    throw 'NSIS installer stub PE architecture is not I386.'
  }
  Assert-UnsignedPe $installer 'Installer'

  $installedEvidenceArtifact = Assert-ManifestArtifact (
    $manifest
  ) $releaseDirectory $script:InstalledEvidenceFilename
  $installedEvidence = Get-Content -LiteralPath $installedEvidencePath -Raw |
    ConvertFrom-Json
  Assert-InstalledEvidence $installedEvidence $canonical $manifest $installerItem $installerHash

  $provenanceArtifact = Assert-ManifestArtifact (
    $manifest
  ) $releaseDirectory 'build-provenance.json'
  $provenance = Get-Content -LiteralPath $provenanceArtifact.path -Raw |
    ConvertFrom-Json
  $runtimeIdentityInputs = @(
    $provenance.inputs |
      Where-Object { [string]$_.path -ceq 'src-tauri/resources/identity.json' }
  )
  if ($runtimeIdentityInputs.Count -ne 1) {
    throw 'Build provenance must contain exactly one runtime identity input.'
  }
  $canonicalIdentityInputs = @(
    $provenance.inputs |
      Where-Object { [string]$_.path -ceq 'release/identity.json' }
  )
  if ($canonicalIdentityInputs.Count -ne 1) {
    throw 'Build provenance must contain exactly one canonical identity input.'
  }
  Assert-Equal (
    Get-Sha256Lower $canonicalPath
  ) ([string]$canonicalIdentityInputs[0].sha256) 'Canonical identity provenance SHA-256'
  Assert-Equal (
    [int64](Get-Item -LiteralPath $canonicalPath).Length
  ) ([int64]$canonicalIdentityInputs[0].bytes) 'Canonical identity provenance bytes'

  $appExeBefore = Find-ExactInstalledExecutable
  $registryBefore = Get-ExactRegistryInstallation $canonical
  $installedBefore = Assert-InstalledPayload (
    $appExeBefore
  ) ([int64]$installedEvidence.installation.executableBytes) (
    [string]$installedEvidence.installation.executableSha256
  ) $canonical $manifest $runtimeIdentityInputs[0]
  if (-not (Test-Path -LiteralPath $registryBefore.uninstaller -PathType Leaf)) {
    throw 'The exact registered NSIS uninstaller is missing.'
  }
  $null = Assert-VerifiedUninstaller $registryBefore.uninstaller $installedEvidence
  Assert-AleksiProcessesNotRunning $appExeBefore $installedBefore.nodePath

  $protectedRoots = Get-ProtectedUserDataRoots
  $fingerprintsBefore = Get-StableUserDataFingerprints (
    $protectedRoots
  ) 'Pre-uninstall stability check'
  $stage = 'backup'
  $backupEvidence = New-VerifiedUserDataBackup (
    $repositoryRoot
  ) $protectedRoots $fingerprintsBefore
  Assert-AleksiProcessesNotRunning $appExeBefore $installedBefore.nodePath

  $stage = 'uninstall'
  $null = Assert-VerifiedUninstaller $registryBefore.uninstaller $installedEvidence
  $uninstallAttempted = $true
  $uninstallResult = Start-Process -FilePath $registryBefore.uninstaller -ArgumentList @('/S') -Wait -PassThru
  if ($uninstallResult.ExitCode -ne 0) {
    throw "Silent NSIS uninstall failed with exit code $($uninstallResult.ExitCode)."
  }
  Wait-ForPathAbsent $registryBefore.installRoot
  if (Test-Path -LiteralPath $script:UninstallRegistryKey) {
    throw 'The exact HKCU Aleksi Workbench uninstall registry key remained after uninstall.'
  }
  $remainingCandidates = @(
    Get-InstallCandidates |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
  )
  if ($remainingCandidates.Count -ne 0) {
    throw 'An approved Aleksi executable candidate remained after uninstall.'
  }
  $fingerprintsAfterUninstall = Get-StableUserDataFingerprints (
    $protectedRoots
  ) 'Post-uninstall stability check'
  Assert-FingerprintsEqual $fingerprintsBefore $fingerprintsAfterUninstall 'Silent uninstall'

  $stage = 'reinstall'
  $installResult = Start-Process -FilePath $installer -ArgumentList @('/S') -Wait -PassThru
  if ($installResult.ExitCode -ne 0) {
    throw "Silent NSIS reinstall failed with exit code $($installResult.ExitCode)."
  }
  $appExeAfter = Find-ExactInstalledExecutable
  $registryAfter = Get-ExactRegistryInstallation $canonical
  $fingerprintsAfterReinstall = Get-StableUserDataFingerprints (
    $protectedRoots
  ) 'Post-reinstall pre-launch stability check'
  Assert-FingerprintsEqual $fingerprintsBefore $fingerprintsAfterReinstall 'Silent reinstall'
  $installedAfter = Assert-InstalledPayload (
    $appExeAfter
  ) ([int64]$installedEvidence.installation.executableBytes) (
    [string]$installedEvidence.installation.executableSha256
  ) $canonical $manifest $runtimeIdentityInputs[0]
  $applicationRestored = $true

  $stage = 'runtime'
  $stdoutLog = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\logs\sidecar.stdout.log'
  $startedAt = Get-Date
  $appProcess = Start-Process -FilePath $appExeAfter -WorkingDirectory $installedAfter.installRoot -PassThru
  try {
    $ready = Wait-ForReadyRecord (
      $stdoutLog
    ) $appProcess $installedAfter.identity $startedAt
    Wait-ForMainWindow $appProcess
    $sidecars = @(Get-ProcessesAtPath $installedAfter.nodePath)
    if ($sidecars.Count -ne 1) {
      throw "Expected exactly one reinstalled Node sidecar process, found $($sidecars.Count)."
    }
    if (-not $appProcess.CloseMainWindow()) {
      throw 'Reinstalled app did not expose a closeable native main window.'
    }
    if (-not $appProcess.WaitForExit(10000)) {
      throw 'Reinstalled app did not exit after normal window close.'
    }
    Wait-ForPortClosed ([int]$ready.port)
    Wait-ForProcessesAtPathAbsent $appExeAfter
    Wait-ForProcessesAtPathAbsent $installedAfter.nodePath
    Wait-ForAleksiWebViewProcessesAbsent
    Start-Sleep -Milliseconds 1200
    Wait-ForProcessesAtPathAbsent $appExeAfter
    Wait-ForProcessesAtPathAbsent $installedAfter.nodePath
    Wait-ForAleksiWebViewProcessesAbsent
    Restore-VerifiedBackupSnapshot $backupEvidence $protectedRoots
    $fingerprintsAfterReinstall = Get-StableUserDataFingerprints (
      $protectedRoots
    ) 'Post-runtime recovery stability check'
    Assert-FingerprintsEqual (
      $fingerprintsBefore
    ) $fingerprintsAfterReinstall 'Post-runtime verified backup recovery'
    $userDataRestored = $true
  } finally {
    if ($null -ne $appProcess) {
      $appProcess.Refresh()
      if (-not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force
        $appProcess.WaitForExit(5000) | Out-Null
      }
    }
  }

  $stage = 'evidence'
  $evidence = [ordered]@{
    schemaVersion = 1
    result = 'passed'
    testedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    evidenceBoundary = 'developer-machine-uninstall-retention-and-same-installer-reinstall'
    installer = [ordered]@{
      path = [string]$canonical.installerFilename
      bytes = [int64]$installerItem.Length
      sha256 = $installerHash
    }
    installedEvidence = [ordered]@{
      path = $script:InstalledEvidenceFilename
      bytes = [int64]$installedEvidenceArtifact.bytes
      sha256 = [string]$installedEvidenceArtifact.sha256
      testedAtUtc = [string]$installedEvidence.testedAtUtc
    }
    identity = [ordered]@{
      version = [string]$canonical.version
      protocolVersion = [int]$canonical.localProtocolVersion
      shellBuildId = [string]$manifest.shellBuildId
      sidecarBuildId = [string]$manifest.sidecarBuildId
      nodeVersion = [string]$canonical.nodeRuntime.version
      nodeSha256 = [string]$canonical.nodeRuntime.sha256
      runtimeIdentitySha256 = [string]$runtimeIdentityInputs[0].sha256
      runtimeIdentityBytes = [int64]$runtimeIdentityInputs[0].bytes
    }
    installation = [ordered]@{
      installRoot = [string]$canonical.windowsPathContracts.install
      executablePath = "$([string]$canonical.windowsPathContracts.install)\$([string]$canonical.executableName)"
      executableBytesBefore = [int64]$installedBefore.executableBytes
      executableSha256Before = [string]$installedBefore.executableSha256
      executableBytesAfter = [int64]$installedAfter.executableBytes
      executableSha256After = [string]$installedAfter.executableSha256
    }
    backup = [ordered]@{
      root = [string]$backupEvidence.root
      manifestPath = [string]$backupEvidence.manifestPath
      manifestBytes = [int64]$backupEvidence.manifestBytes
      manifestSha256 = [string]$backupEvidence.manifestSha256
      fileCount = [int]$backupEvidence.fileCount
      bytes = [int64]$backupEvidence.bytes
      sourceFingerprintDigest = [string]$backupEvidence.sourceFingerprintDigest
      backupFingerprintDigest = [string]$backupEvidence.backupFingerprintDigest
    }
    userDataFingerprintsBefore = $fingerprintsBefore
    userDataFingerprintsAfterUninstall = $fingerprintsAfterUninstall
    userDataFingerprintsAfterReinstall = $fingerprintsAfterReinstall
    uninstall = [ordered]@{
      exitCode = [int]$uninstallResult.ExitCode
      installDirectoryRemoved = $true
      registryKeyRemoved = $true
    }
    reinstall = [ordered]@{
      exitCode = [int]$installResult.ExitCode
      registryVersion = [string]$registryAfter.version
    }
    runtime = [ordered]@{
      dynamicPort = [int]$ready.port
      oneSidecarProcess = $true
      normalWindowCloseStopsSidecar = $true
    }
    recovery = [ordered]@{
      attempted = $false
      installerExitCode = $null
      applicationRestored = $true
    }
  }
  Write-Utf8Json $resolvedEvidence $evidence
  $evidenceHash = Get-Sha256Lower $resolvedEvidence
  $fingerprintLines = ($fingerprintsBefore | ForEach-Object {
    "- $($_.label): exists=$($_.exists); regularFiles=$($_.fileCount); bytes=$($_.bytes); digest=$($_.digest)"
  }) -join "`n"
  $report = @"
# Uninstall retention and reinstall test - $([string]$canonical.displayName) $([string]$canonical.version)

Status: PASSED

- Release: $([string]$canonical.version)
- Installer SHA-256: $installerHash
- Lifecycle evidence: $($script:LifecycleEvidenceFilename)
- Lifecycle evidence SHA-256: $evidenceHash
- Installed evidence: $($script:InstalledEvidenceFilename)
- Installed evidence SHA-256: $([string]$installedEvidenceArtifact.sha256)
- Boundary: developer-machine current-user NSIS lifecycle; this is not clean-machine evidence.
- Backup: $([string]$backupEvidence.root); manifest SHA-256 $([string]$backupEvidence.manifestSha256).
- Uninstall: exit code $($uninstallResult.ExitCode); exact install directory removed; exact HKCU uninstall registry key absent.
- Retention: regular-file relative path, byte length, and SHA-256 inventories were identical before uninstall, after uninstall, and before first launch after reinstall.
- Reinstall: exit code $($installResult.ExitCode); executable bytes/SHA-256 remained $([int64]$installedAfter.executableBytes)/$([string]$installedAfter.executableSha256).
- Runtime: one bundled sidecar process, dynamic loopback port $([int]$ready.port), and normal-window-close sidecar shutdown passed.
- Fingerprints:
$fingerprintLines
"@
  Write-Utf8Text $resolvedReport $report

  Write-Host 'Uninstall retention and same-installer reinstall verification passed.'
  Write-Host "Evidence: $resolvedEvidence"
  Write-Host "Report: $resolvedReport"
  Write-Host "Installer SHA-256: $installerHash"
} catch {
  $failure = $_
  if ($null -ne $appProcess) {
    try {
      $appProcess.Refresh()
      if (-not $appProcess.HasExited) {
        Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
        $appProcess.WaitForExit(5000) | Out-Null
      }
    } catch {
      # Only the process launched by this verifier is eligible for emergency cleanup.
    }
  }

  if ($uninstallAttempted) {
    $applicationRestored = Test-InstalledApplicationRestored (
      $canonical
    ) $manifest $installedEvidence $runtimeIdentityInputs[0]
    if (-not $applicationRestored) {
      $recoveryAttempted = $true
      try {
        $recoveryResult = Start-Process -FilePath $installer -ArgumentList @('/S') -Wait -PassThru
        $recoveryInstallerExitCode = [int]$recoveryResult.ExitCode
      } catch {
        $recoveryInstallerExitCode = -1
      }
      $applicationRestored = Test-InstalledApplicationRestored (
        $canonical
      ) $manifest $installedEvidence $runtimeIdentityInputs[0]
    }
    if ($null -ne $backupEvidence) {
      try {
        Restore-VerifiedBackupSnapshot $backupEvidence $protectedRoots
        $restoredFingerprints = Get-StableUserDataFingerprints (
          $protectedRoots
        ) 'Failure recovery stability check'
        Assert-FingerprintsEqual (
          $fingerprintsBefore
        ) $restoredFingerprints 'Failure verified backup recovery'
        $userDataRestored = $true
      } catch {
        $userDataRestored = $false
      }
    }
  }

  $sanitizedMessage = Get-SanitizedFailureMessage (
    [string]$failure.Exception.Message
  ) $repositoryRoot $releaseDirectory
  $failureEvidence = [ordered]@{
    schemaVersion = 1
    result = 'failed'
    testedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    evidenceBoundary = 'developer-machine-uninstall-retention-and-same-installer-reinstall'
    stage = $stage
    failure = [ordered]@{
      type = [string]$failure.Exception.GetType().FullName
      message = $sanitizedMessage
    }
    installer = [ordered]@{
      path = [string]$canonical.installerFilename
      bytes = [int64]$installerItem.Length
      sha256 = $installerHash
    }
    recovery = [ordered]@{
      attempted = [bool]$recoveryAttempted
      installerExitCode = $recoveryInstallerExitCode
      applicationRestored = [bool]$applicationRestored
      userDataRestored = [bool]$userDataRestored
      applicationLaunched = $false
    }
  }
  Write-Utf8Json $resolvedEvidence $failureEvidence
  $failureHash = Get-Sha256Lower $resolvedEvidence
  $failureReport = @"
# Uninstall retention and reinstall test - $([string]$canonical.displayName) $([string]$canonical.version)

Status: FAILED

- Stage: $stage
- Failure: $sanitizedMessage
- Lifecycle evidence: $($script:LifecycleEvidenceFilename)
- Lifecycle evidence SHA-256: $failureHash
- Recovery installer attempted: $recoveryAttempted
- Recovery installer exit code: $recoveryInstallerExitCode
- Application restored: $applicationRestored
- User data restored: $userDataRestored
- Recovery launch: not performed.
"@
  Write-Utf8Text $resolvedReport $failureReport
  throw
}
