import JSZip from 'jszip'

export async function buildCompatibilityFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.file('_rels/.rels', packageRelationships)
  zip.file('xl/workbook.xml', workbook)
  zip.file('xl/_rels/workbook.xml.rels', workbookRelationships)
  zip.file('xl/worksheets/sheet1.xml', worksheet)
  zip.file('xl/styles.xml', styles)
  zip.file('customXml/item1.xml', '<compatibility-marker value="must-survive"/>')
  zip.file('xl/charts/chart1.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/// Exercises the save path: shared strings, styled cells, sparse rows, a
/// self-closing row, a cached formula, and parts that must survive untouched.
export async function buildEditFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', editContentTypes)
  zip.file('_rels/.rels', packageRelationships)
  zip.file('xl/workbook.xml', editWorkbook)
  zip.file('xl/_rels/workbook.xml.rels', editWorkbookRelationships)
  zip.file('xl/worksheets/sheet1.xml', editWorksheet)
  zip.file('xl/styles.xml', editStyles)
  zip.file('xl/sharedStrings.xml', editSharedStrings)
  zip.file('customXml/item1.xml', '<compatibility-marker value="must-survive"/>')
  zip.file('xl/charts/chart1.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const editContentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`

const editWorkbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
  <definedNames><definedName name="Total">Data!$C$1</definedName></definedNames>
</workbook>`

const editWorkbookRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`

const editWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="C1"><v>5</v></c></row>
    <row r="3"><c r="B3"><f>SUM(C1:C2)</f><v>5</v></c></row>
    <row r="5" ht="20" customHeight="1"/>
  </sheetData>
</worksheet>`

const editSharedStrings = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>Hello</t></si></sst>`

const editStyles = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font/><font><b/></font></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs>
</styleSheet>`

/// Exercises structural row/column shifts: formulas (absolute/relative/range/
/// cross-sheet/string literal), merges, cols, CF, DV, hyperlinks, calcChain.
export async function buildStructureFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', structureContentTypes)
  zip.file('_rels/.rels', packageRelationships)
  zip.file('xl/workbook.xml', structureWorkbook)
  zip.file('xl/_rels/workbook.xml.rels', structureWorkbookRelationships)
  zip.file('xl/worksheets/sheet1.xml', structureWorksheet)
  zip.file('xl/worksheets/sheet2.xml', structureOtherWorksheet)
  zip.file('xl/styles.xml', styles)
  zip.file('xl/calcChain.xml', '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="D2" i="1"/></calcChain>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const structureContentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>
</Types>`

const structureWorkbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets>
</workbook>`

const structureWorkbookRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>
</Relationships>`

const structureWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D10"/>
  <cols><col min="2" max="3" width="20" customWidth="1"/></cols>
  <sheetData>
    <row r="1" spans="1:4"><c r="A1"><v>1</v></c><c r="C1"><v>7</v></c></row>
    <row r="2"><c r="A2"><v>2</v></c><c r="D2"><f>SUM(A1:A2)</f><v>3</v></c></row>
    <row r="4"><c r="B4"><f>$A$2+Other!B9+SUM(B:B)&amp;"A1"</f><v>0</v></c></row>
    <row r="10"><c r="A10"><v>10</v></c></row>
  </sheetData>
  <mergeCells count="2"><mergeCell ref="A5:B6"/><mergeCell ref="C1:D1"/></mergeCells>
  <conditionalFormatting sqref="A1:A10"><cfRule type="expression" priority="1"><formula>$A2&gt;5</formula></cfRule></conditionalFormatting>
  <dataValidations count="1"><dataValidation type="list" sqref="B2:B3"><formula1>"a,b"</formula1></dataValidation></dataValidations>
</worksheet>`

const structureOtherWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><v>1</v></c></row>
  </sheetData>
</worksheet>`

/// Exercises sheet rename/add/remove: three sheets (one with a quoted name),
/// cross-sheet formulas, an internal hyperlink anchor, a chart series
/// reference, scoped and global defined names, an active tab, and calcChain.
export async function buildSheetsFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', sheetsContentTypes)
  zip.file('_rels/.rels', packageRelationships)
  zip.file('xl/workbook.xml', sheetsWorkbook)
  zip.file('xl/_rels/workbook.xml.rels', sheetsWorkbookRelationships)
  zip.file('xl/worksheets/sheet1.xml', sheetsDataWorksheet)
  zip.file('xl/worksheets/sheet2.xml', sheetsOtherWorksheet)
  zip.file('xl/worksheets/sheet3.xml', sheetsMyWorksheet)
  zip.file('xl/styles.xml', styles)
  zip.file('xl/charts/chart1.xml', sheetsChart)
  zip.file('xl/calcChain.xml', '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="A2" i="1"/></calcChain>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const sheetsContentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>
</Types>`

const sheetsWorkbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="2"/></bookViews>
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/><sheet name="My Sheet" sheetId="3" r:id="rId3"/></sheets>
  <definedNames><definedName name="GlobalTotal">Data!$A$1</definedName><definedName name="_xlnm.Print_Area" localSheetId="1">Other!$A$1:$B$2</definedName><definedName name="LocalMy" localSheetId="2">'My Sheet'!$A$1</definedName></definedNames>
</workbook>`

const sheetsWorkbookRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>
</Relationships>`

const sheetsDataWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><v>1</v></c></row>
    <row r="2"><c r="A2"><f>'My Sheet'!A1*2</f><v>10</v></c></row>
  </sheetData>
</worksheet>`

const sheetsOtherWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><f>Data!A1+SUM('My Sheet'!A1:A2)</f><v>6</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>go</t></is></c></row>
  </sheetData>
  <hyperlinks><hyperlink ref="A2" location="Data!A1" display="go"/></hyperlinks>
</worksheet>`

const sheetsMyWorksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><v>5</v></c></row>
  </sheetData>
</worksheet>`

const sheetsChart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:val><c:numRef><c:f>Data!$A$1:$A$2</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

const packageRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const workbookRelationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const worksheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Old</t></is></c><c r="B1"><v>10</v></c></row>
  </sheetData>
</worksheet>`

const styles = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs>
</styleSheet>`
