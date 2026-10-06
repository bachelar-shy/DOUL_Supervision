"""Real LO/Poppler regression images from frozen Product fixture snapshots."""
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

from services.document_runtime.render import LocalDocumentRuntime
from tests_runtime.document_fixtures import snapshots,long_snapshot


def command(args):
    return subprocess.check_output(args,stderr=subprocess.STDOUT,timeout=120)


def main():
    output=Path(sys.argv[1]);output.mkdir(parents=True,exist_ok=True,mode=0o700)
    cache=output/'private-cache';runtime=LocalDocumentRuntime(cache)
    selected={name:(snapshot,html) for name,snapshot,html in snapshots() if name in {'FM-09','FM-20'}}
    selected['long-ko']=long_snapshot('ko');selected['long-vi']=long_snapshot('vi')
    reports=[]
    for name,(snapshot,html) in selected.items():
        folder=output/name;folder.mkdir(mode=0o700)
        before=sha256(html).hexdigest()
        first=runtime.export(snapshot,html,'pdf')
        for format in ['docx','pdf']:
            result=runtime.export(snapshot,html,format)
            (folder/('document.'+format)).write_bytes(result['content'])
            assert sha256(result['content']).hexdigest()==result['sha256']
        assert first['content']==runtime.export(snapshot,html,'pdf')['content']
        assert sha256(html).hexdigest()==before
        command(['pdftoppm','-r','110','-png',str(folder/'document.pdf'),str(folder/'page')])
        text=command(['pdftotext','-layout',str(folder/'document.pdf'),'-']).decode('utf-8')
        assert '\ufffd' not in text
        assert 'DOUL INTERNATIONAL' in text
        if name.startswith('long'):
            assert 'LAST_ROW_MARKER' in text and 'khắc' in text and '장문' in text
        command(['pdftotext','-bbox',str(folder/'document.pdf'),str(folder/'bounds.html')])
        root=ET.parse(folder/'bounds.html').getroot()
        pages=root.findall('.//{http://www.w3.org/1999/xhtml}page')
        if not pages: pages=[node for node in root.iter() if node.tag.endswith('page')]
        assert pages
        for page in pages:
            width,height=float(page.attrib['width']),float(page.attrib['height'])
            assert abs(width-595.276)<2 and abs(height-841.89)<2,'page is not A4'
            for word in page.iter():
                if not word.tag.endswith('word'):continue
                assert float(word.attrib['xMin'])>=0 and float(word.attrib['yMin'])>=0
                assert float(word.attrib['xMax'])<=width and float(word.attrib['yMax'])<=height,'text is outside page'
        if name.startswith('long'): assert len(pages)>=2,'long table did not exercise pagination'
        fonts=command(['pdffonts',str(folder/'document.pdf')]).decode()
        assert 'Noto' in fonts
        (folder/'fonts.txt').write_text(fonts)
        # Cache-free conversion must produce the same visual pages. PDF timestamps
        # can differ; immutable cached output bytes may not be rewritten.
        with tempfile.TemporaryDirectory(prefix='fresh-render-') as temp:
            independent=LocalDocumentRuntime(Path(temp)/'cache').export(snapshot,html,'pdf')
            pdf=Path(temp)/'fresh.pdf';pdf.write_bytes(independent['content'])
            command(['pdftoppm','-r','110','-png',str(pdf),str(Path(temp)/'page')])
            first_pages=sorted(folder.glob('page-*.png'));second_pages=sorted(Path(temp).glob('page-*.png'))
            assert len(first_pages)==len(second_pages)
            for left,right in zip(first_pages,second_pages): assert left.read_bytes()==right.read_bytes(),'rendered pixels drifted'
        (folder/'artifact-manifest.json').write_text(json.dumps(first['manifest'],ensure_ascii=False,sort_keys=True,indent=2))
        reports.append(dict(fixture=name,pages=len(pages),sourceHash=before,pdfHash=first['sha256'],pixelRepeatability=True))
    # Publish only QA images/output metadata, never cache copies or font binaries.
    import shutil
    shutil.rmtree(cache)
    (output/'runtime-inventory.json').write_text(json.dumps(runtime.descriptor,ensure_ascii=False,sort_keys=True,indent=2))
    (output/'verification.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
    print(json.dumps(reports,sort_keys=True))


if __name__=='__main__':main()
