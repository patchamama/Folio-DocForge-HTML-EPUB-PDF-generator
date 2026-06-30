# _mdfromhtml — HTML to Markdown Converter & Book Merger

Converts **Articulate Rise** lesson HTML files to clean Markdown using pandoc, and merges multiple Markdown files into comprehensive books with advanced features.

## Requirements

- **Node.js** (v18+)
- **pandoc** (tested with v3.x) - Only required for `html-to-md.mjs`

---

## Scripts Overview

| Script | Purpose |
| --- | --- |
| `html-to-md.mjs` | Convert HTML to Markdown (single file or batch) |
| `build-collection.mjs` | Build linked collection with navigation |
| `merge-book.mjs` ⭐ | **Merge numbered MD files into single book** |

---

# `html-to-md.mjs` — HTML to Markdown Conversion

## Usage

```bash
# Single file
node html-to-md.mjs <input.html> [output.md]

# All .html files in a directory
node html-to-md.mjs <input_dir/> [output_dir/]
```

If the output path is omitted, files are written next to the source with `.md` extension.

## Examples

```bash
node html-to-md.mjs ../elo_academy/15.html 15.md
node html-to-md.mjs ../elo_academy/ ../elo_md/
```

## Conversion Pipeline

For each HTML file:

1. **Extract** the main content (`<main class="lesson-main">`) — strips navigation, scripts, styles, and SVG icon decorations.
2. **Call pandoc** (`html → markdown`) to do the structural conversion.
3. **Post-process** the pandoc output:

   | Input pattern | Output |
   |---|---|
   | Lesson title heading (with pandoc attrs) | `# Title` |
   | Numbered step dividers | `### N. Step heading` |
   | `h2` / `h3` headings | `##` / `###` preserved |
   | Pandoc `:::` fenced-div markers | removed |
   | Checkbox / bullet list artifacts | cleaned to plain `- item` |
   | Color/style spans `[text]{style="..."}` | stripped to `text` |
   | Link/image attribute blocks `[...](url){attrs}` | stripped to `[...](url)` |
   | Visually-hidden spans `[•]{.visually-hidden-always}` | removed |
   | Copy-button and arc-element UI artifacts | removed |
   | Empty emphasis spans `* *`, `** **` | removed |
   | Code fence attributes ` ``` {.class style="..."}` | stripped to ` ``` ` |
   | Non-breaking spaces `\u00a0` | converted to regular spaces |
   | **Fully-bold paragraphs** `**text**` | converted to `> [!NOTE]` admonitions |

4. **Copy and renumber images** into a per-file subfolder.

## Image Handling

For each converted file, images are copied into a subfolder named after the `.md` file and renumbered sequentially in document order:

```
output/
├── 15.md          ← references ./15/001.png, ./15/002.png, ...
├── 15/
│   ├── 001.png
│   ├── 002.png
│   └── ...
```

- Extensions are preserved (`.png`, `.jpg`, etc.)
- Duplicate image references reuse the same numbered file
- External URLs remain unchanged
- Missing source images produce a warning

---

# `build-collection.mjs` — Full Linked Collection

## Usage

```bash
node build-collection.mjs <input_dir/> [output_dir/]
```

Converts all HTML files in the directory **and** assembles a linked collection. If `output_dir` is omitted, output is written into `input_dir`.

## Example

```bash
node build-collection.mjs ../elo_academy/ ./output/
```

## Generates

| File | Description |
|------|-------------|
| `NN.md` | Individual chapters with ← Prev · ↑ Contents · Next → navigation bars |
| `content.md` | Table of contents linking to each chapter by title |
| `book.md` | All chapters combined with a TOC and `#anchor` links |
| `images/NN/` | Per-chapter image folder with renumbered images |

## Output Format Example

### Individual chapter file (`15.md`)

```markdown
[← Analytics](14.md) · [↑ Contents](content.md) · [Space-Berechtigung →](16.md)

---

# Teamspace

Introductory text...

### 1. Step heading

- Task item one
- Task item two

![](./images/15/001.png)

> [!NOTE]
> This is an important note from a fully-bold paragraph.

---

[← Analytics](14.md) · [↑ Contents](content.md) · [Space-Berechtigung →](16.md)
```

