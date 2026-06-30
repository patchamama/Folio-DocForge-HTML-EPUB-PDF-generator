import * as PJSON from "./pseudo_json.mjs"
import {transformTokens} from "./transform.mjs"
import markdown from "./markdown.mjs"
import * as fs from "fs"
import {dirname, resolve} from "path"
import {fileURLToPath} from "url"
import moldTemplate from "mold-template"
import {highlightCode, classHighlighter} from "@lezer/highlight"
import {Tree} from "@lezer/common"
import {html} from "@codemirror/lang-html"
import {javascript, typescriptLanguage} from "@codemirror/lang-javascript"
import {css} from "@codemirror/lang-css"
import {php} from "@codemirror/lang-php"
import {StreamLanguage} from "@codemirror/language"
import {http} from "@codemirror/legacy-modes/mode/http"
import {python} from "@codemirror/legacy-modes/mode/python"
import {java, c, cpp} from "@codemirror/legacy-modes/mode/clike"
import {pascal} from "@codemirror/legacy-modes/mode/pascal"
import {go} from "@codemirror/legacy-modes/mode/go"
import {yaml} from "@codemirror/legacy-modes/mode/yaml"
import {properties} from "@codemirror/legacy-modes/mode/properties"
import {xml} from "@codemirror/legacy-modes/mode/xml"
import {sql} from "@codemirror/legacy-modes/mode/sql"

const mold = new moldTemplate

let file, epub = false, name = null
let args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] == "--epub") epub = true
  else if (args[i] == "--name") name = args[++i]
  else if (file) throw new Error("Multiple input files")
  else file = args[i] == "-" ? "/dev/stdin" : args[i]
}
if (!file) throw new Error("No input file")
let chapter = /^\d{2}_([^\.]+)/.exec(name || file) || [null, "hints"]

let {tokens, metadata} = transformTokens(markdown.parse(fs.readFileSync(file, "utf8"), {}), {
  defined: epub ? ["book", "html"] : ["interactive", "html"],
  strip: epub ? "hints" : "",
  takeTitle: true,
  index: false
})

let close = epub ? "/" : ""
const dir = dirname(fileURLToPath(import.meta.url))

let chapters = fs.readdirSync(dir + "/..")
    .filter(file => /^\d{2}_\w+\.md$/.test(file))
    .sort()
    .map(file => /^\d{2}_(\w+)\.md$/.exec(file)[1])
if (epub) chapters.push("hints")

