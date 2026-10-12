# DOUL Supervision — GitHub-hosted CI policy

## Operating rule

All repository CI jobs use `ubuntu-24.04` GitHub-hosted Linux x64 runners.
Pull-request code must not execute on the persistent Mac mini or any private
machine. The Mac mini continues to run the independent staging application;
this migration neither stops the staging server nor removes the existing runner.

The policy is enforced by `infra/ci/verify_github_runner_workflows.py` and
`.github/workflows/ci-runner-policy.yml`. Every workflow's `runs-on` is
checked, including any additional jobs in matrix workflows.

## Execution

- Preserve SHA-pinned GitHub actions, locked npm/Python dependencies, and
  `permissions: contents: read` for public pull requests.
- Browser, Docker Compose, PostgreSQL and media conversion tests use only
  disposable per-job data. Docker/Compose are supplied on GitHub's Ubuntu
  runner, and project-specific tools are installed by their CI jobs.
- `infra/ci/prepare_github_runner.sh` verifies hosted Linux x64, Docker
  availability and disk headroom; it **does not prune** host images or modify
  any private Docker context.
- GitHub runner disk size is platform-controlled. This change does **not**
  provision a 50 GiB disk, larger paid runners or any extra infrastructure.

## Validation gates

1. Run `python3 infra/ci/verify_github_runner_workflows.py` and
   `bash -n infra/ci/prepare_github_runner.sh`.
2. Verify the `ci-runner-policy` and impacted GitHub-hosted CI are PASS on
   the current PR head. Pending/queued jobs are not PASS.
3. Verify fresh `main` CI runs after merge. A passed PR check does not prove
   the post-merge push succeeded.
4. Treat synthetic UI/API tests as development verification only: staging
   deployment, role-authorized workflow and field release acceptance are
   separate checkpoints.

Historical Mac mini runner notes are kept in
`infra/ci/macmini-runner.md` for operation/reference. There is **no**
automatic stop, unregister, removal, disk cleanup, or credential mutation.
