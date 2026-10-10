# 격리 업로드 재시도와 업무함 조회 비용 검증 v1 — #123·#124

## #123: 논리 업로드의 원본은 최초 확인된 한 객체로 유지

신규 격리 key는 `evidence/{projectId}/{uploadId}/original`이다. 원본 SHA-256은 완전한 bounded stream 검증 후 metadata/reference에 기록한다. 같은 project/upload ID에서 같은 SHA-256·길이·Content-Type의 재시도만 허용하며, 변경된 내용/표시는 UploadContentConflict로 거부한다. 새로운 내용을 올리려면 새로운 upload ID를 발급한다.

Boto3 어댑터는 모든 PUT에 IfNoneMatch=*를 사용한다. HEAD 후 무조건 PUT하는 방식이나 미지원 저장소에 대한 무조건 PUT 대체는 제공하지 않는다. 412/409, SDK 읽기·연결 시간초과, 서비스 시간초과, 5xx 결과에는 HEAD로 격리 분류·SHA-256 metadata·크기·타입을 대조해 확인된 VersionId를 재사용한다. 버전 미사용 버킷은 version_id=None으로 같은 slot을 재사용한다.

HEAD가 없거나 접근/확인이 불가능하면 UploadReconciliationRequired를 반환한다. 잘못된 내용·분류·크기는 conflict다. 권한 거부 등 다른 원격 오류는 ObjectStorageError이며 기존 객체가 있다고 성공으로 바꾸지 않는다. 결과 불명 시 객체를 자동 삭제하지 않는다. 재시도는 같은 조건부 쓰기를 사용한다.

HEAD metadata 대조는 원격 원본 바이트의 재검증을 대신하지 않는다. 기존 open_verified는 정확한 VersionId의 원본을 bounded read로 다시 SHA-256/크기 검증한 후에만 노출한다. MIME 실측·보안 검사·인간 검토·공식 Evidence 등록과 폐기 Gate는 유지된다. ETag를 SHA-256으로 취급하지 않는다.

로컬 demo 저장소는 업로드별 cross-process 파일 잠금(macOS/Linux fcntl)으로 최초 저장을 직렬화하고, 같은 원본 재시도는 blob/sidecar를 교체하지 않는다. 변경 내용은 HTTP 409, 불완전한 저장/metadata 및 확인 불가 상태는 HTTP 503으로 구분한다. 프로젝트와 actor 격리를 유지하고 key의 프로젝트를 저장소 scope와 대조한다.

업로드 응답에 quarantineKey를 추가했다. 클라이언트는 서버가 발급한 key 또는 목록의 key를 사용하며, SHA-256으로 경로를 추측하지 않는다. 기존 해시 경로 객체는 조회·등록·검증을 계속 지원한다. 로컬에서는 이미 사용한 legacy upload ID에 새 slot을 자동 생성하지 않는다. S3 도입/이전 시에도 기존 ID를 재사용하지 않고 새 ID를 사용하며, 기존 원격 객체를 일괄 이동/삭제하는 migration은 수행하지 않는다.

조건부 쓰기는 활성 격리 객체가 보관되고 다른 writer가 무조건 덮어쓰지 않는 규약에서 유효하다. 삭제 marker/수명정책으로 현재 객체가 사라진 뒤에는 조건부 PUT이 다시 성공할 수 있다. 폐기 Gate를 지난 ID의 재시도 금지는 해당 업로드 업무원장이 맡아야 한다. 이 어댑터에는 삭제·격리 해제·공식증빙 전환 기능을 추가하지 않았다.

회귀: 매 성공 PUT마다 새 VersionId를 만드는 fake에서 동일 재시도, 8개 동시 재시도, 서로 다른 내용의 경쟁, 저장 전/후 시간초과, 확인 불가 HEAD, 409, metadata 충돌, 프로젝트 격리, 버전 없는 버킷, 정확한 이전 VersionId 읽기를 검증했다. 고정된 실제 boto3/botocore SDK의 Stubber로 IfNoneMatch/HEAD 인자와 VersionId 처리도 검사했다. 실제 원격 S3/RustFS의 운영 시험 결과로 표시하지 않는다.

## #124: 탐색용 읽기와 응답 원본 복사를 분리

Engine.iter_work_inbox_records(project_id, machines)를 조회 어댑터 경계로 추가했다. 현재 구현은 프로젝트와 기계를 먼저 거른 뒤 lazy read-only Mapping/Sequence view를 제공한다. guard는 중첩 원본을 수정할 수 없다. 장비 사용 가능 상태의 현재 읽기 파생값은 Engine.get과 같은 계산 경로를 사용하며 역사 버전의 의미는 유지한다.

build_work_inbox는 limit+1 후보만 보관하는 heapq.nsmallest로 페이지를 선택한다. 현재 API가 제공하는 has_candidates는 기존 권한/상태 규칙으로 후보 여부만 판단하고, engine.get 및 상세 preflight는 선택한 페이지에서만 수행한다. 반환 자료는 독립 사본이며, 페이지에서 권한과 version/정렬값을 다시 확인한다. 요청 중 version/정렬/scope가 바뀌면 VERSION_CONFLICT로 재조회를 요구한다.