### `content.md`

```markdown
# Contents

- [Berechtigungskonzept](01.md)
- [LDAP-Schnittstelle](02.md)
- [Teamspace](15.md)
```

### `book.md`

```markdown
# Collection

## Table of Contents

- [Berechtigungskonzept](#berechtigungskonzept)
- [Teamspace](#teamspace)

---

# Berechtigungskonzept

...content of 01.md...

---

# Teamspace

...content of 15.md...
```

---

# `merge-book.mjs` ⭐ — Complete Documentation

## Overview

`merge-book.mjs` is a powerful tool that merges multiple numbered Markdown files into a single, well-formatted book with automatic table of contents, image management, and intelligent content processing.

## Quick Start

```bash
# Basic usage - merge all numbered .md files
node merge-book.mjs ../elo_academy/

# Output: ../elo_academy/book_full.md
```

## Command Line Options

### Input/Output

| Option | Description | Default |
| --- | --- | --- |
| `<input_dir>` | Directory containing `\d+.md` files (required) | - |
| `--output <file>` | Output file path | `<input_dir>/book_full.md` |

### Content Processing

| Option | Description | Default |
| --- | --- | --- |
| `--toc-depth <n>` | Table of contents depth (0-6) | `2` |
| `--no-convert-emphasis` | Keep `*`, `**`, `***` as-is | Convert to backticks |
| `--include-original-refs` | Include "🌐 View..." lines | Excluded |
| `--no-format-tables` | Don't format table cells | Format tables |

### Image Management

| Option | Description | Default |
| --- | --- | --- |
| `--images-dest <path>` | Copy images to folder | Keep original |

## Features

### 1. Automatic Table of Contents

Generates hierarchical TOC with customizable depth (0-6).

**Examples:**
```bash
--toc-depth 1  # Only h1
--toc-depth 2  # h1 and h2 (default)
--toc-depth 3  # h1, h2, and h3
--toc-depth 0  # Disable TOC
```

**Features:**
- ✅ GitHub-style anchor generation
- ✅ German character support (ü→u, ö→o, ä→a, ß→ss)
- ✅ Duplicate detection with auto-numbering
- ✅ Escape character removal

### 2. Emphasis Conversion

Converts emphasis to inline code for readability.

**Behavior:**
- ✅ Partial emphasis: `Use **config.json**` → `Use config.json`
- ❌ Full-line: `**Important line**` → `**Important line**` (unchanged)
- ✅ Escape removal: `C:\\path` → `C:\path`

**Disable:** `--no-convert-emphasis`

### 3. Table Formatting

Formats headers and first columns with backticks.

**Example:**

**Input:**
```markdown
| **Name** | *Description* |
| --- | --- |
| ELO_Users *(rights)* | Access |
```

**Output:**
```markdown
| `Name` | `Description` |
| --- | --- |
| `ELO_Users (rights)` | Access |
```

**Disable:** `--no-format-tables`

### 4. Navigation Filtering

Removes navigation elements:
- ✅ Lines with "↑ Contents"
- ✅ "🌐 View original..." (by default)

**Include web refs:** `--include-original-refs`

### 5. Separator Consolidation

Consolidates consecutive `---` lines into one.

### 6. Trailing Backslash Removal

