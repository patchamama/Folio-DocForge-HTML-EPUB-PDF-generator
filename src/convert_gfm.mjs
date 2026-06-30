#!/usr/bin/env node
// convert_gfm.mjs — Convierte Markdown GFM estándar al formato custom del proyecto.
//
// Conversiones soportadas:
//   ```js / ```py / …                → ```{lang: "javascript"} / …
//   ```  (sin lenguaje)              → ```{lang: null}
//   ![alt](url)                      → {{figure {url: "…", alt: "…"}}}
//   <!-- figure-options: {…} -->     → se merge en el {{figure}} siguiente
//   > [!NOTE] / [!WARNING] / [!TIP] → <div class="admonition …">…</div>
//   <!-- quote: {…} --> + > …        → {{quote {…} … quote}}
//   <!-- hint --> … <!-- /hint -->   → {{hint … hint}}
//   <!-- if: X --> … <!-- endif -->  → {{if X … if}}
//   <!-- index: … -->                → {{index …}}
//   <!-- indexsee: "a","b" -->       → {{indexsee "a", "b"}}
//   <!-- index-inline -->X<!-- /index-inline --> → ((X))
//   <!-- id: "…" -->                 → {{id "…"}}
//   <!-- code-options: {…} -->       → se merge en el fence siguiente
//   <kbd>…</kbd>                     → […]{keyname}
//   <sub>…</sub>                     → ~…~
//   <sup>…</sup>                     → ^…^
//   Fila separadora GFM |---|…       → se elimina
//
// El script añade {{meta {}}} al inicio si no está presente.
//
// Uso:
//   node src/convert_gfm.mjs entrada.md
//   node src/convert_gfm.mjs --lang es entrada.md
//   node src/convert_gfm.mjs -o salida.md entrada.md

import * as fs from "fs"

// ─── Labels de admonitions por idioma ─────────────────────────
const LABELS = {
  en: { NOTE: "Note",    WARNING: "Warning",    TIP: "Tip",     IMPORTANT: "Important",  CAUTION: "Caution",   TODO: "TODO",     INFO: "Info"  },
  es: { NOTE: "Nota",    WARNING: "Advertencia", TIP: "Consejo", IMPORTANT: "Importante", CAUTION: "Precaución", TODO: "TODO",     INFO: "Info"  }
}

// ─── Alias lenguaje → nombre canónico del proyecto ────────────
const LANG_MAP = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", javascript: "javascript",
  ts: "typescript", mts: "typescript", typescript: "typescript",
  py: "python",     python: "python",
  yml: "yaml",      yaml: "yaml",
  htm: "html",      html: "html",
  golang: "go",     go: "go",
  java: "java",     php: "php",
  c: "c",           cpp: "cpp", "c++": "cpp",
  pascal: "pascal", pas: "pascal",
  css: "css",       xml: "xml",
  json: "json",     http: "http"
}

const ADMONITION_TYPES = ["NOTE", "WARNING", "TIP", "IMPORTANT", "CAUTION", "TODO", "INFO"]

// ─── CLI ───────────────────────────────────────────────────────
let lang = "en", file = null, outputFile = null
const argv = process.argv.slice(2)

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--lang")                        { lang = argv[++i]; continue }
  if (argv[i] === "--output" || argv[i] === "-o") { outputFile = argv[++i]; continue }
  if (!file) file = argv[i]
}

if (!file) {
  process.stderr.write([
    "Uso: node src/convert_gfm.mjs [opciones] entrada.md",
    "",
    "Opciones:",
    "  --lang es            Labels en español (default: en)",
    "  --output FILE / -o   Escribir en FILE (default: stdout)",
    ""
  ].join("\n"))
  process.exit(1)
}

const labels = LABELS[lang] || LABELS.en
const lines  = fs.readFileSync(file, "utf8").split("\n")

// ─── Eliminar TOC manual si existe ─────────────────────────────
detectAndRemoveManualTOC(lines)

// ─── Limpiar columnas vacías al final de tablas ────────────────
cleanEmptyTrailingColumns(lines)

// ─── Normalizar <img>: elimina width px, tiny → class="tiny" ───
function normalizeImg(tag) {
  let isTiny = /\btiny\b/.test(tag)
  tag = tag.replace(/\s+tiny\b/g, "")          // eliminar atributo tiny
  tag = tag.replace(/\s+width="\d+"/g, "")     // eliminar width en px
  if (isTiny) tag = tag.replace(/<img/, '<img class="tiny"')
  return tag
}

