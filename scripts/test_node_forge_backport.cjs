#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// This is the exact low-exponent RSA forgery vector added in digitalbazaar/forge PR #1152.
// Padding checks are disabled only to isolate DigestInfo ASN.1 validation, as in upstream.
function verifyPoC(packageRoot) {
  const JSBN = require(path.join(packageRoot, 'lib/jsbn'));
  const MD = require(path.join(packageRoot, 'lib/md.all'));
  const RSA = require(path.join(packageRoot, 'lib/rsa'));
  const UTIL = require(path.join(packageRoot, 'lib/util'));
    const N = new JSBN.BigInteger(
          'E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE56' +
          '47670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A8' +
          '86A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED7' +
          '8F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A' +
          '5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CE' +
          'CC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE5' +
          '4844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6AB' +
          'E252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7',
          16);
  const e = new JSBN.BigInteger('3');
  const S = UTIL.binary.hex.decode(
            'a4ae63dd5e7712b78f4870d0f51e294df5503d4f16c5d27ae33370981fb57f0de49f' +
            '50f3d6a04666774cd984cd13972db9bf8e12bd294ef0ddc916c7c86cbae63efd7b6b' +
            '97885e69760c208a40f1aecc76a90d7af5145177efce1bb55807a8d05c20b1596753' +
            'ba710642fc9acdde6c160232654662c77cc4466c8257a38edb49f894e8845d0fd987' +
            'b857ced88f4b62505a080bd87ef700d35d392a6e8f6fde34250c50b86fae606cb551' +
            '215e8f4813239b77651d5565ad453698c071d48c31e8e526fb4a37610f64b3e1fb8e' +
            '5be5898e408ad08197a0947794a530b54f84485377ce4a7488ed485ce4e5e105dd89' +
            '698a472f390c3b1b76bc16b73276c4d1c81d');

  const publicKey = RSA.setPublicKey(N, e);
  const digest = MD.sha256.create();
  digest.update('hello world!');
  return publicKey.verify(digest.digest().getBytes(), S, undefined, {
    _parseAllDigestBytes: true,
    _skipPaddingChecks: true
  });
}

const metadata = require('../security/backports/node-forge-1.4.0.json');
const installedRoot = path.dirname(require.resolve('node-forge/package.json'));
const installedRsaPath = path.join(installedRoot, metadata.package.originalFile);
const installedRsa = fs.readFileSync(installedRsaPath, 'utf8');
assert.equal(crypto.createHash('sha256').update(installedRsa).digest('hex'), metadata.package.patchedSha256);
const originalRsa = installedRsa.replace(metadata.patch.add, metadata.patch.remove);
assert.notEqual(originalRsa, installedRsa);
assert.equal(crypto.createHash('sha256').update(originalRsa).digest('hex'), metadata.package.originalSha256);

// Reconstruct the exact registry source in a temporary package copy and prove the POC
// succeeds before proving the installed, patched dependency rejects it.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doul-node-forge-backport-'));
const baselineRoot = path.join(temporaryRoot, 'node-forge');
try {
  fs.cpSync(installedRoot, baselineRoot, { recursive: true });
  fs.writeFileSync(path.join(baselineRoot, metadata.package.originalFile), originalRsa);
  assert.equal(verifyPoC(baselineRoot), true, 'pristine 1.4.0 must reproduce the signature forgery');
  assert.throws(
    () => verifyPoC(installedRoot),
    /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value\./
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

// Exercise Expo's certificate, CSR, and manifest-signing helpers through the patched forge.
const signing = require('@expo/code-signing-certificates');
const keyPair = signing.generateKeyPair();
const validityNotBefore = new Date(Date.now() - 60_000);
const validityNotAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
const certificate = signing.generateSelfSignedCodeSigningCertificate({
  keyPair,
  validityNotBefore,
  validityNotAfter,
  commonName: 'DOUL node-forge backport regression'
});
signing.validateSelfSignedCertificate(certificate, keyPair);
const certificatePem = signing.convertCertificateToCertificatePEM(certificate);
assert(signing.convertCertificatePEMToCertificate(certificatePem).verify(certificate));
const csr = signing.generateCSR(keyPair, 'DOUL node-forge backport regression');
assert.equal(csr.verify(csr), true);
const signature = signing.signBufferRSASHA256AndVerify(
  keyPair.privateKey,
  certificate,
  Buffer.from('legitimate Expo signing helper compatibility check')
);
assert.equal(typeof signature, 'string');
assert(signature.length > 0);

console.log('node-forge backport regression and Expo signing compatibility passed');
