"""A4 OOXML and authorized derivative boundaries; PDF conversion runs in CI image."""
from copy import deepcopy
from hashlib import sha256
import importlib.util
import io
import unittest
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from services.document_runtime.render import make_docx,validate_source
from tests_runtime.document_fixtures import snapshots,long_snapshot
from tests_mvp.test_documents_http import DocumentHTTPTests


@unittest.skipUnless(importlib.util.find_spec('docx'),'Dedicated document runtime not installed')
class DocumentRuntimeTests(unittest.TestCase):
    def test_all_36_forms_preserve_source_and_create_a4_repeat_headers(self):
        count=0
        for name,snapshot,html in snapshots():
            with self.subTest(form=name):
                before=deepcopy(snapshot); data=make_docx(snapshot,html)
                self.assertEqual(snapshot,before)
                self.assertEqual(data,make_docx(snapshot,html))
                with ZipFile(io.BytesIO(data)) as archive:
                    xml=archive.read('word/document.xml').decode()
                    self.assertIn('w:w="11906"',xml)
                    self.assertIn('w:h="16838"',xml)
                    self.assertIn('Noto Sans CJK KR',xml)
                    if b'<table>' in html: self.assertIn('w:tblHeader',xml)
                    self.assertNotIn('vbaProject.bin',archive.namelist())
                count+=1
        self.assertEqual(count,36)

    def test_long_multilingual_table_and_last_row_retained(self):
        snapshot,html=long_snapshot('ko')
        with ZipFile(io.BytesIO(make_docx(snapshot,html))) as archive:
            xml=archive.read('word/document.xml').decode()
            self.assertIn('LAST_ROW_MARKER',xml)
            self.assertIn('khắc phục',xml)
            self.assertIn('장문 검증',xml)
            self.assertIn('w:cantSplit',xml)

    def test_tampered_html_or_frozen_payload_rejected(self):
        snapshot,html=long_snapshot('ko')
        with self.assertRaises(ValueError): make_docx(snapshot,html+b'tampered')
        bad=deepcopy(snapshot);bad['sourcePayload']['data']['unexpected']='changed'
        with self.assertRaises(ValueError): make_docx(bad,html)

    def test_external_markup_rejected_even_with_matching_transport_hash(self):
        snapshot,html=long_snapshot('ko')
        html=html.replace(b'</body>',b'<img src="https://untrusted.invalid/image"></body>')
        snapshot['renderHash']=sha256(html).hexdigest()
        with self.assertRaises(ValueError): validate_source(snapshot,html)

    def test_localized_renderer_requires_consistent_frozen_catalog_even_with_transport_hash(self):
        snapshot,html=long_snapshot('ko')
        self.assertEqual(snapshot['rendererVersion'],'reference-html/2')
        for key,value in [('title','Injected catalog'),('formId','FM-99'),('language','en')]:
            bad=deepcopy(snapshot)
            bad['sourcePayload']['localization'][key]=value
            from services.document_runtime.render import canonical
            bad['sourcePayloadHash']=sha256(canonical(bad['sourcePayload'])).hexdigest()
            with self.assertRaises(ValueError): validate_source(bad,html)


class DerivativeEndpointTests(DocumentHTTPTests):
    def test_explicit_derivative_download_does_not_change_source_snapshot(self):
        doc=self.preview().json()
        class Export:
            def export(self,snapshot,html,format):
                assert sha256(html).hexdigest()==snapshot['renderHash']
                data=b'%PDF-synthetic-adapter-test'
                return dict(content=data,mediaType='application/pdf',sha256=sha256(data).hexdigest())
        self.app.state.document_runtime=Export()
        result=self.client.get('/projects/'+self.project+'/documents/'+doc['id']+'/exports/pdf',headers=self.h)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.headers['X-Source-Render-Hash'],doc['renderHash'])
        self.assertEqual(result.headers['X-Legal-Signature-Transferred'],'false')
        self.assertEqual(self.app.state.store.documents.get(doc['id']),doc)
        self.assertNotEqual(result.headers['X-Artifact-SHA256'],doc['renderHash'])

    def test_uninstalled_runtime_fails_explicitly(self):
        doc=self.preview().json()
        result=self.client.get('/projects/'+self.project+'/documents/'+doc['id']+'/exports/pdf',headers=self.h)
        self.assertEqual(result.status_code,501)

    def test_cross_project_derivative_cannot_invoke_renderer(self):
        doc=self.preview().json()
        from app.reference.engine import uid
        class Never:
            def export(self,*args): raise AssertionError('unauthorized render')
        self.app.state.document_runtime=Never()
        result=self.client.get('/projects/'+uid()+'/documents/'+doc['id']+'/exports/pdf',headers=self.h)
        self.assertIn(result.status_code,[403,404])


if __name__=='__main__':unittest.main()