// ─── Transformaciones inline (fuera de fences) ────────────────
function inlineXform(s) {
  // Extract code spans first to protect their content from URL auto-linking
  const codeSpans = []
  s = s.replace(/`([^`]+)`/g, (_, inner) => {
    codeSpans.push('`' + inner + '`')
    return `\x02${codeSpans.length - 1}\x02`
  })

  s = s
    .replace(/<img\b[^>]*>/g,                                    normalizeImg)
    .replace(/<kbd>([^<]+)<\/kbd>/g,                             "[$1]{keyname}")
    .replace(/<sub>([^<]+)<\/sub>/g,                             "~$1~")
    .replace(/<sup>([^<]+)<\/sup>/g,                             "^$1^")
    .replace(/<!-- index-inline -->(.*?)<!-- \/index-inline -->/g, "(($1))")
    .replace(/^(\s*)-\s+\[(\s*[xX]?\s*)\]\s+/gm,                 (match, indent, ch) =>
      indent + ((/[xX]/.test(ch))
        ? '- <input type="checkbox" class="quiz-input" data-correct> '
        : '- <input type="checkbox" class="quiz-input"> '))
    .replace(/(\]\(|["'\[`])(https?:\/\/[^\s)\]"'`<>]+)|((^|[^\["'`])(https?:\/\/[^\s)\]"'`<>]+))/gm,
                                                                 (match, linkPre, linkUrl, _, barePre, bareUrl) => {
      if (linkPre) return match  // ya dentro de ](url) o "[url" o "url" o `url → no tocar
      return barePre + `[${bareUrl}](${bareUrl})`
    })

  // Restore code spans
  return s.replace(/\x02(\d+)\x02/g, (_, i) => codeSpans[i])
}

// ─── Separador de tabla GFM ────────────────────────────────────
function isGfmTableSep(line) {
  return /^\|[\s\-:|]+\|?\s*$/.test(line) && line.includes("---")
}

// ─── Estado del autómata ───────────────────────────────────────
let inFence         = false
let fenceMarker     = ""
let inOpenCodeSpan  = false        // true when a backtick code span starts on a previous line
let admonition      = null         // { type, lines[] }
let pendingFigOpts  = null         // string  — opciones figure pendientes
let pendingQuote    = null         // string  — opciones quote pendientes
let inQuote         = null         // { opts, lines[] } — acumula cuerpo quote
let pendingId       = null         // string
let pendingCodeOpts = null         // string  — opciones code pendientes

const out = []

