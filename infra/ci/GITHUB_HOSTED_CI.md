# Historical GitHub-hosted CI policy

The user requires CI to run on the Mac mini. The current policy selects `[self-hosted, Linux, ARM64, doul-macmini]` for all 24 workflows. See [macmini-runner.md](macmini-runner.md). The text below describes a superseded hosted-runner proposal.

# DOUL Supervision - GitHub-hosted CI policy

## Official execution target

All 15 GitHub Actions workflows select `ubuntu-24.04` (ephemeral hosted Linux x64). No pull-request workflow may execute on the Mac mini or another self-hosted machine. This repository is public, so PR code must not execute in a persistent private runner.

`infra/ci/verify_github_runner_workflows.py` checks every workflow `runs-on`. The policy check itself runs on hosted infrastructure.

## Disk and isolation

`prepare_github_runner.sh` refuses self-hosted runners. On ephemeral GitHub jobs only, it removes unused Android/.NET/PowerShell/Haskell toolchains, preserves Python/Node caches, and checks at least 10 GiB free before heavy jobs. Standard GitHub runner capacity is platform-controlled: **this change does not allocate 50 GiB**. Any larger runner needs explicit procurement and billing approval.

Playwright, Docker/Compose and PostgreSQL tests run in isolated jobs. Keep SHA-pinned actions, package lockfiles and `contents: read` minimum permissions. Never share deployment keys, pilot data, or customer documents with public PR tests.

## Merge and acceptance gates

1. Confirm all affected GitHub workflow jobs at the **current PR head**, including mobile sample, contracts and 200-case UX suite.
2. Confirm runner type is GitHub-hosted ubuntu-24.04; a queued CI is not a pass.
3. Preserve 200-case PASS, PARTIAL, BLOCKED, INVALID and FAIL counts. PARTIAL/BLOCKED are not field acceptance.
4. Verify 390/768/1440px and ko/vi/en navigation, and actual role-authorized persistence/retrieval of the five release workflows.
5. Do not merge draft or chained PRs without conflict resolution and explicit acceptance.

## Historical Mac mini runner

See `infra/ci/macmini-runner.md` for historical documentation only. This commit does **not** stop, delete, prune, or modify an existing Mac mini VM, runner or unrelated worktree.
