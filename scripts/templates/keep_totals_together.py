"""One-off (2026-11-25): the totals block of a printed paper must not break across two pages (小计 at the foot of page 1,
VAT and total on page 2). The block is a one-row outer table holding the totals table; this marks that row cantSplit in
the committed templates. build_finance_templates.totals_block does the same for templates built from now on.
The templates are patched in place rather than rebuilt: they carry corrections made after the builders last ran."""
import glob
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
for f in sorted(glob.glob("templates/word/*.docx")):
    d = Document(f); n = 0
    for t in d.tables:
        if len(t.rows) != 1: continue
        row = t.rows[0]
        if not any(c.tables and "[[TOTAL]]" in "".join(x.text for nt in c.tables for r in nt.rows for x in r.cells) for c in row.cells): continue
        pr = row._tr.get_or_add_trPr()
        if pr.find(qn("w:cantSplit")) is None: pr.append(OxmlElement("w:cantSplit")); n += 1
    if n: d.save(f); print(f.split("/")[-1], n)
