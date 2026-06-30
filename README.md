# Folio DocForge

### HTML · EPUB · PDF Generator

> A multi-format document publishing pipeline with a web UI, real-time progress tracking, and support for any Markdown or HTML source folder.

---

## Origin

Folio DocForge is built on top of the publishing toolchain originally created by [Marijn Haverbeke](https://github.com/marijnh) for the book [**Eloquent JavaScript**](https://github.com/marijnh/Eloquent-JavaScript). That pipeline converts Markdown chapters into interactive HTML, a native EPUB, and a LaTeX-based PDF — all from a single source of truth.

This project extends that foundation significantly:

| Original (Eloquent JavaScript) | Folio DocForge |
|---|---|
| Single book (JavaScript-only content) | Any Markdown or HTML folder |
| JS-only syntax highlighting | 14+ languages via @lezer |
| CLI / Make only | Web UI with folder browser + SSE progress |
| One source folder | Recursive subfolder mode (build each + combined book) |
| Fixed output path | Configurable destination folder |
| XeLaTeX + native EPUB | Adds Pandoc PDF (WeasyPrint) and Pandoc EPUB |
| Static notes | Interactive quiz system + settings panel |
| — | Notes panel with `- [ ]` task tracking |
| — | Dark / light theme toggle |
| — | `clean.sh`, `start.sh`, utility subprojects |

---

## Why

Technical documentation, training courses, and e-books are often authored in Markdown or exported from web platforms as HTML. Converting those sources into clean, portable formats (PDF for printing, EPUB for e-readers, HTML for web hosting) typically requires piecing together multiple tools with no consistent pipeline.

Folio DocForge provides a **single pipeline** that accepts either Markdown or HTML folders and produces all output formats in one run, with a browser-based UI that shows per-task progress in real time.

---

## Tech Stack

### Pipeline (server-side)

| Technology | Role |
|---|---|
| **Node.js 18+** | Pipeline runtime, HTTP server |
| **markdown-it** | Markdown parser (extended with custom block/inline rules) |
| **@lezer** (CodeMirror) | Syntax highlighting for 14+ languages |
| **mold-template** | HTML / EPUB chapter templating |
| **Rollup** | Client-side JS bundle |
| **Make** | Build orchestration and incremental dependency tracking |
| **XeLaTeX / KOMA-Script** | PDF generation (professional typography) |
| **Pandoc** | Alternative PDF and EPUB generation |
| **WeasyPrint** | HTML→PDF rendering engine used by Pandoc |
| **SSE (Server-Sent Events)** | Real-time progress streaming to the browser |

### Client-side (browser)

| Technology | Role |
|---|---|
| **CodeMirror 6** | Interactive code playground |
| **@codemirror/lang-\*** | Language support: JS, TS, CSS, HTML, PHP |
| **@codemirror/legacy-modes** | Language support: Python, Go, XML, JSON, SQL, YAML, Pascal, C/C++ |
| **Vanilla JS + CSS variables** | UI, dark/light theme, settings panel, quizzes, TOC |

### Supported syntax-highlighted languages

`javascript` · `typescript` · `python` · `php` · `go` · `css` · `html` · `xml` · `json` · `yaml` · `sql` · `c` · `cpp` · `pascal`

---

## Architecture

```
Source (Markdown or HTML folder)
        │
        ▼
  ┌─────────────┐
  │ convert_gfm │  GFM extensions → internal token syntax
  └──────┬──────┘
         │ converted/*.md
         ▼
  ┌─────────────┐
  │  markdown   │  Parse → token stream (markdown-it, custom rules)
  └──────┬──────┘
         │
  ┌──────┴──────┐
  │  transform  │  Conditional blocks, anchor IDs, metadata
  └──────┬──────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
render_html  render_latex
    │         │
    ▼         ▼
html/*.html  pdf/*.tex
epub/*.xhtml      │
    │         xelatex × 3
    ▼         + makeindex
book.epub         │
    │         book.pdf
    └────┬────┘
         │         ┌──── Pandoc path ────┐
         │         │  strip_code_spans   │
         │         │  + Pandoc           │
         │         │  → book.pandoc.pdf  │
         │         │  → book.pandoc.epub │
         │         └────────────────────┘
         ▼
    _READY/<folder>/
```

**Two input modes:**

- **Markdown mode** — source `.md` files are staged, built with Make, and deployed.
- **HTML mode** — HTML files are converted to Markdown via `_mdfromhtml/build-collection.mjs`, merged with `merge-book.mjs`, then fed into the same Make pipeline. Supports **recursive subfolder mode**: each subfolder is built independently and then all chapters are merged into a combined full book.

---

## Prerequisites

| Tool | Required for | Install |
|---|---|---|
| Node.js 18+ | All stages | https://nodejs.org |
| npm | Dependencies | Bundled with Node |
| make | Build pipeline | Pre-installed on Linux/macOS |
| XeLaTeX | PDF via LaTeX | `apt install texlive-xetex texlive-fonts-extra` |
| Pandoc | EPUB/PDF via Pandoc | https://pandoc.org |
| WeasyPrint | Pandoc PDF engine | `pip install weasyprint` |
| Inkscape | SVG→PDF (LaTeX path only) | `apt install inkscape` |

---

## Capturing Web Content as HTML Input

Folio DocForge accepts folders of HTML files as input. The easiest way to capture an online course, documentation site, or any multi-page resource is to save it locally first.

### Recommended: Save Page WE (Chrome / Edge)

[**Save Page WE**](https://chrome.google.com/webstore/detail/save-page-we/dhhpefjklgkmgeafimnjhojgjamoafof) is a browser extension that saves a complete web page — including all CSS, images, and embedded fonts — as a single self-contained `.html` file.

**Why it works well with Folio DocForge:**

- Saves each page as a standalone `.html` file with no external dependencies
- Preserves images inline (base64) or as separate files, both of which `_mdfromhtml` handles correctly
- Works on course platforms, documentation portals, intranets, and any page requiring authentication (you are already logged in when you save)

**Workflow:**

```
1. Install "Save Page WE" from the Chrome Web Store
2. Navigate to each lesson / chapter page in your browser
3. Click the extension icon → Save (choose "Complete" or "HTML Only")
4. Repeat for each page, saving all files into one folder:

   my-course/
   ├── 01_introduction.html
   ├── 02_getting_started.html
   ├── 03_advanced_topics.html
   └── images/        ← (if the extension saves images separately)

5. Open Folio DocForge → select "HTML folder" → point to my-course/
6. Run the conversion → get HTML, EPUB, and PDF
```

**Tips:**

- Name files with a numeric prefix (`01_`, `02_`, …) so chapters appear in the correct order
- If the course has a sidebar or navigation you want to exclude, the `_mdfromhtml` converter strips `<nav>`, `<header>`, `<footer>`, and `<aside>` elements automatically
- For courses behind a login (e.g. ELO, Moodle, proprietary LMS), Save Page WE is particularly useful because it captures the rendered page exactly as you see it

### Alternative tools

| Tool | Platform | Notes |
|---|---|---|
| **Save Page WE** | Chrome, Edge | Best all-around; single-file HTML output |
| **SingleFile** | Chrome, Firefox, Edge | Similar to Save Page WE; also produces single-file HTML |
| **wget --mirror** | CLI | Good for static sites without authentication |
| **httrack** | CLI / GUI | Full site mirroring with link rewriting |
| **Playwright / Puppeteer** | Node.js | Scriptable; useful for courses with dynamic content or pagination |

---

## Quick Start

### Option A — Web UI

```bash
./start.sh
```

Opens `http://localhost:7789` in your browser. From there:

1. Select input type: **HTML folder** or **Markdown folder**
2. Browse to the source folder
3. Choose output formats (HTML, EPUB, PDF) and conversion methods
4. Optionally set a custom destination folder
5. Click **Start Conversion** — watch per-task progress in real time

### Option B — Command line

```bash
npm install

# Build everything from Markdown files in the current folder
make all

# Build individual formats
make html                    # Interactive HTML
make book.epub               # Native EPUB
make book.pdf                # PDF via XeLaTeX
make pdf_pandoc              # PDF via Pandoc + WeasyPrint
make book.pandoc.epub        # EPUB via Pandoc

# Language for admonition labels (default: en)
make html BOOK_LANG=es
```

### Option C — HTML folder pipeline

```bash
./build-from-html-folder.sh /path/to/html-folder [html|epub|pdf|all]
```

Detects subfolders with HTML files, builds each independently, then assembles a combined book from all chapters.

### Clean build artifacts

```bash
./clean.sh           # Remove all generated files (keeps html/ejs.js)
./clean.sh --full    # Also removes html/ejs.js (forces Rollup rebuild)
```

---

## Output Formats

| Format | Target | Engine | Output |
|---|---|---|---|
| Interactive HTML | `make html` | markdown-it + @lezer | `html/*.html` + `html/ejs.js` |
| EPUB (native) | `make book.epub` | Custom assembler + zip | `book.epub` |
| EPUB (Pandoc) | `make book.pandoc.epub` | Pandoc | `book.pandoc.epub` |
| PDF (LaTeX) | `make book.pdf` | XeLaTeX / KOMA-Script | `book.pdf` |
| PDF (Pandoc) | `make pdf_pandoc` | Pandoc + WeasyPrint | `book.pandoc.pdf` |

---

## Web UI Features

- **Folder browser** — navigate the filesystem to select source and destination folders
- **Real-time progress** — SSE-based live task log with elapsed time per task, progress bar, and task counter
- **Per-folder stats** — image and video count shown in each phase header
- **Open folder links** — click the folder icon in any phase header to open it in Explorer / Finder
- **Multi-method selection** — select both native and Pandoc methods for EPUB and PDF simultaneously
- **Notes panel** — persistent `.notes.txt` with `- [ ]` pending task counter
- **Dark / light theme** — persisted in `localStorage`
- **Custom destination** — choose any output folder instead of the default `_READY/` subfolder

---

## Markdown Features

### Admonitions

```markdown
> [!NOTE]      > [!WARNING]      > [!TIP]
> [!IMPORTANT] > [!CAUTION]      > [!INFO]
```

Rendered as styled boxes in HTML and EPUB; as `\admonitionbox` with per-type colors in LaTeX.

### Quizzes

```markdown
## Quiz section

- [x] Correct answer
- [ ] Wrong answer
- [x] Another correct one
```

HTML adds **Check / Solutions / Reset** buttons per section. PDF/EPUB show static `☒` / `☐` symbols.

### Conditional blocks

```markdown
<!-- if: interactive -->
This only appears in HTML.
<!-- endif -->
```

Conditions: `interactive` (HTML), `book` (EPUB + PDF), `html` (HTML + EPUB), `tex` (LaTeX only).

### Hints (collapsible)

```markdown
<!-- hint -->
The answer involves recursion.
<!-- /hint -->
```

Renders as `<details>` in HTML. Stripped from PDF.

### Figures with options

```markdown
<!-- figure-options: {chapter: true, width: "6cm"} -->
![Alt text](img/hero.png)
```

### Code blocks (14+ languages)

````markdown
```python
def greet(name):
    return f"Hello, {name}"
```
````

````markdown
```php
echo "Hello, " . $name;
```
````

---

## Directory Structure

```
.
├── src/
│   ├── convert_gfm.mjs         # Stage 1: GFM → internal token syntax
│   ├── markdown.mjs             # Stage 2: Markdown parser
│   ├── transform.mjs            # Stage 3: Token post-processing
│   ├── render_html.mjs          # Stage 4a: HTML / EPUB renderer
│   ├── render_latex.mjs         # Stage 4b: LaTeX renderer
│   ├── prepare_book.mjs         # Chapter discovery, template expansion
│   ├── generate_epub_toc.mjs    # EPUB TOC from rendered chapters
│   ├── add_images_to_epub.mjs   # EPUB image manifest
│   ├── strip_code_spans.mjs     # HTML cleanup for Pandoc input
│   ├── chapter.html             # HTML chapter template
│   └── client/                  # Browser bundle (Rollup)
│       ├── ejs.mjs              # Toolbar, TOC, quizzes, settings, playground
│       └── rollup.config.mjs
│
├── html/                        # Generated HTML output
│   ├── ejs.js                   # Bundled client script
│   └── css/
│       ├── ejs.css              # Main stylesheet (dark/light themes)
│       └── pandoc.css           # Overrides for Pandoc output
│
├── epub/                        # EPUB assets and generated files
│   ├── style.css
│   ├── font/                    # Embedded fonts (Cinzel Bold, PT Mono)
│   ├── toc.xhtml.tmpl
│   └── content.opf.tmpl
│
├── pdf/
│   ├── book.tex.tmpl            # LaTeX document template
│   └── build.sh                 # xelatex × 3 + makeindex
│
├── _mdfromhtml/                 # HTML → Markdown converter
│   ├── build-collection.mjs     # Convert HTML files per folder
│   └── merge-book.mjs           # Merge chapters into book_full.md
│
├── server.mjs                   # Web UI server (HTTP + SSE)
├── start.sh                     # Launch script (checks deps, opens browser)
├── clean.sh                     # Remove all build artifacts
├── build-from-html-folder.sh    # CLI pipeline for HTML input folders
└── Makefile                     # Build targets and dependency tracking
```

---

## Utility Subprojects

| Subproject | Purpose |
|---|---|
| [`_mdfromhtml`](_mdfromhtml/) | HTML → Markdown conversion (ELO, web-exported content) |
| [`_mdformater`](_mbformater/) | Extract, format (Prettier/Black), and reimport code blocks |
| [`_mdImageDownloader`](_mdImageDownloader/) | Download remote images, replace URLs with local paths |
| [`_mdsplit`](_mdsplit/) | Split a large Markdown file into chapters by heading level |
| [`_mdtranslator`](_mbtranslator/) | Extract translatable strings, apply translations, reimport |
| [`_Course_catalog_Generator`](_Course_catalog_Generator/) | Browsable course catalog + full-text / semantic search + Ollama RAG |
| [`_youtube_downloader`](_youtube_downloader/) | Download YouTube subtitles (SRT) and videos for AI indexing |
| [`_pdf_collector`](_pdf_collector/) | Convert SRT / HTML / PDF to structured Markdown for AI notebooks |

---

## License

The publishing pipeline code originates from [Eloquent JavaScript](https://github.com/marijnh/Eloquent-JavaScript) by Marijn Haverbeke, licensed under [CC BY-NC 3.0](https://creativecommons.org/licenses/by-nc/3.0/). Extensions and additions in this project follow the same license terms.
