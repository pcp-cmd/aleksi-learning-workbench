param(
  [string]$Path = (Join-Path $env:USERPROFILE 'Desktop\aleksi-learning-workbench'),
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ManifestName = 'DESKTOP_PACKAGE_MANIFEST.json'
$ExcludedNames = @(
  '.git',
  'node_modules',
  'dist',
  '.vite',
  'playwright-report',
  'test-results',
  'coverage',
  '.superpowers'
)
$ExcludedFilePatterns = @(
  '*.tsbuildinfo'
)
$GeneratedExcludedNames = @(
  'node_modules',
  'dist',
  '.vite',
  'playwright-report',
  'test-results',
  'coverage'
)
$GeneratedExcludedFilePatterns = @('*.tsbuildinfo')
$RequiredFiles = @(
  '.editorconfig',
  '.gitattributes',
  'README.md',
  'package.json',
  'package-lock.json',
  'playwright.config.ts',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.test.json',
  'index.html',
  'src/app/App.tsx',
  'src/main.tsx',
  'src/styles/workbench.css',
  'server/app.ts',
  'server/runtime-entry.ts',
  'server/start-server.ts',
  'server/runtime-config.ts',
  'docs/V0.1_ACCEPTANCE.md',
  'docs/DATA_SCHEMA.md',
  'docs/UI_REUSE_MAP.md',
  'docs/current/ENGINEERING_DISCIPLINE.md',
  'docs/current/PACKAGING_ROADMAP.md',
  'docs/current/PRODUCT_DECISIONS.md',
  'docs/current/PROJECT_MAP.md',
  'docs/current/TECH_DEBT_REGISTER.md',
  'docs/superpowers/specs/2026-06-22-aleksi-learning-workbench-v0.1-design.md',
  'docs/superpowers/plans/2026-06-22-aleksi-learning-workbench-v0.1.md',
  'tests/browser/epsilon-n-flow.spec.ts',
  'scripts/audit-package.mjs',
  'scripts/health-source.mjs',
  'scripts/package-rules.mjs',
  'scripts/package-source.mjs',
  'scripts/start-workbench.cmd',
  'scripts/start-workbench-dev.cmd',
  'scripts/start-workbench-dev.ps1',
  'scripts/start-workbench.ps1',
  'scripts/start-workbench-runtime.cmd',
  'scripts/start-workbench-runtime.ps1',
  'scripts/start-runtime.mjs',
  'scripts/zip-store.mjs',
  'scripts/verify-desktop-package.ps1'
)
$RequiredDirectories = @()

function Resolve-PackageRoot([string]$InputPath) {
  $resolved = Resolve-Path -LiteralPath $InputPath -ErrorAction Stop
  $item = Get-Item -LiteralPath $resolved.Path -Force
  if (-not $item.PSIsContainer) {
    throw "Package path is not a directory: $InputPath"
  }

  return $item.FullName.TrimEnd('\', '/')
}

function Assert-ChildPath([string]$Root, [string]$Candidate) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $candidateFull = [System.IO.Path]::GetFullPath($Candidate)
  $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar

  if (
    $candidateFull -ne $rootFull -and
    -not $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    throw "Refusing to touch a path outside the package root: $candidateFull"
  }
}

function Get-RelativePackagePath([string]$Root, [string]$FullName) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $full = [System.IO.Path]::GetFullPath($FullName)
  Assert-ChildPath $rootFull $full
  return $full.Substring($rootFull.Length).TrimStart('\', '/') -replace '\\', '/'
}

function Test-IsExcludedRelativePath([string]$RelativePath) {
  $segments = $RelativePath -split '/'
  foreach ($segment in $segments) {
    if ($ExcludedNames -contains $segment) {
      return $true
    }
  }

  $fileName = Split-Path -Leaf $RelativePath
  if (Test-IsExcludedFileName $fileName) {
    return $true
  }

  return $false
}

function Test-IsExcludedFileName([string]$FileName) {
  foreach ($pattern in $ExcludedFilePatterns) {
    if ($FileName -like $pattern) {
      return $true
    }
  }

  return $false
}

function Assert-RequiredFiles([string]$Root) {
  foreach ($relativePath in $RequiredFiles) {
    $target = Join-Path $Root ($relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
      throw "Required file is missing: $relativePath"
    }
  }

  foreach ($relativePath in $RequiredDirectories) {
    $target = Join-Path $Root ($relativePath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $target -PathType Container)) {
      throw "Required directory is missing: $relativePath"
    }
  }
}

