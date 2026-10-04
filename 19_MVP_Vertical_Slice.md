# 19. DOUL Supervision MVP Vertical Slice

기준일: 2026-10-04
상태: v0.1

## 1. 목적

문서·모듈을 넓게 추가하기보다 하나의 핵심 업무를 Mobile/Web에서 끝까지 실행 가능하게 만든다.

## 2. Golden Path

시공사 자체검측
→ 검측요청
→ 감리 접수·완전성 확인
→ 감리 현장검측
→ Evidence 수집
→ AI Observation Candidate
→ 감리 확인
→ Issue/NCR
→ 시공사 시정
→ 재검측 요청
→ 감리 재검측
→ 종결
→ 발주처 보고
→ A4/법정문서 생성

## 3. MVP 화면

### Supervisor Mobile
SUP-TODAY-M / SUP-INSPECTION-M / SUP-CHECKLIST-M / SUP-CAPTURE-M / SUP-OBSERVATION-M / SUP-ISSUE-M / SUP-CORRECTION-REVIEW-M / SUP-REINSPECTION-M / SUP-ISSUE-CLOSE-M

### Contractor Responsive
CON-TODAY-R / CON-SELF-INSPECTION-R / CON-INSPECTION-REQUEST-R / CON-ISSUE-R / CON-CORRECTIVE-ACTION-R / CON-REINSPECTION-REQUEST-R

### Owner Web
OWN-DASHBOARD-W / OWN-MAJOR-ISSUES-W / OWN-DECISION-W / OWN-REPORT-W

### Designer Web
DES-RFI-W / DES-DESIGN-RESPONSE-W

### Admin Web
ADM-PROJECT-W / ADM-USERS-ROLES-W / ADM-AUTHORITY-W / ADM-REQUIREMENT-BASELINE-W

## 4. 구현순서

1. Project / Party / RoleAssignment / Authority
2. Requirement / Drawing / Location
3. Inspection / Evidence
4. Observation
5. Issue / Action
6. Reinspection / Closure
7. Owner Report / Decision / Approval
8. DocumentSnapshot / A4 render
9. Offline conflict handling
10. Drawing spatial mapping
11. AI assist

AI가 없어도 1~8은 완전하게 작동해야 한다.

## 5. Command API 원칙

상태값 직접 PATCH보다 업무명령을 우선한다.

예:
- POST /inspections/{id}/start
- POST /inspections/{id}/complete
- POST /observations/{id}/confirm
- POST /issues/{id}/assign
- POST /issues/{id}/corrective-actions
- POST /issues/{id}/request-reinspection
- POST /issues/{id}/close

모든 명령은 RoleAssignment, current state, version, required evidence, Requirement/Gate를 검증한다.

## 6. 완료조건

- Contractor가 공식 Issue를 Close할 수 없음
- A/Hold Point 우회 불가
- Observation Candidate가 사람 확인 없이 Issue가 되지 않음
- 재검측 실패 시 correction cycle 보존
- 발주처 결정 필요사항이 Owner queue에 나타남
- 동일 데이터에서 A4/법정문서 출력 가능
- 모든 공식 transition에 AuditEvent 생성
- Offline stale update가 최신 상태를 덮어쓰지 않음
