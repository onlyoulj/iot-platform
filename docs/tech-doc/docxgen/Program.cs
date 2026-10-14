// IoT 平台技术文档 DOCX 生成器
// Markdown (tech-doc.md) → 专业排版 DOCX（封面 / TOC / 样式 / 表格 / 代码块 / 流程图）
// 遵循 OpenXML 元素顺序规范：pPr 先于 runs；tbl: tblPr→tblGrid→tr；sectPr 为 body 最后子元素
using System.Globalization;
using System.IO;
using System.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

const string FONT_CJK = "微软雅黑";
const string FONT_BODY_CJK = "宋体";
const string FONT_LATIN = "Calibri";
const string FONT_MONO = "Consolas";
const string COLOR_HEAD = "2F5496";
const string COLOR_TEXT = "1F2D3D";
const string COLOR_GRAY = "5E6C84";
const string COLOR_CODE_BG = "F5F6F8";
const string COLOR_HEAD_BG = "DEEAF6";

string mdPath = args.Length > 0 ? args[0] : @"E:\iot-platform\docs\tech-doc\tech-doc.md";
string outPath = args.Length > 1 ? args[1] : @"E:\iot-platform\docs\tech-doc\IoT平台技术文档.docx";
string baseDir = Path.GetDirectoryName(Path.GetFullPath(mdPath))!;

var lines = File.ReadAllLines(mdPath);

using var doc = WordprocessingDocument.Create(outPath, WordprocessingDocumentType.Document);
var mainPart = doc.AddMainDocumentPart();
mainPart.Document = new Document(new Body());
var body = mainPart.Document.Body!;

// ============================ 样式 ============================
var stylesPart = mainPart.AddNewPart<StyleDefinitionsPart>();
stylesPart.Styles = BuildStyles();
stylesPart.Styles.Save();

// ============================ 编号(bullet) ============================
var numberingPart = mainPart.AddNewPart<NumberingDefinitionsPart>();
numberingPart.Numbering = new Numbering(
    new AbstractNum(
        new MultiLevelType { Val = MultiLevelValues.HybridMultilevel },
        new Level(
            new StartNumberingValue { Val = 1 },
            new NumberingFormat { Val = NumberFormatValues.Bullet },
            new LevelText { Val = "•" },
            new LevelJustification { Val = LevelJustificationValues.Left },
            new PreviousParagraphProperties(new Indentation { Left = "420", Hanging = "210" }),
            new NumberingSymbolRunProperties(
                new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
                new FontSize { Val = "18" }))
        { LevelIndex = 0 })
    { AbstractNumberId = 1 },
    new NumberingInstance(new AbstractNumId { Val = 1 }) { NumberID = 1 });
numberingPart.Numbering.Save();

// ============================ 页脚(页码) ============================
var footerPart = mainPart.AddNewPart<FooterPart>();
footerPart.Footer = new Footer(
    new Paragraph(
        new ParagraphProperties(
            new Justification { Val = JustificationValues.Center },
            new SpacingBetweenLines { After = "0" }),
        new Run(
            new RunProperties(new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY }),
            new FieldChar { FieldCharType = FieldCharValues.Begin }),
        new Run(
            new RunProperties(new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY }),
            new FieldCode(" PAGE ") { Space = SpaceProcessingModeValues.Preserve }),
        new Run(
            new RunProperties(new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY }),
            new FieldChar { FieldCharType = FieldCharValues.Separate }),
        new Run(new RunProperties(new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY }),
            new Text("1")),
        new Run(
            new RunProperties(new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY }),
            new FieldChar { FieldCharType = FieldCharValues.End })));
footerPart.Footer.Save();
string footerId = mainPart.GetIdOfPart(footerPart);

// ============================ 封面 ============================
string docTitle = "IoT 设备管理平台技术文档";
AddCenterPara(body, docTitle, "DocTitle", before: "2800", after: "300");
AddCenterPara(body, "—— 项目交付 · 技术设计 · 部署运维 ——", "DocSubtitle", after: "1600");

