"""Record installed package/font provenance without exporting font binaries."""
from hashlib import sha256
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
from .render import VERSION


def inventory():
    fonts=[]
    for family in ('Noto Sans','Noto Sans CJK KR'):
        for style in ('Regular','Bold'):
            data=subprocess.check_output(['fc-match','-f','%{family}\n%{file}\n',family+':style='+style],text=True).splitlines()
            if family not in data[0] or not Path(data[1]).is_file(): raise RuntimeError('Required font unavailable')
            fonts.append(dict(family=family,style=style,actualFamily=data[0],path=data[1],sha256=sha256(Path(data[1]).read_bytes()).hexdigest()))
    packages=subprocess.check_output(['dpkg-query','-W','-f','${Package}=${Version}\n','libreoffice-writer','poppler-utils','fontconfig','fonts-noto-core','fonts-noto-cjk'],text=True).splitlines()
    licenses=[]
    for package in ('fonts-noto-core','fonts-noto-cjk'):
        path=Path('/usr/share/doc')/package/'copyright'
        licenses.append(dict(package=package,path=str(path),sha256=sha256(path.read_bytes()).hexdigest(),distribution='Debian package; upstream OFL/Apache notices retained in runtime'))
    return dict(rendererVersion=VERSION,python=sys.version.split()[0],packages=packages,
                pythonPackages={name:importlib.metadata.version(name) for name in ('python-docx','lxml')},
                libreoffice=subprocess.check_output(['soffice','--version'],text=True).strip(),fonts=fonts,licenses=licenses)


if __name__=='__main__':
    Path(sys.argv[1]).write_text(json.dumps(inventory(),ensure_ascii=False,sort_keys=True,indent=2))
