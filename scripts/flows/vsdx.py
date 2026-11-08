"""
Minimal .vsdx writer for swimlane flowcharts (no stencils needed; Visio and LibreOffice Draw open it).
Units: inches. Shapes get four connection points (top/right/bottom/left) so connectors stay glued when moved.
"""
import zipfile
from xml.sax.saxutils import escape

NS = 'xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

def _cell(n, v, f=None):
    return f'<Cell N="{n}" V="{v}"' + (f' F="{escape(f)}"' if f else "") + "/>"

class Page:
    def __init__(self, width, height):
        self.w, self.h = width, height
        self.shapes = []   # xml strings
        self.connects = [] # xml strings
        self._id = 0

    def nid(self):
        self._id += 1
        return self._id

    # ── 2-D shapes ───────────────────────────────────────────────────────────────────────────────────────
    def box(self, x, y, w, h, text="", kind="rect", fill="#FFFFFF", line="#1F3864", lw=0.0138, font=8, bold=False, color="#000000", align=1, dash=0, rounding=0.0, textdir=0):
        """x,y = centre. kind: rect | diamond | document | terminator | none(text only)."""
        i = self.nid()
        geom = self._geometry(kind, w, h, rounding)
        cells = [_cell("PinX", x), _cell("PinY", y), _cell("Width", w), _cell("Height", h), _cell("LocPinX", w / 2, "Width*0.5"), _cell("LocPinY", h / 2, "Height*0.5"),
                 _cell("LineWeight", lw), _cell("LineColor", line), _cell("FillForegnd", fill), _cell("LinePattern", 0 if kind == "none" else (2 if dash else 1)),
                 _cell("FillPattern", 0 if kind == "none" else 1), _cell("Rounding", (h/2 if kind == "terminator" else rounding)), _cell("VerticalAlign", 1), _cell("TextDirection", textdir)]
        char = f'<Section N="Character"><Row IX="0">{_cell("Font", 4)}{_cell("Color", color)}{_cell("Style", 1 if bold else 0)}{_cell("Size", font / 72)}{_cell("AsianFont", 4)}{_cell("ComplexScriptFont", 4)}</Row></Section>'
        para = f'<Section N="Paragraph"><Row IX="0">{_cell("HorzAlign", align)}</Row></Section>'
        conns = ('<Section N="Connection">'
                 f'<Row IX="0">{_cell("X", w/2, "Width*0.5")}{_cell("Y", h, "Height*1")}</Row>'     # top
                 f'<Row IX="1">{_cell("X", w, "Width*1")}{_cell("Y", h/2, "Height*0.5")}</Row>'     # right
                 f'<Row IX="2">{_cell("X", w/2, "Width*0.5")}{_cell("Y", 0, "Height*0")}</Row>'     # bottom
                 f'<Row IX="3">{_cell("X", 0, "Width*0")}{_cell("Y", h/2, "Height*0.5")}</Row>'     # left
                 '</Section>')
        txt = f"<Text>{escape(text)}</Text>" if text else ""
        self.shapes.append(f'<Shape ID="{i}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">{"".join(cells)}{char}{para}{conns}{geom}{txt}</Shape>')
        return i

    @staticmethod
    def _geometry(kind, w, h, r):
        g = '<Section N="Geometry" IX="0">' + _cell("NoFill", 0) + _cell("NoLine", 0)
        def pt(ix, kind_, x, y, extra=""):
            return f'<Row T="{kind_}" IX="{ix}">{_cell("X", x)}{_cell("Y", y)}{extra}</Row>'
        if kind == "diamond":
            g += pt(1, "MoveTo", 0, h/2) + pt(2, "LineTo", w/2, h) + pt(3, "LineTo", w, h/2) + pt(4, "LineTo", w/2, 0) + pt(5, "LineTo", 0, h/2)
        elif kind == "document":
            g += pt(1, "MoveTo", 0, h*0.12) + pt(2, "LineTo", 0, h) + pt(3, "LineTo", w, h) + pt(4, "LineTo", w, h*0.12) \
               + f'<Row T="ArcTo" IX="5">{_cell("X", w*0.5)}{_cell("Y", h*0.12)}{_cell("A", -h*0.08)}</Row>' \
               + f'<Row T="ArcTo" IX="6">{_cell("X", 0)}{_cell("Y", h*0.12)}{_cell("A", h*0.08)}</Row>'
        elif kind == "terminator":  # stadium: drawn as a rectangle with full rounding (Rounding cell set by caller)
            g += pt(1, "RelMoveTo", 0, 0) + pt(2, "RelLineTo", 1, 0) + pt(3, "RelLineTo", 1, 1) + pt(4, "RelLineTo", 0, 1) + pt(5, "RelLineTo", 0, 0)
        else:  # rect / none
            g += pt(1, "RelMoveTo", 0, 0) + pt(2, "RelLineTo", 1, 0) + pt(3, "RelLineTo", 1, 1) + pt(4, "RelLineTo", 0, 1) + pt(5, "RelLineTo", 0, 0)
        return g + "</Section>"

    # ── connectors ───────────────────────────────────────────────────────────────────────────────────────
    def connector(self, points, from_id=None, from_side=None, to_id=None, to_side=None, label="", label_at=None, color="#1F3864", lw=0.0138, arrow=True):
        """points: absolute (x, y) list from start to end. from/to glue by connection point index (0 top,1 right,2 bottom,3 left)."""
        i = self.nid()
        (x0, y0), (xn, yn) = points[0], points[-1]
        w = max(xn - x0, 1e-6)
        cells = [_cell("PinX", x0), _cell("PinY", y0), _cell("Width", w), _cell("Height", 0), _cell("LocPinX", 0), _cell("LocPinY", 0), _cell("Angle", 0),
                 _cell("BeginX", x0), _cell("BeginY", y0), _cell("EndX", xn), _cell("EndY", yn), _cell("ObjType", 2),
                 _cell("LineWeight", lw), _cell("LineColor", color), _cell("EndArrow", 4 if arrow else 0), _cell("EndArrowSize", 1), _cell("FillPattern", 0),
                 _cell("TxtPinX", 0), _cell("TxtPinY", 0), _cell("TxtWidth", 1.3), _cell("TxtHeight", 0.18), _cell("TxtLocPinX", 0.65), _cell("TxtLocPinY", 0.09)]
        if from_id is not None:
            cells[7] = _cell("BeginX", x0, f"PAR(PNT(Sheet.{from_id}!Connections.X{from_side+1},Sheet.{from_id}!Connections.Y{from_side+1}))")
            cells[8] = _cell("BeginY", y0, f"PAR(PNT(Sheet.{from_id}!Connections.X{from_side+1},Sheet.{from_id}!Connections.Y{from_side+1}))")
            self.connects.append(f'<Connect FromSheet="{i}" FromCell="BeginX" FromPart="9" ToSheet="{from_id}" ToCell="Connections.X{from_side+1}" ToPart="{100+from_side}"/>')
        if to_id is not None:
            cells[9] = _cell("EndX", xn, f"PAR(PNT(Sheet.{to_id}!Connections.X{to_side+1},Sheet.{to_id}!Connections.Y{to_side+1}))")
            cells[10] = _cell("EndY", yn, f"PAR(PNT(Sheet.{to_id}!Connections.X{to_side+1},Sheet.{to_id}!Connections.Y{to_side+1}))")
            self.connects.append(f'<Connect FromSheet="{i}" FromCell="EndX" FromPart="12" ToSheet="{to_id}" ToCell="Connections.X{to_side+1}" ToPart="{100+to_side}"/>')
        # geometry relative to begin point, Width-scaled on X (1-D shape local coords: x along the shape width, y absolute offset)
        geom = '<Section N="Geometry" IX="0">' + _cell("NoFill", 1) + _cell("NoLine", 0)
        for k, (px, py) in enumerate(points):
            geom += f'<Row T="{"MoveTo" if k == 0 else "LineTo"}" IX="{k+1}">{_cell("X", px - x0)}{_cell("Y", py - y0)}</Row>'
        geom += "</Section>"
        txt = ""
        if label:
            lx, ly = label_at if label_at else ((points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2)
            cells += [_cell("TxtPinX", lx - x0), _cell("TxtPinY", ly - y0)]
            txt = f'<Section N="Character"><Row IX="0">{_cell("Font", 4)}{_cell("Size", 7/72)}{_cell("AsianFont", 4)}</Row></Section><Text>{escape(label)}</Text>'
        self.shapes.append(f'<Shape ID="{i}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">{"".join(cells)}{geom}{txt}</Shape>')
        return i

    def xml(self):
        return (f'<?xml version="1.0" encoding="utf-8"?><PageContents {NS}><Shapes>{"".join(self.shapes)}</Shapes>'
                f'<Connects>{"".join(self.connects)}</Connects></PageContents>')


def write_vsdx(path, page: Page, title="Flow", page_name="Page-1"):
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>'
            '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>'
            '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>'
            '<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
        "docProps/core.xml": f'<?xml version="1.0" encoding="utf-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{escape(title)}</dc:title><dc:creator>DCiT</dc:creator></cp:coreProperties>',
        "docProps/app.xml": '<?xml version="1.0" encoding="utf-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Visio</Application></Properties>',
        "visio/document.xml": f'<?xml version="1.0" encoding="utf-8"?><VisioDocument {NS}><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"/>'
            '<FaceNames><FaceName NameU="Helvetica" Name="Helvetica" ID="4"/></FaceNames>'
            '<StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"><Cell N="EnableLineProps" V="1"/><Cell N="EnableFillProps" V="1"/><Cell N="EnableTextProps" V="1"/>'
            '<Cell N="LineWeight" V="0.01"/><Cell N="LineColor" V="#000000"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="#FFFFFF"/><Cell N="FillBkgnd" V="#FFFFFF"/><Cell N="FillPattern" V="1"/>'
            '<Cell N="TextBkgnd" V="0"/><Cell N="TopMargin" V="0.02"/><Cell N="BottomMargin" V="0.02"/><Cell N="LeftMargin" V="0.03"/><Cell N="RightMargin" V="0.03"/>'
            '<Section N="Character"><Row IX="0"><Cell N="Font" V="4"/><Cell N="Size" V="0.1111"/><Cell N="Color" V="#000000"/></Row></Section>'
            '<Section N="Paragraph"><Row IX="0"><Cell N="HorzAlign" V="1"/></Row></Section></StyleSheet></StyleSheets></VisioDocument>',
        "visio/_rels/document.xml.rels": '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/></Relationships>',
        "visio/windows.xml": f'<?xml version="1.0" encoding="utf-8"?><Windows {NS} ClientWidth="1600" ClientHeight="900"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="0" WindowTop="0" WindowWidth="1600" WindowHeight="900" ContainerType="Page" Page="0" ViewScale="0.5" ViewCenterX="{page.w/2}" ViewCenterY="{page.h/2}"/></Windows>',
        "visio/pages/pages.xml": f'<?xml version="1.0" encoding="utf-8"?><Pages {NS}><Page ID="0" NameU="{escape(page_name)}" Name="{escape(page_name)}" ViewScale="0.5" ViewCenterX="{page.w/2}" ViewCenterY="{page.h/2}">'
            f'<PageSheet LineStyle="0" FillStyle="0" TextStyle="0"><Cell N="PageWidth" V="{page.w}"/><Cell N="PageHeight" V="{page.h}"/><Cell N="PageScale" V="1" U="IN"/><Cell N="DrawingScale" V="1" U="IN"/><Cell N="DrawingSizeType" V="3"/><Cell N="DrawingScaleType" V="0"/><Cell N="PrintPageOrientation" V="1"/></PageSheet>'
            '<Rel r:id="rId1"/></Page></Pages>',
        "visio/pages/_rels/pages.xml.rels": '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>',
        "visio/pages/page1.xml": page.xml(),
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
