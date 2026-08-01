param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$EvidencePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256Lower([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ([string]$Actual -cne [string]$Expected) {
    throw "$Label mismatch. Expected '$Expected', got '$Actual'."
  }
}

function Get-ValidTimestampedSignature([string]$Path, [string]$Label) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  Assert-Equal ([string]$signature.Status) 'Valid' "$Label Authenticode status"
  if ($null -eq $signature.SignerCertificate) {
    throw "$Label signer certificate is missing."
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "$Label trusted timestamp certificate is missing."
  }
  return [ordered]@{
    status = [string]$signature.Status
    signerThumbprint = ([string]$signature.SignerCertificate.Thumbprint).ToLowerInvariant()
    timestampThumbprint = ([string]$signature.TimeStamperCertificate.Thumbprint).ToLowerInvariant()
  }
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$manifestFile = (Resolve-Path -LiteralPath $ManifestPath).Path
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
$identity = Get-Content -LiteralPath (
  Join-Path $PSScriptRoot '..\release\identity.json'
) -Raw | ConvertFrom-Json

Assert-Equal ([string]$identity.signing.status) 'signed-release' 'Identity signing status'
Assert-Equal ([bool]$identity.signing.metadataOnly) $false 'Identity metadata-only signing flag'
Assert-Equal ([string]$manifest.signingStatus) 'signed-release' 'Manifest signing status'
Assert-Equal ([bool]$manifest.signed) $true 'Manifest signed flag'
Assert-Equal ([string]$manifest.installer.authenticodeStatus) 'Valid' 'Manifest installer Authenticode status'
Assert-Equal (Get-Sha256Lower $installer) ([string]$manifest.installer.sha256) 'Installer SHA-256'

$installerSignature = Get-ValidTimestampedSignature $installer 'Installer'
$installResult = Start-Process -FilePath $installer -ArgumentList @('/S') -Wait -PassThru
if ($installResult.ExitCode -ne 0) {
  throw "Signed installer failed with exit code $($installResult.ExitCode)."
}

$installRoot = Join-Path $env:LOCALAPPDATA 'Aleksi Workbench'
$executable = Join-Path $installRoot ([string]$identity.executableName)
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw 'Signed installed executable is missing.'
}
$executableSignature = Get-ValidTimestampedSignature $executable 'Installed executable'
$versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
Assert-Equal ([string]$versionInfo.ProductVersion) ([string]$identity.version) 'Installed executable version'

$evidence = [ordered]@{
  schemaVersion = 1
  result = 'passed'
  testedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  version = [string]$identity.version
  installer = [ordered]@{
    path = [string]$identity.installerFilename
    bytes = [int64](Get-Item -LiteralPath $installer).Length
    sha256 = Get-Sha256Lower $installer
    authenticode = $installerSignature
  }
  installedExecutable = [ordered]@{
    path = "%LOCALAPPDATA%\Aleksi Workbench\$([string]$identity.executableName)"
    bytes = [int64](Get-Item -LiteralPath $executable).Length
    sha256 = Get-Sha256Lower $executable
    authenticode = $executableSignature
  }
}
$evidenceDirectory = Split-Path -Parent $EvidencePath
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
[System.IO.File]::WriteAllText(
  $EvidencePath,
  "$($evidence | ConvertTo-Json -Depth 8)`n",
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Authenticode release evidence written: $EvidencePath"
