# Creates "Soranix" shortcuts on the Desktop and in the Start menu with the Soranix icon.
# Run it again if you move the folder. To pin: right-click the Start menu entry > Pin to taskbar
# (or right-click the running Soranix button on the taskbar > Pin to taskbar).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
# prefer the packaged Soranix.exe (node build.js); fall back to the dev copy
$exe = Join-Path $dir 'release\Soranix\Soranix.exe'
$args = ''
if (-not (Test-Path $exe)) {
  $exe = Join-Path $dir 'node_modules\electron\dist\electron.exe'
  $args = '"' + $dir + '"'
  if (-not (Test-Path $exe)) { Write-Host "Run 'npm install' (and 'node build.js') in $dir first."; exit 1 }
}
$sh = New-Object -ComObject WScript.Shell
foreach ($t in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $sh.CreateShortcut((Join-Path $t 'Soranix.lnk'))
  $lnk.TargetPath = $exe
  $lnk.Arguments = $args
  $lnk.WorkingDirectory = Split-Path -Parent $exe
  $lnk.IconLocation = (Join-Path $dir 'icons\soranix.ico') + ',0'
  $lnk.Description = 'Soranix - classic-style player for Spotify'
  $lnk.Save()
  "Created " + (Join-Path $t 'Soranix.lnk')
}
