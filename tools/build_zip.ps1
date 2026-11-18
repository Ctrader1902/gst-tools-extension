# Build dist\gst-tools-extension-<version>.zip containing only what Chrome needs.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File tools\build_zip.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage"
$zip = Join-Path $dist "gst-tools-extension-$version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

$include = @("manifest.json", "background.js", "background", "content", "lib", "sidepanel", "icons")
foreach ($item in $include) {
    Copy-Item (Join-Path $root $item) (Join-Path $stage $item) -Recurse
}

if (Test-Path $zip) { Remove-Item $zip -Force }
# Compress-Archive (PowerShell 5.1) writes '\' in entry names, which the
# Chrome Web Store rejects - write entries with '/' ourselves.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem $stage -Recurse -File | ForEach-Object {
        $name = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
}
Remove-Item $stage -Recurse -Force
Write-Output $zip
