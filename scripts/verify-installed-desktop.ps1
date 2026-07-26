param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$PredecessorInstallerPath,

  [string]$CanonicalIdentityPath = '',

  [string]$EvidencePath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($CanonicalIdentityPath)) {
  $CanonicalIdentityPath = Join-Path $PSScriptRoot '..\release\identity.json'
}
$script:MaxBackupFiles = 100000
$script:MaxBackupBytes = [int64](20GB)
$script:InventoryTimeoutSeconds = 300
$script:BackupCopyTimeoutSeconds = 1800
$script:BackupFreeSpaceReserveBytes = [int64](512MB)

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ([string]$Actual -cne [string]$Expected) {
    throw "$Label mismatch. Expected '$Expected', got '$Actual'."
  }
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

function Get-PeMachine([string]$Path) {
  $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'Read')
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    if ($reader.ReadUInt16() -ne 0x5a4d) {
      throw "PE file is missing the MZ header: $Path"
    }
    $stream.Seek(0x3c, [System.IO.SeekOrigin]::Begin) | Out-Null
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 0x40 -or $peOffset -gt ($stream.Length - 6)) {
      throw "PE file has an invalid header offset: $Path"
    }
    $stream.Seek($peOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "PE file is missing the PE signature: $Path"
    }
    return [int]$reader.ReadUInt16()
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Get-DirectoryMetrics([string]$Path) {
  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction Stop)
  return [ordered]@{
    fileCount = $files.Count
    bytes = [int64](($files | Measure-Object -Property Length -Sum).Sum)
  }
}

function Assert-UnsignedPe([string]$Path, [string]$Label) {
  $status = [string](Get-AuthenticodeSignature -FilePath $Path).Status
  if ($status -ne 'NotSigned') {
    throw "$Label Authenticode status mismatch. Expected NotSigned, got $status."
  }
  return $status
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

function Get-StringSha256([string]$Value) {
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return (($algorithm.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $algorithm.Dispose()
  }
}

function Get-UserDataFingerprint([string]$Root, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    return [ordered]@{
      label = $Label
      exists = $false
      fileCount = 0
      bytes = 0
      digest = Get-StringSha256 ''
    }
  }

  $entries = @(
    Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction Stop |
      ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length).TrimStart('\')
        [pscustomobject]@{
          relative = $relative
          bytes = [int64]$_.Length
          sha256 = Get-Sha256Lower $_.FullName
        }
      } |
      Sort-Object relative
  )
  $payload = ($entries | ForEach-Object {
    "$($_.relative)`t$($_.bytes)`t$($_.sha256)"
  }) -join "`n"
  return [ordered]@{
    label = $Label
    exists = $true
    fileCount = $entries.Count
    bytes = [int64](($entries | Measure-Object -Property bytes -Sum).Sum)
    digest = Get-StringSha256 $payload
  }
}

function Get-ProtectedUserDataRoots {
  $roots = @(
    [pscustomobject]@{ path = (Join-Path $env:APPDATA 'Aleksi Learning Workbench'); label = '%APPDATA%\Aleksi Learning Workbench' }
    [pscustomobject]@{ path = (Join-Path $env:APPDATA 'io.aleksi.workbench'); label = '%APPDATA%\io.aleksi.workbench' }
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench'); label = '%LOCALAPPDATA%\io.aleksi.workbench' }
    [pscustomobject]@{ path = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Aleksi Learning Workbench'); label = '%USERPROFILE%\Documents\Aleksi Learning Workbench' }
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
      $absolute = [System.IO.Path]::GetFullPath([string]$root.path)
      $key = $absolute.TrimEnd('\').ToLowerInvariant()
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        [pscustomobject]@{ path = $absolute; label = [string]$root.label }
      }
    }
  )
}

function Get-AllUserDataFingerprints {
  return @(
    Get-ProtectedUserDataRoots | ForEach-Object {
      Get-UserDataFingerprint ([string]$_.path) ([string]$_.label)
    }
  )
}

