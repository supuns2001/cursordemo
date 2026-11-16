#!/usr/bin/env node
/**
 * CursorDemo Zero-Dependency Verification Script
 * Runs JS syntax checks, Chrome Web Store i18n checks (56 locales),
 * and critical DOM/feature wiring assertions.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

function fail(msg) {
  console.error('❌ [verify] ' + msg);
  process.exit(1);
}

// 1. Validate manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('manifest.json missing');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.version) fail('manifest.version is required');
console.log(`✓ manifest.json v${manifest.version} (MV3)`);

// 2. Syntax check all extension scripts
const scripts = [
  'background.js',
  'content.js',
  'record.js',
  'editor.js',
  'video-processor.js',
  'zoom-analyzer.js'
];
for (const file of scripts) {
  const fullPath = path.join(rootDir, file);
  if (!fs.existsSync(fullPath)) fail(`Missing script: ${file}`);
  try {
    execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
  } catch (err) {
    fail(`Syntax error in ${file}: ${err.stderr ? err.stderr.toString() : err.message}`);
  }
}
console.log(`✓ JS syntax OK (${scripts.length} files)`);

// 3. Validate all _locales/*/messages.json Chrome Web Store limits
const localesDir = path.join(rootDir, '_locales');
if (!fs.existsSync(localesDir)) fail('_locales directory missing');
const locales = fs.readdirSync(localesDir).filter((entry) =>
  fs.statSync(path.join(localesDir, entry)).isDirectory()
);
if (locales.length < 50) fail(`Expected >= 50 locales, found ${locales.length}`);

for (const loc of locales) {
  const msgPath = path.join(localesDir, loc, 'messages.json');
  if (!fs.existsSync(msgPath)) fail(`Missing messages.json for locale ${loc}`);
  const messages = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
  const extName = messages.extName && messages.extName.message;
  const extDesc = messages.extDescription && messages.extDescription.message;
  if (!extName || extName.length > 45) {
    fail(`Locale ${loc} extName invalid or > 45 chars (${extName ? extName.length : 0})`);
  }
  if (!extDesc || extDesc.length > 132) {
    fail(`Locale ${loc} extDescription invalid or > 132 chars (${extDesc ? extDesc.length : 0})`);
  }
}
console.log(`✓ Chrome Web Store i18n OK (${locales.length} locales)`);

// 4. Verify critical wiring in HTML/JS files
const editorHtml = fs.readFileSync(path.join(rootDir, 'editor.html'), 'utf8');
const editorJs = fs.readFileSync(path.join(rootDir, 'editor.js'), 'utf8');
const recordHtml = fs.readFileSync(path.join(rootDir, 'record.html'), 'utf8');
const recordJs = fs.readFileSync(path.join(rootDir, 'record.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(rootDir, 'content.js'), 'utf8');
const vpJs = fs.readFileSync(path.join(rootDir, 'video-processor.js'), 'utf8');

const requiredEditorIds = [
  'reviewModal', 'discordModal', 'exportModal', 'shortcutsModal',
  'cursorHighlightEnabled', 'cursorHighlightStyle', 'cursorHighlightSize', 'cursorHighlightColor'
];
for (const id of requiredEditorIds) {
  if (!editorHtml.includes(`id="${id}"`)) fail(`Missing editor.html element #${id}`);
}

const requiredRecordIds = ['welcomeModal', 'discordModal', 'screenPermissionWarning'];
for (const id of requiredRecordIds) {
  if (!recordHtml.includes(`id="${id}"`)) fail(`Missing record.html element #${id}`);
}

if (!editorJs.includes('https://discord.gg/gwATujg6yq')) fail('Missing Discord invite in editor.js');
if (!recordJs.includes('https://discord.gg/gwATujg6yq')) fail('Missing Discord invite in record.js');
if (!editorJs.includes('cursorHighlightStyle:') || !vpJs.includes('resolveCursorHighlightPos')) {
  fail('Cursor Highlight export parity check failed');
}
if (editorJs.includes('showEditorToast(')) fail('Undefined showEditorToast call found in editor.js');
if (!contentJs.includes('let lastMouseX = null')) fail('content.js initial mouse X must be null');

console.log('✓ Critical DOM, Discord modal, Highlight parity & cross-browser guards OK');
