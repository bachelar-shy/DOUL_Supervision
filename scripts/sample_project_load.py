"""Register coherent, synthetic WWT construction records through genuine FastAPI routes.

This is a fixture loader, not a database reset. It never uses a deployment store
and cannot run against an existing database without its verified owner marker.
File upload is the SAME resumable Evidence HTTP flow used by web clients.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys
from uuid import NAMESPACE_URL, uuid5

from fastapi.testclient import TestClient

from scripts.sample_project_registry import register, TRADES
from scripts.sample_project_materials import LOCATIONS, INSPECTION_TYPES
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter

ROOT=Path(__file__).resolve().parents[1]
VERSION="realistic-wwt-v1"
GROUPS=("CON","SUP","DES","ADM","OWN")
FIELDS=("packageId","locationId","discipline","responsibleOrganizationId","minimumQualificationRank")
UNITS={"ARC":"architecture","STR":"structure","MEP":"mechanical","ELE":"electrical"}


def stable(project: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL,f"DOUL:SAMPLE:{project}:{key}"))


def must(response, operation: str, statuses=(200,201)):
    if response.status_code not in statuses:
        raise AssertionError(f"{operation}: HTTP {response.status_code} {response.text[:650]}")
    return response.json()


def setup(db: str):
    store=SQLiteSnapshotAdapter(db,demo=True)
    try:return register(store)
    finally:store.close()


def load(db: str, material_dir: Path, limit: int|None=None, fixtures=True) -> dict:
    if not material_dir.is_dir(): raise FileNotFoundError(material_dir)
    manifest=json.loads((material_dir/"manifest.json").read_text(encoding="utf-8"))
    assert manifest["classification"]=="SYNTHETIC_NOT_SITE_EVIDENCE"
    setup(db)
    app=create_app(db,demo=True)
    store=app.state.store
    try:
        with TestClient(app) as client:
            directory=must(client.get("/dev/projects"),"list projects",(200,))
            project=directory["defaultProjectId"]
            assert len(directory["items"])==2 and any(x["sample"] and x["projectId"]==project for x in directory["items"])
            with store.transaction(True):
                marker=store.meta.get("mockProjectSetup")
                assert marker and marker.get("key")=="mock-usability-project-v1"
                assert marker["projectId"]==project
                storage=store.meta.setdefault("sampleRealisticFixture",{})
                if storage and storage.get("version")!=VERSION:
                    raise RuntimeError("Unknown sample fixture version; refusing overwrite")
                storage.setdefault("version",VERSION)
                storage.setdefault("projectId",project)
                storage.setdefault("files",{})
                storage.setdefault("drawings",{})
                storage.setdefault("records",{"inspections":{},"observations":{},"issues":{},"actions":{},"reports":{}})
                storage.setdefault("sourceHash",manifest["sourceSha256"])
                if storage["sourceHash"]!=manifest["sourceSha256"]:raise RuntimeError("Sample photo provenance changed")
                project_scope=store.meta["scope"]
                locations=deepcopy(store.meta["sampleLocations"])
                requirements=storage.setdefault("requirements",{})
                # Only fixture-owned reference requirements may be bootstrapped.
                for code,loc,disc,label in [
                    (f"{trade}-{place}",place,UNITS[trade],title)
                    for trade,title,subjects in (
                        ("ARC","건축 마감·치수",[]),("STR","콘크리트·배근",[]),
                        ("MEP","배관·설비",[]),("ELE","전기설비",[]))
                    for place in locations
                ]:
                    refid=stable(project,"requirement:"+code)
                    if ("Requirement",refid) not in store.engine._records:
                        store.engine.bootstrap("Requirement",dict(id=refid,projectId=project,
                            kind="contract",title=f"[SYNTHETIC] {label}: {loc}",
                            effectiveFrom="2026-08-01T00:00:00Z",status="active",
                            requiredFields=["dimension"],packageId=project_scope["packageId"],
                            locationId=locations[loc],discipline=disc,
                            responsibleOrganizationId=project_scope["responsibleOrganizationId"],
                            minimumQualificationRank=1))
                        marker["owned"].append(["Requirement",refid])
                    requirements[code]=dict(objectType="Requirement",objectId=refid,version=1)
            sessions={group:must(client.post("/dev/sessions",json={"actorGroup":group,"projectId":project}),"login "+group,(200,))
                      for group in GROUPS}
            def headers(group, key=None):
                session=sessions[group]
                data={"Authorization":"Bearer "+session["accessToken"],
                      "X-RoleAssignment-Id":session["actor"]["roleAssignmentId"]}
                if key:data["Idempotency-Key"]=key
                return data

            def ledger():
                with store.transaction():
                    return deepcopy(store.meta["sampleRealisticFixture"])

            def remember(kind,key,value):
                with store.transaction(True):
                    store.meta["sampleRealisticFixture"][kind][key]=value

            def upload(entry, kind):
                key=entry["file"]
                current=ledger()["files"].get(key)
                if current:
                    if current["sha256"]!=entry["sha256"]:raise RuntimeError(f"Material changed after upload: {key}")
                    return current
                data=(material_dir/key).read_bytes()
                actual=sha256(data).hexdigest()
                if actual!=entry["sha256"]:raise RuntimeError("Asset hash changed: "+key)
                mime="image/png" if kind=="photo" else "application/pdf"
                doc_name=Path(key).name
                original_kind = "photo" if kind=="photo" else "document"
                if kind=="drawing":
                    disc=UNITS[entry["discipline"]]
                    location_key = {"ARC":"A-2F-C","STR":"A-2F-B","MEP":"WWT-P01","ELE":"B-CTRL"}[entry["discipline"]]
                elif kind=="report":
                    disc="architecture";location_key="A-GF"
                else:
                    photo_index=int(entry["sourcePanel"][1:])-1
                    disc=UNITS[("STR","MEP","ARC","ELE")[photo_index%4]]
                    location_key=("A-2F-B","WWT-P01","A-RF","B-CTRL")[photo_index%4]
                cap=stable(project,"file:"+key)
                start_body=dict(roleAssignmentId=sessions["CON"]["actor"]["roleAssignmentId"],
                    captureId=cap,fileName=doc_name,mimeType=mime,byteCount=len(data),
                    expectedHash=actual,sourcePartyId=sessions["CON"]["actor"]["partyId"],
                    mediaType=original_kind,
                    capturedAt=(entry.get("capturedAt")
                        or (entry.get("date") or entry.get("day") or "2026-09-01")+"T08:30:00+07:00"),
                    discipline=disc,packageId=project_scope["packageId"],locationId=locations[location_key])
                base=f"/projects/{project}"
                started=must(client.post(base+"/uploads",json=start_body,
                                         headers=headers("CON",stable(project,"upload-start:"+key))),
                            "upload start "+key)
                upload_id=started["id"]
                if started["offset"]<len(data):
                    offset=started["offset"]
                    for part in range(offset,len(data),4*1024*1024):
                        chunk=data[part:part+4*1024*1024]
                        must(client.put(base+f"/uploads/{upload_id}/chunks",content=chunk,
                                        headers={**headers("CON",stable(project,f"chunk:{key}:{part}")),
                                                 "Upload-Offset":str(part),"Content-Type":"application/octet-stream"}),
                            "upload chunk "+key,(200,))
                completed=must(client.post(base+f"/uploads/{upload_id}/complete",
                                            json=dict(roleAssignmentId=sessions["CON"]["actor"]["roleAssignmentId"],expectedHash=actual),
                                            headers=headers("CON",stable(project,"complete:"+key))),
                               "upload finish "+key)
                assert completed["id"]==cap and completed["fileHash"]==actual and completed["projectId"]==project
                content=client.get(base+f"/evidence/{cap}/content",headers=headers("SUP"))
                if content.status_code!=200 or sha256(content.content).hexdigest()!=actual:
                    raise AssertionError("Original evidence verification failed: "+key)
                result=dict(file=key,evidenceId=completed["id"],version=completed["version"],
                            sha256=actual,kind=kind,location=location_key,discipline=disc,
                            captureOrigin="ONE_SYNTHETIC_CONTACT_SHEET_CROPPED" if kind=="photo" else "GENERATED_FICTIONAL_DOCUMENT")
                remember("files",key,result)
                return result

            files=manifest["drawings"]+manifest["photos"]+manifest["reports"]
            if limit is not None:files=files[:limit]
            total=Counter()
            for i,entry in enumerate(files,1):
                kind="drawing" if entry in manifest["drawings"] else "photo" if entry in manifest["photos"] else "report"
                record=upload(entry,kind)
                total[kind]+=1
                if kind=="drawing":
                    code=entry["code"];rev=entry["revision"];identity=f"{code}:{rev}"
                    existing=ledger()["drawings"].get(identity)
                    if existing:
                        continue
                    older=ledger()["drawings"].get(f"{code}:A") if rev=="B" else None
                    predecessor=(older or {}).get("drawingRef") if older else None
                    drawing_body={"objectId":stable(project,"drawing:"+identity),
                                  "title":f"{code} | {entry['title']} | REV.{rev} [SYNTHETIC]",
                                  "revision":rev,
                                  "evidenceRef":dict(objectType="Evidence",objectId=record["evidenceId"],version=record["version"]),
                                  "predecessorRef":predecessor,"requestReview":False}
                    response=must(client.post(f"/projects/{project}/parallel/drawing-sources",
                                              json=drawing_body,headers=headers("DES",stable(project,"register-drawing:"+identity))),
                                  "create drawing source "+identity)
                    remember("drawings",identity,{
                        "drawingRef":dict(objectType="InformationItem",objectId=response["drawing"]["id"],version=response["drawing"]["version"]),
                        "evidenceId":record["evidenceId"],"bindingId":response["binding"]["id"],
                        "current":rev=="B" or (f"{code}:B" not in [f"{d['code']}:{d['revision']}" for d in manifest["drawings"]])
                    })
                if i%10==0:print(f"[sample upload] {i}/{len(files)} complete: {dict(total)}",flush=True)

            if fixtures and (limit is None or limit>=len(manifest["drawings"])+len(manifest["photos"])+len(manifest["reports"])):
                create_scenarios(client,store,project,sessions,headers,manifest,locations,material_dir)

            with store.transaction():
                data=deepcopy(store.meta["sampleRealisticFixture"])
            return dict(projectId=project,uploaded=Counter(x["kind"] for x in data["files"].values()),
                        drawingRefs=len(data["drawings"]),
                        records={k:len(v) for k,v in data["records"].items()},
                        userRoles=list(sessions),sourceHash=data["sourceHash"],actualFieldAcceptance=False)
    finally:
        store.close()


def create_scenarios(client,store,project,sessions,headers,manifest,locations,material_dir):
    """Use exactly the same public machine create/command routes as a field client."""
    from app.reference.engine import uid
    base=f"/projects/{project}"
    def data():
        with store.transaction():return deepcopy(store.meta["sampleRealisticFixture"])
    def save(kind,key,result):
        with store.transaction(True):
            store.meta["sampleRealisticFixture"]["records"][kind][key]=result
    def create(collection,machine,group,key,payload):
        current=data()["records"][collection].get(key)
        if current:return current
        body={"roleAssignmentId":sessions[group]["actor"]["roleAssignmentId"],
              "clientObjectId":stable(project,machine+":"+key),"payload":payload}
        created=must(client.post(base+"/"+{"inspections":"inspections","observations":"observations",
                                            "issues":"issues","actions":"actions","reports":"owner-reports"}[collection],
                                 headers=headers(group,stable(project,"create:"+machine+":"+key)),
                                 json=body),"create "+machine+" "+key)
        result={"id":created["record"]["id"],"version":created["record"]["version"],
                "status":created["record"]["status"]}
        save(collection,key,result)
        return result
    def command(collection,group,key,action,payload=None,evidence=None):
        record=data()["records"][collection][key]
        b={"roleAssignmentId":sessions[group]["actor"]["roleAssignmentId"],"expectedVersion":record["version"],
           "payload":payload or {},"evidenceIds":evidence or []}
        route={"inspections":"inspections","observations":"observations",
               "issues":"issues","actions":"actions","reports":"owner-reports"}[collection]
        response=must(client.post(base+f"/{route}/{record['id']}/{action.replace('_','-')}",
                                  json=b,headers=headers(group,stable(project,f"command:{collection}:{key}:{action}"))),
                      f"{key}:{action}")
        item=response["record"];save(collection,key,{"id":item["id"],"version":item["version"],"status":item["status"]})
        return item
    # The fixture reproduces the resulting approved/superseded field reference
    # condition, NOT a legal approval event. This development-only setup is
    # equivalent to the original demo.py approved-drawing baseline.
    with store.transaction(True):
        index=store.meta["sampleRealisticFixture"]["drawings"]
        log=store.meta["sampleRealisticFixture"].setdefault("fictionalDrawingApprovalBaseline",{})
        for identity,entry in index.items():
            drawing=store.engine._records[("InformationItem",entry["drawingRef"]["objectId"])]
            desired="approved" if entry["current"] else "superseded"
            if drawing["status"]!=desired:
                drawing["status"]=desired
                for snapshot in [key for key in store.engine._history
                                 if key[:2]==("InformationItem",drawing["id"])]:
                    store.engine._history[snapshot]=deepcopy(drawing)
            log[identity]={"status":desired,"simulated":True,
                "notLegalApproval":True,"reason":"Development fixture approved/superseded reference state"}
    state=data()
    target_fixtures=state["records"]
    location_ref=locations
    files=state["files"];drawings=state["drawings"];requirements=state["requirements"]
    scope=store.meta["scope"]
    for idx in range(40):
        key=f"INSP-{idx+1:04d}"
        disc,desc,loc,case,code=INSPECTION_TYPES[idx%10]
        trade=UNITS[disc]
        photo=manifest["photos"][(idx*3)%len(manifest["photos"])]
        evidence=files[photo["file"]]["evidenceId"]
        drawing=drawings[f"{code}:B" if f"{code}:B" in drawings else f"{code}:A"]["drawingRef"]
        requested_date="2026-10-15T10:00:00Z" # future to support request validity
        initial=dict(packageId=scope["packageId"],locationId=location_ref[loc],
                     discipline=trade,responsibleOrganizationId=scope["responsibleOrganizationId"],
                     minimumQualificationRank=1,
                     workName=f"[SAMPLE] {key} / {desc}",
                     selfInspectionComplete=True,holdPoint=True,nextWorkAllowed=False,
                     precheck={k:True for k in ["drawing","material","test","previous","change"]},
                     requirementRefs=[requirements[f"{disc}-{loc}"]],drawingRef=drawing,
                     evidenceIds=[evidence])
        if key not in target_fixtures["inspections"]:
            create("inspections","inspection","CON",key,initial)
        state=data()["records"]["inspections"][key]["status"]
        if state=="draft":
            command("inspections","CON",key,"request",
                    {"requestedAt":store.engine.at(),"requestedInspectionAt":requested_date},[evidence])
        if idx%4 in (1,2,3):
            state=data()["records"]["inspections"][key]["status"]
            if state=="requested":command("inspections","SUP",key,"receive",{"receivedAt":store.engine.at()})
            state=data()["records"]["inspections"][key]["status"]
            if state=="completeness_review":command("inspections","SUP",key,"schedule",{"scheduledAt":store.engine.at()})
        # Keep half the workflow cases open for follow-up and late reporting.
        if idx%4 in (2,3):
            state=data()["records"]["inspections"][key]["status"]
            if state=="scheduled":command("inspections","SUP",key,"start")
            state=data()["records"]["inspections"][key]["status"]
            if state=="in_progress":
                value=(122 if idx%4==3 else 120)
                command("inspections","SUP",key,"submit_results",{
                    "checkResults":[{"itemId":"dimension",
                                     "requirementRef":requirements[f"{disc}-{loc}"],
                                     "result":"fail" if idx%4==3 else "pass",
                                     "evidenceIds":[evidence],"measuredValue":value,"unit":"mm"}]
                },[evidence])
            state=data()["records"]["inspections"][key]["status"]
            if state=="result_pending":
                command("inspections","SUP",key,"fail" if idx%4==3 else "pass",{"failureReason":"측정값 122 mm / 합성 허용기준 120 mm 재확인 필요"} if idx%4==3 else {},[evidence])
        if idx%8==0:print(f"[sample records] {idx+1}/40 inspections",flush=True)

    for idx in range(15):
        key=f"NCR-{idx+1:04d}"
        _,desc,loc,case,code=INSPECTION_TYPES[idx%10]
        disc=INSPECTION_TYPES[idx%10][0];trade=UNITS[disc]
        matched=manifest["photos"][(idx*4)%len(manifest["photos"])]
        evidence=files[matched["file"]]["evidenceId"]
        assigned=sessions["CON"]["actor"]["partyId"]
        organization=scope["responsibleOrganizationId"]
        common=dict(packageId=scope["packageId"],locationId=locations[loc],
                    discipline=trade,responsibleOrganizationId=organization,
                    minimumQualificationRank=1,evidenceIds=[evidence])
        obs=f"OBS-{idx+1:04d}"
        if obs not in data()["records"]["observations"]:
            create("observations","observation","SUP",obs,{**common,
                "source":"supervisor","description":f"[SAMPLE] {key} / {desc}: 상세 현장 확인 필요",
                "grounding":[{"evidenceId":evidence,"channel":"visual","claimSupport":"observed"}]})
        if data()["records"]["observations"][obs]["status"]=="candidate":
            command("observations","SUP",obs,"begin_review")
        if data()["records"]["observations"][obs]["status"]=="under_review":
            command("observations","SUP",obs,"confirm",
                    {"verificationNote":"합성 측정기록 검토 완료. 실제 현장검측·법정판정 아님."},[evidence])
        issue_title=f"[SAMPLE] {key} / {desc} / 확인 및 시정 필요"
        if key not in data()["records"]["issues"]:
            create("issues","issue","SUP",key,{**common,"subtype":"NCR","title":issue_title,
                  "observationIds":[data()["records"]["observations"][obs]["id"]],
                  "actionIds":[],"inspectionIds":[data()["records"]["inspections"][f"INSP-{(idx%40)+1:04d}"]["id"]],
                  "correctionCycle":0})
        action_key=f"ACT-{idx+1:04d}"
        if action_key not in data()["records"]["actions"]:
            create("actions","action","SUP",action_key,{**common,
                  "title":f"[SAMPLE] {action_key} / {desc} 시정조치",
                  "relatedIssueId":data()["records"]["issues"][key]["id"]})
        if data()["records"]["actions"][action_key]["status"]=="draft":
            command("actions","SUP",action_key,"assign",{
                "responsiblePartyId":assigned,"responsibleOrganizationId":organization,
                "dueAt":"2026-10-20T10:00:00Z"})
        if idx%5 in (1,2,3,4) and data()["records"]["actions"][action_key]["status"]=="assigned":
            command("actions","CON",action_key,"start")
        if data()["records"]["issues"][key]["status"]=="open":
            command("issues","SUP",key,"assign",{
                "responsiblePartyId":assigned,"responsibleOrganizationId":organization,
                "dueAt":"2026-10-20T10:00:00Z",
                "actionIds":[data()["records"]["actions"][action_key]["id"]]})
        if idx%5 in (1,2,3,4) and data()["records"]["issues"][key]["status"]=="assigned":
            command("issues","CON",key,"start_correction")

    # Deliberately overdue open action for UC-08. Created with the same public
    # create/assign API, not a direct status patch or retroactive audit rewrite.
    overdue="ACT-OVERDUE-001"
    if overdue not in data()["records"]["actions"]:
        issue_key="NCR-0005"
        linked_issue=store.engine.get("Issue",data()["records"]["issues"][issue_key]["id"])
        overdue_scope={field:linked_issue[field] for field in
            ["packageId","locationId","discipline","responsibleOrganizationId","minimumQualificationRank"]}
        create("actions","action","SUP",overdue,{**overdue_scope,
            "title":"[SAMPLE] ACT-OVERDUE-001 / 기한초과 시정조치",
            "relatedIssueId":linked_issue["id"],
            "evidenceIds":linked_issue.get("evidenceIds",[])})
    if data()["records"]["actions"][overdue]["status"]=="draft":
        command("actions","SUP",overdue,"assign",{
            "responsiblePartyId":sessions["CON"]["actor"]["partyId"],
            "responsibleOrganizationId":scope["responsibleOrganizationId"],
            "dueAt":"2026-09-24T10:00:00Z"})
    if data()["records"]["issues"]["NCR-0005"]["status"]=="in_progress":
        linked_issue=store.engine.get("Issue",data()["records"]["issues"]["NCR-0005"]["id"])
        action_ids=list(linked_issue.get("actionIds",[]))
        extra_id=data()["records"]["actions"][overdue]["id"]
        if extra_id not in action_ids:
            command("issues","SUP","NCR-0005","link_actions",
                    {"actionIds":action_ids+[extra_id]})

    # Reports point to real Issue and Inspection entity IDs; their printed PDFs
    # remain synthetic, unsigned companion evidence rather than legal snapshots.
    for idx,report_file in enumerate(manifest["reports"]):
        key=f"RPT-{idx+1:03d}"
        if key in data()["records"]["reports"]:continue
        issue_key=f"NCR-{(idx%15)+1:04d}"
        issue=data()["records"]["issues"][issue_key]
        evidence=files[report_file["file"]]["evidenceId"]
        record=store.engine.get("Issue",issue["id"])
        report_body=dict(packageId=scope["packageId"],locationId=record["locationId"],
            discipline=record["discipline"],responsibleOrganizationId=scope["responsibleOrganizationId"],
            minimumQualificationRank=1,subtype="Report",title=f"[SAMPLE] DR-{idx+1:03d} / 일일감리보고",
            revision="01",report=dict(type="regular",priority="P2",
                sourceDomainRefs=[{"objectType":"Issue","objectId":issue["id"],"version":issue["version"]}],
                recipients=[sessions["OWN"]["actor"]["partyId"]],
                facts=f"가상 현장 보고 {report_file['day']}: {report_file['title']} / 관련 사건 {issue_key}",
                cause="현장 관찰 및 가상 검측자료",impact={"quality":"확인 필요","schedule":"영향 분석 중","cost":"미확정"},
                recommendation="시공사 시정자료 제출 및 감리 재확인",
                dueAt="2026-10-22T12:00:00Z",receiptDueAt="2026-10-21T12:00:00Z",
                actionIds=[data()["records"]["actions"][f"ACT-{(idx%15)+1:04d}"]["id"]],decisionIds=[],
                informationOnly=False),evidenceIds=[evidence])
        create("reports","report","SUP",key,report_body)
        if idx%3 != 0:
            command("reports","SUP",key,"submit",{},[evidence])
            command("reports","SUP",key,"issue",{},[evidence])
    print("[sample records] finalized",flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--database",required=True)
    p.add_argument("--materials",default=".local/sample-materials")
    p.add_argument("--limit",type=int,default=None)
    p.add_argument("--files-only",action="store_true")
    args=p.parse_args()
    d=Path(args.database).resolve()
    if not d.name.lower().startswith(("sample","doul_sample")):
        raise SystemExit("Refusing non-sample database path")
    d.parent.mkdir(parents=True,exist_ok=True)
    print(json.dumps(load(str(d),Path(args.materials),args.limit,not args.files_only),
                     ensure_ascii=False,indent=2,default=dict),flush=True)


if __name__=="__main__":main()