Removes markdown line breaks (`\`) from line ends.

### 7. Image Management

Copy images to centralized location with auto-update.

```bash
node merge-book.mjs ../elo_academy/ --images-dest ./book_images
```

**Features:**
- ✅ Copies all images
- ✅ Handles name collisions
- ✅ Updates references
- ✅ Calculates relative paths
- ✅ Skips external URLs

### 8. Image Verification

Verifies images and reports missing ones in `results.txt`.

## Usage Examples

### Example 1: Basic Merge

```bash
node merge-book.mjs ../elo_academy/
```

**Result:** `../elo_academy/book_full.md` with defaults

---

### Example 2: Complete Book with Images

```bash
node merge-book.mjs ../elo_academy/ \
  --output ./docs/guide.md \
  --images-dest ./docs/images \
  --toc-depth 3
```

---

### Example 3: Minimal Processing

```bash
node merge-book.mjs ../elo_academy/ \
  --toc-depth 0 \
  --no-convert-emphasis \
  --no-format-tables
```

---

### Example 4: Custom Output Location

```bash
node merge-book.mjs ../elo_academy/ \
  --output ./books/elo_complete.md \
  --images-dest ./books/images
```

## File Requirements

### Input Files

Must match pattern: `\d+.md`

**Valid:** `01.md`, `1.md`, `100.md`, `999.md`
**Invalid:** `intro.md`, `README.md`, `chapter-1.md`

### Sorting

Files sorted **numerically**: `1.md`, `2.md`, `10.md`, `100.md`

## Output Structure

```markdown
# Content

- [Chapter 1](#chapter-1)
  - [Section 1.1](#section-11)
- [Chapter 2](#chapter-2)

---

# Chapter 1

Content from 01.md...

---

# Chapter 2

Content from 02.md...
```

## Processing Flow

1. Find & sort files (`\d+.md`)
2. Extract image references
3. Process content (emphasis, tables, etc.)
4. Verify images
5. Copy images (if `--images-dest`)
6. Generate TOC
7. Merge chapters
8. Post-process (backslash, separators, tables)
9. Write output

## Special Characters

German characters normalized in anchors:

| Char | Normalized |
| --- | --- |
| `ü` | `u` |
| `ö` | `o` |
| `ä` | `a` |
| `ß` | `ss` |

**Example:**
- Heading: `Über das System`
- Anchor: `#uber-das-system`

## Troubleshooting

### No files found
**Error:** No numbered files found

**Solution:** Ensure files match `\d+.md` pattern

---

### Missing images
**Warning:** N missing images

**Solution:** Check `results.txt`, verify paths, use `--images-dest`

---

### TOC anchors broken
**Problem:** Links don't jump to sections

**Solution:** Regenerate with latest version, check for escapes

---

### Table formatting issues
**Problem:** Nested backticks or emphasis

**Solution:** Update script or use `--no-format-tables`

## Advanced Usage

### Batch Processing

```bash
for dir in project1 project2 project3; do
  node merge-book.mjs "$dir" --output "output/${dir}_book.md"
done
```

### Integration with Pandoc

```bash
# Merge then convert to PDF
node merge-book.mjs ../elo_academy/ --output book.md
pandoc book.md -o book.pdf --toc --toc-depth=2
```

### Organized Output

```bash
mkdir -p output/books output/images

node merge-book.mjs sources/ \
  --output output/books/guide.md \
  --images-dest output/images \
  --toc-depth 3
```

## Performance

| Files | Images | Time |
| --- | --- | --- |
| 10 chapters | 50 images | ~2 sec |
| 50 chapters | 200 images | ~8 sec |
| 100 chapters | 500 images | ~15 sec |

## Notes

- Designed for **Articulate Rise** HTML but works with any Markdown
- All processing is non-destructive (original files unchanged)
- Output always UTF-8 encoded
- Handles large files efficiently (50MB+ tested)
- Cross-platform (Windows, macOS, Linux)

## Related Workflows

### Full HTML to Book Pipeline

```bash
# Step 1: Convert HTML to MD
node html-to-md.mjs ../html_lessons/ ../md_output/

# Step 2: Merge into book
node merge-book.mjs ../md_output/ \
  --output book.md \
  --images-dest images/ \
  --toc-depth 3
```

### Collection + Book

```bash
# Build collection (individual chapters with navigation)
node build-collection.mjs ../elo_academy/ ../collection/

# Also merge into single book
node merge-book.mjs ../collection/ \
  --output ../complete_book.md
```

---

## Support

For issues, questions, or feature requests, please contact the development team or file an issue in the project repository.
