#requires -Version 5.1
<#
.SYNOPSIS
    Updates lady-lens to the latest version and restarts the MCP daemon.
.DESCRIPTION
    1. lens stop              (a running daemon locks the installed files)
    2. npm i -g <source>
    3. lens mcp -d            (start the daemon again)
    The daemon is only started again when the install succeeded.
.PARAMETER Source
    What npm installs. Default: the highest version of lady-lens-*.tgz in the dist folder of this repository.
    Examples: github:kimVanRenterghemNew/lady-lens   or   C:\git\lady-lens\dist\lady-lens-1.0.13.tgz
.PARAMETER Pack
    Run `npm run pack` first, so dist contains a package of the current source.
#>
param([string]$Source, [switch]$Pack)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Invoke-Checked($label, [scriptblock]$command) {
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$label failed (exit code $LASTEXITCODE)" }
}

Step 'Stopping lens'
# nothing running is not an error
try { lens stop } catch { Write-Host "lens stop: $($_.Exception.Message)" -ForegroundColor Yellow }
$global:LASTEXITCODE = 0

if ($Pack) {
    Step 'Packing into dist'
    Push-Location $repo
    try { Invoke-Checked 'npm run pack' { npm run pack } } finally { Pop-Location }
}

if (-not $Source) {
    $newest = Get-ChildItem (Join-Path $repo 'dist') -Filter 'lady-lens-*.tgz' -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.BaseName -replace '^lady-lens-', '') } -Descending | Select-Object -First 1
    if (-not $newest) { throw "No lady-lens-*.tgz in $repo\dist. Run with -Pack or pass -Source." }
    $Source = $newest.FullName
}

Step "Installing $Source"
Invoke-Checked 'npm install' { npm i -g $Source }

Step 'Installed version'
Invoke-Checked 'npm list' { npm ls -g lady-lens --depth=0 }

Step 'Starting the MCP daemon'
Invoke-Checked 'lens mcp -d' { lens mcp -d }
