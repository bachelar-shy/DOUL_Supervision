# DOUL Supervision — CI execution policy

This filename is retained for existing references. The current execution target
is the user's dedicated Mac mini, following the instruction to run Actions there
while GitHub-hosted billing prevents jobs from starting.

All fifteen workflows select `[self-hosted, Linux, ARM64, doul-macmini]`.
`ci-runner-policy` rejects other runner labels and missing required workflows.
Existing job names, locked dependencies, SHA-pinned actions and verification
steps remain required. See [Mac mini runner operations](macmini-runner.md) for
the dedicated Colima VM, persistent runner and restart procedure.

`prepare_github_runner.sh` preserves SDKs and Docker caches on this persistent
runner. Compose jobs continue to remove their own temporary volumes in their
existing `always()` teardown steps. Maintenance must use `colima-doul-ci` and
must preserve native development worktrees, demo services and other Docker
contexts. Workflow permissions remain `contents: read`; pilot/staging secrets
must not be exposed to pull-request jobs.

Before merging, verify affected checks at the current PR commit and confirm the
job runner is `doul-macmini-m4-linux`. A queued job, online listener, local syntax
check or PARTIAL/BLOCKED scenario is not proof that an integration check or a
field acceptance scenario passed. Preserve failed test evidence and complete
the required browser, API and Docker/PostgreSQL checks.

CI results do not certify production deployment or real-site acceptance.
