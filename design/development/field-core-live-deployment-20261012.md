# Five-workflow entry and password-server deployment — 2026-10-12

## Running site

The user requested replacement of the Vite development server at `http://100.68.153.58:5190/` with a built site and an `admin` password account. The initial password was supplied separately, hashed by the existing scrypt credential adapter, and was never written to source files or deployment scripts.

The old address redirects to `https://automation-macmini.tail0e9ef7.ts.net:10001/`. The HTTPS address is available only within the existing Tailscale network. Existing MCP and other Tailscale forwarding rules were preserved.

The deployed UI source is commit `eb3e34bd8cb92d50db58d4d2f55291d01b3fc15f`. Static build output, rather than Vite dev/preview, is served from a separate release directory. The web build uses `VITE_DOUL_AUTH_MODE=password` and the default five-workflow scope. No browser-side authentication responses were mocked during live verification.

## Runtime and data

The non-demo API runs in the repository's `staging` environment with a persistent PostgreSQL snapshot adapter, a least-privilege database login, pinned RSA token verification, and the existing password adapter. Database migration, clean-foundation provisioning, connection validation and identity validation ran through the existing deployment functions. No operational gate was bypassed.

The initial foundation contains a setup-pending project, the administrator identity and role, and its administration organization. It contains no sample inspection, approval, payment, evidence, qualification or completed-workflow history. Synthetic/setup-pending metadata is retained. This is an operating server for preparation; it is **not an accepted real-field pilot or a completed production release**.

The administrator can sign in and inspect roles/create login credentials for already-provisioned identities. Project creation/editing, participant provisioning and role editing through the UI remain unimplemented. The project is therefore visibly named `DOUL 감리 · 프로젝트 설정 대기`; field use requires a properly configured project and participants.

The API and static web bind to private loopback ports 8795 and 6190. PostgreSQL and authenticated Redis bind to loopback ports 5841 and 6541 in dedicated containers and volumes. Their restart policies preserve the data. API, web and old-address redirect processes are registered as macOS user LaunchAgents with KeepAlive. They restart within the logged-in macOS user session; this does not guarantee availability while the machine is asleep or before user login.

Credentials, signing keys and the first database backup are outside Git in the private operational runtime directory. The old integration demonstration database was preserved and not relabeled as approved operational data. Media workers, legal signatures and report exporters are not activated by this deployment.

## Verified results

| Verification | Result |
| --- | --- |
| Default five-workflow browser suite on Mac mini | 29 passed |
| Password-login browser suite on Mac mini | 5 passed |
| Password HTTP, credential and deployment-mode unit tests | 7 passed |
| Web/mobile typecheck, web lint, UI boundary and password-mode build | Passed; existing lint warnings remain |
| Real HTTPS browser login as admin | Passed |
| Five field pages plus administrator page | Loaded without page errors or HTTP 5xx responses |
| Navigation | Five workflows plus Today; administrator additionally sees role administration |
| Read-only drawing entry | Official-version warning visible; upload controls absent |
| Unsupported full-menu URL | Returned to Today |
| Real HTTPS logout | Returned to login |
| Unauthenticated workspace and revoked-token workspace access | HTTP 401 |
| Demonstration-session endpoint | HTTP 404 |
| Incorrect password | HTTP 401; subsequent correct login passed |
| API restart and persisted account | Correct login passed after restart |
| Private PostgreSQL and authenticated Redis | Healthy |
| First database backup | Saved privately; full recovery acceptance not performed here |
| Real-field acceptance | Not performed |

## CI integration regression

The latest integration had restored paid hosted runners. The user's earlier instruction requires Mac mini CI. All 24 workflows now select the dedicated `[self-hosted, Linux, ARM64, doul-macmini]` runner, and pull-request jobs require same-repository branches. The runner-policy check, YAML parsing and shell syntax check pass. Preparation refuses unsupported runners and does not delete tools, containers or build caches.

Native Mac mini results above are distinct from GitHub Actions results. Queued or running Actions are not a pass; their final status must be checked separately before integration.
