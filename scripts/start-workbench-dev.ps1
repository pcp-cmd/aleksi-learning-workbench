$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "start-workbench.ps1")
exit $LASTEXITCODE
