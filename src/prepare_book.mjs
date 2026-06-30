// prepare_book.mjs — auto-discovers NN_*.md chapters and generates
// pdf/book.tex, epub/toc.xhtml.src, epub/content.opf.src from templates.
// Also generates book.html (redirect to first chapter) and detects the
// cover image (cover.jpg > cover.png > first image in chapters).
// Run from the project root: node src/prepare_book.mjs

import {readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync} from "fs"

let chapters = readdirSync(".")
  .filter(f => /^\d{2}_.*\.md$/.test(f))
  .sort()
  .map(file => {
    let name = file.replace(/\.md$/, "")
    let content = readFileSync(file, "utf8")
    let titleMatch = /^# (.+)/m.exec(content)
    let title = titleMatch ? titleMatch[1].trim() : name
    return {file, name, title, content}
  })

function esc(str) {
  return str.replace(/[<>&"]/g, ch => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[ch]))
}

// ── Cover image detection ────────────────────────────────────────
// Only uses cover.jpg / cover.png placed in the project root.
// If neither exists, no cover page is generated.
function detectCover() {
  if (existsSync("cover.jpg")) return "cover.jpg"
  if (existsSync("cover.png")) return "cover.png"
  return null
}

let coverImage = detectCover()

// ── PDF: cover block + \input per chapter ─────────────────────────
let coverBlock = ""
if (coverImage) {
  // Use a titlepage environment to insert the cover image full-page
  coverBlock = [
    "\\begin{titlepage}",
    "  \\vspace*{-2cm}",
    "  \\begin{center}",
    `    \\includegraphics[width=\\paperwidth,height=\\paperheight,keepaspectratio*]{../${coverImage}}`,
    "  \\end{center}",
    "\\end{titlepage}",
  ].join("\n")
}

let texInputs = chapters.map(c => `\\input{${c.name}.tex}`).join("\n")

let texTmpl = readFileSync("pdf/book.tex.tmpl", "utf8")
writeFileSync("pdf/book.tex",
  texTmpl.replace("{{cover}}", coverBlock)
         .replace("{{chapters}}", texInputs))

// ── EPUB TOC: copy template as-is; both {{chapters_toc}} and
//    {{full_toc}} are filled later by generate_epub_toc.mjs which
//    reads the rendered .xhtml files and has access to anchor IDs.
let tocTmpl = readFileSync("epub/toc.xhtml.tmpl", "utf8")
writeFileSync("epub/toc.xhtml.src", tocTmpl)

// ── EPUB titlepage.xhtml: generated only when cover exists ─────
// frontmatter.xhtml is no longer used (was hardcoded to a specific book)
if (existsSync("epub/frontmatter.xhtml")) unlinkSync("epub/frontmatter.xhtml")

if (coverImage) {
  writeFileSync("epub/titlepage.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en-US">\n` +
    `  <head>\n` +
    `    <title>Cover</title>\n` +
    `    <link rel="stylesheet" href="style.css" type="text/css"/>\n` +
    `    <style type="text/css" title="override_css">\n` +
    `      @page {padding: 0pt; margin:0pt}\n` +
    `      body { text-align: center; padding:0pt; margin: 0pt; }\n` +
    `    </style>\n` +
    `  </head>\n` +
    `  <body>\n` +
    `    <div>\n` +
    `      <img src="${coverImage}" alt="Cover"/>\n` +
    `    </div>\n` +
    `  </body>\n` +
    `</html>\n`)
} else {
  if (existsSync("epub/titlepage.xhtml")) unlinkSync("epub/titlepage.xhtml")
}

// ── EPUB content.opf: manifest items + spine refs ──────────────
let bookTitle = chapters.length > 0 ? chapters[0].title : "Book"

let coverManifest = coverImage
  ? `    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`
  : ""
let coverSpine = coverImage
  ? `    <itemref idref="titlepage" linear="yes"/>`
  : ""

let manifestItems = chapters.map(c =>
  `    <item id="c${c.name}" href="${c.name}.xhtml" media-type="application/xhtml+xml"/>`
).join("\n")

let spineRefs = chapters.map(c =>
  `    <itemref idref="c${c.name}" linear="yes"/>`
).join("\n")

let opfTmpl = readFileSync("epub/content.opf.tmpl", "utf8")
writeFileSync("epub/content.opf.src",
  opfTmpl.replace("{{book_title}}", esc(bookTitle))
         .replace("{{cover_manifest}}", coverManifest)
         .replace("{{cover_spine}}", coverSpine)
         .replace("{{chapter_manifest}}", manifestItems)
         .replace("{{chapter_spine}}", spineRefs))

// ── book.html: redirect to first chapter ────────────────────────
if (chapters.length > 0) {
  let last = chapters[chapters.length - 1]
  let lastFile = last.name + ".html"
  writeFileSync("book.html",
    `<!doctype html>\n<html><head><meta charset="utf-8">\n` +
    `<meta http-equiv="refresh" content="0; url=html/${lastFile}">\n` +
    `<title>Redirect</title></head>\n` +
    `<body><p>Redirecting to <a href="html/${lastFile}">${esc(last.title)}</a>...</p></body></html>\n`)
}

console.error(`prepare_book: ${chapters.length} chapter(s) discovered, cover: ${coverImage || "none"}`)
