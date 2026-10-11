# Mac mini CI runner

The repository's fifteen workflows keep their job names and verification steps.
They select `[self-hosted, Linux, ARM64, doul-macmini]`. One runner executes
jobs serially on the connected M4 Mac mini, using a dedicated Colima Linux VM
(profile `doul-ci`, 4 CPUs, 6 GiB RAM, 24 GiB Docker data disk).

The listener runs with `--once`: each job closes its GitHub session, then the
container restart policy starts the listener for the next job. Registration is
persistent. This avoids the observed listener getting stuck after cancelling
its Busy long-poll when a job finishes; completed jobs are not rerun.

The runner container uses Ubuntu 24.04 and the official ARM64 Actions runner
2.338.0, with the release archive's SHA-256 checked during its image build.
Docker service containers and Compose run in the VM. The runner uses host
networking inside that VM so published Redis/PostgreSQL ports remain reachable
at localhost. `/opt/doul-ci` is mounted at the same absolute path in the VM and
runner; workflow bind mounts therefore resolve to the actual checked-out files.
The existing Mac development checkouts and native browser caches are separate.

## Provision and register

On the Mac, with `gh` authenticated as a repository administrator:

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install colima docker docker-compose
colima start doul-ci --vm-type vz --arch aarch64 --cpu 4 --memory 6 \
  --disk 24 --runtime docker --activate=false
docker --context colima-doul-ci build -t doul-macmini-runner:2.338.0 \
  -f infra/ci/macmini-runner.Dockerfile infra/ci
docker --context colima-doul-ci run -d --name doul-ci-runner \
  --restart unless-stopped --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/doul-ci:/opt/doul-ci \
  doul-macmini-runner:2.338.0
gh api --method POST repos/bachelar-shy/DOUL_Supervision/actions/runners/registration-token \
  --jq .token | docker --context colima-doul-ci exec -i \
  -w /opt/doul-ci/runner doul-ci-runner /bin/bash -c '
    set -euo pipefail
    IFS= read -r registration_token
    ./config.sh --unattended --url https://github.com/bachelar-shy/DOUL_Supervision \
      --token "$registration_token" --name doul-macmini-m4-linux \
      --labels doul-macmini --work /opt/doul-ci/_work
  '
docker --context colima-doul-ci restart doul-ci-runner
```

Registration tokens flow over stdin and are not stored in scripts, images or
repository files. Runner credentials stay in the private VM directory. Do not
print `.credentials`, tokens, or raw runtime environment variables.

## Operation

```bash
colima --profile doul-ci status
docker --context colima-doul-ci logs --tail 40 doul-ci-runner
gh api repos/bachelar-shy/DOUL_Supervision/actions/runners \
  --jq '.runners[] | {name,status,busy,labels: [.labels[].name]}'
colima --profile doul-ci ssh -- df -h / /var/lib/docker
```

After a Mac restart, start this specific VM again; the container's restart policy
restarts its listener. The installed LaunchAgent `local.doul.ci-runner` runs
`/Users/automation/work/DOUL-ci-runtime/ensure-runner.sh` at login and every
60 seconds. It starts only this VM/container if unavailable and does not restart
a running listener. `macmini-ensure-runner.sh` is the versioned source for it.
This login agent requires the automation user to log in; it is not a pre-login
system daemon and does not guarantee execution while the Mac is powered off.
Do not use `brew services start colima`, which targets the default profile.
Use this dedicated Docker context for all maintenance. Never prune other
contexts or erase the user's development worktrees. Preserve failures and logs;
a queued job or online runner is not a passed check. Account restrictions may
still affect dispatch and must be checked against actual GitHub job results.

This is development CI, not production deployment or field acceptance.
