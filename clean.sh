#!/usr/bin/env bash
# clean.sh — Remove all intermediate and output build artifacts.
# Safe to run at any time; leaves source folders, templates, and CSS untouched.
# Usage:
#   ./clean.sh          — standard clean (keeps html/ejs.js so rollup is not re-run)
#   ./clean.sh --full   — also removes html/ejs.js (forces rollup rebuild on next make)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; RST='\033[0m'; BLD='\033[1m'
removed=0

rm_f() {
  local target="$1" label="$2"
  if [ -e "$target" ] || compgen -G "$target" > /dev/null 2>&1; then
    rm -rf $target
    printf "  ${GRN}✓${RST} %s\n" "$label"
    removed=$(( removed + 1 ))
  fi
}

printf "\n${BLD}🧹 Folio — Clean build artifacts${RST}\n\n"

# ── Intermediate markdown (staged by pipeline) ────────────────────────────────
printf "${YEL}Staged markdown${RST}\n"
rm_f "converted"                          "converted/"
rm_f "$SCRIPT_DIR/00_*.md"               "00_*.md (staged chapters)"
rm_f "$SCRIPT_DIR/_00_*.md"              "_00_*.md (build-from-html backups)"
rm_f "$SCRIPT_DIR/_srv_bk_*.md"          "_srv_bk_*.md (server backups)"
rm_f "$SCRIPT_DIR/full_book.md"          "full_book.md"
rm_f "$SCRIPT_DIR/links.md"              "links.md"

# ── HTML output ───────────────────────────────────────────────────────────────
printf "\n${YEL}HTML${RST}\n"
rm_f "html/[0-9][0-9]_*.html"            "html/NN_*.html"
rm_f "html/index.html"                   "html/index.html"
rm_f "html/full_book.html"               "html/full_book.html"
rm_f "html/full_book.md"                 "html/full_book.md"
rm_f "html/images"                       "html/images/"
rm_f "html/videos"                       "html/videos/"
if [ "$FULL" -eq 1 ]; then
  rm_f "html/ejs.js"                     "html/ejs.js (rollup bundle)"
fi

# ── EPUB intermediate ─────────────────────────────────────────────────────────
printf "\n${YEL}EPUB${RST}\n"
rm_f "epub/[0-9][0-9]_*.xhtml"          "epub/NN_*.xhtml"
rm_f "epub/toc.xhtml"                    "epub/toc.xhtml"
rm_f "epub/toc.xhtml.src"               "epub/toc.xhtml.src"
rm_f "epub/content.opf"                  "epub/content.opf"
rm_f "epub/content.opf.src"             "epub/content.opf.src"
rm_f "epub/images"                       "epub/images/"
rm_f "epub/img"                          "epub/img/"

# ── PDF / LaTeX intermediate ──────────────────────────────────────────────────
printf "\n${YEL}PDF / LaTeX${RST}\n"
rm_f "pdf/[0-9][0-9]_*.tex"             "pdf/NN_*.tex"
rm_f "pdf/book.tex"                      "pdf/book.tex"
rm_f "pdf/book_mobile.tex"              "pdf/book_mobile.tex"
rm_f "pdf/build.log"                     "pdf/build.log"
rm_f "img/generated"                     "img/generated/"

# ── Final output files ────────────────────────────────────────────────────────
printf "\n${YEL}Output files${RST}\n"
rm_f "book.epub"                          "book.epub"
rm_f "book.pandoc.epub"                  "book.pandoc.epub"
rm_f "book.pdf"                           "book.pdf"
rm_f "book.pandoc.pdf"                   "book.pandoc.pdf"
rm_f "book_mobile.pdf"                   "book_mobile.pdf"
rm_f "book.html"                          "book.html"

# ── Root asset copies (staged by pipeline) ────────────────────────────────────
printf "\n${YEL}Staged assets${RST}\n"
rm_f "images"                             "images/ (root copy)"

# ── Pandoc temp files ─────────────────────────────────────────────────────────
printf "\n${YEL}Temp files${RST}\n"
rm_f "pdf_pandoc_tmp*.html"              "pdf_pandoc_tmp*.html"
rm_f "epub_pandoc_tmp.html"              "epub_pandoc_tmp.html"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [ "$removed" -eq 0 ]; then
  printf "${GRN}Already clean — nothing to remove.${RST}\n\n"
else
  printf "${GRN}${BLD}Done.${RST} Removed ${removed} item(s).\n"
  if [ "$FULL" -eq 0 ]; then
    printf "  ${YEL}Tip:${RST} run ${BLD}./clean.sh --full${RST} to also remove html/ejs.js (forces rollup rebuild).\n"
  fi
  echo ""
fi
