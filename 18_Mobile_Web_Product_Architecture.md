# 18. DOUL Supervision Mobile · Tablet · Web 제품구조

기준일: 2026-10-04
상태: v0.1 구현기준

## 1. 제품 원칙

Mobile-first가 아니라 **Field-first + Responsive**로 설계한다.

- Mobile: Capture / Fast Action
- Tablet: Field Review / Drawing / Inspection
- Desktop Web: Management / Reporting / Decision

업무규칙·상태·API는 공통으로 사용하고 화면구성만 기기와 역할에 맞게 달라진다.

## 2. 배포 구조

DOUL 내부 감리자는 Native App을 주 사용환경으로 한다.

외부 참여자:
- 시공사: Responsive Web/PWA 우선, 필요한 경우 Mobile App
- 발주처: Web 중심 + Mobile Lite
- 설계자: Web/Tablet 중심

WebView는 전체 앱의 기반이 아니라 일반 업무화면 재사용 수단으로 제한한다.

## 3. Native 우선 기능

- 사진·동영상 촬영
- 음성 녹음
- GPS
- QR / AprilTag
- AR
- 향후 Depth
- 대용량 Evidence 업로드
- Offline 저장·동기화

## 4. Responsive Web 우선 기능

- 대장·목록
- Issue / RFI / Change 상세
- 도면 검토
- 발주처 Dashboard
- 보고서 작성
- 의사결정·승인
- 문서관리
- 사용자·권한관리
- 통계·KPI

## 5. 공통 UX 규칙

Screen → Actor → Domain Object → State → Allowed Action → Required Evidence → Next State

색상만으로 상태를 표현하지 않는다.
현장 화면은 분석보다 행동과 예외를 우선한다.
Desktop은 다중정보 비교·관리·보고를 우선한다.

## 6. 역할별 화면

### SUP
오늘, 현장촬영, 검측, Observation 확인, Issue/NCR, 시정검토, 재검측, 보고

### CON
자체검측, 검측요청, 제출자료, 내 Issue, 시정조치, 재검측요청, RFI

### OWN
프로젝트 현황, 주요 Issue, 결정대기, 승인, 즉시보고, 정기보고

### DES
RFI, 설계검토, 변경정보, 개정도면

### ADM
프로젝트, 조직, RoleAssignment, Authority Matrix, Requirement Baseline, Template, 법정서식

## 7. Stitch 연결

Stitch는 Presentation / UI Design Source로 사용한다. 업무규칙의 우선순위는 Domain Model → State Machine → Authority Matrix → Requirement/Gate → API Contract → UI/Stitch다. 화면에 있는 버튼만으로 업무권한이나 판정규칙을 만들지 않는다.

현재:
- Project: DOUL Supervision MVP
- Project ID: 11486949689509673114
- Design System: DOUL Supervision
- Design System ID: assets/4105194232699724772
- 첫 화면: DOUL 감리 - 오늘
- Screen ID: cc94d5225c01416c9947c9f63db21ae1

Stitch 변경은 Domain/State/Authority와 대조한 뒤 코드에 반영한다.
