import unittest
from copy import deepcopy
from html import escape
from fastapi.testclient import TestClient
from services.api.main import create_app
from app.reference.engine import uid


def put(data,path,value):
    bits=path.split('.');node=data
    for key in bits[:-1]:node=node.setdefault(key,{})
    node[bits[-1]]=value


class DocumentHTTPTests(unittest.TestCase):
    def setUp(self):
        self.app=create_app(demo=True);self.client=TestClient(self.app)
        self.s=self.client.post('/dev/sessions',json={'actorGroup':'SUP'}).json()
        self.project=self.s['projectId'];self.role=self.s['actor']['roleAssignmentId']
        self.h={'Authorization':'Bearer '+self.s['accessToken'],'X-RoleAssignment-Id':self.role,'Idempotency-Key':uid()}
        self.w=self.client.get('/projects/'+self.project+'/workspace',headers=self.h).json()
        self.report=next(x['record'] for x in self.w['items'] if x['machine']=='report')
        spec=self.w['formSchemas']['FM-20'];data={}
        for table in spec['tables']:put(data,table['path'],{k:'' for k in table['columns']} if table['type'] in ['review_table','check_table'] else [])
        self.body=dict(roleAssignmentId=self.role,sourceDomainRefs=[dict(objectType='InformationItem',objectId=self.report['id'],version=self.report['version'])],data=data,language='ko',output='html_a4')
    def tearDown(self):self.client.close();self.app.state.store.close()
    def preview(self):return self.client.post('/projects/'+self.project+'/forms/FM-20/preview',headers=self.h,json=self.body)

    def test_draft_html_and_source_version(self):
        r=self.preview();self.assertEqual(r.status_code,200,r.text);d=r.json()
        self.assertEqual(d['status'],'draft');self.assertEqual(d['sourceDomainRefs'][0]['version'],self.report['version'])
        html=self.client.get('/projects/'+self.project+'/documents/'+d['id']+'/content',headers=self.h)
        self.assertEqual(html.status_code,200);self.assertIn('text/html',html.headers['content-type']);self.assertIn('sandbox',html.headers['content-security-policy'])

    def test_document_survives_later_source_change(self):
        d=self.preview().json();path='/projects/'+self.project+'/documents/'+d['id']+'/content'
        before=self.client.get(path,headers=self.h).content
        owner=self.client.post('/dev/sessions',json={'actorGroup':'OWN'}).json()
        self.client.post('/projects/'+self.project+'/owner-reports/'+self.report['id']+'/acknowledge',headers={'Authorization':'Bearer '+owner['accessToken'],'Idempotency-Key':uid()},json=dict(roleAssignmentId=owner['actor']['roleAssignmentId'],expectedVersion=self.report['version'],payload={},evidenceIds=[]))
        after=self.client.get(path,headers=self.h).content
        self.assertEqual(before,after)

    def test_three_language_previews_freeze_display_catalog_without_mutating_sources(self):
        from app.reference.document_localization import document_localization, format_document_value
        data=deepcopy(self.body['data'])
        fact='원본 사실 / Nguyễn <现场>'
        date='2026-05-06T14:30:00+07:00'
        with self.app.state.store.transaction(True):
            source=self.app.state.store.engine.get('InformationItem',self.report['id'])
            source['report']['facts']=fact
            source['version']+=1
            self.app.state.store.engine._save('InformationItem',source)
        self.body['sourceDomainRefs'][0]['version']=source['version']
        put(data,'urgent.fact',fact)
        put(data,'urgent.occurred_at',date)
        original=self.app.state.store.engine.get('InformationItem',self.report['id'])
        outputs=[]
        for language in ('ko','vi','en'):
            body={**self.body,'data':data,'language':language}
            response=self.client.post('/projects/'+self.project+'/forms/FM-20/preview',
                headers={**self.h,'Idempotency-Key':uid()},json=body)
            self.assertEqual(response.status_code,200,response.text)
            document=response.json()
            catalog=document_localization('FM-20',language)
            self.assertEqual(document['sourcePayload']['localization'],catalog)
            self.assertEqual(document['sourcePayload']['sources'][0]['record'],original)
            self.assertEqual(document['sourcePayload']['data']['urgent']['fact'],fact)
            path='/projects/'+self.project+'/documents/'+document['id']+'/content'
            content=self.client.get(path,headers=self.h).text
            self.assertIn('<html lang="'+language+'">',content)
            self.assertIn(escape(catalog['title']),content)
            self.assertIn(escape(catalog['fields']['urgent.fact']),content)
            self.assertIn(escape(fact),content)
            self.assertIn(format_document_value(date,language,'date-time'),content)
            replay=self.client.get(path,headers=self.h).text
            self.assertEqual(content,replay)
            outputs.append(content)
        self.assertEqual(len(set(outputs)),3)
        self.assertEqual(self.app.state.store.engine.get('InformationItem',self.report['id']),original)


    def test_no_fake_docx_pdf(self):
        for output in ['docx','pdf']:
            r=self.client.post('/projects/'+self.project+'/forms/FM-20/render',headers=self.h,json={**self.body,'output':output})
            self.assertEqual(r.status_code,501)

    def test_no_unverified_signing(self):
        d=self.preview().json();r=self.client.post('/projects/'+self.project+'/documents/'+d['id']+'/sign',headers=self.h,json=dict(roleAssignmentId=self.role,documentHash=d['renderHash'],roleCode='supervisor',method='wet_original_verified'))
        self.assertEqual(r.status_code,501)

    def test_spoofed_signature_receipt_rejected(self):
        d=self.preview().json();r=self.client.post('/projects/'+self.project+'/documents/'+d['id']+'/sign',headers=self.h,json=dict(roleAssignmentId=self.role,documentHash=d['renderHash'],roleCode='supervisor',method='wet_original_verified',receipt={'verified':True}))
        self.assertEqual(r.status_code,422)

    def test_cross_project_render_reference_denied(self):
        self.body['sourceDomainRefs'][0]['objectId']=uid();self.assertEqual(self.preview().status_code,404)

    def test_owner_cannot_read_or_render_snapshot_of_draft_report(self):
        store=self.app.state.store
        with store.transaction(True):
            draft=store.engine.create('report',uid(),self.project,dict(**store.meta['scope'],title='Internal draft',revision='1',report=self.report['report']),self.s['actor']['partyId'],self.role,uid())['record']
        self.body['sourceDomainRefs']=[dict(objectType='InformationItem',objectId=draft['id'],version=draft['version'])]
        d=self.preview().json()
        owner=self.client.post('/dev/sessions',json={'actorGroup':'OWN'}).json()
        h={'Authorization':'Bearer '+owner['accessToken'],'X-RoleAssignment-Id':owner['actor']['roleAssignmentId'],'Idempotency-Key':uid()}
        for path in ['/documents/'+d['id'],'/documents/'+d['id']+'/content','/owner-reports/'+draft['id']]:
            self.assertEqual(self.client.get('/projects/'+self.project+path,headers=h).status_code,404)
        rows=self.client.get('/projects/'+self.project+'/registers/11',headers=h).json()
        self.assertFalse(any(row['data']['id']==d['id'] for row in rows))
        body={**self.body,'roleAssignmentId':owner['actor']['roleAssignmentId']}
        r=self.client.post('/projects/'+self.project+'/forms/FM-20/preview',headers=h,json=body)
        self.assertEqual(r.status_code,404)

if __name__=='__main__':unittest.main()
