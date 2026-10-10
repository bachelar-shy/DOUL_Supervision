#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const xcode = require('xcode');

const projectPath = process.argv[2];
if (!projectPath) {
  console.error('Usage: node scripts/check_xcode_compatibility.cjs <project.pbxproj>');
  process.exit(2);
}

const inputPath = path.resolve(projectPath);
if (!fs.statSync(inputPath).isFile()) {
  throw new Error(`PBX project file does not exist: ${inputPath}`);
}

const project = xcode.project(inputPath);
project.parseSync();
const existingUuids = new Set(project.allUuids());
const generatedUuid = project.generateUuid();
if (!/^[A-F0-9]{24}$/.test(generatedUuid)) {
  throw new Error(`xcode generated an invalid PBX identifier: ${generatedUuid}`);
}
if (existingUuids.has(generatedUuid)) {
  throw new Error(`xcode generated a colliding PBX identifier: ${generatedUuid}`);
}

const addedGroup = project.addPbxGroup([], 'DOULDependencyCompatibility', 'DOULDependencyCompatibility');
if (!/^[A-F0-9]{24}$/.test(addedGroup.uuid) || existingUuids.has(addedGroup.uuid)) {
  throw new Error('xcode added a group with an invalid or colliding identifier');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doul-xcode-pbx-roundtrip-'));
try {
  const outputPath = path.join(tempDir, 'roundtrip.pbxproj');
  fs.writeFileSync(outputPath, project.writeSync());
  const roundtrip = xcode.project(outputPath);
  roundtrip.parseSync();
  const roundtripIds = new Set(roundtrip.allUuids());
  if (roundtripIds.size !== existingUuids.size + 1 ||
      !roundtripIds.has(addedGroup.uuid) ||
      [...existingUuids].some(id => !roundtripIds.has(id))) {
    throw new Error('PBX round trip lost or changed project object identifiers');
  }
  console.log(JSON.stringify({
    xcodeVersion: require('xcode/package.json').version,
    projectPath: inputPath,
    generatedUuid,
    parsedUuidCount: roundtrip.allUuids().length,
    roundtripBytes: fs.statSync(outputPath).size,
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