function Assert-UserDataUnchanged($Before, $After) {
  $beforeJson = $Before | ConvertTo-Json -Depth 8 -Compress
  $afterJson = $After | ConvertTo-Json -Depth 8 -Compress
  if ($beforeJson -ne $afterJson) {
    throw "Installer changed user data before the app was launched. Before=$beforeJson After=$afterJson"
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

  Assert-NoReparseAncestors $Root 'Protected user-data root'
  $rootItem = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
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
    foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
      if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Protected root contains a reparse point and cannot be safely backed up: $Root"
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

function Get-InventoriesDigest($Inventories) {
  $payload = (Convert-InventoriesToFingerprints $Inventories | ForEach-Object {
    $exists = ([bool]$_.exists).ToString().ToLowerInvariant()
    "$($_.label)`t$exists`t$([int]$_.fileCount)`t$([int64]$_.bytes)`t$($_.digest)"
  }) -join "`n"
  return Get-StringSha256 $payload
}

function Assert-InventoriesEquivalent($Expected, $Actual, [string]$Label) {
  if ($Expected.Count -ne $Actual.Count) {
    throw "$Label root count mismatch."
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    Assert-Equal ([string]$Actual[$index].label) ([string]$Expected[$index].label) "$Label root label [$index]"
    Assert-Equal ([bool]$Actual[$index].exists) ([bool]$Expected[$index].exists) "$Label root existence [$index]"
    $expectedJson = @($Expected[$index].entries) | ConvertTo-Json -Depth 6 -Compress
    $actualJson = @($Actual[$index].entries) | ConvertTo-Json -Depth 6 -Compress
    if ($expectedJson -cne $actualJson) {
      throw "$Label regular-file inventory mismatch for '$([string]$Expected[$index].label)'."
    }
  }
}

function New-VerifiedPreUpgradeBackup([string]$RepositoryRoot, $Roots, $ExpectedFingerprints) {
  Assert-ProtectedRootsNotOverlapping $Roots
  Assert-NoReparseAncestors $RepositoryRoot 'Repository backup root'
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
  $backupRoot = $null
  $backupRelative = $null
  for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
    $suffix = if ($attempt -eq 0) { '' } else { "-$attempt" }
    $candidateRelative = "artifacts/review/pre-upgrade-user-data-backup-$stamp$suffix"
    $candidate = [System.IO.Path]::GetFullPath(
      (Join-Path $RepositoryRoot $candidateRelative.Replace('/', '\'))
    )
    if (-not (Test-Path -LiteralPath $candidate)) {
      $backupRoot = $candidate
      $backupRelative = $candidateRelative
      break
    }
  }
  if ($null -eq $backupRoot) {
    throw 'Could not allocate a new pre-upgrade backup directory.'
  }
  foreach ($root in $Roots) {
    $protected = ([string]$root.path).TrimEnd('\')
    if (
      $backupRoot.StartsWith(
        "$protected\",
        [System.StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]::Equals(
        $backupRoot,
        $protected,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) {
      throw 'Pre-upgrade backup directory must remain outside protected user-data roots.'
    }
  }
  New-Item -ItemType Directory -Path $backupRoot -Force -ErrorAction Stop | Out-Null
  Assert-NoReparseAncestors $backupRoot 'Allocated pre-upgrade backup'
  $incompleteMarker = Join-Path $backupRoot '.incomplete'
  [System.IO.File]::WriteAllText(
    $incompleteMarker,
    "Backup verification has not completed.`n",
    [System.Text.UTF8Encoding]::new($false)
  )

  $sourceInventories = Get-ProtectedInventories $Roots
  $sourceFingerprints = Convert-InventoriesToFingerprints $sourceInventories
  Assert-UserDataUnchanged $ExpectedFingerprints $sourceFingerprints
  $totalFiles = [int](($sourceInventories | Measure-Object -Property fileCount -Sum).Sum)
  $totalBytes = [int64](($sourceInventories | Measure-Object -Property bytes -Sum).Sum)
  if ($totalFiles -gt $script:MaxBackupFiles) {
    throw "Protected user data exceeds the $($script:MaxBackupFiles)-file backup limit."
  }
  if ($totalBytes -gt $script:MaxBackupBytes) {
    throw "Protected user data exceeds the $($script:MaxBackupBytes)-byte backup limit."
  }
  $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($backupRoot))
  $requiredFreeBytes = $totalBytes + $script:BackupFreeSpaceReserveBytes
  if ([int64]$drive.AvailableFreeSpace -lt $requiredFreeBytes) {
    throw "Backup volume has insufficient free space. Required=$requiredFreeBytes Available=$([int64]$drive.AvailableFreeSpace)."
  }

  $sourceDigest = Get-InventoriesDigest $sourceInventories
  $manifestRoots = @()
  $backupInventories = @()
  $copyTimer = [System.Diagnostics.Stopwatch]::StartNew()
  for ($rootIndex = 0; $rootIndex -lt $sourceInventories.Count; $rootIndex += 1) {
    $source = $sourceInventories[$rootIndex]
    $relativeDirectory = "data/root-$('{0:d2}' -f $rootIndex)"
    $destinationRoot = Join-Path $backupRoot $relativeDirectory.Replace('/', '\')
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
  Assert-InventoriesEquivalent $sourceInventories $backupInventories 'Pre-upgrade backup'
  $backupDigest = Get-InventoriesDigest $backupInventories
  Assert-Equal $backupDigest $sourceDigest 'Pre-upgrade backup digest'
  $sourceAfter = Get-ProtectedInventories $Roots
  Assert-InventoriesEquivalent $sourceInventories $sourceAfter 'Pre-upgrade source stability'
  Assert-UserDataUnchanged $ExpectedFingerprints (Convert-InventoriesToFingerprints $sourceAfter)

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
  $manifestPath = Join-Path $backupRoot 'manifest.json'
  Write-Utf8Json $manifestPath $manifest
  [System.IO.File]::Delete($incompleteMarker)
  $manifestItem = Get-Item -LiteralPath $manifestPath
  return [pscustomobject]@{
    root = $backupRelative
    manifestPath = "$backupRelative/manifest.json"
    manifestBytes = [int64]$manifestItem.Length
    manifestSha256 = Get-Sha256Lower $manifestPath
    fileCount = $totalFiles
    bytes = $totalBytes
    sourceFingerprintDigest = $sourceDigest
    backupFingerprintDigest = $backupDigest
  }
}

function Find-InstalledExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Aleksi Workbench\aleksi-workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Aleksi Workbench\aleksi-workbench.exe'),
    (Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\aleksi-workbench.exe')
  )
  $existing = @(
    $candidates |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
      ForEach-Object { (Resolve-Path -LiteralPath $_).Path }
  )
  if ($existing.Count -ne 1) {
    throw "Expected exactly one installed aleksi-workbench.exe in an approved per-user location, found $($existing.Count)."
  }
  return [string]$existing[0]
}

function Get-InstalledRegistryState {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Aleksi Workbench'
  if (-not (Test-Path -LiteralPath $key)) {
    throw 'Aleksi Workbench per-user uninstall registry key is missing.'
  }
  $state = Get-ItemProperty -LiteralPath $key -ErrorAction Stop
  $installLocation = ([string]$state.InstallLocation).Trim().Trim('"')
  $uninstallCommand = ([string]$state.UninstallString).Trim().Trim('"')
  if (
    [string]::IsNullOrWhiteSpace($installLocation) -or
    [string]::IsNullOrWhiteSpace($uninstallCommand)
  ) {
    throw 'Aleksi Workbench uninstall registry state is incomplete.'
  }
  return [pscustomobject]@{
    key = $key
    displayName = [string]$state.DisplayName
    version = [string]$state.DisplayVersion
    installLocation = [System.IO.Path]::GetFullPath($installLocation)
    uninstallCommand = [System.IO.Path]::GetFullPath($uninstallCommand)
  }
}

function Assert-RegistryMatchesInstall($RegistryState, [string]$AppExe, [string]$ExpectedDisplayName) {
  $installRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $AppExe))
  Assert-Equal ([string]$RegistryState.displayName) $ExpectedDisplayName 'Installed registry display name'
  Assert-Equal ([string]$RegistryState.installLocation) $installRoot 'Installed registry location'
  Assert-Equal (
    [string]$RegistryState.uninstallCommand
  ) (Join-Path $installRoot 'uninstall.exe') 'Installed registry uninstall command'
  if (-not (Test-Path -LiteralPath $RegistryState.uninstallCommand -PathType Leaf)) {
    throw 'Installed registry uninstall command does not resolve to a regular file.'
  }
}

function Assert-NoRunningInstalledPayload([string[]]$ExecutablePaths) {
  $targets = @{}
  foreach ($path in $ExecutablePaths) {
    $targets[[System.IO.Path]::GetFullPath($path).ToLowerInvariant()] = $true
  }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $matches = @(
    $processes |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        $targets.ContainsKey(
          [System.IO.Path]::GetFullPath([string]$_.ExecutablePath).ToLowerInvariant()
        )
      } |
      Select-Object ProcessId, Name
  )
  $webViewMarker = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench'
  $webViews = @(
    $processes |
      Where-Object {
        [string]$_.Name -ieq 'msedgewebview2.exe' -and
        -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
        ([string]$_.CommandLine).IndexOf(
          $webViewMarker,
          [System.StringComparison]::OrdinalIgnoreCase
        ) -ge 0
      } |
      Select-Object ProcessId, Name
  )
  $running = @($matches) + @($webViews)
  if ($running.Count -ne 0) {
    $summary = ($running | ForEach-Object { "$($_.Name) PID=$($_.ProcessId)" }) -join ', '
    throw "Close the installed Aleksi Workbench and its sidecar before running the upgrade verifier. Running payload: $summary"
  }
}

function Get-SidecarFailureContext {
  $path = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\logs\sidecar.stderr.log'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    return 'sidecar stderr log was not created'
  }

  $item = Get-Item -LiteralPath $path
  return "sidecar stderr log content withheld ($([int64]$item.Length) bytes at $path)"
}

function Assert-NoProtocolSecretTrace([string[]]$Paths, [datetime]$StartedAt) {
  $secretTrace = '(?i)(?:ALEKSI_PROTOCOL_SECRET|X-Aleksi-Protocol-Secret|protocol[_-]?secret|"secret")\s*["''=:]+\s*[a-f0-9]{64}'
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      continue
    }
    $item = Get-Item -LiteralPath $path
    if ($item.LastWriteTimeUtc -lt $StartedAt.ToUniversalTime().AddSeconds(-1)) {
      continue
    }
    $content = [string](Get-Content -LiteralPath $path -Raw -ErrorAction Stop)
    if ($content -match $secretTrace) {
      throw "Installed sidecar log exposed protocol-secret material: $path"
    }
  }
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

function Wait-ForReadyRecord([string]$LogPath, $AppProcess, $Identity, [datetime]$StartedAt) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      throw "Installed app exited before sidecar readiness. ExitCode=$($AppProcess.ExitCode); $(Get-SidecarFailureContext)"
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
            throw 'Installed readiness output exposed a protocol-secret field.'
          }
          try {
            $ready = ($payload | ConvertFrom-Json)
          } catch {
            throw 'Installed sidecar returned an invalid readiness record.'
          }
          if ([string]$ready.host -ne '127.0.0.1') {
            throw 'Installed sidecar readiness host is not IPv4 loopback.'
          }
          if ([int]$ready.port -lt 1 -or [int]$ready.port -gt 65535) {
            throw 'Installed sidecar readiness port is invalid.'
          }
          if ([string]$ready.version -ne [string]$Identity.version) {
            throw 'Installed sidecar readiness version does not match the packaged identity.'
          }
          if ([int]$ready.protocolVersion -ne [int]$Identity.protocolVersion) {
            throw 'Installed sidecar protocol version does not match the packaged identity.'
          }
          if ([string]$ready.shellBuildId -ne [string]$Identity.shellBuildId) {
            throw 'Installed sidecar shell build does not match the packaged identity.'
          }
          if ([string]$ready.sidecarBuildId -ne [string]$Identity.sidecarBuildId) {
            throw 'Installed sidecar build does not match the packaged identity.'
          }
          if (-not (Test-LoopbackPort ([int]$ready.port))) {
            throw "Installed sidecar readiness port is not reachable: $([int]$ready.port)"
          }
          return $ready
        }
      }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for installed sidecar readiness; $(Get-SidecarFailureContext)"
}