// ─── Flush helpers ─────────────────────────────────────────────
function flushAdmonition() {
  if (!admonition) return
  const cls   = admonition.type.toLowerCase()
  const label = labels[admonition.type] || admonition.type
  out.push(`<div class="admonition ${cls}">`)

  // Helper: apply inline markdown formatting to a text string
  function formatInline(text) {
    let codes = []
    let s = inlineXform(text)
      .replace(/`([^`]+)`/g, (_, inner) => { codes.push(`<code>${inner}</code>`); return "\x00" + (codes.length - 1) + "\x00" })
    s = s
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')  // Convert [text](url) to <a> tags
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w])__(.+?)__(?=[^\w]|$)/g, "$1<strong>$2</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, "$1<em>$2</em>")
    return s.replace(/\x00(\d+)\x00/g, (_, i) => codes[i])
  }

  // Group lines into typed blocks: text paragraphs, list items, images, headers
  const blocks = []
  let currentList = null
  let currentText = []

  function flushText() {
    if (currentText.length > 0) { blocks.push({ type: "text", lines: currentText.slice() }); currentText = [] }
  }
  function flushList() {
    if (currentList) { blocks.push({ type: "list", items: currentList.slice() }); currentList = null }
  }

  for (const line of admonition.lines) {
    const headerMatch = /^\s*(#{1,6})\s+(.+)$/.exec(line)
    const imgMatch  = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line)
    const listMatch = /^\s*[-*]\s+(.+)$/.exec(line)
    if (headerMatch) {
      flushText(); flushList()
      blocks.push({ type: "header", level: headerMatch[1].length, content: headerMatch[2] })
    } else if (imgMatch) {
      flushText(); flushList()
      blocks.push({ type: "image", alt: imgMatch[1], url: imgMatch[2] })
    } else if (listMatch) {
      flushText()
      if (!currentList) currentList = []
      currentList.push(listMatch[1])
    } else if (line.trim() === "") {
      flushText(); flushList()
    } else {
      flushList()
      currentText.push(line)
    }
  }
  flushText(); flushList()

  // Emit HTML, prefixing label on the first block
  let first = true
  for (const block of blocks) {
    if (block.type === "header") {
      if (first) { out.push(`<p><strong>${label}:</strong></p>`); first = false }
      out.push(`<h${block.level}>${formatInline(block.content)}</h${block.level}>`)
    } else if (block.type === "text") {
      const content = formatInline(block.lines.join(" "))
      out.push(first ? `<p><strong>${label}:</strong> ${content}</p>` : `<p>${content}</p>`)
      first = false
    } else if (block.type === "list") {
      if (first) { out.push(`<p><strong>${label}:</strong></p>`); first = false }
      out.push("<ul>")
      for (const item of block.items) out.push(`<li>${formatInline(item)}</li>`)
      out.push("</ul>")
    } else if (block.type === "image") {
      if (first) { out.push(`<p><strong>${label}:</strong></p>`); first = false }
      out.push(`<p><img src="${block.url}" alt="${block.alt || "image"}"></p>`)
    }
  }
  if (first) out.push(`<p><strong>${label}:</strong></p>`)

  out.push(`</div>`)
  admonition = null
}

function flushQuote() {
  if (!inQuote) return
  out.push(`{{quote ${inQuote.opts}`)
  out.push("")
  inQuote.lines.forEach(l => out.push(l))
  out.push("")
  out.push("quote}}")
  inQuote = null
}

// ─── Detectar y eliminar TOC manual ────────────────────────────
function detectAndRemoveManualTOC(lines) {
  const TOC_TITLES = /^#{1,6}\s+(content|index|índice|indice|contenido|table of contents|toc)\s*$/i

  // Buscar TOC en primeras 50 líneas
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    if (TOC_TITLES.test(lines[i])) {
      // Contar enlaces anchor después del heading
      let anchorCount = 0
      let endIdx = i + 1

      for (let j = i + 1; j < lines.length; j++) {
        // Si encontramos otro heading del mismo nivel o superior, terminamos
        const headingMatch = /^(#{1,6})\s/.exec(lines[j])
        if (headingMatch) {
          const currentLevel = lines[i].match(/^(#{1,6})/)[1].length
          const nextLevel = headingMatch[1].length
          if (nextLevel <= currentLevel) break
        }

        // Contar enlaces anchor [texto](#anchor)
        const anchorMatches = lines[j].match(/\[([^\]]+)\]\(#[^)]+\)/g)
        if (anchorMatches) anchorCount += anchorMatches.length

        endIdx = j + 1

        // Si hay línea vacía doble, probablemente fin de sección
        if (lines[j].trim() === "" && lines[j + 1]?.trim() === "") {
          endIdx = j + 2
          break
        }
      }

      // Si encontramos >2 enlaces anchor, eliminar toda la sección
      if (anchorCount > 2) {
        lines.splice(i, endIdx - i)
        return true
      }
    }
  }

  return false
}

// ─── Limpiar columnas vacías al final de tablas ────────────────
function cleanEmptyTrailingColumns(lines) {
  let i = 0
  while (i < lines.length) {
    // Detectar inicio de tabla (línea con pipes)
    if (/^\s*\|/.test(lines[i])) {
      const tableStart = i
      let tableEnd = i

      // Encontrar todas las líneas de la tabla
      while (tableEnd < lines.length && /^\s*\|/.test(lines[tableEnd])) {
        tableEnd++
      }

      // Procesar tabla
      const tableLines = lines.slice(tableStart, tableEnd)
      if (tableLines.length >= 1) {
        // SIEMPRE limpiar trailing whitespace de todas las líneas de tabla
        for (let j = 0; j < tableLines.length; j++) {
          lines[tableStart + j] = lines[tableStart + j].replace(/\s+$/g, '')
        }

        // Ahora intentar detectar y eliminar columnas vacías
        if (tableLines.length >= 2) {
          // Parsear todas las filas para contar columnas (usando las líneas ya limpias)
          const rows = tableLines.map((_, idx) => {
            const line = lines[tableStart + idx]
            const trimmed = line.trim()
            // Remover pipes iniciales y finales
            const withoutPipes = trimmed.replace(/^\||\|$/g, '')
            // Split y trim cada celda
            return withoutPipes.split('|').map(cell => cell.trim())
          })

          // Verificar que todas las filas tienen el mismo número de columnas
          const numCols = rows[0].length
          const allSameLength = rows.every(row => row.length === numCols)

          if (allSameLength && numCols > 1) {
            // Verificar si la última columna está vacía en todas las filas
            const lastColEmpty = rows.every(row => {
              const lastCell = row[row.length - 1]
              // Considerar vacío si es string vacío o solo contiene guiones/espacios (separator row)
              return lastCell === '' || /^[\s:-]+$/.test(lastCell)
            })

            if (lastColEmpty) {
              // Eliminar última columna de todas las filas
              for (let j = 0; j < rows.length; j++) {
                const row = rows[j].slice(0, -1) // Eliminar último elemento

                // Si es la fila separadora, regenerar con guiones
                if (j === 1 && row.every(cell => /^[\s:-]+$/.test(cell))) {
                  lines[tableStart + j] = '| ' + row.map(() => '---').join(' | ') + ' |'
                } else {
                  lines[tableStart + j] = '| ' + row.join(' | ') + ' |'
                }
              }
            }
          }
        }
      }

      i = tableEnd
    } else {
      i++
    }
  }
}

// ─── Construir línea de apertura de fence ──────────────────────
function buildFenceOpen(backticks, rawLang) {
  const canonical = rawLang ? (LANG_MAP[rawLang] || rawLang) : null
  let parts = canonical ? [`lang: "${canonical}"`] : ["lang: null"]
  if (pendingCodeOpts) {
    const inner = pendingCodeOpts.replace(/^\{|\}$/g, "").trim()
    if (inner) parts.push(inner)
    pendingCodeOpts = null
  }
  return `${backticks}{${parts.join(", ")}}`
}

// ═══════════════════════════════════════════════════════════════
//  BUCLE PRINCIPAL
// ═══════════════════════════════════════════════════════════════
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]

  // ── Dentro de fence: pass-through hasta cierre ──────────────
  if (inFence) {
    out.push(line)
    const m = /^(`{3,})\s*$/.exec(line)
    if (m && m[1].length >= fenceMarker.length) { inFence = false; fenceMarker = ""; inOpenCodeSpan = false }
    continue
  }

  // ── Línea blanca con pending prefix: skip para mantener la
  //    asociación comentario → elemento destino ──────────────────
  if (line.trim() === "" && (pendingFigOpts || pendingQuote || pendingCodeOpts || pendingId)) {
    continue
  }

  // ── Comentarios HTML especiales ──────────────────────────────
  { // figure-options
    const m = /^<!-- figure-options:\s*(\{[^}]*\})\s*-->$/.exec(line)
    if (m) { flushAdmonition(); flushQuote(); pendingFigOpts = m[1]; continue }
  }
  { // quote
    const m = /^<!-- quote:\s*(\{.*\})\s*-->$/.exec(line)
    if (m) { flushAdmonition(); flushQuote(); pendingQuote = m[1]; continue }
  }
  { // id
    const m = /^<!-- id:\s*"([^"]*?)"\s*-->$/.exec(line)
    if (m) { flushAdmonition(); flushQuote(); pendingId = m[1]; continue }
  }
  { // code-options
    const m = /^<!-- code-options:\s*(\{[^}]*\})\s*-->$/.exec(line)
    if (m) { flushAdmonition(); flushQuote(); pendingCodeOpts = m[1]; continue }
  }
  // hint open / close
  if (/^<!-- hint -->\s*$/.test(line))   { flushAdmonition(); flushQuote(); out.push("{{hint"); continue }
  if (/^<!-- \/hint -->\s*$/.test(line)) { out.push("hint}}"); continue }
  // if open / close
  {
    const m = /^<!-- if:\s*(\w+)\s*-->$/.exec(line)
    if (m) { flushAdmonition(); flushQuote(); out.push(`{{if ${m[1]}`); continue }
  }
  if (/^<!-- endif -->\s*$/.test(line)) { out.push("if}}"); continue }
  // index (standalone)
  {
    const m = /^<!-- index:\s*(.+?)\s*-->$/.exec(line)
    if (m) { out.push(`{{index ${m[1]}}}`); continue }
  }
  // indexsee
  {
    const m = /^<!-- indexsee:\s*"([^"]*)",\s*"([^"]*?)"\s*-->$/.exec(line)
    if (m) { out.push(`{{indexsee "${m[1]}", "${m[2]}"}}`); continue }
  }

  // ── Quote: acumular líneas del blockquote ─────────────────────
  if (pendingQuote || inQuote) {
    const m = /^>\s?(.*)$/.exec(line)
    if (m) {
      if (pendingQuote) { inQuote = { opts: pendingQuote, lines: [] }; pendingQuote = null }
      inQuote.lines.push(m[1])
      continue
    }
    // Fin del blockquote
    if (inQuote) flushQuote()
    pendingQuote = null
    // No continue → procesar esta línea normalmente
  }

  // ── Admonition GFM ───────────────────────────────────────────
  if (admonition) {
    const m = /^>\s?(.*)$/.exec(line)
    if (m) { admonition.lines.push(m[1]); continue }
    flushAdmonition()
    // caer al procesamiento normal
  }
  { // Inicio de admonition > [!TIPO]
    const m = /^>\s*\[!(\w+)\]\s*$/.exec(line)
    if (m && ADMONITION_TYPES.includes(m[1].toUpperCase())) {
      flushAdmonition()
      admonition = { type: m[1].toUpperCase(), lines: [] }
      continue
    }
  }

  // ── Separador de tabla GFM: skip ─────────────────────────────
  if (isGfmTableSep(line)) continue

  // ── Fence con lenguaje (apertura) ───────────────────────────
  {
    const m = /^(`{3,})(\w+)\s*$/.exec(line)
    if (m) {
      flushAdmonition()
      out.push(buildFenceOpen(m[1], m[2]))
      inFence = true; fenceMarker = m[1]
      continue
    }
  }

  // ── Fence sin lenguaje (apertura) ───────────────────────────
  {
    const m = /^(`{3,})\s*$/.exec(line)
    if (m) {
      flushAdmonition()
      out.push(buildFenceOpen(m[1], null))
      inFence = true; fenceMarker = m[1]
      continue
    }
  }

  // ── Fence ya en formato proyecto (idempotencia) ─────────────
  {
    const m = /^(`{3,})\{/.exec(line)
    if (m) {
      flushAdmonition()
      out.push(line)
      inFence = true; fenceMarker = m[1]
      continue
    }
  }

  // ── Imagen de bloque ─────────────────────────────────────────
  {
    const m = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line)
    if (m) {
      // Strip surrounding quotes that pandoc adds around alt text derived from filenames
      const altClean = m[1].replace(/^[“”"']+|[“”"']+$/g, '').trim()
      let opts = `url: "${m[2]}", alt: "${altClean}"`
      if (pendingFigOpts) {
        const inner = pendingFigOpts.replace(/^\{|\}$/g, "").trim()
        if (inner) opts += `, ${inner}`
        pendingFigOpts = null
      }
      if (out.length > 0 && out[out.length - 1] !== "") out.push("")
      out.push(`{{figure {${opts}}}}`)
      out.push("")
      continue
    }
  }

  // ── ID pendiente: emitir antes del elemento siguiente ────────
  if (pendingId) {
    out.push(`{{id "${pendingId}"}}`)
    pendingId = null
  }

  // ── Acceptable answers (text-input quiz) ─────────────────────
  {
    const m = /^(akzeptable antworten|respuestas aceptables|acceptable answers):\s*(.+)$/i.exec(line.trim())
    if (m) {
      const answers = m[2].split(',').map(a => a.trim()).filter(Boolean)
        .map(a => a.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))
      out.push(`<div class="quiz-text-input" data-answers="${answers.join('|')}"><input type="text" class="quiz-text-field" placeholder="Your answer..."></div>`)
      continue
    }
  }

  // ── Línea normal: inline transforms + emit ──────────────────
  // If we're inside a multiline code span, pass the line through untransformed
  out.push(inOpenCodeSpan ? line : inlineXform(line))
  // Count unmatched backticks to track multiline code span state
  const unmatchedTicks = (line.replace(/`[^`]+`/g, "").match(/`/g) || []).length
  if (unmatchedTicks % 2 !== 0) inOpenCodeSpan = !inOpenCodeSpan
}

// ─── Flush final ───────────────────────────────────────────────
if (admonition) flushAdmonition()
if (inQuote)    flushQuote()

// ─── Añadir {{meta {}}} al inicio si no está presente ─────────
let result = out.join("\n")
if (!result.trimStart().startsWith("{{meta")) {
  result = "{{meta {}}}\n\n" + result
}

// ─── Eliminar líneas vacías entre checkboxes consecutivos ──────
// Esto evita que markdown.mjs genere párrafos dentro de list items
result = result.replace(/(<input type="checkbox"[^>]*>[^\n]+)\n\n(?=- <input type="checkbox")/g, "$1\n")

// ─── Salida ────────────────────────────────────────────────────
if (outputFile) {
  fs.writeFileSync(outputFile, result)
  process.stderr.write(`Archivo escrito: ${outputFile}\n`)
} else {
  process.stdout.write(result)
}