function Assert-ExcludedState([string]$Root) {
  foreach ($name in $ExcludedNames) {
    $target = Join-Path $Root $name
    if (Test-Path -LiteralPath $target) {
      throw "Excluded path is present in the package: $name"
    }
  }

  foreach ($pattern in $ExcludedFilePatterns) {
    $matches = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -Filter $pattern)
    if ($matches.Count -gt 0) {
      $relativeMatches = @(
        $matches |
          ForEach-Object { Get-RelativePackagePath $Root $_.FullName }
      )
      throw "Excluded generated files are present in the package: $($relativeMatches -join ', ')"
    }
  }
}

function Get-PackageInventory([string]$Root) {
  $entries = @()
  $files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force

  foreach ($file in $files) {
    $relativePath = Get-RelativePackagePath $Root $file.FullName
    $include = $true

    if ($relativePath -eq $ManifestName) {
      $include = $false
    }
    if (Test-IsExcludedRelativePath $relativePath) {
      $include = $false
    }

    if ($include) {
      $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
      $entries += [pscustomobject]@{
        relativePath = $relativePath
        bytes = $file.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }
  }

  return @($entries | Sort-Object relativePath)
}

function Write-PackageManifest([string]$Root) {
  $manifestPath = Join-Path $Root $ManifestName
  $manifest = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    packageRoot = $Root
    excludes = @($ExcludedNames + $ExcludedFilePatterns)
    files = @(Get-PackageInventory $Root)
  }

  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  return $manifest
}

function Read-PackageManifest([string]$Root) {
  $manifestPath = Join-Path $Root $ManifestName
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    return $null
  }

  return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}

function Assert-ManifestMatches([string]$Root, $Manifest) {
  $expected = @($Manifest.files)
  $current = @(Get-PackageInventory $Root)
  $expectedByPath = @{}
  $currentByPath = @{}

  foreach ($entry in $expected) {
    $expectedByPath[[string]$entry.relativePath] = $entry
  }
  foreach ($entry in $current) {
    $currentByPath[[string]$entry.relativePath] = $entry
  }

  $missing = @(
    $expected |
      Where-Object { -not $currentByPath.ContainsKey([string]$_.relativePath) } |
      ForEach-Object { $_.relativePath }
  )
  $unlisted = @(
    $current |
      Where-Object { -not $expectedByPath.ContainsKey([string]$_.relativePath) } |
      ForEach-Object { $_.relativePath }
  )

  if ($missing.Count -gt 0) {
    throw "Manifest files are missing: $($missing -join ', ')"
  }
  if ($unlisted.Count -gt 0) {
    throw "Unlisted package files are present: $($unlisted -join ', ')"
  }

  foreach ($entry in $current) {
    $expectedEntry = $expectedByPath[[string]$entry.relativePath]
    $expectedHash = ([string]$expectedEntry.sha256).ToLowerInvariant()

    if ([int64]$expectedEntry.bytes -ne [int64]$entry.bytes -or $expectedHash -ne $entry.sha256) {
      throw "Manifest hash/size mismatch: $($entry.relativePath)"
    }
  }
}

function Get-CommandSource([string[]]$Names) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw "Command not found: $($Names -join ' or ')"
}

function Assert-Node22([string]$NodePath) {
  $majorText = & $NodePath -p "process.versions.node.split('.')[0]"
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect the installed Node.js version.'
  }

  $major = [int]$majorText
  if ($major -lt 22) {
    $version = & $NodePath -v
    throw "Node.js 22 or newer is required. Found $version."
  }
}