function Assert-StartupRitualSurvival($AppProcess, [int]$Port, [datetime]$StartedAt) {
  $deadline = $StartedAt.AddSeconds(23)
  do {
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      throw "Installed app exited during the 20-second startup ritual. ExitCode=$($AppProcess.ExitCode); $(Get-SidecarFailureContext)"
    }
    if (-not (Test-LoopbackPort $Port)) {
      throw "Installed sidecar stopped accepting loopback connections during startup ritual on port $Port."
    }
    if ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  $AppProcess.Refresh()
  if ([int64]$AppProcess.MainWindowHandle -eq 0) {
    throw 'Installed app did not expose a native main window after the startup ritual.'
  }
}

function Assert-SingleInstance($AppProcess, [string]$AppExe, [string]$InstallRoot) {
  $second = Start-Process -FilePath $AppExe -WorkingDirectory $InstallRoot -PassThru
  try {
    if (-not $second.WaitForExit(8000)) {
      throw 'A second installed app process remained active; single-instance enforcement failed.'
    }
    $AppProcess.Refresh()
    if ($AppProcess.HasExited) {
      throw 'Launching a second instance terminated the original desktop process.'
    }
  } finally {
    $second.Refresh()
    if (-not $second.HasExited) {
      Stop-Process -Id $second.Id -Force
    }
  }
}

function Wait-ForPortClosed([int]$Port) {
  $deadline = (Get-Date).AddSeconds(8)
  do {
    if (-not (Test-LoopbackPort $Port 350)) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Installed sidecar remained reachable after the window closed: 127.0.0.1:$Port"
}

function Complete-NormalWindowClose($AppProcess) {
  if (-not $AppProcess.CloseMainWindow()) {
    throw 'Installed app did not expose a closeable main window.'
  }
  if ($AppProcess.WaitForExit(1500)) {
    return
  }

  $AppProcess.Refresh()
  if ([int64]$AppProcess.MainWindowHandle -eq 0) {
    if ($AppProcess.WaitForExit(8500)) {
      return
    }
    throw 'Installed app destroyed its main window but did not exit within 10 seconds.'
  }

  $shell = New-Object -ComObject WScript.Shell
  if (-not $shell.AppActivate([int]$AppProcess.Id)) {
    throw 'Installed app did not expose an activatable main window after the native close request.'
  }
  Start-Sleep -Milliseconds 500
  $shell.SendKeys('^q')
  Start-Sleep -Milliseconds 750
  $shell.SendKeys('{ENTER}')
  if (-not $AppProcess.WaitForExit(8500)) {
    throw 'Installed app did not exit after the native close request and confirmed Ctrl+Q fallback.'
  }
}

function Get-ProcessesAtPath([string]$ExecutablePath) {
  return @(
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          [string]::Equals(
            [System.IO.Path]::GetFullPath([string]$_.Path),
            [System.IO.Path]::GetFullPath($ExecutablePath),
            [System.StringComparison]::OrdinalIgnoreCase
          )
        } catch {
          $false
        }
      }
  )
}

