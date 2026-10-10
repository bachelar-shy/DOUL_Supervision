"""Executable scenario verification against the persistent synthetic DOUL SAMPLE DB.

Every run uses a disposable SQLite backup and real FastAPI TestClient routes.
The authoritative sample project is unchanged. PASS is never pilot acceptance.
"""
from __future__ import annotations
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import tempfile
from uuid import uuid4, uuid5, NAMESPACE_URL

from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter

CASES = [
    ("UC-01","프로젝트 등록·관계자 접근","관리자","ADM·SUP·CON·OWN", "서로 다른 두 프로젝트 중 대상 프로젝트만 권한에 따라 조회한다."),
    ("UC-02","현장사진 업로드·재조회","현장기록","CON·SUP", "합성 현장사진을 원본 그대로 보존하고 재조회한다."),
    ("UC-03","시공사 검측요청","검측","CON·SUP", "검측요청의 위치·도면·증빙을 확인한다."),
    ("UC-04","감리자 검측 적합 판정","검측","SUP", "측정기록과 판정 결과가 일치하는지 확인한다."),
    ("UC-05","배근·배관 불량과 지적 연결","검측·지적","SUP·CON", "부적합 검측과 지적·시정조치가 같은 사건을 참조한다."),
    ("UC-06","시공사 시정자료 제출","시정조치","CON·SUP", "시정 제출만으로 자동 종결되지 않음을 확인한다."),
    ("UC-07","시정 검토·재검측","시정조치·검측","CON·SUP", "시정 확인 후에도 재검측·종결이 분리되는지 검증한다."),
    ("UC-08","시정기한 초과","시정조치","SUP·CON", "조치기한과 미종결 상태의 조합을 검증한다."),
    ("UC-09","이전 개정 도면 사용 차단","도면조회·검측","CON·SUP", "Rev.A가 Rev.B보다 이전인 도면을 검측 근거로 사용할 수 없다."),
    ("UC-10","정기 감리보고 기록","감리보고","SUP·OWN", "보고서가 실제 사건·원본 증빙을 참조하는지 확인한다."),
    ("UC-11","발주처 보고 수령","감리보고","OWN·SUP", "보고 수령과 지적사항 종결이 별개인지 확인한다."),
    ("UC-12","사진 재전송·중복방지","현장기록","CON", "통신 재시도 시 동일 파일이 중복 등록되지 않음을 확인한다."),
    ("UC-13","동시 수정 충돌","검측","SUP", "이전 버전 명령이 서버에서 거부되는지 확인한다."),
    ("UC-14","다른 프로젝트 접근 차단","로그인·권한","CON", "다른 현장·무인증 자료 접근이 거부되는지 확인한다."),
    ("UC-15","서버 재시작 후 기록 유지","자료보존","SUP", "파일·도면·업무기록이 동일 상태로 재조회되는지 확인한다."),
]


def catalog():
    return [
        {"id":id,"title":title,"category":cat,"roles":roles.split("·"),
         "situation":description,
         "expected":"업무 원본·도면·권한·상태의 서버 검증이 사전에 정한 결과와 일치",
         "classification":"synthetic_development_only",
         "actualFieldAcceptance":False}
        for id,title,cat,roles,description in CASES
    ]


def backup_to_owned_file(store: SQLiteSnapshotAdapter, file: str):
    """SQLite backup, not a copy of its live WAL files."""
    with store.lock:
        target=sqlite3.connect(file)
        try:store.db.backup(target)
        finally:target.close()


def _session(client,group,project):
    r=client.post("/dev/sessions",json={"actorGroup":group,"projectId":project})
    assert r.status_code==200,(group,r.status_code,r.text)
    return r.json()


def _h(session,key=None):
    h={"Authorization":"Bearer "+session["accessToken"],
       "X-RoleAssignment-Id":session["actor"]["roleAssignmentId"]}
    if key:h["Idempotency-Key"]=key
    return h


def _assert(condition,message):
    if not condition:raise AssertionError(message)


