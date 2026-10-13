# 원본 PDF 장별 도면 검증 — 읽기 전용 회귀검사

## 목적
이미 등록된 원본 PDF의 장별 인덱스, 정확한 SHA256, 이미지 생성, 별도 원본
Evidence 연결과 도면정보 검수 상태를 회귀 검사한다. 마크업·도면번호를 변경하거나
원본을 다시 업로드하지 않는다.

## 입력
프로젝트별로 비공개 JSON 파일을 준비한다. 공식 승인 상태는 추론하지 않는다.
예시 JSON:
    {
      "projectId": "test-project-id",
      "sources": [
        {
          "fileName": "actual-original-architecture.pdf",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "pages": 145,
          "expectEvidenceReuse": true
        },
        {
          "fileName": "actual-original-mep.pdf",
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "pages": 53,
          "expectEvidenceReuse": false
        }
      ]
    }

실제 등록된 53장 설비 원본이 39장/14장으로 나뉜 경우 반드시 각각 기입한다.
SHA256과 파일명은 기존 원본 Evidence/등록자료에서 확인한 값을 사용한다.

## 실행
인증된 역할의 짧은 수명 토큰을 환경변수 DOUL_QA_ACCESS_TOKEN으로 설정하고,
내부 또는 HTTPS 테스트 서버에 요청한다. 토큰을 인자로 직접 넘기거나
리포트에 기록하지 않는다.

    python scripts/verify_drawing_originals.py --api-url https://staging.example.test/api --manifest private-originals.json --origin https://staging.example.test --report local-originals-qa.json --workers 3

## 통과 조건
1. PDF 원본 이름·SHA256이 정확히 일치하고 프로젝트별 원본 인덱스가 중복되지 않는다.
2. 장별 번호가 1부터 누락 없이 연속이며 모두 ready 상태다.
3. 각 페이지 썸네일과 미리보기 JPEG 모두 인증된 GET으로 조회·검증된다.
4. 인간 검수 완료 수, 자동 추출 후보, 중복 도면번호를 결과에 별도 집계한다.
   자동 추출 성공을 사람 확인, 개정 승인, 시공용 발행으로 해석하지 않는다.
5. 현재 프로젝트의 다른 합성 시험용 도면은 보고서에서 분리해 집계한다.

PDF 내부 페이지 내용이 시각적으로 완전히 일치하는지 별도 검토
(1/중간/마지막 페이지 원본 렌더 이미지 해시 대조)가 추가로 필요하다.
리포트는 현장 인수 승인서를 대체하지 않는다.
