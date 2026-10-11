import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ProjectRole, ProjectSettings, Workspace } from "../data/ui-contract";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
import { Panel, SectionHeader } from "../ui";
import { PageBoundary } from "./PageBoundary";
import "./project-settings.css";

const names: Record<ProjectRole,string>={ADM:"관리자",SUP:"감리자",OWN:"발주처",CON:"시공사"};
const tabs=["기본정보","참여회사·담당자","작업범위","업무배정","로그인계정"];
type Assignment=ProjectSettings["assignments"][number];
function dateInZone(zone:string,offset=0) {
  const parts=new Intl.DateTimeFormat("en",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(Date.now()+offset*86400000));
  return ["year","month","day"].map(key=>parts.find(p=>p.type===key)?.value).join("-");
}

export function ProjectSettingsPage({client,workspace,online,onChanged}:{client:SupervisionClient;workspace:Workspace;online:boolean;onChanged:()=>Promise<void>}) {
  const [revision,setRevision]=useState(0);const [data,setData]=useState<ProjectSettings|null>(null);const [tab,setTab]=useState(0);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [accountGroup,setAccountGroup]=useState<ProjectRole>("ADM");const [personGroup,setPersonGroup]=useState<ProjectRole>("SUP");const [edit,setEdit]=useState<Assignment|null>(null);
  const attempt=useRef<{body:string;key:string}|null>(null);const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const load=useCallback(async()=>{
    setBusy(true);setError("");
    try {const next=await client.projectSettings();if(mounted.current){setData(next);setEdit(null);setRevision(n=>n+1);}}
    catch {if(mounted.current)setError("프로젝트 설정을 불러오지 못했습니다. 관리자 배정과 연결 상태를 확인하십시오.");}
    finally {if(mounted.current)setBusy(false);}
  },[client]);
  useEffect(()=>{void load();},[load]);
  const locked=!online||busy||!data?.availableCommands.length;
  const person=(id:string)=>data?.participants.find(p=>p.id===id)?.name||"담당자";
  const company=(id:string)=>data?.organizations.find(o=>o.id===id)?.name||"소속 미등록";
  const roleLabel=(a:Assignment)=>`${names[a.actorGroup]} · ${person(a.partyId)} · ${company(a.organizationId)}`;
  async function save(command:string,payload:object):Promise<boolean> {
    if(!data||locked)return false;
    const body={expectedVersion:data.project.version,...payload};const serialized=JSON.stringify({command,body});
    if(attempt.current?.body!==serialized)attempt.current={body:serialized,key:crypto.randomUUID()};
    setBusy(true);setError("");setNotice("");
    try {
      const next=await client.saveProjectSettings(command,body,attempt.current.key);
      if(!mounted.current)return false;setData(next);if(edit)setEdit(next.assignments.find(a=>a.id===edit.id)||null);attempt.current=null;setNotice("프로젝트 설정을 저장했습니다.");
      await onChanged();return true;
    } catch(e) {
      if(mounted.current)setError(e instanceof ApiError&&e.detail.code==="REFERENCE_STALE"?"다른 관리자가 설정을 변경했습니다. 입력은 유지했습니다. 다시 불러온 뒤 확인하여 저장하십시오.":e instanceof ApiError?e.detail.message:"저장 결과를 확인하지 못했습니다. 입력을 유지한 채 다시 시도하십시오.");return false;
    } finally {if(mounted.current)setBusy(false);}
  }
  function form(command:string,title:string,children:ReactNode,extra:()=>object=()=>({}),clear=false) {
    return <form onSubmit={event=>{
      event.preventDefault();const target=event.currentTarget;const values=Object.fromEntries(new FormData(target));
      if("minimumQualificationRank" in values)Object.assign(values,{minimumQualificationRank:Number(values.minimumQualificationRank)});
      void save(command,{...values,...extra()}).then(ok=>{if(ok&&clear)target.reset();});
    }}><fieldset disabled={locked||!data?.availableCommands.includes(command)} className="settings-form"><legend>{title}</legend>{children}<button className="primary" type="submit">{title.includes("등록")?title:title+" 저장"}</button></fieldset></form>;
  }
  const input=(label:string,key:string,value="",type="text",required=true)=><label>{label}<input name={key} defaultValue={value} type={type} required={required} maxLength={200}/></label>;
  const select=(label:string,key:string,values:Array<{id:string;name:string}>,value="")=><label>{label}<select name={key} defaultValue={value} required><option value="">선택하십시오</option>{values.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>;
  const groups=data?.roleProfiles.map(r=>({id:r.actorGroup,name:names[r.actorGroup]}))||[];
  const scope=data?.scope;
  const own=edit?.id===data?.currentRoleId;
  function checks(field:"disciplines"|"packageIds"|"locationIds",label:string,values:Array<{id:string;name:string}>) {
    if(!edit)return null;
    return <fieldset className="settings-checks"><legend>{label}</legend>{edit[field].includes("*")&&<p>프로젝트 전체 담당</p>}{values.map(v=><label key={v.id}><input type="checkbox" checked={edit[field].includes("*")||edit[field].includes(v.id)} disabled={own||edit[field].includes("*")} onChange={e=>setEdit({...edit,[field]:e.target.checked?[...edit[field],v.id]:edit[field].filter(id=>id!==v.id)})}/>{v.name}</label>)}</fieldset>;
  }
  return <PageBoundary name="admin" className="project-settings-page"><Panel>
    <SectionHeader title="프로젝트 설정" meta={workspace.project.name}/>
    <p className="notice">관리자·감리자·발주처·시공사의 현장 배정과 로그인 계정을 관리합니다. 담당자 배정은 자격 확인이나 기술승인을 대신하지 않습니다.</p>
    <button type="button" disabled={busy||!online} onClick={()=>void load()}>다시 불러오기</button>
    {!online&&<p role="status">연결이 끊겨 저장할 수 없습니다.</p>}{error&&<p role="alert" className="settings-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data?<p role="status">{busy?"설정을 불러오는 중…":"설정을 확인하려면 다시 불러오기를 누르십시오."}</p>:<div key={revision}>
      {!data.availableCommands.length&&<p className="notice">화면 미리보기입니다. 실제 설정은 저장하지 않습니다.</p>}
      <div className="settings-tabs" role="tablist" aria-label="프로젝트 설정">{tabs.map((label,index)=><button key={label} type="button" role="tab" aria-selected={tab===index} aria-controls={`settings-panel-${index}`} onClick={()=>{setTab(index);setNotice("");}}>{label}</button>)}</div>
      <div hidden={tab!==0} id="settings-panel-0" role="tabpanel" aria-label={tabs[0]} key={data.project.id+":basic"}>
        {form("update_project","기본정보",<>{input("프로젝트명","name",data.project.name)}{select("현장 국가","country",[{id:"VN",name:"베트남"},{id:"KR",name:"한국"}],data.project.country)}{select("현장 시간대","timezone",[{id:"Asia/Ho_Chi_Minh",name:"베트남 시간"},{id:"Asia/Seoul",name:"한국 시간"},...(!["Asia/Ho_Chi_Minh","Asia/Seoul"].includes(data.project.timezone)?[{id:data.project.timezone,name:data.project.timezone}]:[])],data.project.timezone)}{input("공사 종류","classification",data.project.classification||"","text",false)}</>)}
      </div>
      <div hidden={tab!==1} id="settings-panel-1" role="tabpanel" aria-label={tabs[1]} className="settings-columns">
        {form("add_organization","참여회사 등록",<>{input("회사명","name")}{select("회사 구분","actorGroup",groups,"CON")}<ul>{data.organizations.filter(o=>names[o.actorGroup]).map(o=><li key={o.id}>{o.name} · {names[o.actorGroup]}</li>)}</ul></>,undefined,true)}
        {form("add_participant","담당자 등록",<>{input("담당자 이름","name")}<label>역할<select value={personGroup} onChange={e=>setPersonGroup(e.target.value as ProjectRole)}>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><div key={personGroup}>{select("소속 회사","organizationId",data.organizations.filter(o=>o.actorGroup===personGroup))}</div>{input("배정 시작일","startDate",dateInZone(data.project.timezone),"date")}{input("배정 종료일","endDate",dateInZone(data.project.timezone,365),"date")}<p>현장 시간대의 날짜를 적용합니다. 담당 범위는 기본 업무범위로 배정하며 업무배정에서 변경할 수 있습니다.</p>{!scope&&<p>기본 업무범위가 아직 없습니다. 작업범위와 업무배정을 지정하십시오.</p>}</>,()=>({actorGroup:personGroup,disciplines:personGroup==="ADM"?["*"]:scope?[scope.discipline]:[],packageIds:personGroup==="ADM"?["*"]:scope?[scope.packageId]:[],locationIds:personGroup==="ADM"?["*"]:scope?[scope.locationId]:[]}),true)}
      </div>
      <div hidden={tab!==2} id="settings-panel-2" role="tabpanel" aria-label={tabs[2]}>
        <div className="settings-columns">{form("add_work_package","공사범위 등록",<>{input("공사범위 이름","name")}<ul>{data.workPackages.map(p=><li key={p.id}>{p.name}</li>)}</ul></>,undefined,true)}{form("add_location","작업구역 등록",<>{input("작업구역 이름","name")}<ul>{data.locations.map(p=><li key={p.id}>{p.name}</li>)}</ul></>,undefined,true)}</div>
        {form("set_work_scope","업무범위",<>{select("기본 공종","discipline",data.disciplines,scope?.discipline)}{select("기본 공사범위","packageId",data.workPackages,scope?.packageId)}{select("기본 작업구역","locationId",data.locations,scope?.locationId)}{select("담당 시공사","responsibleOrganizationId",data.organizations.filter(o=>o.actorGroup==="CON"),scope?.responsibleOrganizationId)}{select("요구 자격등급","minimumQualificationRank",[1,2,3].map(n=>({id:String(n),name:n+"등급"})),String(scope?.minimumQualificationRank||1))}<p>1등급이 가장 엄격한 기준입니다. 기존 기준을 완화하는 변경은 저장되지 않습니다.</p></>)}
      </div>
      <div hidden={tab!==3} id="settings-panel-3" role="tabpanel" aria-label={tabs[3]}>
        <div className="settings-table-scroll"><table><thead><tr><th>역할</th><th>담당자</th><th>소속 회사</th><th>배정 기간</th><th>상태</th><th>배정 확인</th></tr></thead><tbody>{data.assignments.map(a=><tr key={a.id}><td>{names[a.actorGroup]}</td><td>{person(a.partyId)}</td><td>{company(a.organizationId)}</td><td>{a.startDate} ~ {a.endDate}</td><td>{a.active?"배정 중":"배정 중지"}</td><td><button type="button" onClick={()=>setEdit({...a})}>배정 확인 · {person(a.partyId)}</button></td></tr>)}</tbody></table></div>
        {edit&&<form onSubmit={event=>{event.preventDefault();void save("update_assignment",{roleId:edit.id,expectedRoleVersion:edit.version,active:edit.active,startDate:edit.startDate,endDate:edit.endDate,disciplines:edit.disciplines,packageIds:edit.packageIds,locationIds:edit.locationIds});}}><fieldset disabled={locked||own} className="settings-form"><legend>{roleLabel(edit)}</legend>{own&&<p>접속 중인 관리자 본인의 배정은 조회만 가능합니다.</p>}<label>배정 시작일<input required type="date" value={edit.startDate} onChange={e=>setEdit({...edit,startDate:e.target.value})}/></label><label>배정 종료일<input required type="date" value={edit.endDate} onChange={e=>setEdit({...edit,endDate:e.target.value})}/></label>{checks("disciplines","담당 공종",data.disciplines)}{checks("packageIds","담당 공사범위",data.workPackages)}{checks("locationIds","담당 작업구역",data.locations)}<label><input type="checkbox" checked={edit.active} onChange={e=>setEdit({...edit,active:e.target.checked})}/>배정 사용</label><button className="primary" type="submit">업무배정 저장</button></fieldset></form>}
      </div>
      <div hidden={tab!==4} id="settings-panel-4" role="tabpanel" aria-label={tabs[4]}>
        <form onSubmit={(event:FormEvent<HTMLFormElement>)=>{
          event.preventDefault();if(locked)return;const target=event.currentTarget;const values=new FormData(target);const assignment=data.assignments.find(a=>a.id===values.get("role"));if(!assignment)return;
          setBusy(true);setError("");setNotice("");void client.request("/auth/accounts",{method:"POST",body:JSON.stringify({username:values.get("username"),password:values.get("password"),partyId:assignment.partyId,roleAssignmentId:assignment.id})})
            .then(()=>{if(mounted.current){setNotice("로그인 계정을 등록했습니다.");target.reset();}})
            .catch(()=>{if(mounted.current)setError("계정을 등록하지 못했습니다. 아이디 중복, 비밀번호 길이와 담당자 배정을 확인하십시오.");})
            .finally(()=>{const passwordInput=target.elements.namedItem("password") as HTMLInputElement|null;if(passwordInput)passwordInput.value="";if(mounted.current)setBusy(false);});
        }}><fieldset disabled={locked||client.session?.mode!=="PASSWORD"} className="settings-form"><legend>사용자 계정 생성</legend>{client.session?.mode!=="PASSWORD"&&<p>로그인 계정은 실제 비밀번호 로그인 서버에서 등록할 수 있습니다.</p>}<label>계정 역할<select value={accountGroup} onChange={e=>setAccountGroup(e.target.value as ProjectRole)}>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><div key={accountGroup}>{select("담당자·역할","role",data.assignments.filter(a=>a.active&&a.actorGroup===accountGroup).map(a=>({id:a.id,name:roleLabel(a)})))}</div>{!data.assignments.some(a=>a.active&&a.actorGroup===accountGroup)&&<p>선택한 역할의 담당자가 없습니다. 참여회사·담당자에서 먼저 등록하십시오.</p>}<label>로그인 아이디<input name="username" required pattern="[a-z][a-z0-9._-]{2,63}" maxLength={64} autoComplete="off"/></label><p>영문 소문자로 시작하는 3~64자 아이디를 입력하십시오.</p><label>초기 비밀번호<input name="password" required type="password" minLength={12} maxLength={128} autoComplete="new-password"/></label><p>12자 이상으로 입력하십시오. 저장한 비밀번호는 다시 표시하지 않습니다.</p><button className="primary" type="submit">계정 생성</button></fieldset></form>
      </div>
    </div>}
  </Panel></PageBoundary>;
}
