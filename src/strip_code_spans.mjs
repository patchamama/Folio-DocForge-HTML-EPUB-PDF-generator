// Strips <span> tags and extra <pre> attributes inside code blocks so that
// pandoc can re-highlight the code using its own Skylighting highlighter.
// Usage: node src/strip_code_spans.mjs file1.html file2.html ...
// Reads listed files and outputs them concatenated with spans stripped.

import * as fs from "fs"

let files = process.argv.slice(2)
if (!files.length) throw new Error("Usage: strip_code_spans.mjs <file1.html> [file2.html ...]")

for (let file of files) {
  let html = fs.readFileSync(file, "utf8")
  // Strip <nav> blocks (top/bottom chapter navigation) so they don't appear in pandoc output
  html = html.replace(/<nav[\s>][^]*?<\/nav>/g, "")
  // Strip client-side-only TOC placeholder (populated by JS, empty for pandoc)
  html = html.replace(/<div id="toc-wrap"><\/div>/g, "")
  // Convert quiz checkboxes to Unicode symbols (pandoc doesn't render <input> in PDF/EPUB)
  html = html.replace(/<input[^>]*class="quiz-input"[^>]*data-correct[^>]*>/g, "☒ ")
  html = html.replace(/<input[^>]*class="quiz-input"[^>]*>/g, "☐ ")
  // Match <pre ...>optional-anchor<code class="language-XXX">...</code></pre>
  // Strip spans, anchor, and <pre> attrs so pandoc recognizes it as a fenced code block
  html = html.replace(/<pre[^>]*>(<a[^>]*>[^<]*<\/a>)?<code class="language-([^"]+)">([^]*?)<\/code><\/pre>/g,
    (_, _anchor, lang, body) => {
      let plain = body.replace(/<\/?span[^>]*>/g, "")
      return `<pre><code class="language-${lang}">${plain}</code></pre>`
    })
  process.stdout.write(html)
}