호환 호출에서 has_candidates가 없으면 정확한 후보 총수를 위해 기존 preflight를 전체 후보에 실행해야 한다. 이 경우에도 전수 원본 deep copy와 전체 후보 payload 보관은 제거했다. 현재 API는 has_candidates 경로를 사용한다. 이 차이를 숨기거나 호환 경로의 모든 연산이 페이지 크기로 제한된다고 주장하지 않는다.

계약:
- total은 해당 요청의 현재 role에서 읽기와 후보 여부를 모두 통과한 전체 건수다.
- 정렬은 updatedAt(createdAt 대체) 내림차순, 전역적으로 유일한 id 오름차순이다. 유효하지 않은 legacy 시각은 뒤로 정렬한다.
- cursor는 마지막 updatedAt/id 이후의 live keyset 경계이며 여러 요청에 걸친 고정 snapshot이 아니다.
- 변경된 자료가 경계를 넘으면 다음 페이지에서 누락/재등장할 수 있다. 역할/검색 조건 변경 또는 전체 최신 목록이 필요하면 cursor 없이 다시 조회한다.
- 반환 version과 commandCandidates.expectedVersion은 해당 페이지의 현재 읽기/preflight를 따른다. 실제 실행은 기존 version/authority guard를 다시 적용한다.
- 현재 API의 store transaction 아래에서 조회한다. 향후 persistence adapter는 같은 격리·권한 의미를 유지해야 한다.

정확한 total을 위해 후보 권한 탐색은 여전히 O(N)이다. 후보 보관은 O(limit), 선택 비용은 O(N log(limit+1)), 투영 계층의 원본 조회/응답 사본은 페이지 크기만큼이다. 읽기 어댑터를 project index/필요 권한 필드 조회로 대체할 확장 경계를 제공했으며 별도 DB/index를 이미 구현했다고 주장하지 않는다.

현재 DataStore.transaction의 상태 load/rollback 사본과 상세 command-preview의 Engine 복제 비용은 별도다. 이번 투영 모형 측정은 이를 포함하지 않으며 전체 API의 CPU/메모리 비용이 O(limit)이 되었다는 의미가 아니다.

## 검증 기록 — 2026-10-08

- Python: `/Users/automation/work/dependency-cache/7f788163d5a13c941c3f0ed1acddd2ec862403934947de423565638a3c7d015b/bin/python`, 3.12.13, macOS ARM64.
- production lock SHA-256: `28a03caa3f56730428cf987a7b77e6b358c77487a5fccf621eb423d4698ddad4`; 실제 설치 목록 대조와 pip check 통과.
- 계약/단위 294개 통과. API 336개 통과(외부 서비스 등 35개 skip).
- 신규 versioned S3/SDK 회귀 16개, 업무함 비용/읽기/권한/cursor 회귀 8개, 로컬 업로드 API 회귀 5개 포함.
- 실제 API의 SUP/CON/OWN/DES/ADM 역할별 두 페이지 결과는 기존 authoritative preflight 경로와 동일함을 검증.
- 3,500건·limit=1: 원본 get 1회, 상세 preflight 1회. 투영 모형 중앙값 약 5.09ms, CPU 5.09ms, 추가 Python 할당 peak 11,742bytes.
- 50,000건·limit=1: 원본 get 1회, 상세 preflight 1회. 투영 모형 중앙값 약 72.08ms, CPU 72.08ms, 추가 Python 할당 peak 11,862bytes.
- 위 시간은 3회 측정 중앙값이다. 단순화한 guard/preflight와 공유 중첩 원본 payload를 사용한 투영 함수 모형이며, source 구성·실제 권한 의존 조회·Engine preview 복제·API transaction·DB IO·프로세스 RSS/SDK 메모리를 제외한다.
- UI/Browser E2E와 실제 외부 객체 저장소 운영 성능을 이 변경에서 검증한 것으로 표시하지 않는다.

재현:
```sh
export DOUL_TEST_PYTHON=/Users/automation/work/dependency-cache/7f788163d5a13c941c3f0ed1acddd2ec862403934947de423565638a3c7d015b/bin/python
npm run test:contracts
npm run test:api
python3 scripts/dependency_environment.py --python "$DOUL_TEST_PYTHON" -- \
  '{python}' scripts/benchmark_work_inbox.py --output .local/inbox-benchmark.json
```

기계 판독 기록: design/verification/issues123124-validation.json, design/verification/work-inbox-issue124-benchmark.json.

Context7 및 확인한 공식 문서:
- https://github.com/boto/boto3/blob/develop/tests/functional/test_s3.py
- https://github.com/boto/boto3/blob/develop/s3/inject.py
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- https://github.com/python/cpython/blob/main/Doc/library/heapq.rst

수정은 integration/parallel-test-v1에 이슈별 커밋으로 반영한다. main 병합·이슈 종료는 별도 단계다.
