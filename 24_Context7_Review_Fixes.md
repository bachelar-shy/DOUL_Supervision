# 24. Context7 코드 리뷰 수정 검증

기준일: 2026-10-05 · 기준 커밋: `23163df` · 구현계약 v2.2

| 리뷰 결함 | 수정 동작 | 회귀검증 |
|---|---|---|
| 다른 시공사 조직의 필수 서명 | 서명 권한을 주 대상의 책임 조직·배치·자격에 연결 | 다른 조직 서명 거부, 책임 조직 서명 후 후속공정 허용 |
| 한 검수문서가 다른 검측까지 승인 | FM-09는 정확히 하나의 Inspection 주 대상·버전 보존 | 복수 대상 거부, 부가 출처 순서와 무관한 서명, 과거의 모호한 문서 거부 |
| 초안 보고서의 문서 경유 노출 | 조회·렌더·서명·HTTP가 원본과 동결 출처에 같은 읽기 검사 적용 | 대장·뷰·문서·HTML·직접 렌더 차단, 발행 후에도 과거 초안 보호 |
| 반려 검측 보완 불가 | request/resubmit에 자체검측·precheck·최신 기준/도면 참조 허용 | 보완 후 일정 확정, 결과·범위·Hold 변경 거부, 과거 버전 보존 |
| 관찰 이슈의 첫 시정 검증 불가 | 최초 주기에만 선행 검측 없는 검증 허용 | 최초 검증→서명→Issue 종결, 위조 선행 검측·주기·범위 거부 |
| 사진별 처리범위 과장 | 해당 사진의 visual 후보 또는 명시적 no_findings 결과 요구 | 다른 사진 결과 차용 거부, 결함 없는 사진 완료, 모델·출처·상충 결과 검사 |
| 빈 RFI 제출 | submit/resubmit의 질문·참조·기한 필수, 저장할 최종 자료 및 참조 프로젝트 검사 | 엔진·OpenAPI·HTTP에서 빈 제출 거부, 보완 재제출 성공 |

참조 시험 99개(기존 79개 + 추가 20개), HTTP/SQLite 시험 36개(기존 34개 + 추가 2개)를 실행한다. 기존 이슈 #1 검증서의 79개는 최초 해결 시점의 기록이다. 상태모델·전이·정책·관리대장·양식·API 경로 수는 유지한다.

```bash
python scripts/validate_contracts.py
python scripts/generate_api.py --check
python scripts/generate_types.py --check
python -m unittest discover -s tests -v
.venv/bin/python -m unittest discover -s tests_mvp -v
npm run typecheck
npm run lint --workspace apps/web
npm run web:build
```

PR CI는 위 검사에 브라우저 통합시험과 Android/iOS JavaScript 번들 검사를 더한다. 서명된 문서의 바이트·출처는 변경하지 않으며 주 대상이 없는 과거 스냅샷은 새로 렌더링한 뒤 서명해야 한다. 조건부 하도급 서명도 조직 제한을 우회하지 않는다.
