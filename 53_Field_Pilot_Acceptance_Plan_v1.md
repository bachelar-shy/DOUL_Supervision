# 53. Field Pilot Acceptance Plan v1.0

기준일: 2026-10-06
상태: Pilot 준비기준 — 대상 프로젝트는 Project Configuration Pack에서 확정

## 1. 목적

시범운영을 “앱이 켜진다” 수준이 아니라 실제 감리·시공사·발주처 업무가 시작부터 종결까지 수행되는지 검증한다.

## 2. Pilot 착수조건

- Project Configuration Pack 검증 PASS
- 실제 SUP·CON·OWN 계정 및 RoleAssignment 준비
- DES·ADM 역할과 권한도 검증대상에 포함
- 핵심 자격/유효기간 등록
- Project/Package/Location/Discipline 범위 확정
- 발주처 P1~P4 보고선과 수신자/기한 확정
- 적용 DOUL 양식과 법정 원본식별
- Backup/Restore 책임과 장애연락선 확정
- 미디어 기능 사용 시 Provider/반출/보존/비용 정책 확정

## 3. 필수 Pilot 시나리오

최소:
- AC-Q-01 품질 Closed Loop
- AC-S-01 안전 Stop/Resume
- AC-SCH-01 공정/EOT/Baseline
- AC-PAY-01 물량/기성/지급
- AC-HO-01 Commissioning/Handover/Warranty
- AC-MEDIA-01 미디어 분석(미디어 기능 활성화 시)
- AC-AUTH-01 다른 프로젝트 접근차단
- AC-QUAL-01 자격만료
- AC-ADM-01 ADM 기술권한 차단
- AC-VERSION-01 버전충돌
- AC-IDEMP-01 중복요청
- AC-STORE-01 저장소 장애
- AC-WORKER-01 Worker 장애(Worker 기능 활성화 시)
- AC-REPORT-01 발주처 후속조치 종결 분리
- AC-OFFLINE-01 모바일 재연결 충돌

## 4. 역할별 인수

SUP: 공식 검토·판정·Issue·재검측·보고·종결이 권한과 Evidence 기준대로 수행된다.

CON: 제출·검측요청·시정·재검측요청·공정/기성 제출이 가능하되 SUP/OWN 권한을 넘지 않는다.

OWN: 보고수령·Decision·Payment/Handover 등 계약권한을 수행하며 receipt와 approval이 분리된다.

DES: RFI/설계응답·Revision을 수행하되 Change/비용 승인권한을 임의 취득하지 않는다.

ADM: 기준정보·문서행정·수령/배포를 지원하되 기술판정이 차단된다.

## 5. 완료판정

각 시나리오는 `contract_confirmed → backend_api_implemented → ui_connected → integration_passed → pilot_verified` 단계를 기록한다.

Pilot 완료는 필수 시나리오가 `pilot_verified`이고, 남은 결함이 업무종결·권한·감사추적·Evidence 보존을 막지 않는다는 Product/현장 인수판정이 있을 때만 선언한다.

단순 시연 성공, CI 성공, Worker heartbeat, 화면 렌더링 성공만으로 Pilot 완료를 선언하지 않는다.

## 6. Pilot Evidence

- 프로젝트/config version
- 앱 build/commit
- 실제 역할 배치(민감정보 제외 식별가능한 참조)
- 테스트 업무 ID/version
- 실행 command/result
- 화면/로그/문서 Snapshot
- 발견결함과 우회 여부
- 최종 인수판정

## 7. Baseline Feedback

Pilot에서 발견된 문제가 업무 Contract 의미를 바꿔야 해결되는 경우 `48_Product_Baseline_Change_Control_v1.md`로 회수한다. 구현결함은 해당 Backend/UI/Platform backlog로 처리한다.

## 8. 실제 파일 기반 사용성 평가

현장에서 현재 사용하는 건축·구조·기계·전기 PDF, BOQ, 공정표와 현장사진을 제공받아 평가한다. 각 파일의 원본 해시, 도면번호·개정, 공종·위치, BOQ 행·단위·통화, 공정 활동 ID·기준선, 사진 촬영일·위치를 확인한다. 누락되거나 해석되지 않는 정보는 임의로 채우지 않고 입력 결함으로 기록한다.

권한을 가진 실제 사용자가 화면에서 원본을 업로드하고, 재조회·다운로드·버전 참조·프로젝트 접근차단을 검증한다. 파일 내용을 확인한 후 관리대장별 발생 가능한 업무 사례를 만들며, 사례마다 PDF 페이지, BOQ 행, 공정 활동 또는 사진의 정확한 원본 참조를 남긴다. 제안한 시험 사례를 실제 발생한 현장 사건으로 기록하지 않는다.

품질·안전·공정/계약·물량/지급·준공/인수인계 시나리오에 자료를 연결하고 역할별로 실행한다. 한국어·베트남어·영어별 과업 완료 여부, 소요시간, 입력 오류, 이해하기 어려운 용어와 사용자 의견을 기록한다. 결함의 심각도·수정·재시험 근거를 인수 기록에 연결한다.

현재 실제 파일 및 현장 사용자 입력은 제공되지 않았다. 합성 자료를 사용한 자동시험은 이 평가의 완료 근거로 사용하지 않는다.
