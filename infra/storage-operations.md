# 저장소 운영 기준 v1.0

이 문서는 DOUL Supervision의 **Platform 운영 기준**이다. Product/Functional의 업무 상태·권한·판정·종결조건을 새로 정의하지 않는다.

기준은 다음 Product invariant를 실행환경에서 보존하는 것이다.

- 원본 Evidence는 불변이다.
- 공식 기록은 물리 삭제로 업무 이력을 제거하지 않는다.
- 파생 Evidence는 불변 원본과 정확한 source range를 가진다.
- 공식 판정·출력은 source object ID/version/evidence를 재현할 수 있어야 한다.
- Platform 장애나 파일 처리 실패를 Domain 성공으로 바꾸지 않는다.

기계 판독 가능한 기준은 `infra/storage_policy_v1.json`에 둔다.

## 1. 저장 객체 구분

### Original Evidence

원본 업로드 바이트는 finalize 후 덮어쓰지 않는다.

필수 운영조건:

- SHA-256 서버 검증
- object/version 식별자 보존
- quarantine을 거친 뒤에만 공식 저장영역으로 승격
- 동일 key에 새 바이트를 덮어쓰지 않음
- Product/법정 정책을 우회하는 물리 삭제 금지

원본 수정이 필요하다는 요구는 기존 객체 변경이 아니라 새 버전/새 객체로 처리해야 하며, 정확한 업무 의미는 Product Contract가 결정한다.

### Derived Evidence

Frame, thumbnail, transcript 연계 파일 등 파생자료는:

- 원본 parent ID/version을 잃지 않는다.
- 시간범위/frame/source range를 보존한다.
- 파생 바이트에도 hash를 둔다.
- 원본과 파생자료를 같은 객체처럼 취급하지 않는다.

### Legal Original

법정기관·외부기관 원본은 DOUL 내부 생성물로 대체하지 않는다.

- 원본 version/checksum/source 보존
- 내부 Snapshot과 별도 식별
- 수정 대신 새 수신 version 연결

### Generated Snapshot

DOCX/PDF/HTML 등 생성 결과는 최소 다음을 재현할 수 있어야 한다.

- primary source object/version
- source payload hash
- template/version
- render hash

## 2. 업로드와 격리

운영상 권장 흐름은 다음과 같다.

```text
upload
  -> quarantine
  -> hash/MIME 검증
  -> security scan
  -> object finalize
  -> metadata commit
  -> reconciliation
```

`quarantine` 객체는 공식 Evidence로 간주하지 않는다.

시범운영 전에는 업로드 파일에 대한 악성파일/위험콘텐츠 검사를 실제 공급자 또는 승인된 검사도구에 연결해야 한다. 공급자 선정은 이 기준서에서 고정하지 않는다.

Hash 불일치, 검사 실패, finalize 실패가 발생하면 업무 성공 상태를 생성해서는 안 된다.

## 3. DB와 Object Storage 일관성

DB transaction과 S3-compatible Object Storage write는 하나의 원자 transaction이라고 가정하지 않는다.

따라서 Backend ObjectStoragePort 구현은 최소 다음을 지원해야 한다.

- staging/finalize
- idempotent finalize
- orphan 탐지
- reconciliation
- 재처리 시 동일 공식 object를 중복 생성하지 않는 식별

Reconciliation은 기술적 불일치를 복구할 수 있지만 Product 상태나 승인 결과를 임의로 성공 처리할 수 없다.

## 4. 접근제어

기본값은 private이다.

- 익명 공개 ACL/policy 금지
- 프로젝트 간 객체 접근 금지
- object 직접 접근도 기존 사용자/프로젝트 권한을 우회하지 않음
- 사람 계정과 Worker/service credential 분리
- URL 또는 로그에 credential 전체 노출 금지

CI에서 privacy-recovery를 시험하기 위해 임시 public policy를 만드는 것은 허용하지만, 해당 시험은 같은 실행에서 private 복구를 확인하고 데이터를 폐기해야 한다.

## 5. 보존과 삭제

Platform은 **보존기간 숫자를 임의로 정하지 않는다**.

보존기간은 프로젝트 설정팩, 법정요건, 계약조건 또는 회사 거버넌스 기준에서 version과 함께 전달되어야 한다.

Platform 책임은:

- 해당 policy version을 기록 가능하게 함
- 보존 대상의 조기 삭제 방지
- 공식 기록의 물리 삭제 금지 invariant 보존
- 비공식/임시 객체도 명시적 disposition policy 없이는 자동 삭제하지 않음

실제 보존기간이 미확정이면 이를 Product/거버넌스 결정사항으로 남기고 임의 기본값을 넣지 않는다.

## 6. 암호화와 전송

| 환경 | 전송 | 저장 |
| --- | --- | --- |
| Development | loopback 또는 TLS | 개발 Runtime 기준 |
| Validation/Staging | TLS 필수 | 암호화 필수 |
| Pilot | TLS 필수 | 암호화 필수 |
| Production | TLS 필수 | 암호화 필수 |

암호화 key, access key, secret은 repository에 저장하지 않는다.

Production 공급자·KMS·암호화 방식은 별도 배포설계에서 확정한다.

## 7. Backup / Restore

백업은 DB만 보존해서 완료된 것으로 보지 않는다.

필수 범위:

- PostgreSQL state/metadata
- Object Storage object/version
- 적용 configuration version
- secret recovery 절차
- 복구 후 hash/integrity 재검증

Pilot 전 실제 clean environment restore test가 필요하다.

RPO/RTO 숫자는 #46 Backup/Restore 작업에서 운영 책임자와 확정하며 이 문서가 임의 결정하지 않는다.

## 8. 관측과 감사 분리

System observability에서 최소 탐지할 사건:

- integrity failure
- quarantine/security-scan failure
- finalize failure
- access denied
- public policy detected
- orphan detected
- reconciliation failure
- storage capacity threshold

System Log는 업무 Audit Log를 대체하지 않는다.

Business Audit는 누가/언제/어떤 업무 version에 어떤 명령을 실행했는지의 기록이고, Platform Log는 서비스 상태·장애·성능을 위한 기록이다.

## 9. 구현 인수 조건

Object Storage Adapter 및 시범운영 저장환경은 최소 다음 시험을 통과해야 한다.

1. 원본 업로드 후 동일 object/version 바이트 불변
2. 서버 SHA-256 검증 실패 시 finalize 거부
3. quarantine 객체가 공식 Evidence 조회에 노출되지 않음
4. public/anonymous 접근 차단
5. 다른 프로젝트 object 접근 거부
6. metadata commit 실패 후 orphan 탐지/reconciliation
7. 재시도·중복 요청에서 공식 object 중복 생성 방지
8. 파생자료의 immutable parent/source range 재현
9. Backup 후 clean environment restore 및 hash 재검증
10. 장애 복구가 Domain 결과를 임의 성공으로 만들지 않음

현재 Development의 구체 저장소 제품은 운영 Product Contract가 아니다. Production 저장소 선정은 보안·보존·복구·비용·운영성 검증 후 별도로 결정한다.
