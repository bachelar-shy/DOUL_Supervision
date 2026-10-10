# Parallel Wave 1 실행 계약

기준선: integration/parallel-test-v1, main 6dbf11c 포함. 운영 main과 실제 데이터는 변경하지 않는다.

## 범위와 권한
- S1: PDF.js 6.4.299 번들 worker, 공식 Evidence 원본 PDF를 페이지별 렌더링. 20 MiB 업로드, 최대 8M canvas pixels, DPR 2. 정확한 Evidence.drawingRef 일치만 도면 연결로 표시한다. 도면 발행/현장 사용본 확정, OCR, 마크업, 오프라인은 후속 범위다.
- S2: 기존 업로드와 검증된 사용자 소유 격리 원본의 공식 Evidence 등록. checksum, MIME, 프로젝트/역할/범위, idempotency를 검사한다. 업무 연결은 기존 evidenceIds 명령을 통해 실행하며 등록 자체는 승인 의미가 아니다.
- S3: Location 관리 권한이 정식 matrix에 없으므로 demo=True에서 ADM/project_admin/render_document와 명시적 위치 범위가 충족될 때만 생성/이동/편집한다. 운영 권한을 신설하지 않는다. canonical validate, exact Drawing revision, pdf_points, 순환 방지, 버전 충돌, 감사 및 저장을 적용한다.
- S4: 서버 제공 work inbox/command/preflight를 사용한다. 명시적 사용자 입력 후 기존 execute 명령만 실행한다.
- S5: 저장된 감사 이벤트 중 exact source를 읽을 수 있는 활성 actor role의 이벤트만 본인에게 in_app queued로 생성한다. 채널 설명은 내 업무 변경이며 dueAt=event.at는 표시 대기 시점이고 계약상 기한이 아니다. event+recipient 중복을 제거한다. SLA 통지, 외부 발송, push, 이메일 전달은 별도 단계다. 읽음은 별도 지속 receipt이며 공식 acknowledged 상태를 변경하지 않는다. 조회/읽음마다 현재 원본 접근권한을 검사한다.
- S6: 선택한 SafetyStopOrder 정확 버전의 연결을 읽는다. 현재 버전과 일치하고 기존 preflight를 통과할 때만 기존 명령을 제공한다. OwnerReport 전송/중지 해제/재개를 자동 실행하지 않는다.

## 통합 완료 기준
각 작업은 별도 브랜치/워크트리에서 commit하고 integration에서 API composition과 UI facade를 연결한다. 권한/프로젝트 분리, 재시도, 충돌, 저장 재시작 및 핵심 브라우저 동작을 검사한다. UI boundary, typecheck, lint, build와 필요한 API tests를 실행한다. 테스트 결과와 미구현 범위를 함께 보고한다. 테스트 URL은 기존 Tailscale 내부 HTTPS 10002를 유지한다.

## 환경 제한
Mac mini M4 16GB에서 API/웹/DB를 공통 실행하며 agent별 서버는 띄우지 않는다. PDF 전체 페이지 canvas를 메모리에 적재하지 않는다. production requirements.lock을 사용한 환경 재현은 아직 검증되지 않았다. 별도 Mac 테스트 환경과 production 배포 검증을 구분한다.
