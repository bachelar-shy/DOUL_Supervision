"""Immutable HTML reference snapshots and trusted signature-adapter receipts.

HTML structural QA is executable. Production PDF/DOCX pagination, installed
statutory templates and legal e-signature verification are separate adapters.
"""
from copy import deepcopy
import hashlib
from html import escape
import json

from .engine import canonical, digest, load, uid
from .validation import get_path, instant, require, validate

SIGNER_GROUPS={
    'owner_side_supervisor':('SUP', ['discipline_supervisor','chief_supervisor']),
    'discipline_supervisor':('SUP',['discipline_supervisor','chief_supervisor']),
    'chief_supervisor':('SUP',['chief_supervisor']),
    'chief_or_supervisor':('SUP',['discipline_supervisor','chief_supervisor']),
    'contractor_technical_lead':('CON',['contractor_technical_lead']),
    'subcontractor_technical_lead':('CON',['subcontractor_technical_lead']),
    'contractor_lead':('CON',['contractor_technical_lead']),
    'investor':('OWN',['owner_representative','owner_decision_maker']),
    'other_participant':('HUMAN',[]),'other_legal_participant':('HUMAN',[]),
    'handover_from':('HUMAN',[]),'handover_to':('HUMAN',[]),
    'supervision_confirm':('SUP',['discipline_supervisor','chief_supervisor']),
}

# Explicit bindings for result-bearing fields. Other fields are frozen form DTO
# context reviewed by the renderer caller; they are not newly invented domain data.
BINDINGS={
    'FM-07':{'inspection.work_name':('Inspection','workName'),'inspection.requested_at':('Inspection','requestedAt'),'inspection.requested_inspection_at':('Inspection','requestedInspectionAt'),'precheck.self_check':('Inspection','selfInspectionComplete'), **{'precheck.'+k:('Inspection','precheck.'+k) for k in ['drawing','material','test','previous','change']}},
    'FM-09':{'inspection.no':('Inspection','id'),'inspection.work_name':('Inspection','workName'),'result.status':('Inspection','resultStatus'),'result.next_work_allowed':('Inspection','nextWorkAllowed')},
    'FM-13':{'car.no':('Action','id'),'car.root_cause':('Action','rootCause'),'car.corrective_action':('Action','correction'),'car.preventive_action':('Action','preventiveAction'),'car.close_status':('Action','status')},
    'FM-15':{'rfi.no':('WorkItem','id'),'rfi.question':('WorkItem','data.question'),'rfi.response':('WorkItem','data.response'),'rfi.change_required':('WorkItem','data.changeRequired')},
    'FM-20':{'urgent.no':('InformationItem','id'),'urgent.fact':('InformationItem','report.facts'),'urgent.priority':('InformationItem','report.priority'),'urgent.cause':('InformationItem','report.cause'),'urgent.immediate_action':('InformationItem','report.immediateActions'),'urgent.decision_due':('InformationItem','report.dueAt')},
    'FM-21':{'decision.no':('Decision','id'),'decision.due':('Decision','dueAt'),'decision.result':('Decision','decision'),'decision.decided_at':('Decision','decisionAt')},
}

PRIMARY_SOURCES={
    'FM-07':('Inspection',None),'FM-09':('Inspection',None),
    'FM-13':('Action',None),'FM-15':('WorkItem','RFI'),
    'FM-20':('InformationItem','Report'),'FM-21':('Decision',None),
}


def put_path(data,path,value):
    parts=path.split('.');target=data
    for part in parts[:-1]:target=target.setdefault(part,{})
    target[parts[-1]]=deepcopy(value)


