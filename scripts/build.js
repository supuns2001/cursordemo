#!/usr/bin/env node
/**
 * CursorDemo Cross-Platform Release Builder (`npm run build`)
 * Zero external dependencies — stages clean unpacked extension files in `dist/unpacked/`
 * and packages Chrome Web Store-ready `.zip` archives in `dist/`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const version = manifest.version || '1.4.0';

const distDir = path.join(rootDir, 'dist');
const unpackedDir = path.join(distDir, 'unpacked');
const genericZip = path.join(distDir, 'cursordemo.zip');
const versionedZip = path.join(distDir, `cursordemo-v${version}.zip`);

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'record.html',
  'record.js',
  'editor.html',
  'editor.js',
  'video-processor.js',
  'zoom-analyzer.js',
  'LICENSE'
];

const runtimeDirs = ['icons', '_locales'];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === '.DS_Store' || entry === '.git') continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function createZip(sourceDir, outZip) {
  if (fs.existsSync(outZip)) fs.rmSync(outZip, { force: true });

  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${outZip}" -Force`
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  try {
    execFileSync('zip', ['-r', '-q', outZip, '.', '-x', '*.DS_Store', '*.git*'], {
      cwd: sourceDir,
      stdio: 'inherit'
    });
  } catch (_) {
    // Fallback to Python zipfile module if `zip` binary is unavailable
    execFileSync(
      'python3',
      [
        '-c',
        [
          'import os, sys, zipfile',
          'src, out = sys.argv[1], sys.argv[2]',
          'with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:',
          '    for r, dirs, files in os.walk(src):',
          '        dirs[:] = [d for d in dirs if d != ".git"]',
          '        for f in files:',
          '            if f == ".DS_Store": continue',
          '            p = os.path.join(r, f)',
          '            zf.write(p, os.path.relpath(p, src))'
        ].join('\n'),
        sourceDir,
        outZip
      ],
      { stdio: 'inherit' }
    );
  }
}

// Reset dist/
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(unpackedDir, { recursive: true });

for (const file of runtimeFiles) {
  const src = path.join(rootDir, file);
  if (!fs.existsSync(src)) {
    console.error(`❌ Missing required runtime file: ${file}`);
    process.exit(1);
  }
  copyRecursive(src, path.join(unpackedDir, file));
}

for (const dir of runtimeDirs) {
  const src = path.join(rootDir, dir);
  if (!fs.existsSync(src)) {
    console.error(`❌ Missing required runtime directory: ${dir}`);
    process.exit(1);
  }
  copyRecursive(src, path.join(unpackedDir, dir));
}

createZip(unpackedDir, genericZip);
fs.copyFileSync(genericZip, versionedZip);

const sizeKB = (fs.statSync(genericZip).size / 1024).toFixed(1);
console.log(`✅ Built CursorDemo v${version}`);
console.log(`   Unpacked: ${path.relative(rootDir, unpackedDir)}/`);
console.log(`   Archive:  ${path.relative(rootDir, genericZip)} (${sizeKB} KB)`);
console.log(`   Version:  ${path.relative(rootDir, versionedZip)} (${sizeKB} KB)`);