function Invoke-CheckedCommand([string]$WorkingDirectory, [string]$FilePath, [string[]]$Arguments) {
  Write-Host "Running: $FilePath $($Arguments -join ' ')"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Remove-GeneratedExcludedArtifacts([string]$Root) {
  foreach ($name in $GeneratedExcludedNames) {
    $target = Join-Path $Root $name
    if (Test-Path -LiteralPath $target) {
      Assert-ChildPath $Root $target
      Remove-Item -LiteralPath $target -Recurse -Force
      Write-Host "Removed verification-generated $name"
    }
  }

  foreach ($pattern in $GeneratedExcludedFilePatterns) {
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -Filter $pattern)
    foreach ($file in $files) {
      Assert-ChildPath $Root $file.FullName
      Remove-Item -LiteralPath $file.FullName -Force
      Write-Host "Removed verification-generated $($file.Name)"
    }
  }
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
  $listener.Start()
  try {
    return [int]$listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Wait-ForHealth([string]$HealthUrl, [string]$StdoutPath, [string]$StderrPath) {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    try {
      $health = Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 2
      if ($health.ok -eq $true -and $health.service -eq 'aleksi-workbench') {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $deadline)

  $stdout = ''
  $stderr = ''
  if (Test-Path -LiteralPath $StdoutPath) {
    $stdout = Get-Content -LiteralPath $StdoutPath -Raw
  }
  if (Test-Path -LiteralPath $StderrPath) {
    $stderr = Get-Content -LiteralPath $StderrPath -Raw
  }

  throw "Timed out waiting for $HealthUrl. stdout: $stdout stderr: $stderr"
}

function Invoke-JsonPost([string]$Uri, [hashtable]$Body) {
  $json = $Body | ConvertTo-Json -Depth 12
  return Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json; charset=utf-8' -Body $json -TimeoutSec 10
}

function Invoke-DesktopVaultSmoke([string]$Root, [int]$ServicePort, [string]$NodePath) {
  $verifyRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("aleksi-desktop-package-" + [guid]::NewGuid().ToString('N'))
  $vaultPath = Join-Path $verifyRoot 'Vault'
  $settingsDir = Join-Path $verifyRoot 'app-settings'
  $stdoutPath = Join-Path $verifyRoot 'server.out.log'
  $stderrPath = Join-Path $verifyRoot 'server.err.log'
  $tsxCli = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
  $serverScript = Join-Path $Root 'server\runtime-entry.ts'
  $healthUrl = "http://127.0.0.1:$ServicePort/api/health"
  $serverProcess = $null
  $previousPort = $env:ALEKSI_SERVER_PORT
  $previousSettingsDir = $env:ALEKSI_APP_SETTINGS_DIR

  if (-not (Test-Path -LiteralPath $tsxCli -PathType Leaf)) {
    throw 'tsx CLI is missing after dependency installation.'
  }

  New-Item -ItemType Directory -Path $verifyRoot -Force | Out-Null

  try {
    $env:ALEKSI_SERVER_PORT = [string]$ServicePort
    $env:ALEKSI_APP_SETTINGS_DIR = $settingsDir

    $serverProcess = Start-Process `
      -FilePath $NodePath `
      -ArgumentList @($tsxCli, $serverScript) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru

    Wait-ForHealth $healthUrl $stdoutPath $stderrPath

    $baseUrl = "http://127.0.0.1:$ServicePort"
    $initialize = Invoke-JsonPost "$baseUrl/api/vault/initialize" @{
      path = $vaultPath
    }
    if ($initialize.status.initialized -ne $true) {
      throw 'Temporary Desktop-package Vault was not initialized.'
    }

    $reading = Invoke-JsonPost "$baseUrl/api/readings" @{
      title = 'Desktop package epsilon-N reading'
      concept = 'DesktopPackageConcept'
      body = "For every epsilon greater than zero there is an N.`n`n$$`n\forall \epsilon > 0, \exists N.`n$$"
      source = 'manual-paste'
    }
    $readingId = [string]$reading.reading.id

    $createdCard = Invoke-JsonPost "$baseUrl/api/cards" @{
      type = 'definition'
      title = 'Desktop package definition'
      concept = 'DesktopPackageConcept'
      relatedConcepts = @()
      sourceReadingId = $readingId
      excerpt = 'For every epsilon greater than zero there is an N.'
      understanding = 'The verifier proves the Desktop package can persist cards.'
      blockType = 'definition'
      nextAction = 'Reload the card from the package verification Vault.'
      formalDefinition = 'For every epsilon greater than zero, there exists an N.'
      plainExplanation = 'After some point the sequence stays inside the epsilon band.'
      quantifierStructure = 'forall epsilon exists N'
      commonMisunderstandings = 'N may depend on epsilon.'
    }
    $cardId = [string]$createdCard.card.id

    $loadedCard = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/cards/$cardId" -TimeoutSec 10
    if ([string]$loadedCard.card.id -ne $cardId) {
      throw 'Created card did not reload by ID.'
    }

    $rebuild = Invoke-JsonPost "$baseUrl/api/index/rebuild" @{
      confirmed = $true
    }
    if ($rebuild.ok -ne $true) {
      throw 'Index rebuild did not report ok=true.'
    }

    return [pscustomobject]@{
      healthUrl = $healthUrl
      testVaultPath = $vaultPath
      cardId = $cardId
      saveReceiptRelativePath = [string]$createdCard.saveReceipt.relativePath
      saveReceiptModifiedAt = [string]$createdCard.saveReceipt.modifiedAt
    }
  } finally {
    if ($serverProcess -ne $null -and -not $serverProcess.HasExited) {
      Stop-Process -Id $serverProcess.Id -Force
      $serverProcess.WaitForExit(5000) | Out-Null
    }

    if ($null -eq $previousPort) {
      Remove-Item Env:\ALEKSI_SERVER_PORT -ErrorAction SilentlyContinue
    } else {
      $env:ALEKSI_SERVER_PORT = $previousPort
    }

    if ($null -eq $previousSettingsDir) {
      Remove-Item Env:\ALEKSI_APP_SETTINGS_DIR -ErrorAction SilentlyContinue
    } else {
      $env:ALEKSI_APP_SETTINGS_DIR = $previousSettingsDir
    }
  }
}

$root = Resolve-PackageRoot $Path
$manifest = Read-PackageManifest $root
$nodePath = Get-CommandSource @('node')
$npmPath = Get-CommandSource @('npm.cmd', 'npm')

if ($Port -eq 0) {
  $Port = Get-FreeTcpPort
}

Assert-Node22 $nodePath
Assert-RequiredFiles $root

if ($manifest -eq $null) {
  Assert-ExcludedState $root
  $manifest = Write-PackageManifest $root
  Write-Host "Generated $ManifestName"
} else {
  Assert-ExcludedState $root
}

Assert-ManifestMatches $root $manifest

Invoke-CheckedCommand $root $npmPath @('ci')
Invoke-CheckedCommand $root $npmPath @('run', 'verify')

$smoke = Invoke-DesktopVaultSmoke $root $Port $nodePath
Remove-GeneratedExcludedArtifacts $root
Assert-ExcludedState $root
Assert-ManifestMatches $root $manifest

$result = [ordered]@{
  ok = $true
  packagePath = $root
  manifestPath = (Join-Path $root $ManifestName)
  healthUrl = $smoke.healthUrl
  testVaultPath = $smoke.testVaultPath
  cardId = $smoke.cardId
  saveReceipt = [ordered]@{
    relativePath = $smoke.saveReceiptRelativePath
    modifiedAt = $smoke.saveReceiptModifiedAt
  }
}

Write-Host 'Desktop package verification passed.'
$result | ConvertTo-Json -Depth 6
