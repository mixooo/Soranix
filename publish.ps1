# Publishes a new Soranix release that installed copies pick up as an update.
#   powershell -ExecutionPolicy Bypass -File publish.ps1 -NotesFile notes.md
# 1) raises the version in package.json (only if that version was already released)
# 2) builds the exe (node build.js) and the MSI (installer\build-msi.ps1)
# 3) writes the MSI's SHA-256 fingerprint next to it (the updater refuses an MSI without a match)
# 4) commits and pushes, then creates the GitHub release with the MSI and its fingerprint
param([string]$NotesFile = '')
# (each step's exit code is checked below; 'Stop' would treat any tool's progress output on
#  stderr as a failure in Windows PowerShell)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# 1) version
$current = (Get-Content package.json -Raw | ConvertFrom-Json).version
gh release view "v$current" *> $null
if ($LASTEXITCODE -eq 0) {
  $current = node -e "const f='package.json',p=require('./'+f),v=p.version.split('.').map(Number);v[2]++;p.version=v.join('.');require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n');console.log(p.version)"
}
$version = $current.Trim()
"== Publishing Soranix $version"

# 2) build (a copy still running from release\ would lock its folder)
Get-Process | Where-Object { $_.Path -like (Join-Path $PSScriptRoot 'release\*') } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3
node build.js
if ($LASTEXITCODE) { throw 'node build.js failed' }
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build-msi.ps1
if ($LASTEXITCODE) { throw 'build-msi.ps1 failed' }
$msi = "dist\Soranix-$version.msi"
if (-not (Test-Path $msi)) { throw "$msi was not built" }

# 3) fingerprint
$hash = (Get-FileHash $msi -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "$msi.sha256"), "$hash  Soranix-$version.msi`n")
"== SHA-256 $hash"

# 4) commit, push, release
git add package.json
git diff --cached --quiet
if ($LASTEXITCODE) { git commit -q -m "Soranix $version"; if ($LASTEXITCODE) { throw 'git commit failed' } }
git push -q
if ($LASTEXITCODE) { throw 'git push failed' }
$notes = if ($NotesFile) { @('--notes-file', $NotesFile) } else { @('--generate-notes') }
gh release create "v$version" $msi "$msi.sha256" --title "Soranix $version" @notes
if ($LASTEXITCODE) { throw 'gh release create failed' }
"== Done: https://github.com/mixooo/Soranix/releases/tag/v$version"
