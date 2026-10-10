# node-forge 1.4.0 local security backport

This repository carries a narrow local backport for GHSA-86w9-cpqp-85rv. It
adds the nested `DigestAlgorithm` child-count check from
[digitalbazaar/forge PR #1152](https://github.com/digitalbazaar/forge/pull/1152),
pinned to upstream head `ceba34402e329f0365134f23fe19898756527d65`. The PR was
open and unmerged when this backport was prepared on 2026-10-10. The lockfile
continues to install registry `node-forge@1.4.0` with its recorded integrity;
the npm advisory finding remains visible. This change is a source mitigation,
not an upstream release, advisory closure, or release approval.

`node scripts/apply_node_forge_backport.cjs` applies the exact hunk recorded in
[`node-forge-1.4.0.json`](./node-forge-1.4.0.json). It checks the package-lock
path, version and registry integrity, then requires either the recorded source
SHA-256 or the reviewed target SHA-256. It fails closed on other source. The
root `postinstall` runs it after npm installs dependencies. Docker builders
copy the applier and metadata before `npm ci`, so their install lifecycle can
apply it. `scripts/dependency_environment.py --node` verifies the installed
target hash and rejects skipped or altered backports, including after
`npm ci --ignore-scripts`.

The upstream package is dual-licensed `(BSD-3-Clause OR GPL-2.0)`. This patch
selects BSD-3-Clause and retains Digital Bazaar's notice in
[`LICENSE.BSD-3-Clause`](./LICENSE.BSD-3-Clause). Provenance and the upstream
commit are in the JSON metadata. The package keeps its original name and
version; no audit suppression or dependency graph override is used.

The regression uses the exact forged-signature vector added in PR #1152. Before
applying the patch, the pristine locked 1.4.0 source accepted that vector
(`verify result true`). With the pinned patch, verification throws
`ASN.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value.`
The Expo code-signing compatibility check also exercises a valid RSA signature,
self-signed certificate creation and verification, certificate PEM round-trip,
CSR signing and verification, and Expo's manifest-signing helper.

Run the compatibility regression with:

```sh
npm run test:node-forge-backport
```

The audit finding remains high because npm audits the original locked version.
The recorded local state is
`mitigated_by_pinned_backport_pending_upstream_release_and_release_review`.
Keep dependency release approval blocked until a reviewed upstream fixed
release is available and the lock/audit are updated, or a separate release
review accepts this maintained local patch.