function Wait-ForProcessesAtPathAbsent([string]$ExecutablePath) {
  $deadline = (Get-Date).AddSeconds(8)
  do {
    $matches = @(Get-ProcessesAtPath $ExecutablePath)
    if ($matches.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  $ids = (@(Get-ProcessesAtPath $ExecutablePath) | ForEach-Object { $_.Id }) -join ', '
  throw "Installed sidecar process remained after forced shell termination: $ExecutablePath (PIDs: $ids)"
}

function Stop-AppProcess($AppProcess) {
  $AppProcess.Refresh()
  if (-not $AppProcess.HasExited) {
    Stop-Process -Id $AppProcess.Id -Force
    $AppProcess.WaitForExit(5000) | Out-Null
  }
}

function Get-RuntimeMemorySample($AppProcess, [string]$NodePath) {
  $AppProcess.Refresh()
  $sidecars = @(
    Get-Process -Name 'node' -ErrorAction SilentlyContinue |
      Where-Object {
        try {
          [string]::Equals($_.Path, $NodePath, [System.StringComparison]::OrdinalIgnoreCase)
        } catch {
          $false
        }
      }
  )
  if ($sidecars.Count -ne 1) {
    throw "Expected exactly one installed Node sidecar process, found $($sidecars.Count)."
  }
  return [ordered]@{
    shellWorkingSetBytes = [int64]$AppProcess.WorkingSet64
    sidecarProcessCount = $sidecars.Count
    sidecarWorkingSetBytes = [int64](($sidecars | Measure-Object -Property WorkingSet64 -Sum).Sum)
  }
}

function Start-And-VerifyForcedShellTermination(
  [string]$AppExe,
  [string]$InstallRoot,
  [string]$StdoutLog,
  [string]$NodePath,
  $Identity
) {
  $startedAt = Get-Date
  $stderrLog = Join-Path (Split-Path -Parent $StdoutLog) 'sidecar.stderr.log'
  $appProcess = Start-Process -FilePath $AppExe -WorkingDirectory $InstallRoot -PassThru
  try {
    $ready = Wait-ForReadyRecord $StdoutLog $appProcess $Identity $startedAt
    $null = Get-RuntimeMemorySample $appProcess $NodePath
    Stop-Process -Id $appProcess.Id -Force
    if (-not $appProcess.WaitForExit(5000)) {
      throw 'Installed shell did not exit within 5 seconds after forced termination.'
    }
    Wait-ForPortClosed ([int]$ready.port)
    Wait-ForProcessesAtPathAbsent $NodePath
    return [ordered]@{
      port = [int]$ready.port
    }
  } catch {
    Stop-AppProcess $appProcess
    foreach ($sidecar in @(Get-ProcessesAtPath $NodePath)) {
      Stop-Process -Id $sidecar.Id -Force -ErrorAction SilentlyContinue
    }
    throw
  } finally {
    Assert-NoProtocolSecretTrace @($StdoutLog, $stderrLog) $startedAt
  }
}

function Start-And-VerifyInstalledApp([string]$AppExe, [string]$InstallRoot, [string]$StdoutLog, [string]$NodePath, $Identity, [bool]$CheckSingleInstance) {
  $startedAt = Get-Date
  $stderrLog = Join-Path (Split-Path -Parent $StdoutLog) 'sidecar.stderr.log'
  $appProcess = Start-Process -FilePath $AppExe -WorkingDirectory $InstallRoot -PassThru
  try {
    $ready = Wait-ForReadyRecord $StdoutLog $appProcess $Identity $startedAt
    $readyAt = Get-Date
    Assert-StartupRitualSurvival $appProcess ([int]$ready.port) $startedAt
    $ritualCompletedAt = Get-Date
    $memory = Get-RuntimeMemorySample $appProcess $NodePath
    if ($CheckSingleInstance) {
      Assert-SingleInstance $appProcess $AppExe $InstallRoot
    }
    try {
      Complete-NormalWindowClose $appProcess
    } catch {
      $appProcess.Refresh()
      $remainingSidecars = @(Get-ProcessesAtPath $NodePath)
      throw (
        "$($_.Exception.Message) " +
        "MainWindowHandle=$([int64]$appProcess.MainWindowHandle); " +
        "Responding=$($appProcess.Responding); " +
        "SidecarCount=$($remainingSidecars.Count); " +
        "PortOpen=$(Test-LoopbackPort ([int]$ready.port) 350)."
      )
    }
    Wait-ForPortClosed ([int]$ready.port)
    return [ordered]@{
      port = [int]$ready.port
      shellBuildId = [string]$ready.shellBuildId
      sidecarBuildId = [string]$ready.sidecarBuildId
      readyMilliseconds = [int][Math]::Round(($readyAt - $startedAt).TotalMilliseconds)
      startupRitualSurvivalMilliseconds = [int][Math]::Round(($ritualCompletedAt - $startedAt).TotalMilliseconds)
      memory = $memory
    }
  } catch {
    Stop-AppProcess $appProcess
    throw
  } finally {
    Assert-NoProtocolSecretTrace @($StdoutLog, $stderrLog) $startedAt
  }
}

function Assert-PredecessorInstallationRestored(
  $Canonical,
  $ExpectedRegistry,
  $ExpectedInventory,
  $ExpectedFingerprints,
  $ProtectedRoots,
  $ExpectedIdentity
) {
  $appExe = Find-InstalledExecutable
  $installRoot = Split-Path -Parent $appExe
  $registry = Get-InstalledRegistryState
  Assert-Equal ([string]$registry.version) ([string]$Canonical.upgradeFrom.version) 'Recovered predecessor registry version'
  Assert-Equal ([string]$registry.displayName) ([string]$ExpectedRegistry.displayName) 'Recovered predecessor registry display name'
  Assert-Equal ([string]$registry.installLocation) ([string]$ExpectedRegistry.installLocation) 'Recovered predecessor registry location'
  Assert-Equal ([string]$registry.uninstallCommand) ([string]$ExpectedRegistry.uninstallCommand) 'Recovered predecessor registry uninstaller'
  Assert-Equal ([int64](Get-Item -LiteralPath $appExe).Length) ([int64]$Canonical.upgradeFrom.installedExecutableBytes) 'Recovered predecessor executable bytes'
  Assert-Equal (Get-Sha256Lower $appExe) ([string]$Canonical.upgradeFrom.installedExecutableSha256) 'Recovered predecessor executable SHA-256'
  $actualInventory = Get-RegularFileInventory $installRoot
  $expectedEntries = @($ExpectedInventory.entries) | ConvertTo-Json -Depth 6 -Compress
  $actualEntries = @($actualInventory.entries) | ConvertTo-Json -Depth 6 -Compress
  if (
    -not [bool]$actualInventory.exists -or
    [int]$actualInventory.fileCount -ne [int]$ExpectedInventory.fileCount -or
    [int64]$actualInventory.bytes -ne [int64]$ExpectedInventory.bytes -or
    $actualEntries -cne $expectedEntries
  ) {
    throw 'Recovered predecessor installation does not match the captured pre-upgrade payload inventory.'
  }
  $fingerprints = Convert-InventoriesToFingerprints (
    Get-ProtectedInventories $ProtectedRoots
  )
  Assert-UserDataUnchanged $ExpectedFingerprints $fingerprints

  $identityPath = Join-Path $installRoot 'resources\identity.json'
  $nodePath = Join-Path $installRoot 'resources\sidecar\node.exe'
  if (
    -not (Test-Path -LiteralPath $identityPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $nodePath -PathType Leaf)
  ) {
    throw 'Recovered predecessor runtime resources are incomplete.'
  }
  $restoredIdentity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  foreach ($field in @(
    'version',
    'protocolVersion',
    'shellBuildId',
    'sidecarBuildId',
    'nodeVersion'
  )) {
    $expectedProperty = $ExpectedIdentity.PSObject.Properties[$field]
    if ($null -eq $expectedProperty) {
      continue
    }
    $restoredProperty = $restoredIdentity.PSObject.Properties[$field]
    if ($null -eq $restoredProperty) {
      throw "Recovered predecessor identity is missing $field."
    }
    Assert-Equal (
      [string]$restoredProperty.Value
    ) ([string]$expectedProperty.Value) "Recovered predecessor identity $field"
  }
  Assert-NoRunningInstalledPayload @($appExe, $nodePath)
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$canonicalPath = (Resolve-Path -LiteralPath $CanonicalIdentityPath).Path
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$predecessorInstaller = (Resolve-Path -LiteralPath $PredecessorInstallerPath).Path
$canonical = Get-Content -LiteralPath $canonicalPath -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$canonicalReleaseDirectory = [System.IO.Path]::GetFullPath(
  (Join-Path $repositoryRoot ([string]$canonical.releaseDirectory))
)
if (
  -not [string]::Equals(
    (Split-Path -Parent $manifestFile),
    $canonicalReleaseDirectory,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  -not [string]::Equals(
    (Split-Path -Parent $installer),
    $canonicalReleaseDirectory,
    [System.StringComparison]::OrdinalIgnoreCase
  )
) {
  throw 'Installer and release manifest must both come from the canonical release directory.'
}

Assert-Equal ([string]$manifest.product) ([string]$canonical.displayName) 'Manifest product'
Assert-Equal ([string]$manifest.version) ([string]$canonical.version) 'Manifest version'
Assert-Equal ([string]$manifest.identifier) ([string]$canonical.identifier) 'Manifest identifier'
Assert-Equal ([string]$manifest.platform) 'windows' 'Manifest platform'
Assert-Equal ([string]$manifest.architecture) ([string]$canonical.nodeRuntime.architecture) 'Manifest architecture'
Assert-Equal ([string]$manifest.nodeVersion) ([string]$canonical.nodeRuntime.version) 'Manifest Node runtime version'
Assert-Equal ([string]$manifest.upgradeFromVersion) ([string]$canonical.upgradeFromVersion) 'Manifest upgrade source version'
Assert-Equal ([string]$manifest.upgradeFrom.version) ([string]$canonical.upgradeFrom.version) 'Manifest predecessor version'
Assert-Equal ([string]$manifest.upgradeFrom.installerFilename) ([string]$canonical.upgradeFrom.installerFilename) 'Manifest predecessor installer filename'
Assert-Equal ([int64]$manifest.upgradeFrom.installerBytes) ([int64]$canonical.upgradeFrom.installerBytes) 'Manifest predecessor installer bytes'
Assert-Equal ([string]$manifest.upgradeFrom.installerSha256) ([string]$canonical.upgradeFrom.installerSha256) 'Manifest predecessor installer SHA-256'
Assert-Equal ([int64]$manifest.upgradeFrom.installedExecutableBytes) ([int64]$canonical.upgradeFrom.installedExecutableBytes) 'Manifest predecessor executable bytes'
Assert-Equal ([string]$manifest.upgradeFrom.installedExecutableSha256) ([string]$canonical.upgradeFrom.installedExecutableSha256) 'Manifest predecessor executable SHA-256'
Assert-Equal ([string]$manifest.signingStatus) ([string]$canonical.signing.status) 'Manifest signing status'
Assert-Equal ([string]$manifest.installerStatus) 'present' 'Manifest installer status'
if ([bool]$manifest.signed -ne $false -or [string]$canonical.signing.status -ne 'unsigned-preview') {
  throw 'Installed verification currently accepts only the canonical unsigned-preview signing state.'
}
if ($null -eq $manifest.installer) {
  throw 'Release manifest is missing the installer artifact record.'
}
Assert-Equal ([string]$manifest.installer.path) ([string]$canonical.installerFilename) 'Manifest installer filename'
Assert-Equal (Split-Path -Leaf $installer) ([string]$canonical.installerFilename) 'Installer filename'

$installerItem = Get-Item -LiteralPath $installer
$installerHash = Get-Sha256Lower $installer
Assert-Equal ([int64]$installerItem.Length) ([int64]$manifest.installer.bytes) 'Installer byte length'
Assert-Equal $installerHash ([string]$manifest.installer.sha256) 'Installer SHA-256'
$manifestInstallerRecords = @(
  $manifest.artifacts | Where-Object { [string]$_.path -eq [string]$canonical.installerFilename }
)
if ($manifestInstallerRecords.Count -ne 1) {
  throw 'Release manifest must contain exactly one canonical installer artifact.'
}
Assert-Equal ([string]$manifestInstallerRecords[0].sha256) $installerHash 'Installer artifact SHA-256'
Assert-Equal ([int64]$manifestInstallerRecords[0].bytes) ([int64]$installerItem.Length) 'Installer artifact byte length'

$releasePrefix = $canonicalReleaseDirectory.TrimEnd('\') + '\'
foreach ($artifact in @($manifest.artifacts)) {
  $relativeArtifactPath = ([string]$artifact.path).Replace('/', '\')
  if (
    [string]::IsNullOrWhiteSpace($relativeArtifactPath) -or
    [System.IO.Path]::IsPathRooted($relativeArtifactPath) -or
    $relativeArtifactPath.Split('\') -contains '..'
  ) {
    throw "Release manifest contains an unsafe artifact path: $relativeArtifactPath"
  }
  $artifactPath = [System.IO.Path]::GetFullPath(
    (Join-Path $canonicalReleaseDirectory $relativeArtifactPath)
  )
  if (-not $artifactPath.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Release artifact leaves the canonical directory: $relativeArtifactPath"
  }
  if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Release artifact is missing: $relativeArtifactPath"
  }
  $artifactItem = Get-Item -LiteralPath $artifactPath
  Assert-Equal ([int64]$artifactItem.Length) ([int64]$artifact.bytes) "Release artifact bytes ($relativeArtifactPath)"
  Assert-Equal (Get-Sha256Lower $artifactPath) ([string]$artifact.sha256) "Release artifact SHA-256 ($relativeArtifactPath)"
}
$manifestArtifactPaths = @(
  $manifest.artifacts |
    ForEach-Object { ([string]$_.path).Replace('\', '/') } |
    Sort-Object
)
$actualArtifactPaths = @(
  Get-ChildItem -LiteralPath $canonicalReleaseDirectory -Recurse -File -Force |
    ForEach-Object {
      $_.FullName.Substring($canonicalReleaseDirectory.Length).TrimStart('\').Replace('\', '/')
    } |
    Where-Object { $_ -ne 'release-manifest.json' } |
    Sort-Object
)
Assert-Equal $actualArtifactPaths.Count $manifestArtifactPaths.Count 'Release manifest artifact count'
for ($index = 0; $index -lt $actualArtifactPaths.Count; $index += 1) {
  Assert-Equal $actualArtifactPaths[$index] $manifestArtifactPaths[$index] "Release manifest artifact path [$index]"
}
Assert-Equal (
  [string]$manifest.hashCoverage
) 'Every regular file in this release directory except release-manifest.json itself.' 'Release manifest hash coverage'

$provenancePath = Join-Path $canonicalReleaseDirectory 'build-provenance.json'
$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
$runtimeIdentityInputs = @(
  $provenance.inputs | Where-Object { [string]$_.path -eq 'src-tauri/resources/identity.json' }
)
if ($runtimeIdentityInputs.Count -ne 1) {
  throw 'Build provenance must contain exactly one runtime identity input.'
}

$checksumPath = "$installer.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "Canonical installer checksum file is missing: $checksumPath"
}
$expectedChecksumLine = "$installerHash  $([string]$canonical.installerFilename)"
Assert-Equal ((Get-Content -LiteralPath $checksumPath -Raw).Trim()) $expectedChecksumLine 'Installer checksum file'
if ((Get-PeMachine $installer) -ne 0x014c) {
  throw 'NSIS installer stub PE architecture is not I386.'
}
$installerSignature = Assert-UnsignedPe $installer 'Installer'
$installerVersionInfo = $installerItem.VersionInfo
Assert-Equal ([string]$installerVersionInfo.ProductName) ([string]$canonical.displayName) 'Installer ProductName'
Assert-Equal ([string]$installerVersionInfo.FileDescription) ([string]$canonical.displayName) 'Installer FileDescription'
Assert-Equal ([string]$installerVersionInfo.ProductVersion) ([string]$canonical.version) 'Installer ProductVersion'
Assert-Equal ([string]$installerVersionInfo.FileVersion) ([string]$canonical.version) 'Installer FileVersion'

$predecessorInstallerItem = Get-Item -LiteralPath $predecessorInstaller
$predecessorInstallerHash = Get-Sha256Lower $predecessorInstaller
Assert-Equal (Split-Path -Leaf $predecessorInstaller) ([string]$canonical.upgradeFrom.installerFilename) 'Predecessor installer filename'
Assert-Equal ([int64]$predecessorInstallerItem.Length) ([int64]$canonical.upgradeFrom.installerBytes) 'Predecessor installer byte length'
Assert-Equal $predecessorInstallerHash ([string]$canonical.upgradeFrom.installerSha256) 'Predecessor installer SHA-256'
if ((Get-PeMachine $predecessorInstaller) -ne 0x014c) {
  throw 'Predecessor NSIS installer stub PE architecture is not I386.'
}
$predecessorInstallerSignature = Assert-UnsignedPe $predecessorInstaller 'Predecessor installer'
$predecessorInstallerVersionInfo = $predecessorInstallerItem.VersionInfo
Assert-Equal ([string]$predecessorInstallerVersionInfo.ProductName) ([string]$canonical.displayName) 'Predecessor installer ProductName'
Assert-Equal ([string]$predecessorInstallerVersionInfo.ProductVersion) ([string]$canonical.upgradeFrom.version) 'Predecessor installer ProductVersion'
Assert-Equal ([string]$predecessorInstallerVersionInfo.FileVersion) ([string]$canonical.upgradeFrom.version) 'Predecessor installer FileVersion'

$registryStateBefore = Get-InstalledRegistryState
Assert-Equal ([string]$registryStateBefore.version) ([string]$canonical.upgradeFromVersion) 'Installed pre-upgrade registry version'
$predecessorAppExe = Find-InstalledExecutable
$predecessorInstallRoot = Split-Path -Parent $predecessorAppExe
Assert-RegistryMatchesInstall $registryStateBefore $predecessorAppExe ([string]$canonical.displayName)
$predecessorAppItem = Get-Item -LiteralPath $predecessorAppExe
$predecessorAppHash = Get-Sha256Lower $predecessorAppExe
Assert-Equal ([int64]$predecessorAppItem.Length) ([int64]$canonical.upgradeFrom.installedExecutableBytes) 'Installed predecessor executable byte length'
Assert-Equal $predecessorAppHash ([string]$canonical.upgradeFrom.installedExecutableSha256) 'Installed predecessor executable SHA-256'
if ((Get-PeMachine $predecessorAppExe) -ne 0x8664) {
  throw 'Installed predecessor application PE architecture is not AMD64/x64.'
}
$predecessorAppSignature = Assert-UnsignedPe $predecessorAppExe 'Installed predecessor application'
$predecessorAppVersionInfo = $predecessorAppItem.VersionInfo
Assert-Equal ([string]$predecessorAppVersionInfo.ProductName) ([string]$canonical.displayName) 'Installed predecessor application ProductName'
Assert-Equal ([string]$predecessorAppVersionInfo.ProductVersion) ([string]$canonical.upgradeFrom.version) 'Installed predecessor application ProductVersion'
Assert-Equal ([string]$predecessorAppVersionInfo.FileVersion) ([string]$canonical.upgradeFrom.version) 'Installed predecessor application FileVersion'
Assert-NoRunningInstalledPayload @(
  $predecessorAppExe,
  (Join-Path $predecessorInstallRoot 'resources\sidecar\node.exe')
)
$predecessorIdentityPath = Join-Path $predecessorInstallRoot 'resources\identity.json'
if (-not (Test-Path -LiteralPath $predecessorIdentityPath -PathType Leaf)) {
  throw 'Installed predecessor runtime identity is missing.'
}
$predecessorIdentity = Get-Content -LiteralPath $predecessorIdentityPath -Raw | ConvertFrom-Json
$predecessorPayloadInventory = Get-RegularFileInventory $predecessorInstallRoot
$protectedRoots = @(Get-ProtectedUserDataRoots)
Assert-ProtectedRootsNotOverlapping $protectedRoots
$userDataInitial = Convert-InventoriesToFingerprints (
  Get-ProtectedInventories $protectedRoots
)
Start-Sleep -Milliseconds 1200
$userDataBefore = Convert-InventoriesToFingerprints (
  Get-ProtectedInventories $protectedRoots
)
Assert-UserDataUnchanged $userDataInitial $userDataBefore
$backupEvidence = New-VerifiedPreUpgradeBackup (
  $repositoryRoot
) $protectedRoots $userDataBefore

$mutationAttempted = $false
$recoveryAttempted = $false
$recoveryInstallerExitCode = $null
$applicationRestored = $false
try {
  $mutationAttempted = $true
  $installResult = Start-Process -FilePath $installer -ArgumentList @('/S') -Wait -PassThru
if ($installResult.ExitCode -ne 0) {
  throw "Silent NSIS install failed with exit code $($installResult.ExitCode)."
}

$userDataAfterInstall = Convert-InventoriesToFingerprints (
  Get-ProtectedInventories $protectedRoots
)
Assert-UserDataUnchanged $userDataBefore $userDataAfterInstall

$appExe = Find-InstalledExecutable
$installRoot = Split-Path -Parent $appExe
$identityPath = Join-Path $installRoot 'resources\identity.json'
$nodePath = Join-Path $installRoot 'resources\sidecar\node.exe'
$serverPath = Join-Path $installRoot 'resources\sidecar\server.cjs'
$legacyServerPath = Join-Path $installRoot 'resources\sidecar\server.js'
if (Test-Path -LiteralPath $legacyServerPath -PathType Leaf) {
  throw "Upgrade left the legacy sidecar in place: $legacyServerPath"
}
foreach ($resource in @($identityPath, $nodePath, $serverPath)) {
  if (-not (Test-Path -LiteralPath $resource -PathType Leaf)) {
    throw "Installed desktop resource is missing: $resource"
  }
}

$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
Assert-Equal (Get-Sha256Lower $identityPath) ([string]$runtimeIdentityInputs[0].sha256) 'Installed runtime identity SHA-256'
Assert-Equal ([int64](Get-Item -LiteralPath $identityPath).Length) ([int64]$runtimeIdentityInputs[0].bytes) 'Installed runtime identity byte length'
Assert-Equal ([string]$identity.product) ([string]$canonical.displayName) 'Installed identity product'
Assert-Equal ([string]$identity.version) ([string]$canonical.version) 'Installed identity version'
Assert-Equal ([int]$identity.schemaVersion) ([int]$canonical.projectSchemaVersion) 'Installed project schema version'
Assert-Equal ([int]$identity.protocolVersion) ([int]$canonical.localProtocolVersion) 'Installed protocol version'
Assert-Equal ([string]$identity.shellBuildId) ([string]$manifest.shellBuildId) 'Installed shell build ID'
Assert-Equal ([string]$identity.sidecarBuildId) ([string]$manifest.sidecarBuildId) 'Installed sidecar build ID'
Assert-Equal ([string]$identity.nodeVersion) ([string]$canonical.nodeRuntime.version) 'Installed Node runtime version'
if (
  [string]$identity.shellBuildId -notmatch '^desktop-[a-f0-9]{20}$' -or
  [string]$identity.sidecarBuildId -notmatch '^sidecar-[a-f0-9]{20}$' -or
  [string]$identity.buildId -ne [string]$identity.shellBuildId
) {
  throw "Installed desktop identity is invalid: $($identity | ConvertTo-Json -Compress -Depth 4)"
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
    throw "Installed resource hash mismatch for $logicalPath."
  }
  if (
    $logicalPath -eq 'sidecar/node.exe' -and
    $hash -ne [string]$canonical.nodeRuntime.sha256
  ) {
    throw 'Installed Node runtime does not match the canonical official SHA-256.'
  }
}

$registryStateAfter = Get-InstalledRegistryState
Assert-Equal ([string]$registryStateAfter.version) ([string]$canonical.version) 'Installed registry version'
Assert-RegistryMatchesInstall $registryStateAfter $appExe ([string]$canonical.displayName)
$uninstallerPath = [string]$registryStateAfter.uninstallCommand
$uninstallerItem = Assert-RegularFileNoReparse $uninstallerPath 'Installed uninstaller'
if ((Get-PeMachine $uninstallerPath) -ne 0x014c) {
  throw 'Installed NSIS uninstaller stub PE architecture is not I386.'
}
$uninstallerHash = Get-Sha256Lower $uninstallerPath
$uninstallerSignature = Assert-UnsignedPe $uninstallerPath 'Installed uninstaller'
if ((Get-PeMachine $appExe) -ne 0x8664) {
  throw 'Installed application PE architecture is not AMD64/x64.'
}
$appSignature = Assert-UnsignedPe $appExe 'Installed application'
$appVersionInfo = (Get-Item -LiteralPath $appExe).VersionInfo
Assert-Equal ([string]$appVersionInfo.ProductName) ([string]$canonical.displayName) 'Installed application ProductName'
Assert-Equal ([string]$appVersionInfo.FileDescription) ([string]$canonical.displayName) 'Installed application FileDescription'
Assert-Equal ([string]$appVersionInfo.CompanyName) ([string]$canonical.company) 'Installed application CompanyName'
Assert-Equal ([string]$appVersionInfo.ProductVersion) ([string]$canonical.version) 'Installed application ProductVersion'
Assert-Equal ([string]$appVersionInfo.FileVersion) ([string]$canonical.version) 'Installed application FileVersion'

$stdoutLog = Join-Path $env:LOCALAPPDATA 'io.aleksi.workbench\logs\sidecar.stdout.log'
$first = Start-And-VerifyInstalledApp $appExe $installRoot $stdoutLog $nodePath $identity $true
$second = Start-And-VerifyInstalledApp $appExe $installRoot $stdoutLog $nodePath $identity $false
$forcedTermination = Start-And-VerifyForcedShellTermination $appExe $installRoot $stdoutLog $nodePath $identity
Restore-VerifiedBackupSnapshot $backupEvidence $protectedRoots
$userDataAfterRuntimeRecovery = Convert-InventoriesToFingerprints (
  Get-ProtectedInventories $protectedRoots
)
Assert-UserDataUnchanged $userDataBefore $userDataAfterRuntimeRecovery
$installedMetrics = Get-DirectoryMetrics $installRoot

$report = [ordered]@{
  schemaVersion = 1
  result = 'passed'
  testedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  evidenceBoundary = 'developer-machine-installed-shell-and-isolated-packaged-sidecar'
  installer = [ordered]@{
    path = [string]$canonical.installerFilename
    bytes = [int64]$installerItem.Length
    sha256 = $installerHash
    peMachine = 'I386'
    authenticodeStatus = $installerSignature
    manifestPath = 'release-manifest.json'
  }
  upgrade = [ordered]@{
    previousVersion = [string]$registryStateBefore.version
    installedVersion = [string]$registryStateAfter.version
    predecessorInstaller = [ordered]@{
      path = [string]$canonical.upgradeFrom.installerFilename
      bytes = [int64]$predecessorInstallerItem.Length
      sha256 = $predecessorInstallerHash
      version = [string]$predecessorInstallerVersionInfo.ProductVersion
      peMachine = 'I386'
      authenticodeStatus = $predecessorInstallerSignature
    }
    predecessorInstallation = [ordered]@{
      executablePath = '%LOCALAPPDATA%\Aleksi Workbench\aleksi-workbench.exe'
      executableBytes = [int64]$predecessorAppItem.Length
      executableSha256 = $predecessorAppHash
      version = [string]$predecessorAppVersionInfo.ProductVersion
      executableAuthenticodeStatus = $predecessorAppSignature
    }
    preUpgradeBackup = [ordered]@{
      root = [string]$backupEvidence.root
      manifestPath = [string]$backupEvidence.manifestPath
      manifestBytes = [int64]$backupEvidence.manifestBytes
      manifestSha256 = [string]$backupEvidence.manifestSha256
      fileCount = [int]$backupEvidence.fileCount
      bytes = [int64]$backupEvidence.bytes
      sourceFingerprintDigest = [string]$backupEvidence.sourceFingerprintDigest
      backupFingerprintDigest = [string]$backupEvidence.backupFingerprintDigest
    }
    userDataPreservedByInstaller = $true
    userDataFingerprintsBefore = $userDataBefore
    userDataFingerprintsAfter = $userDataAfterInstall
  }
  identity = [ordered]@{
    product = [string]$identity.product
    version = [string]$identity.version
    schemaVersion = [int]$identity.schemaVersion
    protocolVersion = [int]$identity.protocolVersion
    shellBuildId = [string]$identity.shellBuildId
    sidecarBuildId = [string]$identity.sidecarBuildId
    nodeVersion = [string]$identity.nodeVersion
    nodeSha256 = Get-Sha256Lower $nodePath
  }
  installation = [ordered]@{
    executablePath = '%LOCALAPPDATA%\Aleksi Workbench\aleksi-workbench.exe'
    executableBytes = [int64](Get-Item -LiteralPath $appExe).Length
    executableSha256 = Get-Sha256Lower $appExe
    executableAuthenticodeStatus = $appSignature
    installRoot = [string]$canonical.windowsPathContracts.install
    uninstallerPath = '%LOCALAPPDATA%\Aleksi Workbench\uninstall.exe'
    uninstallerBytes = [int64]$uninstallerItem.Length
    uninstallerSha256 = $uninstallerHash
    uninstallerPeMachine = 'I386'
    uninstallerAuthenticodeStatus = $uninstallerSignature
    fileCount = [int]$installedMetrics.fileCount
    bytes = [int64]$installedMetrics.bytes
  }
  runtime = [ordered]@{
    firstDynamicPort = [int]$first.port
    secondDynamicPort = [int]$second.port
    coldReadyMilliseconds = [int]$first.readyMilliseconds
    warmReadyMilliseconds = [int]$second.readyMilliseconds
    coldRitualSurvivalMilliseconds = [int]$first.startupRitualSurvivalMilliseconds
    warmRitualSurvivalMilliseconds = [int]$second.startupRitualSurvivalMilliseconds
    coldMemory = $first.memory
    warmMemory = $second.memory
    startupRitualSeconds = 20
    singleInstance = 'passed'
    normalWindowCloseStopsSidecar = 'passed'
    forcedTerminationDynamicPort = [int]$forcedTermination.port
    forcedShellTerminationStopsSidecar = 'passed'
    apiVerification = 'delegated-to-isolated-packaged-sidecar-gate'
  }
}

if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
  $resolvedEvidence = [System.IO.Path]::GetFullPath($EvidencePath)
  $evidenceDirectory = Split-Path -Parent $resolvedEvidence
  New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
  $reportJson = $report | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText(
    $resolvedEvidence,
    $reportJson,
    [System.Text.UTF8Encoding]::new($false)
  )
}

Write-Host 'Installed desktop verification passed.'
Write-Host "Installed executable: $appExe"
Write-Host "Upgrade: $([string]$registryStateBefore.version) -> $([string]$registryStateAfter.version)"
Write-Host "Identity: $([string]$identity.version) $([string]$identity.shellBuildId) $([string]$identity.sidecarBuildId)"
Write-Host "Dynamic ports: $([int]$first.port), $([int]$second.port)"
Write-Host "Ready timing (cold/warm ms): $([int]$first.readyMilliseconds)/$([int]$second.readyMilliseconds)"
Write-Host "Verified pre-upgrade backup: $([string]$backupEvidence.root)"
Write-Host 'No content changes were detected in the fingerprinted user-data roots during silent installation.'
Write-Host 'API behavior is verified separately against an isolated packaged sidecar; this installed-shell pass issues no HTTP requests or data-removal commands.'
} catch {
  $failure = $_
  $recoveryMessage = 'not attempted because no installer mutation occurred'
  if ($mutationAttempted) {
    $recoveryAttempted = $true
    try {
      $recoveryResult = Start-Process -FilePath $predecessorInstaller -ArgumentList @('/S') -Wait -PassThru
      $recoveryInstallerExitCode = [int]$recoveryResult.ExitCode
      if ($recoveryResult.ExitCode -ne 0) {
        throw "Canonical predecessor repair installer failed with exit code $($recoveryResult.ExitCode)."
      }
      Restore-VerifiedBackupSnapshot $backupEvidence $protectedRoots
      Assert-PredecessorInstallationRestored (
        $canonical
      ) $registryStateBefore $predecessorPayloadInventory $userDataBefore $protectedRoots $predecessorIdentity
      $applicationRestored = $true
      $recoveryMessage = 'canonical predecessor payload, registry, protected user data, and runtime were restored and reverified'
    } catch {
      $recoveryMessage = "recovery failed: $($_.Exception.Message)"
    }
  }
  $backupPathForFailure = if ($null -ne $backupEvidence) {
    [string]$backupEvidence.root
  } else {
    '<backup-not-created>'
  }
  throw "Installed upgrade verification failed. Original failure: $($failure.Exception.Message) Recovery attempted=$recoveryAttempted; predecessor restored=$applicationRestored; recovery installer exit code=$recoveryInstallerExitCode; recovery result=$recoveryMessage; verified backup=$backupPathForFailure"
}
