# DOUL Supervision 병렬 에이전트 실행 기록 v1

기준: 2026-10-07 / main 223bdfe7806e53c85df7fadbd967a5634e2b9edd
사용자 지시: 개발 진행, 작업 에이전트는 Luna, 개발에 Context7 적용.

## 실행 방식

사용자는 이 채팅방 하나를 창구로 사용한다. 총괄은 작업 분해·공통 계약·공통 파일·결과 검토·PR 통합을 관리한다. S1~S6는 gpt-6-luna 작업 에이전트에 배정했다. Mac mini MCP를 통해 실제 맥미니에서 작업한다. 원격 저장소는 GitHub bachelar-shy/DOUL_Supervision이다.

| 담당 | 브랜치 | 맥미니 worktree | 첫 구현 범위 |
|---|---|---|---|
| S0 | parallel/s0-integration-control-v1 | /Users/automation/work/doul-s0-integration | 계약·공통 접점·검증·PR 관리 |
| S1 | parallel/s1-drawing-document-v1 | /Users/automation/work/doul-s1-drawing | 기존 정확한 버전의 도면 참조 조회 |
| S2 | parallel/s2-evidence-media-v1 | /Users/automation/work/doul-s2-evidence | 제한된 메모리의 원본 객체 저장 어댑터·무결성 |
| S3 | parallel/s3-location-v1 | /Users/automation/work/doul-s3-location | 기존 위치 계약을 소비하는 계층 조회 |
| S4 | parallel/s4-work-inbox-v1 | /Users/automation/work/doul-s4-inbox | 기존 권한·명령 기반의 페이지별 업무함 조회 |
| S5 | parallel/s5-notification-deadline-v1 | /Users/automation/work/doul-s5-notification | 기존 수신자 알림 조회·읽음 의미 분리 |
| S6 | parallel/s6-business-workflow-v1 | /Users/automation/work/doul-s6-business | 기존 업무와 도면·위치·증빙·보고 참조 추적 |

## 충돌·자원 관리

- 현재 다른 UI 작업의 미커밋 변경 3개를 보존했다. 해당 원래 checkout의 브랜치를 바꾸거나 파일을 수정하지 않는다.
- main 확인 시 열린 PR 0개. 새 병렬 worktree 7개를 생성했다.
- 각 에이전트는 기능 전용 신규 모듈·시험만 작성한다. 공통 API·Engine·저장소·생성계약·잠금파일·Compose·UI 경계 변경은 S0가 조율한다.
- 에이전트는 자기 파일만 명시적으로 stage한다. 공유 저장소의 force push·reset·임의 정리는 하지 않는다.
- 기존 Python 가상환경을 재사용한다. venv/node_modules/전체 서버 환경을 개발축 수만큼 새로 설치하지 않는다. 집중 단위시험은 가볍게 수행하고 전체 통합·빌드·브라우저 시험은 총괄이 조율한다.
- 시작 시 맥미니 파일시스템 여유는 약 13GiB였다. 기존 worktree 삭제를 이번 작업 범위로 간주하지 않는다. 실제 설치·빌드 전 디스크 증가를 확인한다.

## Context7 적용

새 라이브러리/API 사용 또는 외부 동작이 불확실한 경우 Context7에서 공식 문서를 조회하고 저장소에 고정된 버전의 실제 API와 대조한다. 자체 계약/순수 Python 데이터 연산에는 외부 의존성을 억지로 추가하지 않는다. 공식 문서 확인과 실제 실행 검증을 구분한다.

조회 근거:
- boto3 /boto/boto3: binary file-like 업로드, TransferConfig의 기본 동시성 및 use_threads=False. https://github.com/boto/boto3/blob/develop/docs/source/guide/s3-uploading-files.rst 및 https://github.com/boto/boto3/blob/develop/docs/source/guide/s3.rst
- boto3 실제 단일 PUT 구현 확인: binary file Body, HEAD metadata, 객체 key의 기본 overwrite 의미. https://github.com/boto/boto3/blob/develop/docs/source/guide/quickstart.rst 및 https://github.com/boto/boto3/blob/develop/tests/functional/test_s3.py
- FastAPI /websites/fastapi_tiangolo: Query의 ge/le 숫자 검증 및 타입에 따른 query parsing. https://fastapi.tiangolo.com/tutorial/path-params-numeric-validations 및 https://fastapi.tiangolo.com/reference/parameters

## 완료 표현

브랜치/worktree 생성이나 모듈 단위시험 통과를 앱 기능의 저장·API·화면·현장 통합 완료로 표현하지 않는다. 실제 API 연결·권한·원본 저장·UI·Browser E2E·장애복구가 남으면 각각 미완료로 보고한다. 각 작은 PR에 완료 범위와 다음 연결을 남긴다.
