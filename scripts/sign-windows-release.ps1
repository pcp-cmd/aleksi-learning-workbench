$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$certificateBase64 = [string]$env:ALEKSI_WINDOWS_SIGNING_CERTIFICATE_BASE64
$certificatePassword = [string]$env:ALEKSI_WINDOWS_SIGNING_CERTIFICATE_PASSWORD
if ([string]::IsNullOrWhiteSpace($certificateBase64)) {
  throw 'ALEKSI_WINDOWS_SIGNING_CERTIFICATE_BASE64 is required.'
}
if ([string]::IsNullOrWhiteSpace($certificatePassword)) {
  throw 'ALEKSI_WINDOWS_SIGNING_CERTIFICATE_PASSWORD is required.'
}
if ([string]::IsNullOrWhiteSpace([string]$env:RUNNER_TEMP)) {
  throw 'RUNNER_TEMP is required for isolated certificate preparation.'
}

$pfxPath = Join-Path $env:RUNNER_TEMP 'aleksi-release-signing.pfx'
$configPath = Join-Path $env:RUNNER_TEMP 'aleksi-tauri-signing-config.json'
$pfxBytes = [Convert]::FromBase64String($certificateBase64)
[System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)

$securePassword = ConvertTo-SecureString $certificatePassword -AsPlainText -Force
$certificate = Import-PfxCertificate `
  -FilePath $pfxPath `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -Password $securePassword `
  -Exportable:$false

if ($null -eq $certificate -or -not $certificate.HasPrivateKey) {
  throw 'Imported Authenticode certificate does not expose a private key.'
}
if ((Get-Date) -lt $certificate.NotBefore -or (Get-Date) -gt $certificate.NotAfter) {
  throw 'Imported Authenticode certificate is outside its validity window.'
}
$codeSigningOid = '1.3.6.1.5.5.7.3.3'
$hasCodeSigningEku = @(
  $certificate.EnhancedKeyUsageList |
    Where-Object { [string]$_.ObjectId.Value -eq $codeSigningOid }
).Count -gt 0
if (-not $hasCodeSigningEku) {
  throw 'Imported certificate is not valid for code signing.'
}

$config = [ordered]@{
  bundle = [ordered]@{
    windows = [ordered]@{
      certificateThumbprint = ([string]$certificate.Thumbprint).ToUpperInvariant()
      digestAlgorithm = 'sha256'
      timestampUrl = 'http://timestamp.digicert.com'
    }
  }
}
[System.IO.File]::WriteAllText(
  $configPath,
  "$($config | ConvertTo-Json -Depth 5)`n",
  [System.Text.UTF8Encoding]::new($false)
)

if (-not [string]::IsNullOrWhiteSpace([string]$env:GITHUB_OUTPUT)) {
  "signing_config_path=$configPath" >> $env:GITHUB_OUTPUT
  "certificate_thumbprint=$(([string]$certificate.Thumbprint).ToUpperInvariant())" >> $env:GITHUB_OUTPUT
  "certificate_path=Cert:\CurrentUser\My\$(([string]$certificate.Thumbprint).ToUpperInvariant())" >> $env:GITHUB_OUTPUT
}

Write-Host 'Imported the release certificate and created an isolated Tauri signing configuration.'
