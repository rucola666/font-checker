// Builds an InDesign IDML document from the layout recorded while building
// the PDF specimen. Every text stays live text in its own frame, with
// paragraph styles named after their role and size ("Pangram 26pt").
import { makeZipBytes } from './zip.js'

const NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging'
const DOM = '8.0'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // control characters are not allowed in XML
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const n = (v) => (Math.round(v * 1000) / 1000).toString()

const ROLE_NAMES = { spec: 'Specimen', glyph: 'Glyph', label: 'Label', labelBold: 'Label Bold' }

/**
 * @param layout  { width, height, margin, pages: [{ items }] } from buildSpecimen
 * @param fonts   { specimen: { family, style }, label: { family, regular, bold } }
 * @returns {Promise<Uint8Array>} the .idml file
 */
export async function buildIdml(layout, fonts) {
  const { width: W, height: H, margin: M } = layout
  const styles = new Map()       // name -> paragraph style attributes
  const stories = []
  const spreads = []
  let uid = 0
  const id = (p) => `${p}${(++uid).toString(36)}`

  const fontFor = (role) => {
    if (role === 'label') return { family: fonts.label.family, style: fonts.label.regular }
    if (role === 'labelBold') return { family: fonts.label.family, style: fonts.label.bold }
    return { family: fonts.specimen.family, style: fonts.specimen.style }
  }

  function styleFor(item, base) {
    const size = Math.round(item.size * 10) / 10
    const name = `${base} ${size}pt`
    if (!styles.has(name)) {
      const f = fontFor(item.role)
      styles.set(name, {
        size, leading: item.leading, tracking: item.role === 'spec' ? item.tracking || 0 : 0,
        family: f.family, style: f.style, grey: item.grey,
      })
    }
    return name
  }

  // Spread coordinates: the page is centred on the spread origin.
  const X = (x) => x - W / 2
  const Y = (yPdf) => H / 2 - yPdf

  function rect(x, top, w, h) {
    const pts = [[x, top], [x, top + h], [x + w, top + h], [x + w, top]]
    return pts.map(([a, b]) => `<PathPointType Anchor="${n(a)} ${n(b)}" LeftDirection="${n(a)} ${n(b)}" RightDirection="${n(a)} ${n(b)}"/>`).join('')
  }

  function textFrame({ x, top, w, h, paragraphs, style, columns = 1, gutter = 12 }) {
    const story = id('st')
    const content = paragraphs.map((p) => `<Content>${esc(p)}</Content>`).join('<Br/>')
    stories.push({
      self: story,
      xml: `<Story Self="${story}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">` +
        `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${esc(style)}">` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">${content}</CharacterStyleRange>` +
        `</ParagraphStyleRange></Story>`,
    })
    return `<TextFrame Self="${id('tf')}" ParentStory="${story}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemLayer="layer1" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 0 0">` +
      `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${rect(x, top, w, h)}</PathPointArray></GeometryPathType></PathGeometry></Properties>` +
      `<TextFramePreference TextColumnCount="${columns}" TextColumnGutter="${n(gutter)}" FirstBaselineOffset="LeadingOffset" AutoSizingType="Off" VerticalJustification="TopAlign" UseFixedColumnWidth="false">` +
      `<Properties><InsetSpacing type="list"><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem><ListItem type="unit">0</ListItem></InsetSpacing></Properties>` +
      `</TextFramePreference></TextFrame>`
  }

  layout.pages.forEach((page, i) => {
    const items = []
    for (const it of page.items) {
      if (it.type === 'line') {
        const a = `${n(X(it.x1))} ${n(Y(it.y1))}`
        const b = `${n(X(it.x2))} ${n(Y(it.y2))}`
        items.push(`<GraphicLine Self="${id('gl')}" ItemLayer="layer1" StrokeWeight="${n(it.thickness)}" StrokeColor="Color/${it.grey ? 'Rule' : 'Black'}" FillColor="Swatch/None" ItemTransform="1 0 0 1 0 0">` +
          `<Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>` +
          `<PathPointType Anchor="${a}" LeftDirection="${a}" RightDirection="${a}"/><PathPointType Anchor="${b}" LeftDirection="${b}" RightDirection="${b}"/>` +
          `</PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>`)
      } else if (it.type === 'text') {
        // single line: first baseline = top + leading; a tight leading keeps big frames on the page
        const leading = Math.round(it.size * 0.85 * 100) / 100
        const style = styleFor({ ...it, leading }, ROLE_NAMES[it.role] || 'Text')
        // frame runs from the text start to the page edge, so nothing oversets
        const frameW = Math.max(W - it.x, it.size * 1.2)
        items.push(textFrame({
          x: X(it.x), top: Y(it.y) - leading, w: frameW, h: it.size * 1.15,
          paragraphs: [it.text], style,
        }))
      } else if (it.type === 'flow') {
        const style = styleFor(it, it.style)
        const paragraphs = it.wrapping ? [it.lines.join(' ')] : it.lines
        const rows = it.columns === 2 ? Math.ceil(it.lines.length / 2) : it.lines.length
        items.push(textFrame({
          x: X(it.x), top: Y(it.y) - it.leading, w: it.width,
          h: (rows + 1) * it.leading, paragraphs, style,
          columns: it.columns, gutter: it.gutter,
        }))
      }
    }
    const spread = id('sp')
    const pageId = `page${i + 1}`
    spreads.push({
      self: spread,
      xml: `<Spread Self="${spread}" PageCount="1" BindingLocation="0" AllowPageShuffle="true" ShowMasterItems="true" ItemTransform="1 0 0 1 0 ${n(i * (H + 40))}" FlattenerOverride="Default">` +
        `<Page Self="${pageId}" Name="${i + 1}" AppliedMaster="ma" GeometricBounds="0 0 ${n(H)} ${n(W)}" ItemTransform="1 0 0 1 ${n(-W / 2)} ${n(-H / 2)}" OverrideList="" TabOrder="">` +
        `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${M}" Bottom="${M}" Left="${M}" Right="${M}" ColumnDirection="Horizontal"/></Page>` +
        items.join('') + `</Spread>`,
    })
  })

  const pkg = (tag, body) => `${XML_HEAD}<idPkg:${tag} xmlns:idPkg="${NS}" DOMVersion="${DOM}">${body}</idPkg:${tag}>`

  const paragraphStyles = [...styles].map(([name, s]) =>
    `<ParagraphStyle Self="ParagraphStyle/${esc(name)}" Name="${esc(name)}" PointSize="${s.size}" FontStyle="${esc(s.style)}" Tracking="${Math.round(s.tracking)}" FillColor="Color/${s.grey ? 'Grey' : 'Black'}" Hyphenation="false" Justification="LeftAlign">` +
    `<Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">${esc(s.family)}</AppliedFont><Leading type="unit">${n(s.leading)}</Leading></Properties></ParagraphStyle>`
  ).join('')

  const stylesXml = pkg('Styles',
    `<RootCharacterStyleGroup Self="rcsg"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/></RootCharacterStyleGroup>` +
    `<RootParagraphStyleGroup Self="rpsg">` +
    `<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12" FontStyle="${esc(fonts.specimen.style)}"><Properties><AppliedFont type="string">${esc(fonts.specimen.family)}</AppliedFont><Leading type="enumeration">Auto</Leading></Properties></ParagraphStyle>` +
    paragraphStyles + `</RootParagraphStyleGroup>`)

  const graphicXml = pkg('Graphic',
    `<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
    `<Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
    `<Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
    `<Color Self="Color/Grey" Model="Process" Space="CMYK" ColorValue="0 0 0 55" ColorOverride="Normal" Name="Grey" ColorEditable="true" ColorRemovable="true" Visible="true"/>` +
    `<Color Self="Color/Rule" Model="Process" Space="CMYK" ColorValue="0 0 0 20" ColorOverride="Normal" Name="Rule" ColorEditable="true" ColorRemovable="true" Visible="true"/>` +
    `<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>` +
    `<StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>`)

  const prefsXml = pkg('Preferences',
        // No PagesPerDocument: InDesign would create that many blank default pages
    // before adding ours. FacingPages comes first so nothing is built as a spread.
    `<DocumentPreference FacingPages="false" PageHeight="${n(H)}" PageWidth="${n(W)}" PageBinding="LeftToRight" StartPageNumber="1"/>` +
    `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${M}" Bottom="${M}" Left="${M}" Right="${M}" ColumnDirection="Horizontal"/>` +
    `<ViewPreference HorizontalMeasurementUnits="Millimeters" VerticalMeasurementUnits="Millimeters"/>`)

  const designmap = `${XML_HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="8.0(370)" ?>` +
    `<Document xmlns:idPkg="${NS}" DOMVersion="${DOM}" Self="d" ActiveLayer="layer1" CMYKProfile="$ID/" RGBProfile="$ID/" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">` +
    `<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>` +
    `<Layer Self="layer1" Name="Layer 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>` +
    `<idPkg:MasterSpread src="MasterSpreads/MasterSpread_ma.xml"/>` +
    spreads.map((s) => `<idPkg:Spread src="Spreads/Spread_${s.self}.xml"/>`).join('') +
    `<Section Self="sec1" Length="${layout.pages.length}" Name="" ContinueNumbering="false" IncludeSectionPrefix="false" PageNumberStyle="Arabic" PageStart="page1" SectionPrefix=""/>` +
    stories.map((s) => `<idPkg:Story src="Stories/Story_${s.self}.xml"/>`).join('') +
    `</Document>`

  const enc = new TextEncoder()
  const files = [
    { path: 'mimetype', data: enc.encode('application/vnd.adobe.indesign-idml-package') },
    { path: 'designmap.xml', data: enc.encode(designmap) },
    { path: 'META-INF/container.xml', data: enc.encode(`${XML_HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`) },
    { path: 'Resources/Graphic.xml', data: enc.encode(graphicXml) },
    { path: 'Resources/Fonts.xml', data: enc.encode(pkg('Fonts', '')) },
    { path: 'Resources/Styles.xml', data: enc.encode(stylesXml) },
    { path: 'Resources/Preferences.xml', data: enc.encode(prefsXml) },
    { path: 'MasterSpreads/MasterSpread_ma.xml', data: enc.encode(pkg('MasterSpread',
      `<MasterSpread Self="ma" Name="A-Master" NamePrefix="A" BaseName="Master" ShowMasterItems="true" PageCount="1" OverriddenPageItemProps="" PrimaryTextFrame="n" ItemTransform="1 0 0 1 0 0">` +
      `<Page Self="mpage" Name="A" AppliedMaster="n" GeometricBounds="0 0 ${n(H)} ${n(W)}" ItemTransform="1 0 0 1 ${n(-W / 2)} ${n(-H / 2)}" OverrideList="" TabOrder="">` +
      `<MarginPreference ColumnCount="1" ColumnGutter="12" Top="${M}" Bottom="${M}" Left="${M}" Right="${M}" ColumnDirection="Horizontal"/></Page></MasterSpread>`)) },
    ...spreads.map((s) => ({ path: `Spreads/Spread_${s.self}.xml`, data: enc.encode(pkg('Spread', s.xml)) })),
    ...stories.map((s) => ({ path: `Stories/Story_${s.self}.xml`, data: enc.encode(pkg('Story', s.xml)) })),
  ]
  return makeZipBytes(files)
}
