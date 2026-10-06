"""Final receiving forms retain the NCR link only when one was issued."""
import unittest

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import Fixture


class ReceivingNcrFormTests(unittest.TestCase):
    def setUp(self):self.f=Fixture()

    def render(self,refs,status='fail',ncr_no=None,final=True):
        data=self.f.form_data('FM-05')
        data['review']['status']=status
        data['review'].pop('ncr_no',None)
        if ncr_no is not None:data['review']['ncr_no']=ncr_no
        return self.f.docs.render('FM-05',refs,data,*self.f.actors['SUP'],uid(),final=final)

    def issued_failure(self):
        inspection=self.f.inspect(self.f.inspection(),'fail')
        return inspection,self.f.issue(inspection)

    def test_pass_and_hold_do_not_require_ncr(self):
        refs=[self.f.ref('Requirement',self.f.requirement)]
        for status in ['pass','hold']:
            with self.subTest(status=status):self.assertEqual(self.render(refs,status)['status'],'final')

    def test_failure_without_issued_ncr_does_not_require_a_number(self):
        inspection=self.f.inspect(self.f.inspection(),'fail')
        self.assertEqual(self.render([self.f.ref('Inspection',inspection['id'])])['status'],'final')

    def test_issued_ncr_cannot_be_omitted_or_hidden_by_dto_status(self):
        inspection,_=self.issued_failure()
        refs=[self.f.ref('Inspection',inspection['id'])]
        for status in ['fail','pass']:
            with self.subTest(status=status),self.assertRaises(ContractError) as caught:
                self.render(refs,status)
            self.assertEqual(caught.exception.code,'FORM_NCR_LINK_REQUIRED')

    def test_number_or_related_issue_reference_satisfies_final_link(self):
        inspection,issue=self.issued_failure()
        refs=[self.f.ref('Inspection',inspection['id'])]
        numbered=self.render(refs,ncr_no='NCR-001')
        self.assertEqual(numbered['sourcePayload']['data']['review']['ncr_no'],'NCR-001')
        linked=self.render(refs+[self.f.ref('Issue',issue['id'])])
        self.assertEqual(linked['sourcePayload']['data']['review']['ncr_no'],issue['id'])
        self.assertIn(issue['id'].encode(),self.f.docs.rerender(linked['id']))

    def test_unrelated_issue_and_blank_number_do_not_satisfy_the_link(self):
        inspection,_=self.issued_failure()
        _,other=self.issued_failure()
        refs=[self.f.ref('Inspection',inspection['id']),self.f.ref('Issue',other['id'])]
        with self.assertRaises(ContractError) as caught:self.render(refs,ncr_no='  ')
        self.assertEqual(caught.exception.code,'FORM_NCR_LINK_REQUIRED')

    def test_draft_can_be_prepared_before_ncr_link_is_filled(self):
        inspection,_=self.issued_failure()
        draft=self.render([self.f.ref('Inspection',inspection['id'])],final=False)
        self.assertEqual(draft['status'],'draft')


if __name__=='__main__':unittest.main()
