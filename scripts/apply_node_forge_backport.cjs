#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const metadataPath = path.join(root, 'security/backports/node-forge-1.4.0.json');

function fail(message) {
  console.error(`node-forge backport refused: ${message}`);
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packagePaths = Object.entries(lock.packages || {})
  .filter(([name]) => name.endsWith('node_modules/node-forge'));

if (packagePaths.length !== 1 || packagePaths[0][0] !== metadata.package.lockPath) {
  fail(`expected one locked copy at ${metadata.package.lockPath}; found ${packagePaths.map(([name]) => name).join(', ') || 'none'}`);
}

const [lockPath, lockedPackage] = packagePaths[0];
if (lockedPackage.version !== metadata.package.version || lockedPackage.integrity !== metadata.package.integrity) {
  fail(`lock entry changed; expected node-forge ${metadata.package.version} with recorded registry integrity`);
}

const packageRoot = path.join(root, lockPath);
const packageManifestPath = path.join(packageRoot, 'package.json');
if (!fs.existsSync(packageManifestPath)) {
  fail(`missing installed package at ${lockPath}; run npm ci first`);
}
const packageManifest = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
if (packageManifest.name !== metadata.package.name || packageManifest.version !== metadata.package.version) {
  fail(`installed package identity changed; expected ${metadata.package.name}@${metadata.package.version}`);
}

const targetPath = path.join(packageRoot, metadata.package.originalFile);
if (!fs.existsSync(targetPath)) {
  fail(`missing ${metadata.package.originalFile}`);
}
const original = fs.readFileSync(targetPath);
const currentHash = sha256(original);
if (currentHash === metadata.package.patchedSha256) {
  console.log(`node-forge ${metadata.package.version} backport already verified (${currentHash})`);
  process.exit(0);
}
if (currentHash !== metadata.package.originalSha256) {
  fail(`unexpected ${metadata.package.originalFile} SHA-256 ${currentHash}`);
}

const source = original.toString('utf8');
const remove = metadata.patch.remove;
if (source.split(remove).length !== 2) {
  fail('expected exactly one pristine patch location');
}
const patched = Buffer.from(source.replace(remove, metadata.patch.add), 'utf8');
const patchedHash = sha256(patched);
if (patchedHash !== metadata.package.patchedSha256) {
  fail(`generated target SHA-256 ${patchedHash} did not match reviewed backport`);
}

const temporaryPath = `${targetPath}.doul-backport-${process.pid}`;
try {
  fs.writeFileSync(temporaryPath, patched, { mode: fs.statSync(targetPath).mode });
  if (sha256(fs.readFileSync(temporaryPath)) !== metadata.package.patchedSha256) {
    fail('temporary target failed checksum verification');
  }
  fs.renameSync(temporaryPath, targetPath);
} finally {
  if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
}

if (sha256(fs.readFileSync(targetPath)) !== metadata.package.patchedSha256) {
  fail('installed target failed final checksum verification');
}
console.log(`applied pinned local node-forge ${metadata.package.version} security backport`);
