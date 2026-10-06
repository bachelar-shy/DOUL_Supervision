"""Synthetic, exact-version fixtures from all 36 existing Product form contracts."""
from app.reference.engine import uid
from tests.fixtures import Fixture,DUE


def snapshots():
    for form in sorted(Fixture().docs.templates):
        f=Fixture()
        kind={'FM-07':'Inspection','FM-09':'Inspection','FM-13':'Action','FM-15':'WorkItem','FM-20':'InformationItem','FM-21':'Decision'}.get(form,'Requirement')
        if form in ['FM-07','FM-09']: record=f.inspect(f.inspection())
        elif form=='FM-13': record=f.complete_action(f.action())
        elif form=='FM-15': record=f.create('rfi',dict(title='질의',data={'question':'질의','response':'답변','changeRequired':False}),'CON')
        elif form=='FM-20': record=f.report()
        elif form=='FM-21': record=f.create('decision',dict(title='결정',options=[{'id':'A'}],impact={'quality':'영향'},recommendation='A',actionIds=[],dueAt=DUE))
        else: record=f.engine.get('Requirement',f.requirement)
        snapshot=f.docs.render(form,[f.ref(kind,record['id'])],f.form_data(form),*f.actors['SUP'],uid())
        yield form,snapshot,f.docs.rerender(snapshot['id'])


def long_snapshot(language):
    f=Fixture(); data=f.form_data('FM-22',28)
    for i,row in enumerate(data['items']):
        for key in row: row[key]=f'항목 {i+1:02} / kiểm tra {i+1:02}'
    data['items'][0]['issue']='장문 검증 및 시정조치. Nội dung kiểm tra và biện pháp khắc phục. '*15
    data['items'][-1]['issue']='LAST_ROW_MARKER 최종 확인 / xác nhận cuối cùng'
    snapshot=f.docs.render('FM-22',[f.ref('Requirement',f.requirement)],data,*f.actors['SUP'],uid(),language=language)
    return snapshot,f.docs.rerender(snapshot['id'])
