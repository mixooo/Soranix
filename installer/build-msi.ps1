# Builds dist\Soranix-<version>.msi from release\Soranix (run "node build.js" first).
# Needs WiX 3 in tools\wix3 (portable, no install).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$wix = Join-Path $root 'tools\wix3'
$src = Join-Path $root 'release\Soranix'
$obj = Join-Path $root 'installer\obj'
$out = Join-Path $root 'dist'
if (-not (Test-Path (Join-Path $src 'Soranix.exe'))) { throw "Build the app first: node build.js" }
New-Item -ItemType Directory -Force $obj, $out | Out-Null

# version: the one in package.json, so the app, the MSI and the GitHub release all agree
# (publish.ps1 raises it for every release; the MSI needs a higher number to upgrade)
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version

# 1) list every file of the app
& (Join-Path $wix 'heat.exe') dir $src -nologo -cg AppFiles -dr INSTALLFOLDER -srd -gg -sfrag -sreg -var var.SourceDir -out (Join-Path $obj 'files.wxs')
if ($LASTEXITCODE) { throw "heat failed" }
# per-user install: mark the harvested components as 64-bit
(Get-Content (Join-Path $obj 'files.wxs') -Raw) -replace '<Component ', '<Component Win64="yes" ' | Set-Content (Join-Path $obj 'files.wxs') -Encoding UTF8

# launcher left at the old name's path for updates from before the rename (see oldname.cs)
$oldExe = Join-Path $obj 'oldname.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize "/win32icon:$(Join-Path $root 'icons\soranix.ico')" "/out:$oldExe" (Join-Path $root 'installer\oldname.cs')
if ($LASTEXITCODE) { throw "compiling oldname.cs failed" }

# 2) compile
& (Join-Path $wix 'candle.exe') -nologo -arch x64 -ext WixUIExtension -ext WixUtilExtension `
  "-dOldNameExe=$oldExe" "-dSourceDir=$src" "-dVersion=$version" "-dIconFile=$(Join-Path $root 'icons\soranix.ico')" "-dLicenseFile=$(Join-Path $root 'installer\License.rtf')" `
  -out "$obj\" (Join-Path $root 'installer\Soranix.wxs') (Join-Path $obj 'files.wxs')
if ($LASTEXITCODE) { throw "candle failed" }

# 3) link into the .msi (ICE validation skipped: it doesn't understand per-user file components)
$msi = Join-Path $out "Soranix-$version.msi"
& (Join-Path $wix 'light.exe') -nologo -sval -ext WixUIExtension -ext WixUtilExtension -spdb -out $msi (Join-Path $obj 'Soranix.wixobj') (Join-Path $obj 'files.wixobj')
if ($LASTEXITCODE) { throw "light failed" }
"Built $msi ({0:N0} MB)" -f ((Get-Item $msi).Length / 1MB)
