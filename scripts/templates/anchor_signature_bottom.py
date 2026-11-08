"""Move the signature block (the last two paragraphs: roles with ______ and the Name / Date line) of each DCiT Word
template into a borderless table floated to the bottom margin, so signatures and stamps always sit at the foot of
the page instead of right after the body (rule 2026-11-08). Usage: python3 anchor_sig.py <src_dir> <out_dir>"""
import sys, glob, os, re, copy
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

SKIP = {"02_Company_Information.docx", "18_Project_Report.docx", "01_Official_Letter.docx"}
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

def text(p): return "".join(t.text for t in p.iter(qn("w:t")))

for f in sorted(glob.glob(os.path.join(src, "*.docx"))):
    name = os.path.basename(f)
    d = Document(f)
    body = d.element.body
    if name in SKIP:
        d.save(os.path.join(out, name)); print("skip ", name); continue
    paras = [c for c in body if c.tag == qn("w:p")]
    # signature block = trailing paragraphs that contain '____' (roles line, name/date line), skipping empty ones
    sig = []
    for p in reversed(paras):
        t = text(p)
        if not t.strip(): continue
        if "____" in t or re.search(r"Name / ชื่อ|ลงนาม|ลงชื่อ", t): sig.insert(0, p)
        else: break
    if not sig: print("none ", name); continue
    # build floating 1x1 table anchored to the bottom margin
    tbl = OxmlElement("w:tbl")
    tblPr = OxmlElement("w:tblPr")
    pos = OxmlElement("w:tblpPr")
    for k, v in {"w:vertAnchor": "margin", "w:tblpYSpec": "bottom", "w:horzAnchor": "margin", "w:tblpXSpec": "center", "w:topFromText": "284"}.items(): pos.set(qn(k), v)
    tblPr.append(pos)
    w = OxmlElement("w:tblW"); w.set(qn("w:w"), "5000"); w.set(qn("w:type"), "pct"); tblPr.append(w)
    borders = OxmlElement("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement(f"w:{side}"); b.set(qn("w:val"), "nil"); borders.append(b)
    tblPr.append(borders)
    tbl.append(tblPr)
    grid = OxmlElement("w:tblGrid"); gc = OxmlElement("w:gridCol"); gc.set(qn("w:w"), "9638"); grid.append(gc); tbl.append(grid)
    tr = OxmlElement("w:tr"); tc = OxmlElement("w:tc")
    tcPr = OxmlElement("w:tcPr"); tcw = OxmlElement("w:tcW"); tcw.set(qn("w:w"), "5000"); tcw.set(qn("w:type"), "pct"); tcPr.append(tcw); tc.append(tcPr)
    # an empty spacer paragraph above the roles line leaves room for the stamp
    spacer = OxmlElement("w:p"); sp = OxmlElement("w:pPr"); spc = OxmlElement("w:spacing"); spc.set(qn("w:before"), "720"); sp.append(spc); spacer.append(sp); tc.append(spacer)
    anchor_index = list(body).index(sig[0])
    for p in sig:
        body.remove(p); tc.append(p)
    tr.append(tc); tbl.append(tr)
    # a table must be followed by a paragraph in the body; insert table where the block was, then an empty paragraph
    body.insert(anchor_index, tbl)
    body.insert(anchor_index + 1, OxmlElement("w:p"))
    d.save(os.path.join(out, name)); print("moved", name, "|", " / ".join(text(p)[:30] for p in sig))
