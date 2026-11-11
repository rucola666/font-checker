# Font Checker

A browser tool for type design students. Drop in an `.otf` or `.ttf` font to:

- **Preview** what the font contains, with size, line spacing, letter spacing and variable-axis sliders.
- **Check** font info and glyph coverage, with missing characters and empty fields highlighted.
- **Edit** family name, style name, full font name, author and license; the changes are written into the font.
- **Export** a 4-page A4 PDF specimen plus the updated font, as one folder.
- **Export** an InDesign (`.idml`) version of the specimen with live text and paragraph styles, plus a `Document Fonts` folder.

Everything runs in the browser; fonts are never uploaded. The export libraries (pdf-lib, fontkit, pdf.js) load from jsDelivr when first used.

## Develop

```sh
npm install
npm run dev
```

## Deploy

Pushing to `main` builds the site and publishes it with GitHub Actions
(Settings → Pages → Source: **GitHub Actions**).
