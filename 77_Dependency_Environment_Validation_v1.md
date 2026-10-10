# 의존성 환경 재사용 및 검증 v1 — #113

## 실행 규칙

임의의 기존 venv를 재사용하지 않는다. Python 캐시 키는 선택한 고정파일의 원문 SHA-256과 Python 구현·정확한 버전·OS·아키텍처로 계산한다. 같은 키의 작업트리는 하나의 환경을 공유한다. requirements가 바뀌면 새 키의 환경을 준비한다. 사용 중인 환경에 추가 설치하거나 구버전 환경을 덮어써서 동기화하지 않는다.

`scripts/prepare_dependency_environment.py`는 같은 키의 설치를 디렉터리 임대로 직렬화하고, 새 환경을 설치한 뒤 실제 설치 목록과 `pip check`를 검증한다. 기존 캐시도 매번 다시 검증한다. 실패한 환경은 재사용하지 않으며 자동으로 덮어쓰지 않는다. 설치 중인 키는 다른 설치자가 실패하고 재시도하도록 안내한다.

`scripts/dependency_environment.py`는 고정파일의 정확한 버전, 누락, 선언하지 않은 패키지, 중복 distribution, virtualenv 여부를 확인한다. pip/setuptools/wheel만 설치 도구로 허용한다. psycopg[binary]의 psycopg-binary도 확인한다. pip check만으로 정확한 lock 일치를 판단하지 않는다. 지원하지 않는 range/marker/extra 형식은 명시적으로 실패하며, 추가 의존성은 완전한 exact pin으로 고정한다.

캐시 manifest는 참고 기록이며 실제 설치 검사를 대신하지 않는다. 실패 시 종료코드 2로 끝나고 이후 시험 명령을 실행하지 않는다. `--suite contracts|api|all` 또는 `-- {python} ...`로 검증과 실행을 한 명령에 묶는다. PYTHONPATH/PYTHONHOME을 제거하고 선택한 interpreter로 Python suite를 실행한다.

## Node 및 자원 원칙

Node 검사는 package-lock SHA-256, workspace manifest SHA-256, 실제 설치 버전, 현재 worktree의 workspace 링크, npm ls의 missing/invalid/extraneous 문제를 확인한다. npm ls가 0으로 끝나도 problems를 확인한다. 설치되지 않은 optional 패키지는 허용한다. 기록에 Node/npm 버전과 설치 목록 지문을 남긴다.

node_modules를 다른 worktree에 연결하면 workspace 링크가 다른 소스를 가리킬 수 있으므로 lock hash만 같다고 재사용하지 않는다. 실제 링크와 설치 검사를 모두 통과해야 한다. 불일치 시 실행 중인 공유 node_modules에 npm ci를 실행하지 않는다. 별도 검증 checkout에 한 번 npm ci를 수행하거나 사용자가 없는 환경의 설치를 S0가 조율한다.

`npm run test:contracts`와 `npm run test:api`는 Python 사전 검사를 거친다. `npm run typecheck`와 `npm run web:build`는 Node 사전 검사를 자동 실행한다. CI도 설치 직후 Python/Node 검사 후 같은 venv interpreter로 계약/API 검사를 수행한다.

16GB 장비에서 전체 서비스 환경을 개발축 수만큼 복제하지 않는다. 같은 Python 키는 공유하고 서버·DB·Redis·객체 저장소는 기존 격리 원칙을 유지한다. 무거운 설치·전체 빌드·브라우저 시험은 동시 1건으로 조율한다. 이번 검증은 서버를 추가 기동하지 않았으며 기존 API/Vite 실행 환경을 수정하지 않았다.

## 사용 예

저장소 루트에서 base Python을 명시해 준비한다.

```sh
python3 scripts/prepare_dependency_environment.py \
  --python /Users/automation/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12 \
  --cache /Users/automation/work/dependency-cache
```

출력된 JSON의 python 경로를 선택한다. 이번 production 검증 경로는 다음과 같다.

```sh
export DOUL_TEST_PYTHON=/Users/automation/work/dependency-cache/7f788163d5a13c941c3f0ed1acddd2ec862403934947de423565638a3c7d015b/bin/python
npm run test:contracts
npm run test:api
npm run check:dependencies
npm run typecheck
npm run web:build
```

Node 명령은 검사에 통과하는 해당 worktree의 설치에서 실행한다. 기존 통합 worktree의 node_modules는 현재 불일치하므로 위 Node 검사는 실패하는 것이 정상이다. 이번 깨끗한 Node 검증 checkout은 `/Users/automation/work/doul-issue113-verification`이다.

독립 실행의 증거를 보존하려면 `--report .local/dependency-S3-api.json`처럼 작업별 경로를 지정한다. 기본 기록은 `.local/dependency-environment.json`이며 종료보고에는 그 기록의 executable·version·lock_sha256·inventory_sha256을 복사한다.

기존 `requirements.mac-test.lock`은 FastAPI stack을 다른 환경에서 상속하던 부분을 제거하고 전체 정확한 버전을 고정했다. Python 3.9.6 재현용 프로필이며 `--lock requirements.mac-test.lock`으로 명시적으로 선택할 때만 사용한다. 결과에는 explicit-alternate로 표시한다. production requirements.lock을 기본값으로 유지하고 구버전 환경에 맞춰 변경하지 않았다.

## 2026-10-08 검증

- Production lock SHA-256: `28a03caa3f56730428cf987a7b77e6b358c77487a5fccf621eb423d4698ddad4`
- Python: 위 DOUL_TEST_PYTHON 경로, 3.12.13, macOS ARM64.
- Node lock SHA-256: `defaa1629dc2080ef243497b53d5e3f319f9dedf85ce9562361e788ed629a517`
- Node/npm: 26.5.0 / 12.0.2. CI 설정의 Node 24 실행 결과로 표시하지 않는다.
- 통합 source: `f15990b` + 이번 변경. 두 worktree에서 동일 Python 캐시·설치 지문으로 계약 270개, API 331개 통과(API 35개 skip).
- main source: `6dbf11c7f59855185059c3de9698658f773a672f`. 별도 두 worktree에서 동일 캐시·설치 지문으로 계약 191개, API 243개 통과(API 35개 skip). 기존 main worktree는 수정하지 않았다.
- 회귀 8개 통과: 정확한 버전·누락·오염·중복·extra·hash 변경·optional Node·workspace 링크·실패 후 시험 실행 차단·Node 전용 검사로 Python suite 우회 차단.
- 기존 통합 Python/Node 환경은 모두 종료코드 2로 차단. 새 production Python 환경과 npm ci 설치는 모두 사전 검사 통과.
- 새 Python 3.9.6 테스트 전용 캐시는 전체 대체 lock 검사 통과. 기존 상속 venv는 중복 distribution으로도 거부되며 이를 production 통과로 표시하지 않는다.
- 웹/모바일 typecheck와 웹 production build 통과. 빌드의 기존 500kB chunk 경고는 유지된다.
- 외부 서비스가 필요한 skip 항목, Browser E2E, Linux CI 실행을 이 변경에서 검증한 것으로 표시하지 않는다.

원본 결과를 요약한 기계 판독 증거: `design/verification/dependency-environment-issue113.json`.

Context7로 확인한 공식 문서:
- https://pip.pypa.io/en/stable/cli/pip_check/
- https://pip.pypa.io/en/stable/reference/inspect-report/
- https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-ci.md
- https://github.com/npm/cli/blob/latest/lib/commands/ls.js

#113 수정은 integration/parallel-test-v1 브랜치에 반영한다. main 병합과 이슈 종료는 별도 단계다.