class Documents:
    def __init__(self,engine):
        self.engine=engine
        self.templates={f['id']:f for f in load('forms/form_templates_v1.json')['templates']}
        self.schemas=load('forms/form_data_schemas_v1.json')['forms']
        self._snapshots={};self._bytes={};self._signatures={};self._idempotency={}
        # The engine reads a copy, so callers cannot mutate stored acceptance data.
        engine.documents={}

    def _roles(self,form,data):
        roles=list(self.schemas[form]['signature_roles'])
        for conditional in self.schemas[form]['conditional_signatures']:
            when=conditional['when']
            require(when['operator']=='non_null','CONDITIONAL_RULE_INVALID','Only fixed non-null predicate is supported')
            if get_path(data,when['path']) is not None:roles.append(conditional['role'])
        return roles

    def render(self,form,source_refs,data,party_id,role_id,key,language='vi',final=True,supersedes_id=None):
        require(form in self.templates,'FORM_UNKNOWN',form)
        require(bool(source_refs),'SOURCE_VERSION_REQUIRED','At least one exact source version is required')
        records=[self.engine.resolve(r) for r in source_refs];project=records[0]['projectId']
        for record in records:
            require(record['projectId']==project,'PROJECT_MISMATCH','Snapshot sources must share a project')
            self.engine.authorize_read(record,party_id,role_id)
        subject=0
        if form in PRIMARY_SOURCES:
            kind,subtype=PRIMARY_SOURCES[form]
            subjects=[i for i,(ref,r) in enumerate(zip(source_refs,records)) if ref['objectType']==kind and (subtype is None or r.get('subtype')==subtype)]
            require(len(subjects)==1,'FORM_SUBJECT_INVALID','Form requires exactly one '+kind+' subject'+(' of subtype '+subtype if subtype else ''))
            subject=subjects[0]
        request=dict(form=form,refs=source_refs,data=data,language=language,final=final,supersedesId=supersedes_id,role=role_id)
        cache_key=(project,party_id,key)
        require(bool(key),'IDEMPOTENCY_REQUIRED','Render key required')
        if cache_key in self._idempotency:
            old_hash,doc_id=self._idempotency[cache_key]
            require(old_hash==digest(request),'IDEMPOTENCY_CONFLICT','Render key reused')
            return self.get(doc_id)
        template=self.templates[form];spec=self.schemas[form];frozen=deepcopy(data)
        for field,(kind,path) in BINDINGS.get(form,{}).items():
            source=records[subject]
            require(source_refs[subject]['objectType']==kind,'FORM_SOURCE_MISSING',kind+' source required')
            require(source is not None,'FORM_SOURCE_MISSING',kind+' source required')
            value=get_path(source,path)
            if value is not None:put_path(frozen,field,value if spec['scalar_fields'][field]['type']!='string' else str(value))
        for field,rule in spec['scalar_fields'].items():
            value=get_path(frozen,field)
            if final and rule['required']:require(value is not None and value!='','FORM_FIELD_MISSING',field)
            if value is not None:require(isinstance(value,(str,int,float,bool)),'FORM_FIELD_INVALID',field+' requires a scalar DTO value')
            if value is not None:
                if rule['type']=='boolean':require(type(value) is bool,'FORM_FIELD_INVALID',field+' requires boolean')
                elif rule['type']=='date-time':instant(value)
                else:require(isinstance(value,str),'FORM_FIELD_INVALID',field+' requires text')
        for table in spec['tables']:
            rows=get_path(frozen,table['path'])
            if table['type'] in ['review_table','check_table']:
                require(isinstance(rows,dict),'FORM_TABLE_INVALID',table['path'])
                for field in table['columns']:require(field in rows,'FORM_FIELD_MISSING',table['path']+'.'+field)
            else:
                require(isinstance(rows,list),'FORM_TABLE_INVALID',table['path'])
                for row in rows:
                    require(isinstance(row,dict) and all(c in row for c in table['columns']),'FORM_TABLE_INVALID','Every table row needs declared columns')
        if final and form in ['FM-09','FM-10','FM-11']:require(language=='vi','STATUTORY_LANGUAGE_REQUIRED','Final statutory record uses Vietnamese')
        require(language in ['ko','vi','en'],'LANGUAGE_INVALID',language)
        if supersedes_id:
            old=self.get(supersedes_id)
            require(old['projectId']==project and old['formId']==form,'SNAPSHOT_SUPERSESSION_INVALID','Supersession must remain in the same project/form')
        payload={'data':frozen,'sources':[{'ref':ref,'record':r} for ref,r in zip(source_refs,records)],'language':language,'requiredSignatureRoles':self._roles(form,frozen)}
        output=self._html(template,payload)
        snapshot=dict(id=uid(),projectId=project,version=1,formId=form,templateVersion=template['version'],templateHash=digest(template),rendererVersion='reference-html/1',primarySourceRef=deepcopy(source_refs[subject]),sourceDomainRefs=deepcopy(source_refs),sourcePayload=payload,sourcePayloadHash=digest(payload),renderHash=hashlib.sha256(output).hexdigest(),renderedAt=self.engine.at(),status='final' if final else 'draft',signatureIds=[])
        if supersedes_id:snapshot['supersedesId']=supersedes_id
        validate(snapshot,self.engine.schemas['DocumentSnapshot'],self.engine.schemas)
        self.engine._save('DocumentSnapshot',snapshot)
        self.engine._event(snapshot,'document:render',party_id,role_id,key,request,None)
        self._snapshots[snapshot['id']]=snapshot;self._bytes[snapshot['id']]=output
        self._idempotency[cache_key]=(digest(request),snapshot['id']);self.engine.documents[snapshot['id']]=deepcopy(snapshot)
        return self.get(snapshot['id'])

    def _html(self,template,payload):
        data=payload['data'];parts=[]
        for field in self.schemas[template['id']]['scalar_fields']:
            value=get_path(data,field)
            parts.append('<p><b>'+escape(field)+'</b>: '+escape(str(value if value is not None else ''))+'</p>')
        for table in self.schemas[template['id']]['tables']:
            rows=get_path(data,table['path']);cols=table['columns']
            if isinstance(rows,dict):rows=[{c:rows[c] for c in cols}]
            head='<thead><tr>'+''.join('<th>'+escape(c)+'</th>' for c in cols)+'</tr></thead>'
            body=''.join('<tr>'+''.join('<td>'+escape(str(row[c]))+'</td>' for c in cols)+'</tr>' for row in rows)
            parts.append('<table>'+head+'<tbody>'+body+'</tbody></table>')
        style='@page{size:A4;margin:17mm}body{font-family:"Noto Sans KR","Noto Sans",sans-serif;font-size:10pt}p,td{overflow-wrap:anywhere;white-space:pre-wrap}table{width:100%;border-collapse:collapse}thead{display:table-header-group}th,td{border:1px solid #bbb;padding:4px}tr{break-inside:avoid}.footer{position:fixed;bottom:0;font-size:8pt}'
        return ('<!doctype html><html lang="'+payload['language']+'"><meta charset="utf-8"><style>'+style+'</style><body><h1>'+escape(template['title'])+'</h1>'+''.join(parts)+'<div class="footer">DOUL INTERNATIONAL · '+escape(template['id'])+' · '+escape(template['version'])+'</div></body></html>').encode()

    def get(self,doc_id):
        require(doc_id in self._snapshots,'DOCUMENT_NOT_FOUND',doc_id)
        return deepcopy(self._snapshots[doc_id])

    def rerender(self,doc_id):
        """Return preserved bytes; never fetch current domain/template versions."""
        self.get(doc_id)
        return bytes(self._bytes[doc_id])

    def sign(self,doc_id,party_id,role_id,signer_role,method,receipt,key):
        doc=self.get(doc_id)
        require(doc['status'] in ['final','signed'],'DOCUMENT_NOT_FINAL','Draft cannot be signed')
        self.engine.authorize_read(doc,party_id,role_id)
        require(bool(doc.get('primarySourceRef')),'DOCUMENT_SUBJECT_REQUIRED','Legacy snapshot requires a new render with an explicit subject before signing')
        primary=next(source['record'] for source in doc['sourcePayload']['sources'] if source['ref']==doc['primarySourceRef'])
        role=self.engine.authorize(primary,'sign_legal_document',party_id,role_id)
        require(signer_role in doc['sourcePayload']['requiredSignatureRoles'],'SIGNATURE_ROLE_INVALID',signer_role)
        group,codes=SIGNER_GROUPS[signer_role]
        require((group=='HUMAN' or group==role['actorGroup']) and (not codes or role['roleCode'] in codes),'SIGNATURE_ROLE_INVALID','Stored assignment must match the required signer role')
        qualifications=self.engine._qualified(primary,role) if role['actorGroup'] in ['SUP','CON','DES'] else []
        require(method in ['wet_original_verified','approved_e_signature'],'SIGNATURE_METHOD_INVALID',method)
        # receipt is supplied by a trusted verification adapter, never direct HTTP JSON.
        require(receipt.get('verified') is True and receipt.get('partyId')==party_id and receipt.get('documentHash')==doc['renderHash'],'SIGNATURE_UNVERIFIED','Trusted signature receipt must bind signer and exact render hash')
        if method=='wet_original_verified':require(bool(receipt.get('originalFileId')),'SIGNATURE_ORIGINAL_REQUIRED','Verified original file required')
        if doc['formId']=='FM-11':require(receipt.get('corporateSealVerified') is True,'CORPORATE_SEAL_REQUIRED','Required seal must be verified')
        cache_key=(doc_id,party_id,key);request=dict(role=role_id,signerRole=signer_role,method=method,receipt=receipt)
        require(bool(key),'IDEMPOTENCY_REQUIRED','Signature key required')
        if cache_key in self._idempotency:
            h,sid=self._idempotency[cache_key];require(h==digest(request),'IDEMPOTENCY_CONFLICT','Signature key reused');return deepcopy(self._signatures[sid])
        require(not any(self._signatures[s]['roleCode']==signer_role for s in doc['signatureIds']),'SIGNATURE_ALREADY_EXISTS','Required role already signed')
        signature=dict(id=uid(),projectId=doc['projectId'],version=1,documentId=doc_id,partyId=party_id,roleAssignmentId=role_id,roleCode=signer_role,qualificationRefs=[dict(objectType='Qualification',objectId=q['id'],version=q['version']) for q in qualifications],signedAt=self.engine.at(),documentHash=doc['renderHash'],method=method,legal=True)
        if receipt.get('originalFileId'):signature['originalFileId']=receipt['originalFileId']
        validate(signature,self.engine.schemas['Signature'],self.engine.schemas)
        self.engine._save('Signature',signature)
        self.engine._event(signature,'document:sign',party_id,role_id,key,request,None)
        self._signatures[signature['id']]=signature;doc['signatureIds'].append(signature['id'])
        signed_roles={self._signatures[s]['roleCode'] for s in doc['signatureIds']}
        if set(doc['sourcePayload']['requiredSignatureRoles'])<=signed_roles:doc['status']='signed'
        doc['version']+=1;self.engine._save('DocumentSnapshot',doc)
        self._snapshots[doc_id]=doc;self.engine.documents[doc_id]=deepcopy(doc)
        self._idempotency[cache_key]=(digest(request),signature['id'])
        return deepcopy(signature)

    def render_official(self,legal_form_id):
        registry=load('forms/legal_form_registry.json')['official_fixed']
        entry=next((x for x in registry if x['id']==legal_form_id),None)
        require(entry is not None,'LEGAL_FORM_UNKNOWN',legal_form_id)
        require(entry['mode']!='receive_only','LEGAL_FORM_RECEIVE_ONLY','External authority result must be received, not generated')
        require(entry['render_enabled'] and entry['template_status']=='verified_installed','LEGAL_TEMPLATE_NOT_INSTALLED','Original legal template and effective dates have not been installed')
        require(False,'LEGAL_ADAPTER_NOT_IMPLEMENTED','Production official-template adapter is required')
