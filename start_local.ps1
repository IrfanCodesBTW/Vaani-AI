<#
.SYNOPSIS
    Thin wrapper — delegates to scripts/start_local.ps1 (canonical location).
#>
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'scripts\start_local.ps1'
if (-not (Test-Path -LiteralPath $target)) { Write-Host "Missing $target" -ForegroundColor Red; exit 1 }
& $target @args
