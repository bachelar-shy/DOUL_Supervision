"""Reproducible fictional WWT factory working documents for real API verification.

Source photos are cropped views of ONE generated contact sheet. None is a
photograph of a real site. PDFs are synthetic vector shop/inspection references,
not approved shop drawings or legal reports.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
from hashlib import sha256
import json
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
CONTACT = ROOT / "design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png"
DISCIPLINES = (
    ("ARC", "ARCHITECTURE", ["General arrangement ground floor", "Partition layout and openings", "Roof waterproofing details", "Facade access and flashing", "Doors and fire compartmentation"]),
    ("STR", "STRUCTURE", ["Rebar slab 2F grid B-D", "Slab sections and cover dimensions", "Column reinforcement schedule", "Baseplate and anchor bolts", "Structural joint details"]),
    ("MEP", "MECHANICAL", ["WWT DN110 pipe network", "FRP tank and flange connections", "Pump room piping section", "Ventilation service routing", "Drainage pipe testing points"]),
    ("ELE", "ELECTRICAL", ["Cable trays ground floor", "LV switchboard arrangement", "Grounding and bonding layout", "Lighting and emergency circuits", "Fire alarm device locations"]),
)
LOCATIONS = [
    ("A-GF", "A동 지상1층 / 구조·건축", "A동", "1F"),
    ("A-2F-B", "A동 2층 / B~D 그리드", "A동", "2F"),
    ("A-2F-C", "A동 2층 / C-5", "A동", "2F"),
    ("A-RF", "A동 지붕 / 방수", "A동", "RF"),
    ("A-EXT", "A동 외벽 / 파사드", "A동", "EXT"),
    ("B-GF", "B동 1층 / 설치구역", "B동", "1F"),
    ("B-PUMP", "B동 펌프실", "B동", "B1"),
    ("B-CTRL", "B동 전기실", "B동", "1F"),
    ("WWT-T01", "WWT 탱크 T-01", "WWT", "T-01"),
    ("WWT-T02", "WWT 탱크 T-02", "WWT", "T-02"),
    ("WWT-P01", "WWT 배관 트렌치 P-01", "WWT", "P-01"),
    ("WWT-P02", "WWT 배관 트렌치 P-02", "WWT", "P-02"),
    ("WWT-FRP", "WWT FRP 배관 플랜지", "WWT", "FRP"),
    ("YARD", "옥외 야적·하역장", "옥외", "YARD"),
    ("UTILITY", "유틸리티 시설", "설비", "UTILITY"),
]
INSPECTION_TYPES = [
    ("STR", "2층 슬래브 배근 간격 검측", "A-2F-B", "UC-05", "S-201"),
    ("STR", "기둥 철근 피복두께 확인", "A-2F-C", "UC-04", "S-202"),
    ("ARC", "옥상 방수 바탕 및 겹침길이 검측", "A-RF", "UC-03", "A-203"),
    ("ARC", "경량벽체 골조 수직도 검측", "A-2F-C", "UC-02", "A-202"),
    ("MEP", "DN110 배수관 구배 및 연결부 검측", "WWT-P01", "UC-05", "M-201"),
    ("MEP", "FRP 플랜지 볼트·가스켓 설치 확인", "WWT-FRP", "UC-06", "M-202"),
    ("MEP", "펌프실 배관 내압시험", "B-PUMP", "UC-07", "M-203"),
    ("ELE", "케이블트레이 지지간격 확인", "B-CTRL", "UC-08", "E-201"),
    ("ELE", "접지선 접속상태 확인", "B-CTRL", "UC-09", "E-203"),
    ("ARC", "방화문 설치·개폐 및 실링 확인", "A-GF", "UC-10", "A-205"),
]



def _png_chunks(data: bytes):
    pos=8
    while pos+12 <= len(data):
        length=struct.unpack(">I",data[pos:pos+4])[0]
        kind=data[pos+4:pos+8]
        payload=data[pos+8:pos+8+length]
        yield kind,payload
        pos+=12+length
        if kind==b"IEND":break


def decode_rgb_png(content: bytes):
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Not PNG")
    chunks=list(_png_chunks(content))
    ihdr=next(payload for kind,payload in chunks if kind==b"IHDR")
    width,height,depth,color,compression,filter_mode,interlace=struct.unpack(">IIBBBBB",ihdr)
    if (depth,color,compression,filter_mode,interlace)!=(8,2,0,0,0):
        raise ValueError("Synthetic source must be 8-bit RGB noninterlaced PNG")
    unpacked=zlib.decompress(b"".join(payload for kind,payload in chunks if kind==b"IDAT"))
    stride=width*3
    result=[]
    previous=bytes(stride)
    pos=0
    for _ in range(height):
        filter_type=unpacked[pos];pos+=1
        row=bytearray(unpacked[pos:pos+stride]);pos+=stride
        for i in range(stride):
            a=row[i-3] if i>=3 else 0
            b=previous[i]
            c=previous[i-3] if i>=3 else 0
            if filter_type==1:row[i]=(row[i]+a)&255
            elif filter_type==2:row[i]=(row[i]+b)&255
            elif filter_type==3:row[i]=(row[i]+((a+b)//2))&255
            elif filter_type==4:
                p=a+b-c
                distances=(abs(p-a),abs(p-b),abs(p-c))
                predictor=(a,b,c)[distances.index(min(distances))]
                row[i]=(row[i]+predictor)&255
            elif filter_type!=0:raise ValueError("Unknown PNG filter")
        previous=bytes(row)
        result.append(previous)
    return width,height,result


def _png_chunk(kind: bytes,body: bytes):
    return struct.pack(">I",len(body))+kind+body+struct.pack(">I",zlib.crc32(kind+body)&0xffffffff)


def write_png_crop(image, x: int, y: int, width: int, height: int, output: Path):
    source_width,source_height,rows=image
    if x<0 or y<0 or x+width>source_width or y+height>source_height:
        raise ValueError("Synthetic crop outside source image")
    raw=b"".join(b"\0"+row[x*3:(x+width)*3] for row in rows[y:y+height])
    ihdr=struct.pack(">IIBBBBB",width,height,8,2,0,0,0)
    output.write_bytes(b"\x89PNG\r\n\x1a\n"
                       +_png_chunk(b"IHDR",ihdr)
                       +_png_chunk(b"IDAT",zlib.compress(raw,6))
                       +_png_chunk(b"IEND",b""))


def _t(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf(lines: list[str], out: Path):
    """Write valid single-page, vector/text PDF using only standard library."""
    commands = "\n".join(lines).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Length " + str(len(commands)).encode() + b" >>\nstream\n" + commands + b"\nendstream",
    ]
    payload = bytearray(b"%PDF-1.4\n% SYNTHETIC TEST - NOT FOR CONSTRUCTION\n")
    offsets = [0]
    for i, item in enumerate(objects, start=1):
        offsets.append(len(payload))
        payload.extend(f"{i} 0 obj\n".encode() + item + b"\nendobj\n")
    start = len(payload)
    payload.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        payload.extend(f"{offset:010d} 00000 n \n".encode())
    payload.extend(f"trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    out.write_bytes(payload)


def _txt(x, y, text, size=11, bold=False):
    return f"BT /F{2 if bold else 1} {size} Tf {x} {y} Td ({_t(text)}) Tj ET"


def _line(x1, y1, x2, y2):
    return f"{x1} {y1} m {x2} {y2} l S"


def _rect(x, y, w, h):
    return f"{x} {y} {w} {h} re S"


def create_drawing(code, rev, discipline, title, seq, path):
    l = ["0.18 0.22 0.29 RG", "0.7 w", _rect(34, 38, 1122, 766),
         _line(34, 145, 1156, 145), _line(857, 38, 857, 145), "1.5 w",
         _txt(52, 778, "DOUL SAMPLE - WWT FACTORY", 18, True),
         _txt(52, 756, "SYNTHETIC TEST DRAWING - NOT FOR CONSTRUCTION", 11),
         _txt(52, 723, f"{discipline} / {title.upper()}", 14, True),
         _txt(56, 118, f"DRAWING  {code}", 14, True),
         _txt(56, 93, f"REVISION {rev}    SHEET 01/01   SCALE 1:100 @ A3", 11),
         _txt(56, 65, "PROJECT: DOUL SAMPLE / WWT FACTORY - HANOI", 11),
         _txt(877, 122, f"CHECK: TEST ONLY    REV: {rev}", 11, True),
         _txt(877, 96, "ORIGIN: SYNTHETIC FIXTURE", 10),
         _txt(877, 68, "DRAWN: 2026-09-10", 10)]
    for idx in range(7):
        x=94+idx*104
        l.extend(["0.70 0.74 0.79 RG", "0.35 w",_line(x,231,x,694),
                  "0.18 0.22 0.29 RG",_txt(x-5,703,str(idx+1),10,True)])
    for idx in range(5):
        y=238+idx*101
        l.extend(["0.70 0.74 0.79 RG","0.35 w",_line(86,y,800,y),
                  "0.18 0.22 0.29 RG",_txt(71,y-4,chr(65+idx),10,True)])
    for idx in range(6):
        for j in range(4):
            x=94+idx*104;y=238+j*101
            l.extend(["0.22 0.28 0.35 RG","1.1 w",_rect(x+8,y+8,87,84),
                      "0.74 0.79 0.84 RG","0.5 w",_line(x+8,y+8,x+95,y+92)])
            if discipline=="STRUCTURE":
                for k in range(5):
                    l.extend(["0.22 0.28 0.35 RG",_line(x+17+k*16,y+13,x+17+k*16,y+86)])
            elif discipline=="MECHANICAL":
                l.extend(["0.12 0.40 0.57 RG","2.5 w",_line(x+13,y+30,x+82,y+30),_line(x+82,y+30,x+82,y+70)])
            elif discipline=="ELECTRICAL":
                l.extend(["0.40 0.37 0.20 RG","2 w",_line(x+14,y+55,x+78,y+55),_txt(x+22,y+35,"DB",8)])
    l.extend(["0.18 0.22 0.29 RG","1 w",_rect(868,430,264,300),
              _txt(884,706,"GENERAL NOTES",12,True),
              _txt(884,677,"1. DIMENSIONS IN MILLIMETRES",9),
              _txt(884,654,"2. VERIFY ALL SITE LEVELS",9),
              _txt(884,631,"3. NO FABRICATION FROM PDF",9),
              _txt(884,608,"4. AUTHORISED REVISION ONLY",9),
              _txt(884,585,f"5. TRADE: {discipline}",9),
              _txt(884,562,f"6. GRID REFERENCE: {seq + 1:02d}",9),
              _txt(884,539,"7. TEST DATA / NOT APPROVED",9),
              _txt(884,513,"REFERENCE DIMENSIONS",10,True),
              _txt(884,490,f"SPAN = {6000 + seq*250} MM (FICTIONAL)",9),
              _txt(884,467,"DRAWING REFERENCES",10,True),
              _txt(884,445,"SCOPE / LOCATION DEMO ONLY",9)])
    _pdf(l,path)


def create_report(no, day, subject, issues, checks, path):
    l=["0.18 0.22 0.28 RG", "0.7 w", _rect(36,42,1118,756),
       _txt(65,761,"DOUL / SUPERVISION REPORT",24,True),
       _txt(65,733,"SYNTHETIC TEST DOCUMENT - NOT A VALID SITE REPORT",12),
       _txt(65,697,f"REPORT NO: DR-{no:03d}   DATE: {day.isoformat()}  LOCATION: HANOI WWT",13,True),
       _line(65,679,1125,679), _txt(65,648,f"SUBJECT: {subject.upper()}",13,True),
       _txt(65,615,"1. WORK COMPLETED / OBSERVATIONS",12,True),
       _txt(78,587,"WWT piping and building coordination walk-through / synthetic project."),
       _txt(78,560,f"Daily inspections checked: {checks}; Open observations: {issues} (fictional figures)."),
       _txt(65,510,"2. QUALITY / CORRECTIVE ACTIONS",12,True),
       _txt(78,483,"Measurements and photo references are simulation inputs; no compliance certified."),
       _txt(78,456,"Use exact document revision and location when raising inspection requests."),
       _txt(65,405,"3. ACTIONS / RECIPIENTS",12,True),
       _txt(78,378,"CON: Submit correction and inspection evidence when applicable."),
       _txt(78,352,"SUP: Verify rectification and record explicit re-inspection."),
       _txt(78,326,"OWN: Receive information and respond separately from issue closure."),
       _line(65,251,1125,251), _txt(70,215,"PREPARED BY: SYNTHETIC SUPERVISOR",11,True),
       _txt(70,188,"STATUS: DEMONSTRATION / UNSIGNED / UNISSUED",10),
       _txt(70,155,"REVISION: 01         DOCUMENT CLASS: INTERNAL TRAINING FIXTURE",10),
       _txt(70,92,"This file is not an approved site record, signature, legal notice or payment certificate.",10)]
    _pdf(l,path)


def build(output: Path):
    output.mkdir(parents=True,exist_ok=True)
    drawings = output/"drawings";photos=output/"photos";reports=output/"reports"
    for folder in (drawings, photos, reports):folder.mkdir(exist_ok=True)
    manifest = {"classification":"SYNTHETIC_NOT_SITE_EVIDENCE","photoSource":"one_generated_contact_sheet_12_panels",
                "sourceSha256":sha256(CONTACT.read_bytes()).hexdigest(),"drawings":[],"photos":[],"reports":[]}
    names={"ARC":"A","STR":"S","MEP":"M","ELE":"E"}
    for discipline,title,subjects in DISCIPLINES:
        for idx,subject in enumerate(subjects):
            code=f"{names[discipline]}-{201+idx}"
            rev="B" if idx==0 else "A"
            path=drawings/f"SYNTHETIC_{code}_REV-{rev}.pdf"
            create_drawing(code,rev,title,subject,idx,path)
            manifest["drawings"].append(dict(code=code,revision=rev,discipline=discipline,title=subject,file=str(path.relative_to(output)),sha256=sha256(path.read_bytes()).hexdigest(),date="2026-09-10"))
            if idx==0:
                old=drawings/f"SYNTHETIC_{code}_REV-A.pdf"
                create_drawing(code,"A",title,subject,idx,old)
                manifest["drawings"].insert(-1,dict(code=code,revision="A",discipline=discipline,title=subject,
                    file=str(old.relative_to(output)),sha256=sha256(old.read_bytes()).hexdigest(),date="2026-08-15",supersededBy="B"))
    for i in range(10):
        dt=date(2026,9,7)+timedelta(days=3*i)
        subject=f"FIELD CHECK {i+1:03d} / {INSPECTION_TYPES[i][0]} / {INSPECTION_TYPES[i][2]}"
        path=reports/f"SYNTHETIC_DAILY_REPORT_{i+1:03d}.pdf"
        create_report(i+1,dt,subject,i%6+1,3+(i%5),path)
        manifest["reports"].append(dict(id=f"DR-{i+1:03d}",day=dt.isoformat(),title=subject,file=str(path.relative_to(output)),sha256=sha256(path.read_bytes()).hexdigest()))
    image=decode_rgb_png(CONTACT.read_bytes())
    # 4 columns x 3 rows of illustrative views. The 60 outputs are DERIVED
    # crops from 12 panels, NEVER 60 camera originals. Preserve this lineage.
    for row in range(3):
        for col in range(4):
            panel=row*4+col+1
            for view in range(5):
                y=row*341 + (10 if view%2==0 else 18)
                x=col*384 + (10 if view%2==0 else 18)
                height=320-(view%3)*10
                width=360-(view%2)*15
                path=photos/f"SYNTHETIC_PANEL-P{panel:02d}_VIEW-{view+1:02d}.png"
                write_png_crop(image,x,y,width,height,path)
                manifest["photos"].append(dict(id=f"P{panel:02d}-V{view+1:02d}",sourcePanel=f"P{panel:02d}",derived=True,
                    stage=("initial","progress","detail","correction","reinspection")[view],
                    file=str(path.relative_to(output)),sha256=sha256(path.read_bytes()).hexdigest(),
                    capturedAt=(date(2026,9,7)+timedelta(days=(panel+view)%30)).isoformat()+"T08:30:00+07:00"))
    with (output/"inspection-register.csv").open("w",newline="",encoding="utf-8-sig") as file:
        writer=csv.writer(file);writer.writerow(["검측번호","공종","검측항목","위치코드","검측예정일","관련도면","시험상태","사례번호"])
        for idx in range(40):
            disc,desc,location,case,drawing=INSPECTION_TYPES[idx%10]
            day=date(2026,9,7)+timedelta(days=(idx*3)%30)
            writer.writerow([f"INSP-{idx+1:04d}",disc,desc,location,day.isoformat(),drawing,
                             ["요청","예정","검측중","적합","재검측 대기"][idx%5],case])
    with (output/"site-events.csv").open("w",newline="",encoding="utf-8-sig") as file:
        writer=csv.writer(file);writer.writerow(["사건번호","검측번호","일자","위치","유형","지적사항","책임자","기한","상태"])
        notes=["슬래브 철근 간격 확인","FRP 플랜지 체결 상태","옥상 방수 겹침길이","케이블 트레이 지지부 누락","DN110 배수관 구배 재측정"]
        for idx in range(15):
            day=date(2026,9,9)+timedelta(days=idx*2)
            writer.writerow([f"NCR-{idx+1:04d}",f"INSP-{(idx%40)+1:04d}",day.isoformat(),LOCATIONS[idx][0],
                "시정조치",notes[idx%5],"SYNTHETIC 시공사 기술담당", (day+timedelta(days=3)).isoformat(),
                ["미조치","진행중","재확인 대기","종결","기한초과"][idx%5]])
    (output/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return {"drawings":len(manifest["drawings"]),"photos":len(manifest["photos"]),"reports":len(manifest["reports"]),
            "photoProvenance":manifest["photoSource"],"output":str(output)}


if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--output",required=True)
    args=parser.parse_args()
    print(json.dumps(build(Path(args.output)),ensure_ascii=False,indent=2))
