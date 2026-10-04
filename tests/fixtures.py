from datetime import datetime,timezone
import hashlib
from app.reference.engine import Engine,uid
from app.reference.documents import Documents,put_path
from app.reference.validation import get_path

NOW=datetime(2026,10,4,12,0,tzinfo=timezone.utc)
BEFORE='2026-01-01T00:00:00Z';AFTER='2027-01-01T00:00:00Z';AT='2026-10-04T12:00:00Z';DUE='2026-10-05T12:00:00Z'


class Fixture:
    def __init__(self):
        self.clock=NOW;self.engine=Engine(lambda:self.clock);self.docs=Documents(self.engine)
        self.project=uid();self.package=uid();self.location=uid();self.organization=uid();self.actors={}
        self.engine.bootstrap('Project',dict(id=self.project,projectId=self.project,name='DOUL 현장',country='VN',timezone='Asia/Ho_Chi_Minh',qualificationRules=[dict(discipline='architecture',minimumRank=3)]))
        self.engine.bootstrap('Location',dict(id=self.location,projectId=self.project,name='1F A/1',semanticAnchor='building/1F/A-1'))
        for actor,code in [('SUP','chief_supervisor'),('CON','contractor_technical_lead'),('OWN','owner_decision_maker'),('DES','designer'),('ADM','project_admin'),('AI','ai_worker'),('SYSTEM','workflow_worker'),('INTEGRATION','integration_worker')]:
            party,role,q=uid(),uid(),uid();self.actors[actor]=(party,role)
            self.engine.bootstrap('Party',dict(id=party,projectId=self.project,kind='PERSON' if actor in ['SUP','CON','OWN','DES','ADM'] else 'ORGANIZATION',name=actor,loginEnabled=True,organizationId=self.organization))
            self.engine.bootstrap('Qualification',dict(id=q,projectId=self.project,partyId=party,number='fixture-'+actor,rank=1,disciplines=['architecture'],validFrom=BEFORE,validTo=AFTER,verified=True,revoked=False))
            self.engine.bootstrap('RoleAssignment',dict(id=role,projectId=self.project,partyId=party,organizationId=self.organization,actorGroup=actor,roleCode=code,authorityCodes=[k for k,v in self.engine.policies.items() if actor in v['actor_groups']],disciplines=['architecture'],packageIds=[self.package],locationIds=[self.location],qualificationIds=[q],validFrom=BEFORE,validTo=AFTER,active=True,approvedBy=party))
        self.requirement=uid();self.drawing=uid();self.evidence=uid()
        self.engine.bootstrap('Requirement',dict(id=self.requirement,projectId=self.project,kind='contract',title='계약 검측기준',effectiveFrom=BEFORE,status='active',requiredFields=['dimension'],**self.scope()))
        self.engine.bootstrap('InformationItem',dict(id=self.drawing,projectId=self.project,subtype='Drawing',title='승인도면',revision='A',status='approved',**self.scope()))
        self.evidence_record(self.evidence)

    def scope(self):return dict(packageId=self.package,locationId=self.location,discipline='architecture',responsibleOrganizationId=self.organization,minimumQualificationRank=3)
    def ref(self,kind,oid):return dict(objectType=kind,objectId=oid,version=self.engine.get(kind,oid)['version'])
    def evidence_record(self,eid,**changes):
        payload=dict(sourceType='original',mediaType='photo',fileId=uid(),fileHash=hashlib.sha256(b'original').hexdigest(),sourcePartyId=self.actors['CON'][0],**self.scope());payload.update(changes)
        return self.engine.add_evidence(eid,self.project,payload,b'original',*self.actors['CON'],uid())['record']
    def create(self,machine,payload,actor='SUP',oid=None):
        return self.engine.create(machine,oid or uid(),self.project,{**self.scope(),**payload},*self.actors[actor],uid())['record']
    def command(self,machine,record,cmd,payload=None,actor='SUP',evidence=None,key=None):
        kind=self.engine.machines[machine]['object_type'];record=self.engine.get(kind,record['id'])
        return self.engine.execute(machine,record['id'],cmd,record['version'],payload or {},evidence if evidence is not None else [self.evidence],*self.actors[actor],key or uid())['record']
    def inspection(self,**fields):
        return self.create('inspection',dict(workName='벽체 A/1',selfInspectionComplete=True,precheck={k:True for k in ['drawing','material','test','previous','change']},holdPoint=False,nextWorkAllowed=False,requirementRefs=[self.ref('Requirement',self.requirement)],drawingRef=self.ref('InformationItem',self.drawing),evidenceIds=[self.evidence]) | fields,'CON')
    def inspect(self,record,result='pass'):
        record=self.command('inspection',record,'request',dict(requestedAt=AT,requestedInspectionAt=DUE),'CON')
        record=self.command('inspection',record,'receive',dict(receivedAt=AT))
        record=self.command('inspection',record,'schedule',dict(scheduledAt=AT))
        record=self.command('inspection',record,'start')
        record=self.command('inspection',record,'submit_results',dict(checkResults=[dict(itemId='dimension',requirementRef=self.ref('Requirement',self.requirement),result=result,evidenceIds=[self.evidence],measuredValue=120,unit='mm')]))
        return self.command('inspection',record,'pass' if result=='pass' else 'fail',{} if result=='pass' else {'failureReason':'치수 불합격'})
    def form_data(self,form,rows=1):
        data={}
        for path,rule in self.docs.schemas[form]['scalar_fields'].items():put_path(data,path,True if rule['type']=='boolean' else AT if rule['type']=='date-time' else '확인 · đã kiểm tra')
        for table in self.docs.schemas[form]['tables']:
            put_path(data,table['path'],{**(get_path(data,table['path']) or {}),**{c:'확인' for c in table['columns']}} if table['type'] in ['check_table','review_table'] else [{c:'확인' for c in table['columns']} for _ in range(rows)])
        return data
    def acceptance(self,record,subcontractor=False):
        data=self.form_data('FM-09')
        if subcontractor:put_path(data,'participants.subcontractor',{'name':'subcontractor'})
        doc=self.docs.render('FM-09',[self.ref('Inspection',record['id'])],data,*self.actors['SUP'],uid())
        for role,actor in [('owner_side_supervisor','SUP'),('contractor_technical_lead','CON')]:
            self.docs.sign(doc['id'],*self.actors[actor],role,'approved_e_signature',dict(verified=True,partyId=self.actors[actor][0],documentHash=doc['renderHash']),uid())
        return self.docs.get(doc['id'])
    def finish(self,record):
        self.acceptance(record)
        return self.command('inspection',record,'release_next_work' if record['resultStatus']=='pass' else 'record_failure')
    def observation(self):
        r=self.create('observation',dict(source='supervisor',description='치수 결함 현장 확인',grounding=[dict(evidenceId=self.evidence,channel='visual',claimSupport='observed')],evidenceIds=[self.evidence]))
        r=self.command('observation',r,'begin_review')
        return self.command('observation',r,'confirm',dict(verificationNote='원본과 현장 확인'))
    def issue(self,failed):
        obs=self.observation()
        return self.create('issue',dict(subtype='NCR',title='벽체 치수 시정',observationIds=[obs['id']],actionIds=[],inspectionIds=[failed['id']],correctionCycle=0,evidenceIds=[self.evidence]))
    def action(self,**refs):return self.create('action',dict(title='시정 및 재발방지',**refs))
    def complete_action(self,action):
        action=self.command('action',action,'assign',dict(responsiblePartyId=self.actors['CON'][0],responsibleOrganizationId=self.organization,dueAt=DUE))
        action=self.command('action',action,'start',actor='CON')
        action=self.command('action',action,'submit',dict(correction='치수 보완',rootCause='기준선 미확인',preventiveAction='선행 확인'),actor='CON')
        action=self.command('action',action,'verify')
        return self.command('action',action,'close')
    def report(self,information_only=False):
        data=dict(type='decision_request',priority='P2',sourceDomainRefs=[self.ref('Requirement',self.requirement)],recipients=[self.actors['OWN'][0]],facts='현장 사실',cause='확인 중',impact={'quality':'검측 필요'},recommendation='보완 후 확인',dueAt=DUE,receiptDueAt=DUE,actionIds=[],decisionIds=[],informationOnly=information_only)
        return self.create('report',dict(title='발주처 보고',revision='1',report=data,evidenceIds=[self.evidence]))
    def issue_report(self,record):
        record=self.command('report',record,'submit')
        return self.command('report',record,'issue')