function escapeChar(ch) {
  return ch == "<" ? "&lt;" : ch == ">" ? "&gt;" : ch == "&" ? "&amp;" : "&quot;"
}
function escape(str) { return str.replace(/[<>&"]/g, escapeChar) }

// FIXME http highlighting

const parsers = {
  css: css().language.parser,
  html: html().language.parser,
  javascript: javascript().language.parser,
  typescript: typescriptLanguage.parser,
  json: javascript().language.parser.configure({top: "SingleExpression"}),
  http: StreamLanguage.define(http).parser,
  python: StreamLanguage.define(python).parser,
  java: StreamLanguage.define(java).parser,
  c: StreamLanguage.define(c).parser,
  cpp: StreamLanguage.define(cpp).parser,
  pascal: StreamLanguage.define(pascal).parser,
  go: StreamLanguage.define(go).parser,
  yaml: StreamLanguage.define(yaml).parser,
  xml: StreamLanguage.define(xml).parser,
  conf: StreamLanguage.define(properties).parser,
  sql: StreamLanguage.define(sql({})).parser,
  php: php().language.parser,
}

const styled = "keyword atom number definition variableName variableName2 typeName propertyName comment string string2 invalid meta"
      .split(" ").map(n => "tok-" + n)

function highlight(lang, text) {
  let result = "", parser = parsers[lang], tree = parser ? parser.parse(text) : Tree.empty
  highlightCode(text, tree, classHighlighter, (code, cls) => {
    let esc = escape(code)
    cls = cls.replace(/([\w-]+)\s*/g, (m, style) => styled.includes(style) ? m : "")
    result += cls ? `<span class="${cls}">${esc}</span>` : esc
  }, () => result += "\n")
  return result
}

function maybeSplitInlineCode(html) {
  if (html.length <= 16) return html
  return html.replace(/[.\/](?!\/)/g, `$&<wbr${close}>`)
}

const seenIDs = Object.create(null)
function anchor(token) {
  let id = token.hashID
  if (id in seenIDs) for (let i = 1;; i++) {
    let ext = id + "_" + i
    if (!(ext in seenIDs)) { id = ext; break }
  }
  seenIDs[id] = true
  return `<a class="${id.charAt(0)}_ident" id="${id}" href="#${id}" tabindex="-1" role="presentation"></a>`
}

function attrs(token) {
  return token.attrs ? token.attrs.map(([name, val]) => ` ${name}="${escape(String(val))}"`).join("") : ""
}

let linkedChapter = null
let isYoutubeLink = false
let isVideoLink = false

const root = dir + "/.."
function localVideoExists(href) {
  const rel = decodeURIComponent(href.replace(/^\.\//, ""))
  return fs.existsSync(`${root}/${rel}`) ||
         fs.existsSync(`${root}/html/${rel}`) ||
         fs.existsSync(resolve("../html", rel))
}

let renderer = {
  fence(token) {
    let config = /\S/.test(token.info) ? PJSON.parse(token.info) : {}
    if (config.hidden) return "";
    let lang = config.lang || "javascript", tab = /^(html|javascript|python|java|c|cpp)$/.test(lang) ? " tabindex=\"0\"" : ""
    return `\n\n<pre${attrs(token)}${tab} class="snippet" data-language="${lang}" ${config.focus ? " data-focus=\"true\"" : ""}${config.sandbox ? ` data-sandbox="${config.sandbox}"` : ""}${config.meta ? ` data-meta="${config.meta}"` : ""}>${anchor(token)}<code class="language-${lang}">${highlight(lang, token.content.trimRight())}</code></pre>`
  },

  code_block(token) {
    return `\n\n<pre class="snippet"><code>${escape(token.content.trimRight())}</code></pre>`
  },

  hardbreak() { return `<br${close}>` },
  softbreak() { return " " },

  text(token) {
    let {content} = token
    if (linkedChapter != null) content = content.replace(/\?/g, linkedChapter)
    return escape(content)
  },

  paragraph_open(token) { return `\n\n<p${attrs(token)}>${anchor(token)}` },
  paragraph_close() { return "</p>" },

  heading_open(token) { return `\n\n<${token.tag}${attrs(token)}>${anchor(token)}` },
  heading_close(token) { return `</${token.tag}>` },

  bullet_list_open(token) { return `\n\n<ul${attrs(token)}>` },
  bullet_list_close() { return `</ul>` },

  ordered_list_open(token) {
    let start = token.attrGet("start")
    let startStyle = start ? ` style="--ol-start:${start - 1}"` : ""
    return `\n\n<ol${attrs(token)}${startStyle}>`
  },
  ordered_list_close() { return `\n\n</ol>` },

  list_item_open() { return "\n\n<li>" },
  list_item_close() { return "</li>" },

  table_open() { return "\n\n<table>" },
  table_close() { return "\n\n</table>" },
  tbody_open() { return "" },
  tbody_close() { return "" },
  tr_open() { return "\n\n<tr>" },
  tr_close() { return "\n\n</tr>" },
  td_open() { return "<td>" },
  td_close() { return "</td>" },

  html_block(token) {
    // Markdown sources use ./html/videos/ (relative to source folder).
    // In HTML output (inside html/) the correct path is ./videos/.
    return token.content.replace(/\.\/html\/videos\//g, './videos/')
  },
  html_inline(token) {
    if (epub && /class="quiz-input"/.test(token.content))
      return /data-correct/.test(token.content) ? "[X] " : "[ ] "
    return token.content
  },

  image(token) {
    let src = token.attrGet("src")
    let alt = token.attrGet("alt") || token.content || ""
    return `<img src="${escape(src)}" alt="${escape(alt)}"${close}>`
  },

  code_inline(token) { return `<code>${maybeSplitInlineCode(escape(token.content))}</code>` },

  strong_open() { return "<strong>" },
  strong_close() { return "</strong>" },

  em_open() { return "<em>" },
  em_close() { return "</em>" },

  sub_open() { return "<sub>" },
  sub_close() { return "</sub>" },

  sup_open() { return "<sup>" },
  sup_close() { return "</sup>" },

  s_open() { return "<del>" },
  s_close() { return "</del>" },

  blockquote_open() { return "\n\n<blockquote>" },
  blockquote_close() { return "\n\n</blockquote>" },

  hr() { return `\n\n<hr${close}>` },

  link_open(token) {
    let alt = token.attrGet("alt"), href= token.attrGet("href")
    // Embed YouTube links as iframes in HTML output (keep as <a> for epub/pdf)
    if (!epub) {
      const ytMatch = /youtube\.com\/watch\?v=([A-Za-z0-9_-]+)/.exec(href)
      if (ytMatch) {
        isYoutubeLink = true
        return `<div class="yt-embed"><iframe width="560" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><p class="yt-link"><a href="${escape(href)}" target="_blank" rel="noopener noreferrer">`
      }
      // Embed local video files if the file exists in videos/ or html/videos/
      const videoMatch = /\.(mp4|webm|ogg|mov)$/i.exec(href)
      if (videoMatch && localVideoExists(href)) {
        isVideoLink = true
        return `<div class="video-embed"><video src="${escape(href)}" controls></video><p class="video-link"><a href="${escape(href)}">`
      }
    }
    let maybeChapter = /^(\w+)(#.*)?$/.exec(href)
    if (maybeChapter && chapters.includes(maybeChapter[1])) {
      let number = ""
      if (maybeChapter[1] != "hints") {
        linkedChapter = chapters.indexOf(maybeChapter[1])
        number =  pad(linkedChapter) + "_"
      }
      href = number + maybeChapter[1] + (epub ? ".xhtml" : ".html") + (maybeChapter[2] || "")
    }
    let target = href.charAt(0) !== "#" ? ` target="_blank" rel="noopener noreferrer"` : ""
    return `<a href="${escape(href)}"${alt ? ` alt="${escape(alt)}"` : ""}${target}>`
  },
  link_close() {
    if (isYoutubeLink) { isYoutubeLink = false; linkedChapter = null; return "</a></p></div>" }
    if (isVideoLink) { isVideoLink = false; return "</a></p></div>" }
    linkedChapter = null; return "</a>"
  },

  inline(token) { return renderArray(token.children) },

  meta_figure(token) {
    let {url, alt, chapter} = token.args[0]
    let className = !chapter ? null : "chapter" + (chapter == "true" ? "" : " " + chapter)
    return `<figure${attrs(token)}${className ? ` class="${className}"` : ""}><img src="${escape(url)}" alt="${escape(alt)}"${close}></figure>`
  },

  meta_quote_open() { return "\n\n<blockquote>" },
  meta_quote_close(token) {
    let {author, title} = token.args[0] || {}
    return (author ? `\n\n<footer>${escape(author)}${title ? `, <cite>${escape(title)}</cite>` : ""}</footer>` : "") +
      "\n\n</blockquote>"
  },
  meta_keyname_open() { return "<span class=\"keyname\">" },
  meta_keyname_close() { return "</span>" },

  meta_hint_open() { return "\n\n<details class=\"solution\"><summary>Display hints...</summary><div class=\"solution-text\">" },
  meta_hint_close() { return "\n\n</div></details>" }
}

function renderArray(tokens) {
  let result = ""
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], f = renderer[token.type]
    if (!f) throw new Error("No render function for " + token.type)
    result += f(token)
  }
  return result
}

function pad(n) {
  return (n < 10 ? "0" : "") + n
}

metadata.content = renderArray(tokens)
let index
if (chapter && (index = chapters.indexOf(chapter[1])) > -1) {
  metadata.page = {type: "chapter", number: index, load_files: metadata.load_files }
  if (index > 0) metadata.prev_link = `${pad(index - 1)}_${chapters[index - 1]}`
  if (index < chapters.length - 1) metadata.next_link = `${pad(index + 1)}_${chapters[index + 1]}`
} else {
  metadata.page = {type: "hints"}
}

let template = mold.bake("chapter", fs.readFileSync(dir + `/${epub ? "epub_" : ""}chapter.html`, "utf8"))

let htmlOut = template(metadata)

// ── Post-process: remove lines with getCoverImage() JS artifact
htmlOut = htmlOut.replace(/^[^\n]*'background-image'\s*:\s*getCoverImage\(\)[^\n]*\n?/gm, '')

// ── Post-process: convert {{figure {url: ..., alt: ...}}} to <img>
//    HTML may mix ASCII " and &quot; entities. Strip both to extract clean values.
//    unquote: decode &quot; then strip leading/trailing quote chars (ASCII + curly).
htmlOut = htmlOut.replace(
  /\{\{figure \{url: ([^,]+), alt: (.*?)\}\}+\}/g,
  (_, urlPart, altPart) => {
    const unq = s => s.replace(/&quot;/g, '"').replace(/^["""]+|["""]+$/g, '').trim()
    return `<img src="${unq(urlPart)}" alt="${escape(unq(altPart))}">`
  }
)

// ── Post-process: fix doubled quotes in <img> attributes
//    Values are filenames/paths (no spaces) so [^”\s]+ prevents cross-attr contamination.
//    Also strips data-clickable (ELO-specific, irrelevant in output).
htmlOut = htmlOut.replace(/<img\b[^>]*>/g, tag =>
  tag
    .replace(/[“”]/g, '')                            // remove curly/smart quotes entirely
    .replace(/\s*data-clickable=”[^”]*”/g, '')       // remove ELO-only attribute
    .replace(/src=”([^”\s]+)””+/g,     'src=”$1”')  // src=”url””  → src=”url”
    .replace(/src=””+([^”\s]+)””+/g,   'src=”$1”')  // src=””url”” → src=”url”
    .replace(/alt=””+([^”\s]+)””+/g,   'alt=”$1”')  // alt=””txt”” → alt=”txt”
    .replace(/alt=”([^”\s]+)””+/g,     'alt=”$1”')  // alt=”txt””  → alt=”txt”
)

console.log(htmlOut)