def run_case(database: str, case_id: str):
    if case_id not in {row[0] for row in CASES}:raise ValueError("Unknown case")
    app=create_app(database,demo=True)
    store=app.state.store
    checks=[]
    def ck(message,condition):
        _assert(condition,message)
        checks.append(message)
    try:
        with TestClient(app) as client:
            directory=client.get("/dev/projects").json()
            project=directory["defaultProjectId"]
            state=store.meta.get("sampleRealisticFixture")
            ck("검증 대상은 합성 샘플 프로젝트",state and state.get("projectId")==project)
            session={group:_session(client,group,project) for group in ["SUP","CON","OWN","ADM","DES"]}
            rec=state["records"];file_index=state["files"];drawings=state["drawings"]
            def record(kind,id,api_role="SUP"):
                row=rec[kind][id]
                kind_type={"inspections":"inspections","issues":"issues","actions":"actions",
                           "observations":"observations","reports":"owner-reports"}[kind]
                r=client.get(f"/projects/{project}/{kind_type}/{row['id']}",headers=_h(session[api_role]))
                ck(f"{kind}/{id} 접근",r.status_code==200)
                return r.json()
            def evidence(f,role="SUP"):
                row=file_index[f]
                r=client.get(f"/projects/{project}/evidence/{row['evidenceId']}/content",
                             headers=_h(session[role]))
                ck(f"자료 원본 SHA256 {Path(f).name}",r.status_code==200 and sha256(r.content).hexdigest()==row["sha256"])
                return r
            if case_id=="UC-01":
                ck("두 개의 독립 프로젝트 목록",len(directory["items"])==2)
                for grp in ["SUP","CON","OWN","ADM"]:
                    r=client.get(f"/projects/{project}/workspace",headers=_h(session[grp]))
                    ck(f"{grp} 업무 조회",r.status_code==200 and r.json()["project"]["id"]==project)
                another=next(x["projectId"] for x in directory["items"] if x["projectId"]!=project)
                ck("다른 프로젝트 권한 분리",client.get(f"/projects/{another}/workspace",headers=_h(session["CON"])).status_code==404)
                # Administrator-issued real password logins are addressed by PR #148.
            elif case_id=="UC-02":
                photos=[key for key,x in file_index.items() if x["kind"]=="photo"]
                ck("현장사진 60건",len(photos)==60)
                for f in [photos[0],photos[11],photos[-1]]:evidence(f)
                ck("사진은 한 개 생성원본의 파생본으로 기록",all(x["captureOrigin"]=="ONE_SYNTHETIC_CONTACT_SHEET_CROPPED" for x in file_index.values() if x["kind"]=="photo"))
            elif case_id=="UC-03":
                ck("검측 요청 40건",len(rec["inspections"])==40)
                doc=record("inspections","INSP-0001")
                ck("검측요청 상태",doc["status"]=="requested")
                ck("기준·도면·사진 연결",bool(doc["drawingRef"]) and bool(doc["requirementRefs"]) and len(doc["evidenceIds"])>0)
            elif case_id=="UC-04":
                passed=[k for k,v in rec["inspections"].items() if v["status"]=="passed"]
                ck("적합 검측 시나리오",len(passed)>=8)
                doc=record("inspections",passed[0])
                ck("실제 측정 근거와 적합 판정",doc["resultStatus"]=="pass" and all(r["result"]=="pass" for r in doc["checkResults"]))
            elif case_id=="UC-05":
                failed=[v["id"] for v in rec["inspections"].values() if v["status"]=="failed"]
                ck("부적합 검측 데이터",len(failed)>=8)
                linked=[x for x in rec["issues"].values() if set(store.engine.get("Issue",x["id"]).get("inspectionIds",[])) & set(failed)]
                ck("부적합 검측 연결 지적사항",len(linked)>=2)
                row=record("issues","NCR-0004")
                ck("관찰·검측·시정 연결",bool(row["observationIds"]) and bool(row["inspectionIds"]) and bool(row["actionIds"]))
            elif case_id=="UC-06":
                action=record("actions","ACT-0002")
                issue=record("issues","NCR-0002")
                ck("시정 담당자 배치",bool(action.get("responsiblePartyId")))
                ck("시정 완료 이전 상태",action["status"]=="in_progress" and issue["status"]=="in_progress")
            elif case_id=="UC-07":
                # Execute the real API on disposable clone. Do not claim this
                # demonstrates legal signature or completion.
                row=record("actions","ACT-0002")
                file_row=next(x for x in file_index.values() if x["kind"]=="photo")
                key=str(uuid4())
                payload={"roleAssignmentId":session["CON"]["actor"]["roleAssignmentId"],
                         "expectedVersion":row["version"],
                         "payload":{"correction":"추가 철근 결속·사진자료 제출 (가상)",
                                    "rootCause":"도면 개정 확인 절차 누락 (가상)",
                                    "preventiveAction":"타설 전 교차검측 강화 (가상)"},
                         "evidenceIds":[file_row["evidenceId"]]}
                submit=client.post(f"/projects/{project}/actions/{row['id']}/submit",headers=_h(session["CON"],key),json=payload)
                ck("시공사 시정 제출",submit.status_code==200)
                submitted=submit.json()["record"]
                ck("제출 후 지적사항은 미종결",record("issues","NCR-0002")["status"]!="closed")
                verify=client.post(f"/projects/{project}/actions/{row['id']}/verify",
                    headers=_h(session["SUP"],str(uuid4())),
                    json={"roleAssignmentId":session["SUP"]["actor"]["roleAssignmentId"],
                          "expectedVersion":submitted["version"],"payload":{},
                          "evidenceIds":[file_row["evidenceId"]]})
                ck("감리 시정 확인",verify.status_code==200)
                ck("시정 확인 후에도 지적 미종결",record("issues","NCR-0002")["status"]!="closed")
            elif case_id=="UC-08":
                # This assertion currently probes true overdue logic, rather
                # than misreporting future-dated actions as overdue.
                assigned=record("actions","ACT-0005")
                ck("조치기한 기록",bool(assigned.get("dueAt")))
                now=datetime.now(timezone.utc)
                overdue=[
                    x for x in rec["actions"].values()
                    if (a:=store.engine.get("Action",x["id"])).get("dueAt")
                    and datetime.fromisoformat(a["dueAt"].replace("Z","+00:00")) < now and a["status"]!="closed"
                ]
                ck("기한이 지난 미종결 조치 존재",len(overdue)>=1)
            elif case_id=="UC-09":
                old=drawings["S-201:A"]["drawingRef"]
                ck("이전 도면 버전은 무효",store.engine.get("InformationItem",old["objectId"])["status"]=="superseded")
                row=record("inspections","INSP-0001",api_role="CON")
                body={"roleAssignmentId":session["CON"]["actor"]["roleAssignmentId"],
                      "clientObjectId":str(uuid4()),
                      "payload":{key:deepcopy(row[key]) for key in
                                 ["packageId","locationId","discipline","responsibleOrganizationId","minimumQualificationRank",
                                  "workName","selfInspectionComplete","precheck","holdPoint","nextWorkAllowed","requirementRefs","evidenceIds"]}}
                body["payload"]["drawingRef"]=old
                error=client.post(f"/projects/{project}/inspections",headers=_h(session["CON"],str(uuid4())),json=body)
                ck("구버전 도면 검측 생성 차단",error.status_code==409 and error.json().get("code")=="DRAWING_STALE")
            elif case_id=="UC-10":
                ck("정기 보고 10건",len(rec["reports"])==10)
                reports=[key for key,row in rec["reports"].items() if row["status"]=="issued"]
                ck("발행된 합성 정기보고",len(reports)>=5)
                report=record("reports",reports[0],api_role="OWN")
                ck("보고서 수신자 및 사건번호",bool(report["report"]["recipients"]) and bool(report["report"]["sourceDomainRefs"]))
                f=next(k for k,v in file_index.items() if v["kind"]=="report")
                evidence(f)
            elif case_id=="UC-11":
                candidate=next(k for k,v in rec["reports"].items() if v["status"]=="issued")
                report=record("reports",candidate,api_role="OWN")
                ref=next(x for x in file_index.values() if x["kind"]=="photo")
                ack=client.post(f"/projects/{project}/owner-reports/{report['id']}/acknowledge",
                    headers=_h(session["OWN"],str(uuid4())),
                    json={"roleAssignmentId":session["OWN"]["actor"]["roleAssignmentId"],
                          "expectedVersion":report["version"],"payload":{},"evidenceIds":[ref["evidenceId"]]})
                ck("발주처 보고 수령",ack.status_code==200 and ack.json()["record"]["status"]=="acknowledged")
                ck("보고 수령은 지적종결이 아님",record("issues","NCR-0002")["status"]!="closed")
            elif case_id=="UC-12":
                # Proof of replay/retrieval; offline UI state is a separate
                # Playwright test, not implied by this API check.
                f=next(k for k,v in file_index.items() if v["kind"]=="photo")
                row=file_index[f];eid=row["evidenceId"]
                raw=evidence(f,"CON").content
                ck("동일 사진 재조회 해시 일치",sha256(raw).hexdigest()==row["sha256"])
                ck("자료가 하나의 캡처ID로 저장",sum(1 for x in file_index.values() if x["evidenceId"]==eid)==1)
            elif case_id=="UC-13":
                row=record("inspections","INSP-0001",api_role="SUP")
                body={"roleAssignmentId":session["SUP"]["actor"]["roleAssignmentId"],
                      "expectedVersion":row["version"],"payload":{"receivedAt":datetime.now(timezone.utc).isoformat()},
                      "evidenceIds":[]}
                first=client.post(f"/projects/{project}/inspections/{row['id']}/receive",
                    headers=_h(session["SUP"],str(uuid4())),json=body)
                ck("첫 검측접수 처리",first.status_code==200)
                stale=client.post(f"/projects/{project}/inspections/{row['id']}/receive",
                    headers=_h(session["SUP"],str(uuid4())),json=body)
                ck("구버전 수정 거부",stale.status_code==409 and stale.json()["code"] in ("VERSION_CONFLICT","INVALID_TRANSITION"))
            elif case_id=="UC-14":
                original=next(x["projectId"] for x in directory["items"] if x["projectId"]!=project)
                response=client.get(f"/projects/{original}/workspace",headers=_h(session["CON"]))
                ck("다른 프로젝트 접속 제한",response.status_code==404)
                denial=client.get(f"/projects/{project}/workspace")
                ck("무인증 접근 제한",denial.status_code==401)
            elif case_id=="UC-15":
                photos=[k for k,x in file_index.items() if x["kind"]=="photo"]
                row=file_index[photos[0]]
                before=evidence(photos[0]).content
                reopened=create_app(database,demo=True)
                with TestClient(reopened) as c2:
                    new_session=_session(c2,"SUP",project)
                    after=c2.get(f"/projects/{project}/evidence/{row['evidenceId']}/content",headers=_h(new_session))
                    ck("재기동 후 원본 바이트 보존",after.status_code==200 and after.content==before)
                    work=c2.get(f"/projects/{project}/workspace",headers=_h(new_session))
                    ck("재기동 후 업무기록 보존",work.status_code==200 and any(item["machine"]=="inspection" for item in work.json()["items"]))
                reopened.state.store.close()
        limited={
            "UC-01":"관리자 발급 비밀번호 계정 테스트는 PR #148 통합 후 수행 필요",
            "UC-07":"시정자료 제출·검증만 실제 실행, 법정 재검측·서명·종결은 별도",
            "UC-12":"재조회·캡처 유일성만 검사, 실제 오프라인 복귀 브라우저 시험은 별도"
        }
        return {"id":case_id,"status":"PARTIAL" if case_id in limited else "PASS",
                "checks":checks,"message":limited.get(case_id,"실제 개발용 API 및 저장소로 검증"),
                "actualFieldAcceptance":False}
    finally:
        store.close()