var meta = new (string k, string v)[] {
    ("文档版本", "v1.0"),
    ("文档类型", "项目交付技术文档"),
    ("密级", "内部"),
    ("适用读者", "项目验收方 · 运维团队 · 后续研发团队"),
    ("编制日期", "2026 年 10 月"),
};
var metaTbl = BuildTable(new[] { 2200, 6200 });
foreach (var (k, v) in meta)
{
    var tr = new TableRow();
    tr.Append(MakeCell(k, bold: true, fill: COLOR_HEAD_BG, width: 2200));
    tr.Append(MakeCell(v, width: 6200));
    metaTbl.Append(tr);
}
body.Append(metaTbl);
AddPageBreak(body);

// ============================ 目录 ============================
body.Append(new Paragraph(
    new ParagraphProperties(
        new ParagraphStyleId { Val = "TOCHeading" }),
    new Run(new Text("目  录"))));
body.Append(new Paragraph(
    new Run(new FieldChar { FieldCharType = FieldCharValues.Begin, Dirty = true }),
    new Run(new FieldCode(" TOC \\o \"1-3\" \\h \\z \\u ") { Space = SpaceProcessingModeValues.Preserve }),
    new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }),
    new Run(new RunProperties(new Color { Val = COLOR_GRAY }),
        new Text("（在 Word 中按 F9 或右键“更新域”以生成目录）")),
    new Run(new FieldChar { FieldCharType = FieldCharValues.End })));
AddPageBreak(body);

// ============================ 正文（Markdown 解析） ============================
uint imgId = 10;
int i = 0;
bool firstH1 = true;
while (i < lines.Length)
{
    string line = lines[i];

    // 代码块
    if (line.TrimStart().StartsWith("```"))
    {
        i++;
        var codeLines = new List<string>();
        while (i < lines.Length && !lines[i].TrimStart().StartsWith("```"))
        {
            codeLines.Add(lines[i]);
            i++;
        }
        i++; // 跳过结束 ```
        for (int c = 0; c < codeLines.Count; c++)
            body.Append(MakeCodePara(codeLines[c]));
        body.Append(MakeSpacerPara());
        continue;
    }

    // 表格
    if (line.TrimStart().StartsWith("|"))
    {
        var rows = new List<string[]>();
        while (i < lines.Length && lines[i].TrimStart().StartsWith("|"))
        {
            var cells = ParseTableRow(lines[i]);
            if (cells != null && !IsSeparatorRow(cells))
                rows.Add(cells);
            i++;
        }
        if (rows.Count > 0)
        {
            int colW = 8400 / rows[0].Length;
            var tbl = BuildTable(Enumerable.Repeat(colW, rows[0].Length).ToArray());
            for (int r = 0; r < rows.Count; r++)
            {
                var tr = new TableRow();
                for (int c = 0; c < rows[r].Length; c++)
                    tr.Append(MakeCell(rows[r][c], bold: r == 0,
                        fill: r == 0 ? COLOR_HEAD_BG : null, width: colW));
                tbl.Append(tr);
            }
            body.Append(tbl);
            body.Append(MakeSpacerPara());
        }
        continue;
    }

    // 图片
    var imgMatch = System.Text.RegularExpressions.Regex.Match(line.Trim(),
        @"^!\[(.*)\]\((.+)\)$");
    if (imgMatch.Success)
    {
        string alt = imgMatch.Groups[1].Value;
        string rel = imgMatch.Groups[2].Value;
        string imgPath = Path.Combine(baseDir, rel);
        if (File.Exists(imgPath))
        {
            AddImage(body, mainPart, imgPath, alt, ref imgId);
            AddCenterPara(body, alt, "Caption");
        }
        i++;
        continue;
    }

    // 标题
    int hLevel = CountHeading(line);
    if (hLevel > 0)
    {
        string text = line.Substring(hLevel).Trim();
        i++;
        if (hLevel == 1) continue; // 文档主标题已上封面
        // md 的 ## 章 → Heading1，### 节 → Heading2，#### → Heading3
        string styleId = hLevel == 2 ? "Heading1" : hLevel == 3 ? "Heading2"
                       : hLevel == 4 ? "Heading3" : "Heading4";
        var hp = new Paragraph(new ParagraphProperties(new ParagraphStyleId { Val = styleId }));
        foreach (var r in MakeStyledRuns(text, styleId)) hp.Append(r);
        body.Append(hp);
        continue;
    }

    // 水平线 / 空行
    string t = line.Trim();
    if (t == "---" || t == "***")
    {
        i++;
        continue;
    }
    if (t == "")
    {
        i++;
        continue;
    }

    // 引用
    if (t.StartsWith(">"))
    {
        var quoteLines = new List<string>();
        while (i < lines.Length && lines[i].TrimStart().StartsWith(">"))
        {
            quoteLines.Add(lines[i].TrimStart().TrimStart('>').Trim());
            i++;
        }
        foreach (var ql in quoteLines)
            if (ql.Length > 0)
                body.Append(MakeQuotePara(ql));
        continue;
    }

    // 无序列表
    if (t.StartsWith("- ") || t.StartsWith("* "))
    {
        while (i < lines.Length)
        {
            string lt = lines[i].Trim();
            if (!lt.StartsWith("- ") && !lt.StartsWith("* ")) break;
            body.Append(MakeBulletPara(lt.Substring(2).Trim()));
            i++;
        }
        continue;
    }

    // 普通段落（含有序列表文本原样保留）
    var bp = new Paragraph(
        new ParagraphProperties(new ParagraphStyleId { Val = "BodyText" }));
    foreach (var r in MakeStyledRuns(line.Trim(), "BodyText")) bp.Append(r);
    body.Append(bp);
    i++;
}

