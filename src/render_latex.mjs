import * as fs from "fs"
import {dirname} from "path"
import {fileURLToPath} from "url"
import {transformTokens} from "./transform.mjs"
import markdown from "./markdown.mjs"
import * as PJSON from "./pseudo_json.mjs"

let file, noStarch = false, name = null
let args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] == "--nostarch") noStarch = true
  else if (args[i] == "--name") name = args[++i]
  else if (file) throw new Error("Multiple input files")
  else file = args[i] == "-" ? "/dev/stdin" : args[i]
}
if (!file) throw new Error("No input file")
let chapter = /^\d{2}_([^\.]+)/.exec(name || file) || [null, "hints"]

let {tokens} = transformTokens(markdown.parse(fs.readFileSync(file, "utf8"), {}), {
  defined: ["book", "tex"].concat(noStarch ? ["commercial"] : []),
  strip: "hints",
  texQuotes: true,
  moveQuotes: noStarch,
  capitalizeTitles: noStarch,
  index: true
})

const dir = dirname(fileURLToPath(import.meta.url))
const root = dir + "/.."

function imageOk(url) {
  if (/\.gif$/i.test(url)) return false  // xdvipdfmx cannot process GIF
  const abs = url.replace(/^\.\//, "")
  return fs.existsSync(`${root}/${abs}`)
}

let chapters = fs.readdirSync(root)
    .filter(file => /^\d{2}_\w+\.md$/.test(file))
    .sort()
    .map(file => /^\d{2}_(\w+)\.md$/.exec(file)[1])
    .concat(['hints'])

function escapeChar(ch) {
  switch (ch) {
    case "~": return "\\textasciitilde "
    case "^": return "\\textasciicircum "
    case "\\": return "\\textbackslash "
    case "/": return "\\slash "
    case '"': return "\\textquotedbl{}"
    default: return "\\" + ch
  }
}
function escape(str) {
  return String(str).replace(/[&%$#_{}~^\\"]|\w(\/)\w/g, (match, group) => {
    if (group) return match[0] + escapeChar(group) + match[2]
    return escapeChar(match)
  })
}

function escapeIndexChar(ch) {
  switch (ch) {
    case "~": return "\\textasciitilde "
    case "^": return "\\textasciicircum "
    case "\\": return "\\textbackslash "
    case "|": return "\\textbar{} "
    case "@": return "\"@"
    case "!": return "\"!"
    case "- ": return "-@− "
    case "--": return "--@−−"
    case "-=": return "-=@−="
    default: return "\\" + ch
  }
}
function escapeIndex(value) {
  if (Array.isArray(value)) return value.map(escapeIndex).join("!")
  return String(value).replace(/[&%$#_{}~^\\|!@]|-[ -=]/g, escapeIndexChar)
}

function escapeComplexScripts(string) {
  return string.replace(/[^\u0000-\u0600→“”…←‘’]+/g, m => {
    if (/[\u0600-\u06ff]/.test(m)) m = "\\textarab{" + m + "}"
    else if (/[\u4E00-\u9FA5]/.test(m)) m = "\\cjkfont{" + m + "}"
    return `$<${m}>$`
  })
}

function id(token) {
  let id = token.attrGet("id")
  return id ? `\\label{${chapter[1] + "." + id}}` : ''
}

let linkedChapter = null, raw = false, quote = false, imageOnlyHeading = false
let inHeading = false, headingImages = []

const lstLanguages = {
  javascript: "JavaScript", typescript: "JavaScript",
  python: "Python", java: "Java", php: "PHP",
  c: "C", cpp: "C++", pascal: "Pascal",
  html: "HTML", css: "CSS", xml: "XML", go: "Go",
}

let renderer = {
  fence(token, _i, _t, newlines) {
    let config = /\S/.test(token.info) ? PJSON.parse(token.info) : {}
    if (config.hidden) return ""
    let lang = config.lang || "javascript"
    let lstLang = lstLanguages[lang]
    let langOpt = lstLang ? `[language=${lstLang}]` : ""
    let esc = escapeComplexScripts(token.content.trimRight())
    if (noStarch) esc = esc.replace(/[""]/g, '"').replace(/…/g, "...")
    return `${paraBreak(newlines)}${id(token)}\\begin{lstlisting}${langOpt}\n${esc}\n\\end{lstlisting}\n`
  },

  code_block(token, _i, _t, newlines) {
    return `${paraBreak(newlines)}\\begin{lstlisting}\n${escapeComplexScripts(token.content.trimRight())}\n\\end{lstlisting}\n`
  },

  hardbreak() { return "\\break\n" },
  softbreak() { return " " },

  text(token) {
    let {content} = token
    if (linkedChapter != null) content = content.replace(/\?/g, linkedChapter)
    return raw ? content : escape(content)
  },

  paragraph_open(token, i, tokens, newlines) {
    let noIndent = ""
    let inListItem = false
    if (!noStarch) for (i--; i >= 0; i--) {
      let prev = tokens[i]
      if (prev.type == "fence") noIndent = "\\noindent "
      // Check if we're inside a list item (para right after list_item_open)
      if (prev.type == "list_item_open") inListItem = true
      if (!/^meta_index/.test(prev.type)) break
    }
    let nl = paraBreak(newlines)
    if (quote) { nl = ""; quote = false }
    // Don't add paragraph break if we're right after a list item open
    if (inListItem) nl = ""
    return nl + noIndent + id(token)
  },
  paragraph_close() { return "" },

  heading_open(token, i, t, newlines) {
    let breaks = paraBreak(newlines)
    headingImages = []
    // \adjustbox / \includegraphics are fragile — cannot go inside moving args like \section{}.
    let nextTok = t[i + 1]
    if (nextTok && nextTok.type === "inline" && nextTok.children) {
      let meaningful = nextTok.children.filter(c =>
        !(c.type === "softbreak") && !(c.type === "text" && !c.content.trim())
      )
      const hasImage = meaningful.some(c => c.type === "image")
      if (hasImage) {
        if (meaningful.length === 1) {
          // Image-only heading: render as standalone block, skip \section{} entirely
          imageOnlyHeading = true
          inHeading = false
          return breaks
        }
        // Mixed heading (text + image): suppress images inside title, emit as block after
        inHeading = true
        imageOnlyHeading = false
      } else {
        inHeading = false
        imageOnlyHeading = false
      }
    } else {
      inHeading = false
      imageOnlyHeading = false
    }
    if (token.tag == "h1") return `\\${!["hints", "intro"].includes(chapter[1]) ? "chapter" : noStarch ? "chapter*" : "addchap"}{`
    if (token.tag == "h2") return `${breaks}${id(token)}\\section{`
    if (token.tag == "h3") return `${breaks}${id(token)}\\subsection{`
    if (token.tag == "h4") return `${breaks}${id(token)}\\subsubsection{`
    if (token.tag == "h5") return `${breaks}${id(token)}\\paragraph{`
    if (token.tag == "h6") return `${breaks}${id(token)}\\subparagraph{`
    throw new Error("Can't handle heading tag " + token.tag)
  },
  heading_close(token) {
    if (imageOnlyHeading) { imageOnlyHeading = false; return "" }
    inHeading = false
    const suffix = headingImages.length
      ? `\n\n${headingImages.join("\n\n")}`
      : ""
    headingImages = []
    if (token.tag == "h1") return `}\\label{${chapter[1]}}${suffix}`
    return `}${suffix}`
  },

  bullet_list_open() { return `\n\n\\begin{itemize}` },
  bullet_list_close() { return `\n\\end{itemize}` },

  ordered_list_open() { return `\n\n\\begin{enumerate}` },
  ordered_list_close() { return `\n\\end{enumerate}` },

  list_item_open() { return `\n\\item ` },
  list_item_close() { return "" },

  table_open(_token, i, tokens, newlines) {
    // Calculate column widths based on content
    let cols = 0
    let maxLengths = []
    let currentCol = 0
    let currentRow = []

    // Scan table to find max content length per column
    for (let j = i + 1; j < tokens.length; j++) {
      let tok = tokens[j]
      if (tok.type === "table_close") break

      if (tok.type === "td_open") {
        cols++
        currentCol = currentRow.length
        currentRow.push(0)
      } else if (tok.type === "text" && currentRow.length > 0) {
        currentRow[currentCol] += tok.content.length
      } else if (tok.type === "code_inline" && currentRow.length > 0) {
        currentRow[currentCol] += tok.content.length
      } else if (tok.type === "tr_close" && currentRow.length > 0) {
        // Update max lengths
        for (let k = 0; k < currentRow.length; k++) {
          maxLengths[k] = Math.max(maxLengths[k] || 0, currentRow[k])
        }
        currentRow = []
        currentCol = 0
      }
    }

    // Calculate proportional widths (minimum 10% per column, total 95%)
    let numCols = maxLengths.length || 2
    let totalLen = maxLengths.reduce((a, b) => a + b, 0) || numCols
    let widths = maxLengths.map(len => Math.max(0.10, (len / totalLen) * 0.95))

    // Normalize to ensure sum is 0.95
    let sum = widths.reduce((a, b) => a + b, 0)
    widths = widths.map(w => (w / sum * 0.95).toFixed(3))

    // Force new line before tables - use multiple techniques to ensure line break
    let colSpec = "|" + widths.map(w => `p{${w}\\linewidth}`).join("|") + "|"
    return `\n\n\\par\\vspace{1em}\\leavevmode\\par\\noindent{\\scriptsize\\begin{longtable}{${colSpec}}\\hline`
  },
  table_close() { return `\n\\end{longtable}}` },
  tbody_open() { return "" },
  tbody_close() { return "" },
  tr_open() { return "" },
  tr_close() { return "\n\\tabularnewline\\hline" },
  td_open() { return "\n" },
  td_close(_, i, tokens) { return tokens[i + 1] && tokens[i + 1].type == "td_open" ? " &" : "" },

  code_inline(token) {
    return `\\texttt{${escape(token.content)}}`
  },

  strong_open() { return "\\textbf{" },
  strong_close() { return "}" },

  em_open() { return "\\emph{" },
  em_close() { return "}" },

  sub_open() { return "\\textsubscript{" },
  sub_close() { return "}" },

  sup_open() { return "\\textsuperscript{" },
  sup_close() { return "}" },

  s_open() { return "\\sout{" },
  s_close() { return "}" },

  blockquote_open(_token, _i, _t, newlines) {
    // Force new line before blockquote - use multiple techniques to ensure line break
    return "\n\n\\par\\vspace{1em}\\leavevmode\\par\\begin{quote}"
  },
  blockquote_close() { return "\n\\end{quote}" },

  hr(_token, _i, _t, newlines) { return paraBreak(newlines) + "\\noindent\\rule{\\linewidth}{0.4pt}\n" },

  meta_indexsee(token, _i, _t, newlines) {
    return paraBreak(newlines) +
      `\\index{${escapeIndex(token.args[0])}|see{${escapeIndex(token.args[1])}}}`
  },
  meta_index(token, _, _t, newlines) {
    return (token.inline ? "" : paraBreak(newlines)) +
      token.args.map(term => `\\index{${escapeIndex(term)}}`).join("")
  },

  meta_latex_open() { raw = true; return "" },
  meta_latex_close() { raw = false; return "" },

  meta_keyname_open() { return noStarch ? "\\keycap{" : "\\textsc{" },
  meta_keyname_close() { return "}" },

  link_open(token) {
    let href = token.attrGet("href")

    // Manejar #anchor (solo anchor sin chapter)
    if (/^#(.+)$/.test(href)) {
      const anchor = /^#(.+)$/.exec(href)[1]
      return `\\hyperref[${chapter[1]}.${anchor}]{`
    }

    // Manejar chapter o chapter#anchor
    let maybeChapter = /^(\w+)(?:#(.*))?$/.exec(href)
    if (maybeChapter && chapters.includes(maybeChapter[1])) {
      linkedChapter = chapters.indexOf(maybeChapter[1])
      return `\\hyperref[${maybeChapter[1] + (maybeChapter[2] ? "." + maybeChapter[2] : "")}]{`
    }

    // URL externo - escapar caracteres especiales
    return `\\href{${escape(href)}}{`
  },
  link_close() { linkedChapter = null; return "}" },

  inline(token) { return renderArray(token.children) },

  meta_figure(token, _i, _t, newlines) {
    let {url, width, chapter} = token.args[0]
    if (/\.svg$/.test(url)) url = url.replace(/^img\//, "img/generated/").replace(/\.svg$/, ".pdf")
    if (!imageOk(url)) return ""
    // Force new line before images - use multiple techniques to ensure line break
    if (chapter) {
      let graphics = `\\includegraphics[width=0.75\\textwidth]{${url}}`
      if (chapter === "framed")
        graphics = `{\\setlength{\\fboxsep}{0pt}\\setlength{\\fboxrule}{2pt}\\fbox{${graphics}}}`
      else if (chapter === "square-framed")
        graphics = `{\\setlength{\\fboxsep}{4pt}\\setlength{\\fboxrule}{2pt}\\doublebox{${graphics}}}`
      return `\n\n\\par\\vspace{1em}\\leavevmode\\par\\begin{center}\n${graphics}\n\\end{center}\n`
    }
    let graphics = width
      ? `\\includegraphics[width=${width}]{${url}}`
      : `\\adjustbox{max width=\\linewidth, keepaspectratio}{\\includegraphics{${url}}}`
    if (noStarch) return `\n\n\\par\\vspace{1em}\\leavevmode\\par\\begin{figure}[H]\n${graphics}\n\\end{figure}\n`
    return `\n\n\\par\\vspace{1em}\\leavevmode\\par\\noindent${graphics}\\vskip 1.5ex\n`
  },

  meta_quote_open(token) {
    if (token.args[0] && token.args[0].chapter) {
      quote = true
      if (!noStarch) return `\n\n\\epigraphhead[30]{\n\\epigraph{\\hspace*{-.1cm}\\itshape\`\``
      return `\\epigraphskip
\\thispagestyle{empty}
\\vspace*{\\fill}
\\begin{center} 
\\begin{minipage}{\\epigraphwidth}
\\centering
\\setlength{\\epigraphrule}{0pt}
\\renewcommand{\\sourceflush}{center}
\\epigraph{\\centering{\`\``
    } else {
      return `\n\n\\begin{quote}`
    }
  },
  meta_quote_close(token) {
    quote = false
    let {author, title, chapter, image} = token.args[0] || {}
    let attribution = author ? `\n{---${escape(author)}${title ? `, ${escape(title)}` : ""}}` : ""
    if (!chapter) return `${attribution ? "\n" + attribution : ""}\n\\end{quote}`
    if (!noStarch) return `''}%${attribution}\n}`
    return `}}%${attribution}
${image ? `\\includegraphics[width=\\linewidth]{${image}}` : ''}
\\end{minipage}
\\end{center}
\\vspace*{\\fill}
\\clearpage

`
  },

  html_block(token, _i, _t, newlines) {
    const divMatch = /^<div class="admonition (\w+)">([\s\S]*)<\/div>\s*$/.exec(token.content)
    if (!divMatch) return ""
    const type = divMatch[1], inner = divMatch[2].trim()

    // Convert inline HTML to LaTeX
    function formatInline(html) {
      let codes = []
      html = html.replace(/<code>(.*?)<\/code>/g, (_, c) => { codes.push(c); return "\x01" + (codes.length - 1) + "\x01" })
      let tags = []
      html = html.replace(/<[^>]+>/g, t => { tags.push(t); return "\x00" + (tags.length - 1) + "\x00" })
      html = escape(html)

      // Add word breaking for long text without spaces (>80 chars)
      html = html.replace(/\S{80,}/g, match => {
        // Insert \allowbreak every 80 characters
        return match.match(/.{1,80}/g).join("\\allowbreak ")
      })

      html = html.replace(/\x01(\d+)\x01/g, (_, i) => `\\texttt{${escape(codes[i])}}`)
      html = html.replace(/\x00(\d+)\x00/g, (_, i) => {
        if (tags[i] === "<strong>") return "\\textbf{"
        if (tags[i] === "</strong>") return "}"
        if (tags[i] === "<em>") return "\\emph{"
        if (tags[i] === "</em>") return "}"
        // Process links
        const linkM = /^<a\s+href="([^"]+)">/.exec(tags[i])
        if (linkM) {
          const href = linkM[1]
          // Internal anchor: #anchor
          if (/^#(.+)$/.test(href)) {
            const anchor = /^#(.+)$/.exec(href)[1]
            return `\\hyperref[${chapter[1]}.${anchor}]{`
          }
          // Chapter reference: chapter or chapter#anchor
          const maybeChapter = /^(\w+)(?:#(.*))?$/.exec(href)
          if (maybeChapter && chapters.includes(maybeChapter[1])) {
            return `\\hyperref[${maybeChapter[1] + (maybeChapter[2] ? "." + maybeChapter[2] : "")}]{`
          }
          // External URL - escape special chars
          return `\\href{${escape(href)}}{`
        }
        if (tags[i] === "</a>") return "}"
        // Process images
        const imgM = /^<img\s[^>]*src="([^"]+)"/.exec(tags[i])
        if (imgM) return imageOk(imgM[1]) ? `\\adjustbox{max width=\\linewidth, keepaspectratio}{\\includegraphics{${imgM[1]}}}` : ""
        // Process headers h2-h5
        const headerM = /^<(h[2-5])>/.exec(tags[i])
        if (headerM) return "\\textbf{"
        if (/^<\/(h[2-5])>/.test(tags[i])) return "}"
        return ""
      })
      return html
    }

    // Parse top-level block elements: <p>, <ul>, <ol>
    const parts = []
    const blockRe = /<(p|ul|ol)>([\s\S]*?)<\/\1>/g
    let bm
    while ((bm = blockRe.exec(inner)) !== null) {
      const tag = bm[1], content = bm[2]
      if (tag === "p") {
        parts.push(formatInline(content))
      } else {
        const env = tag === "ul" ? "itemize" : "enumerate"
        const items = []
        const liRe = /<li>([\s\S]*?)<\/li>/g
        let li
        while ((li = liRe.exec(content)) !== null) items.push("\\item " + formatInline(li[1]))
        parts.push(`\\begin{${env}}\n${items.join("\n")}\n\\end{${env}}`)
      }
    }

    const body = parts.join("\n\n")
    const styles = {
      note: ["admonition-note-fg", "admonition-note-bg"],
      warning: ["admonition-warning-fg", "admonition-warning-bg"],
      tip: ["admonition-tip-fg", "admonition-tip-bg"],
      important: ["admonition-important-fg", "admonition-important-bg"],
      caution: ["admonition-caution-fg", "admonition-caution-bg"],
      todo: ["admonition-todo-fg", "admonition-todo-bg"],
      info: ["admonition-info-fg", "admonition-info-bg"]
    }
    const [fg, bg] = styles[type] || styles.note
    // Force new line before admonitions - use multiple techniques to ensure line break
    return `\n\n\\par\\vspace{1em}\\leavevmode\\par\\admonitionbox{${fg}}{${bg}}{${body}}\n`
  },
  html_inline(token) {
    // Handle checkboxes
    if (/class="quiz-input"/.test(token.content))
      return /data-correct/.test(token.content) ? "$\\boxtimes$ " : "$\\square$ "

    // Handle line breaks <br> or <br/> - use \newline for table cells
    // \\ would break table structure, \newline works within cells
    if (/<br\s*\/?>/i.test(token.content))
      return " \\newline "

    return ""
  },

  image(token) {
    let src = token.attrGet("src") || ""
    if (/\.svg$/.test(src)) src = src.replace(/^img\//, "img/generated/").replace(/\.svg$/, ".pdf")
    if (!imageOk(src)) return ""
    const imgCmd = `\\adjustbox{max width=\\linewidth, keepaspectratio}{\\includegraphics{${src}}}`
    if (imageOnlyHeading) {
      return `\n\n\\par\\vspace{0.5em}\\noindent${imgCmd}\n\n`
    }
    if (inHeading) {
      // Image inside a mixed heading: store for emission after heading_close, suppress inline
      headingImages.push(`\\par\\vspace{0.5em}\\noindent${imgCmd}`)
      return ""
    }
    return imgCmd
  },

  meta_hint_open() { return "" }, // FIXME filter out entirely
  meta_hint_close() { return "" }
}

function paraBreak(newlines) {
  return "\n".repeat(Math.max(0, 2 - newlines))
}

function renderArray(tokens) {
  let result = ""
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], f = renderer[token.type]
    if (!f) throw new Error("No render function for " + token.type)
    result += f(token, i, tokens, /\n*$/.exec(result)[0].length)
  }
  return result
}

// Move epigraph to the front
if (noStarch) {
  let epiStart = tokens.findIndex(t => t.type == "meta_quote_open" && t.args[0]?.chapter)
  if (epiStart > -1) {
    let epiEnd = tokens.findIndex((t, i) => t.type == "meta_quote_close" && i > epiStart)
    let range = tokens.slice(epiStart, epiEnd + 1)
    tokens.splice(epiStart, epiEnd + 1 - epiStart)
    tokens.splice(0, 0, ...range)
    let image = tokens.findIndex(t => t.type == "meta_figure" && t.args[0]?.chapter)
    if (image) {
      tokens[0].args[0].image = tokens[image].args[0].url
      tokens.splice(image, 1)
    }
  }
}

console.log(renderArray(tokens))