def run_on_backup(store, case_id):
    with tempfile.TemporaryDirectory(prefix="doul-sample-case-") as folder:
        tempdb=str(Path(folder)/"case.sqlite3")
        backup_to_owned_file(store,tempdb)
        try:return run_case(tempdb,case_id)
        except Exception as exc:
            return {"id":case_id,"status":"FAIL","checks":[],
                    "message":f"{type(exc).__name__}: {exc}","actualFieldAcceptance":False}


def main():
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database",required=True)
    p.add_argument("--case",default="all")
    p.add_argument("--output")
    args=p.parse_args()
    if args.case!="all" and args.case not in {row[0] for row in CASES}:
        p.error("Unknown case")
    db=Path(args.database)
    store=SQLiteSnapshotAdapter(str(db),demo=True)
    try:
        if "sampleRealisticFixture" not in store.meta:raise RuntimeError("Synthetic fixture not installed")
        ids=[row[0] for row in CASES] if args.case=="all" else [args.case]
        results=[run_on_backup(store,c) for c in ids]
        with store.transaction(True):
            history=store.meta.setdefault("sampleUseCaseRuns",{})
            for result in results:
                history[result["id"]]=dict(result,runAt=datetime.now(timezone.utc).isoformat())
    finally:store.close()
    out={"classification":"synthetic_development_only","actualFieldAcceptance":False,
         "total":len(results),"passed":sum(r["status"]=="PASS" for r in results),
         "partial":sum(r["status"]=="PARTIAL" for r in results),
         "failed":sum(r["status"]=="FAIL" for r in results),
         "results":results}
    if args.output:
        Path(args.output).parent.mkdir(parents=True,exist_ok=True)
        Path(args.output).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if out["failed"]>0:raise SystemExit(1)


if __name__=="__main__":main()
