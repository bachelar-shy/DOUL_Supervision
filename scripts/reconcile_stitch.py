"""Reconcile server-side generated screens before any retry.

Some generation calls finish server-side even when the client reports an error.
Only missing codes are generated; wrong-format new screens get a separate edit.
Never delete or edit the two existing user screens. Sequential calls are deliberate.
"""
from datetime import datetime,timezone
import json
from pathlib import Path
import time
from stitch_screen_set import call,PROJECT,DESIGN,RAW,OUT,SPECS,screens


def listing():
    data=call('list_screens',{'projectId':PROJECT},90)
    RAW.joinpath('reconciled-list.json').write_text(json.dumps(data,ensure_ascii=False))
    return data.get('screens',[])


def by_code(rows,code):
    return [s for s in rows if code in s.get('title','')]


def main():
    manifest=json.loads((OUT/'screens.json').read_text())
    rows=listing();resolved=[];errors=[]
    for code,device,actor,title,route,description,commands in SPECS:
        matches=by_code(rows,code)
        if not matches:
            # A generated resource not yet listed can still be resolved by its ID.
            saved=next((s for s in manifest['screens'] if s['code']==code),None)
            if saved:
                try:
                    resource=call('get_screen',{'name':saved['resourceName']},90)
                    if resource.get('name'):matches=[resource]
                except RuntimeError:pass
        good=[s for s in matches if (int(s.get('width',0))<=900)==(device=='MOBILE')]
        selected=good[0] if good else matches[0] if matches else None
        prompt=('Create exactly ONE '+device+' screen. Title '+code+' | '+title+'. Korean operational DOUL supervision UI, white/gray and navy #17365D, small corners, no decorative gradients. Every example labelled 개발 미리보기 · 예시 데이터. '+('STRICT smartphone portrait, 390 CSS px wide, 844 CSS px tall with scroll. NO desktop sidebar or wide dashboard. Thumb-friendly bottom navigation. DO NOT generate a desktop version. ' if device=='MOBILE' else 'STRICT desktop workspace 1440 CSS px wide, sidebar and master-detail layout. ')+'Role '+actor+'. '+description)
        if not good:
            tool='edit_screens' if selected else 'generate_screen_from_text'
            args=dict(projectId=PROJECT,deviceType=device,modelId='GEMINI_3_8_FLASH',prompt=prompt)
            if selected:args['selectedScreenIds']=[selected['name'].split('/')[-1]]
            else:args['designSystem']=DESIGN
            try:
                result=call(tool,args,300)
                RAW.joinpath(code+'-reconciled.json').write_text(json.dumps(result,ensure_ascii=False))
                candidates=list(screens(result))
                formatted=[s for s in candidates if (int(s.get('width',0))<=900)==(device=='MOBILE')]
                if formatted:selected=formatted[0]
            except Exception as exc:
                print(code+' response '+type(exc).__name__+'; checking server before deciding',flush=True)
            rows=listing();matches=by_code(rows,code)
            formatted=[s for s in matches if (int(s.get('width',0))<=900)==(device=='MOBILE')]
            if formatted:selected=formatted[0]
        if not selected:
            errors.append(dict(code=code,error='not_found_after_readback'));continue
        sid=selected['name'].split('/')[-1]
        # Read the selected resource individually, not only its generation response.
        try:
            detail=call('get_screen',{'name':selected['name']},90)
            RAW.joinpath(code+'-verified.json').write_text(json.dumps(detail,ensure_ascii=False))
            width=int(detail.get('width',selected.get('width',0)))
            ok=(width<=900)==(device=='MOBILE')
            resolved.append(dict(code=code,title=title,actor=actor,surface=device.lower(),route=route,commands=commands,stitchScreenId=sid,resourceName=selected['name'],width=width,height=detail.get('height'),readbackVerified=True,formatVerified=ok,status='generated_not_user_approved'))
            if not ok:errors.append(dict(code=code,error='wrong_surface_dimensions'))
            print(code+' verified '+sid+' width='+str(width),flush=True)
        except Exception as exc:errors.append(dict(code=code,error='readback_'+type(exc).__name__))
        manifest.update(screens=resolved,errors=errors)
        (OUT/'screens.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    final=listing();ids={s['name'].split('/')[-1] for s in final}
    manifest.update(screens=resolved,errors=errors,readbackVerified=all(s.get('readbackVerified') for s in resolved),preservedVerified=all(i in ids for i in manifest['preservedScreenIds']),verifiedAt=datetime.now(timezone.utc).isoformat())
    (OUT/'screens.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'screens':len(resolved),'errors':errors,'preserved':manifest['preservedVerified']}),flush=True)

if __name__=='__main__':main()