// ============================ sectPr（body 最后子元素） ============================
body.Append(new SectionProperties(
    new FooterReference { Type = HeaderFooterValues.Default, Id = footerId },
    new PageSize { Width = 11906, Height = 16838 },
    new PageMargin { Top = 1440, Right = 1260, Bottom = 1440, Left = 1260,
        Header = 720, Footer = 720, Gutter = 0 }));

mainPart.Document.Save();
Console.WriteLine("saved: " + outPath);

// ============================ helpers ============================

static int CountHeading(string line)
{
    int n = 0;
    while (n < line.Length && line[n] == '#') n++;
    if (n > 0 && n < line.Length && line[n] == ' ') return n;
    return 0;
}

static string[]? ParseTableRow(string line)
{
    var t = line.Trim();
    if (!t.StartsWith("|")) return null;
    t = t.TrimStart('|').TrimEnd('|');
    return t.Split('|').Select(c => c.Trim()).ToArray();
}

static bool IsSeparatorRow(string[] cells) =>
    cells.All(c => c.Length == 0 || c.Replace("-", "").Replace(":", "").Replace(" ", "").Length == 0);

static Run[] MakeStyledRuns(string text, string context)
{
    var runs = new List<Run>();
    // 先按 ** 分段（粗体），段内按 ` 分段（行内代码）
    var boldParts = text.Split(new[] { "**" }, System.StringSplitOptions.None);
    for (int b = 0; b < boldParts.Length; b++)
    {
        bool bold = b % 2 == 1;
        var codeParts = boldParts[b].Split('`');
        for (int c = 0; c < codeParts.Length; c++)
        {
            if (codeParts[c].Length == 0) continue;
            bool code = c % 2 == 1;
            var rp = new RunProperties();
            if (code)
            {
                rp.Append(new RunFonts { Ascii = FONT_MONO, HighAnsi = FONT_MONO, EastAsia = FONT_CJK });
                rp.Append(new FontSize { Val = "19" });
                rp.Append(new Color { Val = "B33A3A" });
            }
            else
            {
                rp.Append(new FontSize { Val = context == "Caption" ? "18" : "21" });
                if (bold) rp.Append(new Bold());
            }
            var run = new Run();
            run.Append(rp);
            run.Append(new Text(codeParts[c]) { Space = SpaceProcessingModeValues.Preserve });
            runs.Add(run);
        }
    }
    return runs.ToArray();
}

