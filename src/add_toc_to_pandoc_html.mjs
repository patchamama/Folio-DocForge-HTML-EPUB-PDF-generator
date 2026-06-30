// Adds a table of contents to HTML before passing to Pandoc
// Usage: node src/add_toc_to_pandoc_html.mjs input.html > output.html
//
// Handles heading shapes produced by render_html.mjs:
//   <h1>Title</h1>                                       (template title, no anchor)
//   <h1><a class="s_ident" id="s-XXX" ...></a>Title</h1> (content h1 section, with anchor)
//   <h2><a class="h_ident" id="h-XXX" ...></a>Title</h2> (section, with anchor)
// Only h1 and h2 are included in the TOC.

import * as fs from "fs"

const file = process.argv[2]
if (!file) throw new Error("Usage: add_toc_to_pandoc_html.mjs <input.html>")

let html = fs.readFileSync(file, "utf8")

// Generate a URL-safe id from heading text
function slugify(text) {
  return 'toc-' + text.trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60)
}

// Extract h1 and h2 headings only (two-level TOC).
// Regex captures:
//   group 1 — heading level (1 or 2)
//   group 2 — attributes on <hN> tag
//   group 3 — everything inside <hN>...</hN> (may include <a> anchor)
const headingRe = /<h([12])([^>]*)>([\s\S]*?)<\/h\1>/g

const headings = []
const replacements = []   // headings that need an id injected
const usedIds = new Set()
let m

while ((m = headingRe.exec(html)) !== null) {
  const [fullMatch, levelStr, tagAttrs, inner] = m
  const level = parseInt(levelStr)

  // Strip all tags to get plain text
  const text = inner.replace(/<[^>]*>/g, '').trim()
  if (!text) continue

  // Look for id on the inner <a> anchor first (h2/h3 style)
  const anchorIdMatch = inner.match(/id="([^"]+)"/)
  // Fall back to id on the <hN> tag itself
  const tagIdMatch = tagAttrs.match(/id="([^"]+)"/)
  let id = anchorIdMatch?.[1] ?? tagIdMatch?.[1] ?? null

  if (!id) {
    // Generate a unique slug, inject it onto the <hN> tag
    let slug = slugify(text)
    let candidate = slug
    let n = 1
    while (usedIds.has(candidate)) candidate = slug + '-' + (++n)
    id = candidate

    const newHTML = `<h${levelStr} id="${id}"${tagAttrs}>${inner}</h${levelStr}>`
    replacements.push({ index: m.index, length: fullMatch.length, newHTML })
  }

  usedIds.add(id)
  headings.push({ level, id, text })
}

// Apply id injections in reverse order to preserve string indices
for (let i = replacements.length - 1; i >= 0; i--) {
  const { index, length, newHTML } = replacements[i]
  html = html.slice(0, index) + newHTML + html.slice(index + length)
}

// Build TOC HTML
let tocHTML = '<nav id="TOC" role="doc-toc">\n'
tocHTML += '<h1 class="toc-title">Content</h1>\n'

if (headings.length > 0) {
  let currentLevel = 0

  for (const heading of headings) {
    while (currentLevel < heading.level) {
      tocHTML += '<ul>\n'
      currentLevel++
    }
    while (currentLevel > heading.level) {
      tocHTML += '</ul>\n'
      currentLevel--
    }
    tocHTML += `<li><a href="#${heading.id}">${heading.text}</a></li>\n`
  }

  while (currentLevel > 0) {
    tocHTML += '</ul>\n'
    currentLevel--
  }
}

tocHTML += '</nav>\n\n'

// Inject TOC before the first heading
const firstHeadingIndex = html.search(/<h[12][\s>]/)
if (firstHeadingIndex !== -1) {
  html = html.slice(0, firstHeadingIndex) + tocHTML + html.slice(firstHeadingIndex)
} else {
  // Fallback: inject after <body> opening tag
  const bodyIndex = html.indexOf('<body')
  if (bodyIndex !== -1) {
    const closeTag = html.indexOf('>', bodyIndex)
    html = html.slice(0, closeTag + 1) + '\n' + tocHTML + html.slice(closeTag + 1)
  }
}

process.stdout.write(html)
