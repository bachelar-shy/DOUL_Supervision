# DOUL local-development API

`python -m services.api --demo`로만 실행한다. loopback 8791 포트와 합성자료를 사용한다.

- 기존 PR #2 `Engine`과 `Documents` 계약 재사용
- SQLite는 개발용 JSON snapshot adapter이며 normalized PostgreSQL 구현이 아니다.
- Dev session은 실제 사용자 인증이 아니다.
- 전자서명, AI, DOCX/PDF는 HTTP 501로 명시한다.
- 모든 증빙·업무 조회와 명령에 프로젝트 배치·유효기간·범위 검증 적용

상세는 `23_MVP_Code_Skeleton_and_Stitch.md` 참조.