static Paragraph MakeBulletPara(string text)
{
    var p = new Paragraph(
        new ParagraphProperties(
            new ParagraphStyleId { Val = "BodyText" },
            new NumberingProperties(new NumberingLevelReference { Val = 0 },
                new NumberingId { Val = 1 }),
            new SpacingBetweenLines { After = "60" }));
    foreach (var r in MakeStyledRuns(text, "BodyText")) p.Append(r);
    return p;
}

static Paragraph MakeQuotePara(string text)
{
    var p = new Paragraph(new ParagraphProperties(
        new ParagraphStyleId { Val = "BodyText" },
        new ParagraphBorders(new LeftBorder { Val = BorderValues.Single, Size = 18,
            Color = COLOR_HEAD, Space = 8 }),
        new Indentation { Left = "360" },
        new SpacingBetweenLines { After = "80" }));
    foreach (var r in MakeStyledRuns(text, "BodyText")) p.Append(r);
    foreach (var r in p.Elements<Run>())
        r.RunProperties ??= new RunProperties();
    return p;
}

static Paragraph MakeCodePara(string codeLine)
{
    var rp = new RunProperties(
        new RunFonts { Ascii = FONT_MONO, HighAnsi = FONT_MONO, EastAsia = FONT_CJK },
        new FontSize { Val = "18" },
        new Color { Val = "24292F" });
    var p = new Paragraph(
        new ParagraphProperties(
            new Shading { Val = ShadingPatternValues.Clear, Fill = COLOR_CODE_BG },
            new SpacingBetweenLines { After = "0", Line = "260", LineRule = LineSpacingRuleValues.Auto },
            new Indentation { Left = "160", Right = "160" }),
        new Run(rp, new Text(codeLine.Length == 0 ? " " : codeLine)
        { Space = SpaceProcessingModeValues.Preserve }));
    return p;
}

static Paragraph MakeSpacerPara() => new Paragraph(
    new ParagraphProperties(new SpacingBetweenLines { After = "60" }),
    new Run(new RunProperties(new FontSize { Val = "2" }), new Text("")));

static void AddCenterPara(Body body, string text, string styleId,
    string before = "0", string after = "120")
{
    var pPr = new ParagraphProperties(
        new ParagraphStyleId { Val = styleId },
        new SpacingBetweenLines { Before = before, After = after });
    body.Append(new Paragraph(pPr, new Run(new Text(text))));
}

static void AddPageBreak(Body body) =>
    body.Append(new Paragraph(new Run(new Break { Type = BreakValues.Page })));

static Table BuildTable(int[] widths)
{
    var tblPr = new TableProperties(
        new TableWidth { Type = TableWidthUnitValues.Dxa, Width = widths.Sum().ToString() },
        new TableBorders(
            new TopBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
            new LeftBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
            new BottomBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
            new RightBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
            new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Color = "B9CCE4" },
            new InsideVerticalBorder { Val = BorderValues.Single, Size = 4, Color = "B9CCE4" }),
        new TableLayout { Type = TableLayoutValues.Fixed });
    var grid = new TableGrid();
    foreach (var w in widths) grid.Append(new GridColumn { Width = w.ToString() });
    return new Table(tblPr, grid);
}

static TableCell MakeCell(string text, bool bold = false, string? fill = null, int width = 2000)
{
    var tcPr = new TableCellProperties(
        new TableCellWidth { Type = TableWidthUnitValues.Dxa, Width = width.ToString() },
        new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center });
    if (fill != null)
        tcPr.Append(new Shading { Val = ShadingPatternValues.Clear, Fill = fill });
    var pPr = new ParagraphProperties(
        new SpacingBetweenLines { Before = "40", After = "40", Line = "240", LineRule = LineSpacingRuleValues.Auto });
    var p = new Paragraph(pPr);
    foreach (var r in MakeStyledRuns(text, "Cell"))
    {
        if (bold)
        {
            r.RunProperties ??= new RunProperties();
            if (r.RunProperties.GetFirstChild<Bold>() == null) r.RunProperties.Append(new Bold());
        }
        p.Append(r);
    }
    if (!p.Elements<Run>().Any())
        p.Append(new Run(new Text("")));
    return new TableCell(tcPr, p);
}

