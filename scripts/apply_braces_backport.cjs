#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'security/backports/braces-3.0.3.json'), 'utf8'));

function fail(message) {
  console.error(`braces backport refused: ${message}`);
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const matches = Object.entries(lock.packages || {}).filter(([name]) => name === 'node_modules/braces' || name.endsWith('/node_modules/braces'));
if (matches.length !== 1 || matches[0][0] !== metadata.package.lockPath) {
  fail(`expected one locked copy at ${metadata.package.lockPath}; found ${matches.map(([name]) => name).join(', ') || 'none'}`);
}

const [lockPath, locked] = matches[0];
if (locked.version !== metadata.package.version || locked.integrity !== metadata.package.integrity) {
  fail(`lock entry changed; expected braces ${metadata.package.version} with recorded registry integrity`);
}

const packageRoot = path.join(root, lockPath);
const manifestPath = path.join(packageRoot, 'package.json');
if (!fs.existsSync(manifestPath)) fail(`missing installed package at ${lockPath}; run npm ci first`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.name !== metadata.package.name || manifest.version !== metadata.package.version) {
  fail(`installed package identity changed; expected ${metadata.package.name}@${metadata.package.version}`);
}

const staged = [];
let alreadyPatched = 0;
for (const entry of metadata.files) {
  if (path.basename(entry.path) !== entry.path.split('/').pop() || entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
    fail(`unsafe source path ${entry.path}`);
  }
  const targetPath = path.join(packageRoot, entry.path);
  const stats = fs.lstatSync(targetPath);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(`expected regular source file ${entry.path}`);
  const original = fs.readFileSync(targetPath);
  const currentHash = sha256(original);
  if (currentHash === entry.patchedSha256) {
    alreadyPatched++;
    staged.push({ targetPath, original, patched: original, mode: stats.mode });
    continue;
  }
  if (currentHash !== entry.originalSha256) fail(`unexpected ${entry.path} SHA-256 ${currentHash}`);

  let source = original.toString('utf8');
  for (const hunk of [...entry.hunks].sort((left, right) => right.offset - left.offset)) {
    if (source.slice(hunk.offset, hunk.offset + hunk.before.length) !== hunk.before) {
      fail(`pristine patch context changed in ${entry.path} at UTF-16 offset ${hunk.offset}`);
    }
    source = source.slice(0, hunk.offset) + hunk.after + source.slice(hunk.offset + hunk.before.length);
  }
  const patched = Buffer.from(source, 'utf8');
  const patchedHash = sha256(patched);
  if (patchedHash !== entry.patchedSha256) fail(`generated ${entry.path} SHA-256 ${patchedHash} did not match reviewed backport`);
  staged.push({ targetPath, original, patched, mode: stats.mode });
}

if (alreadyPatched !== 0 && alreadyPatched !== metadata.files.length) {
  fail('installed source is a mixed original/patched state; restore the locked package and retry');
}
if (alreadyPatched === metadata.files.length) {
  console.log(`braces ${metadata.package.version} backport already verified (${metadata.upstream.headCommit})`);
  process.exit(0);
}

const temps = [];
try {
  for (const item of staged) {
    const temporaryPath = `${item.targetPath}.doul-backport-${process.pid}`;
    fs.writeFileSync(temporaryPath, item.patched, { mode: item.mode, flag: 'wx' });
    if (sha256(fs.readFileSync(temporaryPath)) !== sha256(item.patched)) fail('temporary source failed checksum verification');
    temps.push({ ...item, temporaryPath });
  }
  for (const item of temps) fs.renameSync(item.temporaryPath, item.targetPath);
} catch (error) {
  // Restore any file already renamed if a later rename failed.
  for (const item of temps) {
    if (sha256(fs.readFileSync(item.targetPath)) === sha256(item.patched)) {
      const restorePath = `${item.targetPath}.doul-restore-${process.pid}`;
      fs.writeFileSync(restorePath, item.original, { mode: item.mode, flag: 'w' });
      fs.renameSync(restorePath, item.targetPath);
    }
  }
  throw error;
} finally {
  for (const item of temps) if (fs.existsSync(item.temporaryPath)) fs.unlinkSync(item.temporaryPath);
}

for (const item of staged) {
  if (sha256(fs.readFileSync(item.targetPath)) !== metadata.files.find(file => path.join(packageRoot, file.path) === item.targetPath).patchedSha256) {
    fail('installed source failed final checksum verification');
  }
}
console.log(`applied pinned local braces ${metadata.package.version} security backport from ${metadata.upstream.headCommit}`);
