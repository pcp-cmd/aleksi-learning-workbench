$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $root
try {
  node scripts/start-runtime.mjs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