static void AddImage(Body body, MainDocumentPart mainPart, string path, string alt, ref uint idCounter)
{
    byte[] bytes = File.ReadAllBytes(path);
    // PNG IHDR: width @16, height @20 (big endian)
    int pxW = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    int pxH = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];

    const double contentWIn = 6.3, maxHIn = 7.6;
    double wIn = contentWIn, hIn = contentWIn * pxH / pxW;
    if (hIn > maxHIn) { hIn = maxHIn; wIn = maxHIn * pxW / pxH; }
    long cx = (long)(wIn * 914400), cy = (long)(hIn * 914400);

    var imagePart = mainPart.AddImagePart(ImagePartType.Png);
    using (var ms = new MemoryStream(bytes)) imagePart.FeedData(ms);
    string relId = mainPart.GetIdOfPart(imagePart);
    uint pid = idCounter++;

    var name = "Figure" + pid;
    var picture = new PIC.Picture(
        new PIC.NonVisualPictureProperties(
            new PIC.NonVisualDrawingProperties { Id = 0U, Name = name },
            new PIC.NonVisualPictureDrawingProperties()),
        new PIC.BlipFill(
            new A.Blip { Embed = relId, CompressionState = A.BlipCompressionValues.Print },
            new A.Stretch(new A.FillRectangle())),
        new PIC.ShapeProperties(
            new A.Transform2D(
                new A.Offset { X = 0L, Y = 0L },
                new A.Extents { Cx = cx, Cy = cy }),
            new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle }));

    var inline = new DW.Inline(
        new DW.Extent { Cx = cx, Cy = cy },
        new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
        new DW.DocProperties { Id = pid, Name = name, Description = alt },
        new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
        new A.Graphic(new A.GraphicData(picture)
        { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
    {
        DistanceFromTop = 0U, DistanceFromBottom = 0U,
        DistanceFromLeft = 0U, DistanceFromRight = 0U
    };

    body.Append(new Paragraph(
        new ParagraphProperties(
            new KeepNext(),
            new Justification { Val = JustificationValues.Center },
            new SpacingBetweenLines { Before = "120", After = "60" }),
        new Run(new Drawing(inline))));
}

static Styles BuildStyles()
{
    var styles = new Styles();

    styles.Append(new DocDefaults(
        new RunPropertiesDefault(new RunPropertiesBaseStyle(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_BODY_CJK, ComplexScript = FONT_LATIN },
            new FontSize { Val = "21" }, new FontSizeComplexScript { Val = "21" },
            new Languages { Val = "en-US", EastAsia = "zh-CN" })),
        new ParagraphPropertiesDefault(new ParagraphPropertiesBaseStyle(
            new SpacingBetweenLines { After = "120", Line = "300", LineRule = LineSpacingRuleValues.Auto }))));

    // Normal
    styles.Append(MakeParaStyle("Normal", "Normal", isDefault: true,
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_BODY_CJK },
            new FontSize { Val = "21" }, new Color { Val = COLOR_TEXT })));

    // 正文缩进样式
    styles.Append(MakeParaStyle("BodyText", "Body Text", basedOn: "Normal",
        pPr: new StyleParagraphProperties(
            new SpacingBetweenLines { After = "120", Line = "300", LineRule = LineSpacingRuleValues.Auto }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_BODY_CJK },
            new FontSize { Val = "21" }, new Color { Val = COLOR_TEXT })));

    // 标题族（必须含 OutlineLevel，否则 TOC/导航失效）
    styles.Append(MakeParaStyle("Heading1", "heading 1", basedOn: "Normal", next: "BodyText",
        pPr: new StyleParagraphProperties(
            new KeepNext(), new KeepLines(),
            new SpacingBetweenLines { Before = "320", After = "160" },
            new OutlineLevel { Val = 0 }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "32" }, new Color { Val = COLOR_HEAD })));

    styles.Append(MakeParaStyle("Heading2", "heading 2", basedOn: "Normal", next: "BodyText",
        pPr: new StyleParagraphProperties(
            new KeepNext(), new KeepLines(),
            new SpacingBetweenLines { Before = "240", After = "120" },
            new OutlineLevel { Val = 1 }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "27" }, new Color { Val = COLOR_HEAD })));

    styles.Append(MakeParaStyle("Heading3", "heading 3", basedOn: "Normal", next: "BodyText",
        pPr: new StyleParagraphProperties(
            new KeepNext(), new KeepLines(),
            new SpacingBetweenLines { Before = "180", After = "100" },
            new OutlineLevel { Val = 2 }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "24" }, new Color { Val = "35415A" })));

    styles.Append(MakeParaStyle("Heading4", "heading 4", basedOn: "Normal", next: "BodyText",
        pPr: new StyleParagraphProperties(
            new KeepNext(), new KeepLines(),
            new SpacingBetweenLines { Before = "140", After = "80" },
            new OutlineLevel { Val = 3 }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "22" }, new Color { Val = "35415A" })));

    // 封面
    styles.Append(MakeParaStyle("DocTitle", "Doc Title",
        pPr: new StyleParagraphProperties(new Justification { Val = JustificationValues.Center }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "56" }, new Color { Val = COLOR_HEAD })));

    styles.Append(MakeParaStyle("DocSubtitle", "Doc Subtitle",
        pPr: new StyleParagraphProperties(new Justification { Val = JustificationValues.Center }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new FontSize { Val = "26" }, new Color { Val = COLOR_GRAY })));

    // TOC 标题
    styles.Append(MakeParaStyle("TOCHeading", "TOC Heading", basedOn: "Heading1",
        pPr: new StyleParagraphProperties(
            new SpacingBetweenLines { Before = "120", After = "240" },
            new OutlineLevel { Val = 9 /*不进目录*/ }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new Bold(), new FontSize { Val = "32" }, new Color { Val = COLOR_HEAD })));

    // 图注
    styles.Append(MakeParaStyle("Caption", "Caption",
        pPr: new StyleParagraphProperties(
            new Justification { Val = JustificationValues.Center },
            new SpacingBetweenLines { Before = "40", After = "200" }),
        rPr: new StyleRunProperties(
            new RunFonts { Ascii = FONT_LATIN, HighAnsi = FONT_LATIN, EastAsia = FONT_CJK },
            new FontSize { Val = "18" }, new Color { Val = COLOR_GRAY })));

    // 表格基础样式
    var tblStyle = new Style(
        new StyleName { Val = "Table Grid" },
        new TableProperties(
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
                new LeftBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
                new BottomBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
                new RightBorder { Val = BorderValues.Single, Size = 4, Color = "9CB6D8" },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4, Color = "B9CCE4" },
                new InsideVerticalBorder { Val = BorderValues.Single, Size = 4, Color = "B9CCE4" })))
    { Type = StyleValues.Table, StyleId = "TableGrid" };
    styles.Append(tblStyle);

    return styles;
}

static Style MakeParaStyle(string id, string name, string? basedOn = null,
    string? next = null, bool isDefault = false,
    StyleParagraphProperties? pPr = null, StyleRunProperties? rPr = null)
{
    var s = new Style { Type = StyleValues.Paragraph, StyleId = id, Default = isDefault };
    s.Append(new StyleName { Val = name });
    if (basedOn != null) s.Append(new BasedOn { Val = basedOn });
    if (next != null) s.Append(new NextParagraphStyle { Val = next });
    if (pPr != null) s.Append(pPr);
    if (rPr != null) s.Append(rPr);
    return s;
}
