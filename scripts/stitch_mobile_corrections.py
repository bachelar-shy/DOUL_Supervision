"""Create explicitly mobile replacement designs, preserving earlier references."""
from pathlib import Path
import json,subprocess
from stitch_screen_set import CONFIG,PROJECT,DESIGN,RAW,SPECS,screens
from stitch_long_request import wrapper

def main():
 for code in ['SUP-INSPECTION-M','SUP-CAPTURE-M','CON-CORRECTION-M']:
  spec=next(s for s in SPECS if s[0]==code)
  prompt='Create ONE smartphone app screen. Strict device: MOBILE. Portrait 390 CSS pixels wide. Single column mobile layout. Title: '+code+' v2 | '+spec[3]+'. Use Korean text, navy #17365D, white cards, light gray background, compact 4px corners. No sidebar. No multi-column workspace. No surrounding presentation board. Use a 390 by 844 smartphone viewport and natural vertical scroll. All data clearly labelled 예시 데이터. This is a native field app screen. Preserve existing screens. '+spec[5]+' Keep UI content within mobile viewport width.'
  args=dict(projectId=PROJECT,designSystem=DESIGN,deviceType='MOBILE',modelId='GEMINI_3_8_FLASH',prompt=prompt)
  p=subprocess.run(['node',str(wrapper()),'--config',str(CONFIG),'--server','stitch','--method','tools/call','--tool-name','generate_screen_from_text','--tool-args-json',json.dumps(args,ensure_ascii=False),'--format','json'],capture_output=True,text=True,timeout=350)
  RAW.joinpath(code+'-mobile-v2-response.json').write_text(p.stdout)
  RAW.joinpath(code+'-mobile-v2-error.log').write_text(p.stderr)
  try:
   r=json.loads(p.stdout).get('result',{});d=r.get('structuredContent')
   if d is None:d=next((json.loads(c['text']) for c in r.get('content',[]) if c.get('type')=='text'),{})
   results=[dict(name=s['name'],title=s.get('title'),width=s.get('width')) for s in screens(d)]
   print(code,'exit',p.returncode,'isError',r.get('isError'),results,flush=True)
   if p.returncode:print('error_code',json.loads(p.stdout).get('error',{}).get('code'),flush=True)
  except ValueError:print(code,'non-json response',p.returncode,flush=True)
if __name__=='__main__':main()
