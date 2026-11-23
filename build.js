// Builds release\Soranix\Soranix.exe: a stand-alone copy of the app with its own name
// and icon, then VMP-signs it with castLabs so Spotify plays in it.
// Run:  node build.js        (needs: npm install, and a castLabs EVS account for signing)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'release', 'Soranix');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const RCEDIT = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const APP_FILES = ['main.js', 'preload.js', 'index.html', 'app.js', 'style.css', 'manifest.json'];
const pkg = require('./package.json');

const step = s => console.log('\n== ' + s);

step('Copying the app engine');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true });
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'Soranix.exe'));
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

step('Adding Soranix');
const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(path.join(appDir, 'icons'), { recursive: true });
for (const f of APP_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
for (const f of fs.readdirSync(path.join(ROOT, 'icons')).filter(f => /\.(png|ico)$/.test(f)))
  fs.copyFileSync(path.join(ROOT, 'icons', f), path.join(appDir, 'icons', f));
fs.mkdirSync(path.join(appDir, 'helpers'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'helpers', 'balance.exe'), path.join(appDir, 'helpers', 'balance.exe'));
fs.mkdirSync(path.join(appDir, 'vendor'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'vendor')))
  fs.copyFileSync(path.join(ROOT, 'vendor', f), path.join(appDir, 'vendor', f));
// same "name" as the dev copy, so your login and settings carry over
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'soranix', productName: 'Soranix', version: pkg.version, main: 'main.js', description: pkg.description,
}, null, 2));

step('Setting the icon and name on Soranix.exe');
execFileSync(RCEDIT, [path.join(OUT, 'Soranix.exe'),
  '--set-icon', path.join(ROOT, 'icons', 'soranix.ico'),
  '--set-version-string', 'ProductName', 'Soranix',
  '--set-version-string', 'FileDescription', 'Soranix',
  '--set-version-string', 'InternalName', 'Soranix',
  '--set-version-string', 'OriginalFilename', 'Soranix.exe',
  '--set-version-string', 'CompanyName', 'Soranix',
  '--set-version-string', 'LegalCopyright', '',
  '--set-file-version', pkg.version, '--set-product-version', pkg.version,
], { stdio: 'inherit' });

step('Signing for protected playback (castLabs EVS)');
// must come last: any change to the exe after this breaks the signature
execFileSync('python', ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', OUT], { stdio: 'inherit' });

console.log('\nDone: ' + path.join(OUT, 'Soranix.exe'));
