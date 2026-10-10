# DOUL Supervision — GitHub-hosted CI

## Execution contract

All Actions jobs run on GitHub-hosted `ubuntu-24.04` (Linux x64, ephemeral VM). Jobs do not use the Mac mini, Colima, Tailscale, or persistent test disk. This public repository uses standard GitHub-hosted Actions subject to GitHub platform limits. Workflow permissions remain `contents: read`.

The `ci-runner-policy` workflow rejects any new runner label other than `ubuntu-24.04`. The migration preserves API contract, Playwright, Docker/Compose, security scan, backup/restore and document rendering checks; it does not skip tests.

## Disk and isolation

Heavy builds run `bash infra/ci/prepare_github_runner.sh`, removing unused preinstalled Android/.NET/PowerShell/Haskell SDKs on the disposable hosted VM only. No repository source or permanent Docker volumes are deleted. It fails early when disk available is below 10 GiB. Existing Compose jobs tear down temporary volumes in `always()` steps.

Jobs never rely on host disk persistence, Tailscale, Mac mini hardware, fixed IPs or cross-job Docker cache. Dependency lockfiles and SHA-pinned actions remain required; no pilot/staging secrets should be exposed to pull_request jobs.

## Merge verification

1. Confirm all affected GitHub Actions workflow checks are green at the PR HEAD.
2. Confirm job runner metadata indicates GitHub-hosted `ubuntu-24.04`, not `doul-macmini`.
3. Require Docker/PostgreSQL and Playwright integration checks, not just syntax checks.
4. Fix hosted-runner disk or AMD64 issues without reverting to self-hosted CI.

This migration does not certify a production deployment or real-site acceptance.
