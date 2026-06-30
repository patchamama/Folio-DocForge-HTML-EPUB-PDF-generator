#!/usr/bin/env bash
set -e

FOLDER="${1%/}"
TYPE="${2:-all}"

# PIDs of background pandoc PDF jobs — populated by start_pandoc_pdf_bg()
PANDOC_BG_PIDS=()

if [ -z "$FOLDER" ]; then
  echo "Usage: $0 <folder> [html|epub|pdf|all|deploy|make]"
  exit 1
fi

case "$TYPE" in
  html)   MAKE_TARGET="html" ;;
  epub)   MAKE_TARGET="book.epub" ;;
  pdf)    MAKE_TARGET="book.pdf" ;;
  all)    MAKE_TARGET="all" ;;
  deploy) MAKE_TARGET="all" ;;
  make)   MAKE_TARGET="all" ;;
  *)
    echo "Invalid type: '$TYPE'. Options: html, epub, pdf, all, deploy, make"
    exit 1
    ;;
esac

start_progress_server

# ── Helpers ───────────────────────────────────────────────────────────────────

sanitize_name() {
  echo "$1" | tr ' ()[]{}!@#$%^&*+=' '_________________' | tr -s '_' | sed 's/_$//'
}

has_html() {
  ls "$1"/*.html 2>/dev/null | grep -q .
}

# ── Progress UI ───────────────────────────────────────────────────────────────
PROGRESS_PORT=7788
PROGRESS_PID=""
_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

_pej() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

pe() {
  [ -z "$PROGRESS_PID" ] && return 0
  local t i l d
  t=$(_pej "$1") i=$(_pej "$2") l=$(_pej "${3:-}") d=$(_pej "${4:-}")
  curl -s -X POST "http://127.0.0.1:${PROGRESS_PORT}/event" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"type\":\"${t}\",\"id\":\"${i}\",\"label\":\"${l}\",\"detail\":\"${d}\"}" \
    2>/dev/null || true
}

pe_plan() {
  [ -z "$PROGRESS_PID" ] && return 0
  local pi picon pl ti tl
  pi=$(_pej "$1") picon=$(_pej "$2") pl=$(_pej "$3") ti=$(_pej "$4") tl=$(_pej "$5")
  curl -s -X POST "http://127.0.0.1:${PROGRESS_PORT}/event" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"type\":\"task_plan\",\"phase_id\":\"${pi}\",\"phase_icon\":\"${picon}\",\"phase_label\":\"${pl}\",\"id\":\"${ti}\",\"label\":\"${tl}\"}" \
    2>/dev/null || true
}

pe_log() {
  [ -z "$PROGRESS_PID" ] && return 0
  local m lv
  m=$(_pej "$1") lv="${2:-}"
  curl -s -X POST "http://127.0.0.1:${PROGRESS_PORT}/event" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"type\":\"log\",\"message\":\"${m}\",\"level\":\"${lv}\"}" \
    2>/dev/null || true
}

pe_make() {
  # pe_make <fid> <make_target> — start + run + done/fail, return make exit code
  local FID="$1" MT="$2" TID TL
  case "$MT" in
    html)      TID="${FID}_make_html"; TL="Render HTML" ;;
    book.epub) TID="${FID}_make_epub"; TL="Build EPUB (native)" ;;
    book.pdf)  TID="${FID}_make_pdf";  TL="Build PDF (LaTeX)" ;;
    *)         TID="${FID}_make_${MT}"; TL="make ${MT}" ;;
  esac
  pe task_start "$TID" "$TL"
  if make "$MT" 2>/dev/null; then
    pe task_done "$TID" "$TL"; return 0
  else
    pe task_fail "$TID" "$TL" "make ${MT} failed"; return 1
  fi
}

plan_folder() {
  # plan_folder <fid> <flabel> — emits task_plan events for a single folder build
  local FID="$1" FL="$2" PH="ph_${1}" ICON="📁"
  pe_plan "$PH" "$ICON" "$FL" "${FID}_assets"     "Copy images & videos"
  if [ "$TYPE" != "make" ]; then
    pe_plan "$PH" "$ICON" "$FL" "${FID}_collect"  "HTML → Markdown (build-collection)"
    pe_plan "$PH" "$ICON" "$FL" "${FID}_merge"    "Merge book chapters"
  fi
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "html"      ]] && pe_plan "$PH" "$ICON" "$FL" "${FID}_make_html" "Render HTML"
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "book.epub" ]] && pe_plan "$PH" "$ICON" "$FL" "${FID}_make_epub" "Build EPUB (native)"
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "book.pdf"  ]] && pe_plan "$PH" "$ICON" "$FL" "${FID}_make_pdf"  "Build PDF (LaTeX)"
  pe_plan "$PH" "$ICON" "$FL" "${FID}_deploy" "Deploy to READY"
  if [[ "$MAKE_TARGET" == "all" ]]; then
    pe_plan "ph_bg" "⚡" "Background (pandoc)" "${FID}_pandoc_pdf"  "pandoc PDF"
    pe_plan "ph_bg" "⚡" "Background (pandoc)" "${FID}_pandoc_epub" "pandoc EPUB"
  fi
}

plan_combined() {
  local PH="ph_combined"
  pe_plan "$PH" "📚" "Combined book" "cb_concat"     "Concatenate all chapters"
  pe_plan "$PH" "📚" "Combined book" "cb_clean"      "make clean"
  pe_plan "$PH" "📚" "Combined book" "cb_assets"     "Merge all assets"
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "html"      ]] && pe_plan "$PH" "📚" "Combined book" "cb_make_html" "Render HTML (full book)"
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "book.epub" ]] && pe_plan "$PH" "📚" "Combined book" "cb_make_epub" "Build EPUB (full book)"
  [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "book.pdf"  ]] && pe_plan "$PH" "📚" "Combined book" "cb_make_pdf"  "Build PDF (full book)"
  pe_plan "$PH" "📚" "Combined book" "cb_deploy" "Deploy full book"
  if [[ "$MAKE_TARGET" == "all" ]]; then
    pe_plan "ph_bg" "⚡" "Background (pandoc)" "cb_pandoc_pdf"  "pandoc PDF (full book)"
    pe_plan "ph_bg" "⚡" "Background (pandoc)" "cb_pandoc_epub" "pandoc EPUB (full book)"
  fi
}

start_progress_server() {
  command -v node &>/dev/null || return
  command -v curl &>/dev/null || return
  # Skip if port already busy
  curl -s --max-time 0.3 "http://127.0.0.1:${PROGRESS_PORT}/" -o /dev/null 2>/dev/null && {
    echo "  [WARN] Port ${PROGRESS_PORT} busy — progress UI skipped"; return
  }
  PROGRESS_PORT="${PROGRESS_PORT}" node "${_SCRIPT_DIR}/src/progress-server.mjs" 2>/dev/null &
  PROGRESS_PID=$!
  # Wait up to 3s for ready signal
  local i=0
  while [ $i -lt 15 ]; do
    curl -s --max-time 0.2 "http://127.0.0.1:${PROGRESS_PORT}/" -o /dev/null 2>/dev/null && break
    sleep 0.2; i=$(( i + 1 ))
  done
  echo "  Progress UI → http://127.0.0.1:${PROGRESS_PORT}/"
  # Open browser (WSL2 / Linux / macOS)
  if [ -f /mnt/c/Windows/System32/cmd.exe ]; then
    /mnt/c/Windows/System32/cmd.exe /c "start http://127.0.0.1:${PROGRESS_PORT}/" 2>/dev/null &
  elif command -v wslview  &>/dev/null; then wslview  "http://127.0.0.1:${PROGRESS_PORT}/" 2>/dev/null &
  elif command -v xdg-open &>/dev/null; then xdg-open "http://127.0.0.1:${PROGRESS_PORT}/" 2>/dev/null &
  elif command -v open     &>/dev/null; then open     "http://127.0.0.1:${PROGRESS_PORT}/" 2>/dev/null &
  fi
}

stop_progress_server() {
  [ -z "$PROGRESS_PID" ] && return
  curl -s "http://127.0.0.1:${PROGRESS_PORT}/shutdown" 2>/dev/null || true
  wait "$PROGRESS_PID" 2>/dev/null || true
  PROGRESS_PID=""
}

# ── Background pandoc PDF ────────────────────────────────────────────────────
# Copies all required resources to an isolated temp dir (random name) and runs
# pandoc in background. On completion copies book.pandoc.pdf to READY_DIR and
# FOLDER_DST. Registers the PID in PANDOC_BG_PIDS for the final wait.
start_pandoc_pdf_bg() {
  local READY_DIR="$1"
  local FOLDER_DST="$2"
  local TASK_ID="${3:-pandoc_pdf}"

  # Fast prep steps: strip code spans + add TOC + fix img src paths
  local TMPD
  TMPD="$(mktemp -d)"

  node src/strip_code_spans.mjs \
      $(ls html/[0-9][0-9]_*.html 2>/dev/null | sort | tr '\n' ' ') \
    > "${TMPD}/tmp1.html" 2>/dev/null || {
    echo "  [BG-PDF] strip_code_spans failed — skipping pandoc PDF"
    pe task_fail "$TASK_ID" "pandoc PDF" "strip_code_spans failed"
    rm -rf "$TMPD"; return
  }
  node src/add_toc_to_pandoc_html.mjs "${TMPD}/tmp1.html" \
    > "${TMPD}/tmp2.html" 2>/dev/null \
    && sed 's|src="\./|src="html/|g' "${TMPD}/tmp2.html" > "${TMPD}/input.html" \
    || cp "${TMPD}/tmp1.html" "${TMPD}/input.html"
  rm -f "${TMPD}/tmp1.html" "${TMPD}/tmp2.html"

  cp -r html "${TMPD}/html"

  local RD="$READY_DIR" FD="$FOLDER_DST" TID="$TASK_ID"
  (
    pe task_start "$TID" "pandoc PDF"
    cd "$TMPD"
    pandoc input.html \
      --from html --to pdf \
      --pdf-engine=weasyprint \
      --css html/css/ejs.css \
      --css html/css/pandoc.css \
      --resource-path=html \
      --highlight-style=tango \
      --standalone \
      --metadata title="" \
      --metadata toc-title="Content" \
      -o book.pandoc.pdf \
    && {
      pe task_done "$TID" "pandoc PDF"
      [ -n "$RD" ] && mkdir -p "$RD" \
        && cp book.pandoc.pdf "$RD/book.pandoc.pdf" \
        && echo "  [PDF] book.pandoc.pdf → ${RD}"
      [ -n "$FD" ] && cp book.pandoc.pdf "${FD}/book.pandoc.pdf" 2>/dev/null || true
    } || {
      pe task_fail "$TID" "pandoc PDF" "pandoc exited non-zero"
      echo "  [WARN] pandoc PDF failed (temp dir: ${TMPD})"
    }
    rm -rf "$TMPD"
  ) &
  local PID=$!
  PANDOC_BG_PIDS+=("$PID")
  echo "  [BG] pandoc PDF started (PID ${PID})"
}

# ── Background pandoc EPUB ───────────────────────────────────────────────────
start_pandoc_epub_bg() {
  local READY_DIR="$1"
  local FOLDER_DST="$2"
  local TASK_ID="${3:-pandoc_epub}"

  local TMPD
  TMPD="$(mktemp -d)"

  node src/strip_code_spans.mjs \
      $(ls html/[0-9][0-9]_*.html 2>/dev/null | sort | tr '\n' ' ') \
    > "${TMPD}/input.html" 2>/dev/null || {
    echo "  [BG-EPUB] strip_code_spans failed — skipping pandoc EPUB"
    pe task_fail "$TASK_ID" "pandoc EPUB" "strip_code_spans failed"
    rm -rf "$TMPD"; return
  }

  cp -r html "${TMPD}/html"

  local RD="$READY_DIR" FD="$FOLDER_DST" TID="$TASK_ID"
  (
    pe task_start "$TID" "pandoc EPUB"
    cd "$TMPD"
    pandoc input.html \
      --from html --to epub \
      --css html/css/ejs.css \
      --css html/css/pandoc.css \
      --resource-path=html \
      --highlight-style=tango \
      --standalone \
      --toc --toc-depth=2 \
      --epub-title-page=false \
      --metadata title="" \
      --metadata toc-title="Content" \
      -o book.pandoc.epub \
    && {
      pe task_done "$TID" "pandoc EPUB"
      [ -n "$RD" ] && mkdir -p "$RD" \
        && cp book.pandoc.epub "$RD/book.pandoc.epub" \
        && echo "  [EPUB] book.pandoc.epub → ${RD}"
      [ -n "$FD" ] && cp book.pandoc.epub "${FD}/book.pandoc.epub" 2>/dev/null || true
    } || {
      pe task_fail "$TID" "pandoc EPUB" "pandoc exited non-zero"
      echo "  [WARN] pandoc EPUB failed (temp dir: ${TMPD})"
    }
    rm -rf "$TMPD"
  ) &
  local PID=$!
  PANDOC_BG_PIDS+=("$PID")
  echo "  [BG] pandoc EPUB started (PID ${PID})"
}

# ── Build + deploy one folder ─────────────────────────────────────────────────
# Args: WORK_DIR  READY_DIR
build_and_deploy() {
  local WORK_DIR="$1"
  local READY_DIR="$2"
  local FID
  FID=$(sanitize_name "$WORK_DIR")

  echo ""
  echo "━━━ Building: ${WORK_DIR} → ${READY_DIR} ━━━"
  pe_log "Building: ${WORK_DIR}"

  pe task_start "${FID}_assets" "Copy images & videos"
  for asset in images videos; do
    if [ -d "${WORK_DIR}/${asset}" ]; then
      echo "  Copying ${WORK_DIR}/${asset} → html/${asset}"
      rm -rf "html/${asset}/"
      cp -r "${WORK_DIR}/${asset}/." "html/${asset}/"
    fi
  done
  pe task_done "${FID}_assets" "Copy images & videos"

  for f in 00_*.md; do
    [ -e "$f" ] || continue
    mv "$f" "_${f}"
  done

  if [ "$TYPE" != "make" ]; then
    pe task_start "${FID}_collect" "HTML → Markdown (build-collection)"
    node _mdfromhtml/build-collection.mjs "$WORK_DIR"
    pe task_done  "${FID}_collect" "HTML → Markdown (build-collection)"

    pe task_start "${FID}_merge" "Merge book chapters"
    node _mdfromhtml/merge-book.mjs "$WORK_DIR" \
      --no-convert-emphasis --no-format-tables --toc-depth 0
    pe task_done  "${FID}_merge" "Merge book chapters"

    rm -f "00_${WORK_DIR}.md"
    cp "${WORK_DIR}/book_full.md" "00_${WORK_DIR}.md"
    make clean
  else
    cp "${WORK_DIR}/book_full.md" "00_${WORK_DIR}.md"
  fi

  for asset in images videos; do
    if [ -d "${WORK_DIR}/${asset}" ]; then
      rm -rf "html/${asset}/"
      cp -r "${WORK_DIR}/${asset}/." "html/${asset}/"
    fi
  done

  [ -d "./images" ] && rm -rf "./images"
  [ -d "${WORK_DIR}/images" ] && cp -r "${WORK_DIR}/images" "."
  [ -d "./epub/images" ] && rm -rf "./epub/images"
  [ -d "${WORK_DIR}/images" ] && cp -r "${WORK_DIR}/images" "./epub/images"

  local SYNC_TARGET="$MAKE_TARGET"
  [[ "$MAKE_TARGET" == "all" ]] && SYNC_TARGET="html book.epub book.pdf"
  for _mt in $SYNC_TARGET; do
    pe_make "$FID" "$_mt" || echo "  [WARN] make ${_mt} failed for ${WORK_DIR} — continuing"
  done
  cp "html/00_${WORK_DIR}.html" "html/index.html" 2>/dev/null || true

  pe task_start "${FID}_deploy" "Deploy to READY"
  mkdir -p "$READY_DIR"
  echo "  Deploying to ${READY_DIR}..."
  cp -r html "${READY_DIR}/"
  for ext in docx xml json pdf sql csv txt; do
    ls "${WORK_DIR}"/*.${ext} 2>/dev/null | while read -r f; do cp "$f" "${READY_DIR}/html/"; done
  done
  for f in book.epub book.pdf book.pandoc.pdf book.pandoc.epub book.html; do
    [ -e "$f" ] && cp "$f" "${READY_DIR}/" && echo "    → $f"
  done

  local SRC_MD="00_${WORK_DIR}.md"
  if [ -e "$SRC_MD" ]; then
    python3 -c "
import sys
p, out = sys.argv[1], sys.argv[2]
t = open(p).read()
t = t.replace('./images/', './html/images/')
t = t.replace('./videos/', './html/videos/')
open(out, 'w').write(t)
" "$SRC_MD" "${READY_DIR}/book.md"
    echo "    → book.md"
  fi

  mkdir -p "${READY_DIR}/markdown"
  cp "${WORK_DIR}"/*.md "${READY_DIR}/markdown/"
  [ -d "${WORK_DIR}/images" ] && cp -r "${WORK_DIR}/images" "${READY_DIR}/markdown/"
  python3 -c "
import os, glob
for p in glob.glob(os.path.join('${READY_DIR}/markdown', '*.md')):
    t = open(p).read()
    t2 = t.replace('./html/videos/', '../html/videos/').replace('./images/', '../html/images/')
    if t2 != t: open(p, 'w').write(t2)
"

  if [ -d "html/videos" ]; then
    mkdir -p "${READY_DIR}/videos"
    cp -r html/videos/. "${READY_DIR}/videos/"
    echo "    → videos/ (${READY_DIR}/videos/)"
  fi
  pe task_done "${FID}_deploy" "Deploy to READY"

  if [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "pdf_pandoc" ]]; then
    start_pandoc_pdf_bg  "$READY_DIR" "$FOLDER" "${FID}_pandoc_pdf"
    start_pandoc_epub_bg "$READY_DIR" "$FOLDER" "${FID}_pandoc_epub"
  fi

  echo "  Done: ${READY_DIR}"
}

# ── Combined book (recursive mode only) ──────────────────────────────────────
# Concatenates all book_full.md files, merges assets, builds one HTML/EPUB/PDF.
# Image stems are unique across folders so no path rewriting is needed.
build_combined() {
  local WORK_DIRS=("$@")   # ordered list: root first, then subfolders
  local READY_DIR="$READY_BASE"

  echo ""
  echo "━━━ Building combined full_book ━━━"
  pe_log "Building combined full_book"

  pe task_start "cb_concat" "Concatenate all chapters"
  local COMBINED="full_book.md"
  > "$COMBINED"
  for wd in "${WORK_DIRS[@]}"; do
    if [ -f "${wd}/book_full.md" ]; then
      cat "${wd}/book_full.md" >> "$COMBINED"
      printf '\n\n' >> "$COMBINED"
    fi
  done
  pe task_done "cb_concat" "Concatenate all chapters"

  for f in 00_*.md; do [ -e "$f" ] && mv "$f" "_${f}"; done
  local STEM="00_${FOLDER}_full"
  cp "$COMBINED" "${STEM}.md"

  pe task_start "cb_clean" "make clean"
  make clean
  pe task_done  "cb_clean" "make clean"

  pe task_start "cb_assets" "Merge all assets"
  rm -rf html/images html/videos
  for wd in "${WORK_DIRS[@]}"; do
    for asset in images videos; do
      if [ -d "${wd}/${asset}" ]; then
        mkdir -p "html/${asset}"
        cp -r "${wd}/${asset}/." "html/${asset}/"
      fi
    done
  done
  [ -d "./images" ] && rm -rf "./images"
  [ -d html/images ] && cp -r html/images ./images
  [ -d "./epub/images" ] && rm -rf "./epub/images"
  [ -d html/images ] && cp -r html/images ./epub/images
  pe task_done "cb_assets" "Merge all assets"

  local SYNC_TARGET="$MAKE_TARGET"
  [[ "$MAKE_TARGET" == "all" ]] && SYNC_TARGET="html book.epub book.pdf"
  for _mt in $SYNC_TARGET; do
    local _tid _tl
    case "$_mt" in
      html)      _tid="cb_make_html"; _tl="Render HTML (full book)" ;;
      book.epub) _tid="cb_make_epub"; _tl="Build EPUB (full book)" ;;
      book.pdf)  _tid="cb_make_pdf";  _tl="Build PDF (full book)" ;;
      *)         _tid="cb_make_${_mt}"; _tl="make ${_mt}" ;;
    esac
    pe task_start "$_tid" "$_tl"
    if make "$_mt" 2>/dev/null; then
      pe task_done "$_tid" "$_tl"
    else
      pe task_fail "$_tid" "$_tl" "make ${_mt} failed"
      echo "  [WARN] make ${_mt} failed for combined book — continuing"
    fi
  done

  cp "$COMBINED" "html/full_book.md"
  cp "html/${STEM}.html" "html/index.html" 2>/dev/null || true

  for f in book.epub book.pdf book.pandoc.pdf book.pandoc.epub; do
    if [ -e "$f" ]; then
      cp "$f" "${FOLDER}/"
      echo "  → ${FOLDER}/$f"
    fi
  done

  # ── Deploy to READY ─────────────────────────────────────────────────────────
  pe task_start "cb_deploy" "Deploy full book"
  for wd in "${WORK_DIRS[@]}"; do
    for asset in images videos; do
      if [ -d "${wd}/${asset}" ]; then
        mkdir -p "${READY_DIR}/html/${asset}"
        cp -r "${wd}/${asset}/." "${READY_DIR}/html/${asset}/"
      fi
    done
  done
  if [ -d "html/videos" ]; then
    mkdir -p "${READY_DIR}/videos"
    cp -r html/videos/. "${READY_DIR}/videos/"
  fi

  cp "html/${STEM}.html" "${READY_DIR}/html/full_book.html" 2>/dev/null \
    || echo "  (no full_book.html generated)"
  cp "html/full_book.md" "${READY_DIR}/html/full_book.md"
  printf '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=html/full_book.html"></head><body><a href="html/full_book.html">full_book.html</a></body></html>\n' \
    > "${READY_DIR}/full_book.html"
  echo "    → full_book.html (redirect → html/full_book.html)"
  cp "html/index.html" "${READY_DIR}/html/index.html" 2>/dev/null || true

  python3 -c "
import sys
p, out = sys.argv[1], sys.argv[2]
t = open(p).read()
t = t.replace('./images/', './html/images/')
t = t.replace('./videos/', './html/videos/')
open(out, 'w').write(t)
" "$COMBINED" "${READY_DIR}/full_book.md"
  echo "    → html/full_book.html (images via ./images/)"
  echo "    → full_book.md        (images via ./html/images/)"

  for f in book.epub book.pdf book.pandoc.epub; do
    [ -e "${FOLDER}/$f" ] && cp "${FOLDER}/$f" "${READY_DIR}/" && echo "    → $f"
  done
  pe task_done "cb_deploy" "Deploy full book"

  if [[ "$MAKE_TARGET" == "all" || "$MAKE_TARGET" == "pdf_pandoc" ]]; then
    start_pandoc_pdf_bg  "$READY_DIR" "$FOLDER" "cb_pandoc_pdf"
    start_pandoc_epub_bg "$READY_DIR" "$FOLDER" "cb_pandoc_epub"
  fi

  echo "  Combined book ready: ${READY_DIR}/html/full_book.html"
}

# ── Sanitize top-level folder name ───────────────────────────────────────────
SAFE_FOLDER=$(sanitize_name "$FOLDER")
if [ "$FOLDER" != "$SAFE_FOLDER" ]; then
  echo "Sanitizing: '$FOLDER' → '$SAFE_FOLDER'"
  rm -rf "$SAFE_FOLDER"
  cp -r "$FOLDER" "$SAFE_FOLDER"
  FOLDER="$SAFE_FOLDER"
fi

READY_BASE="${FOLDER}/_READY/${FOLDER}"

# ── Detect subdirs with HTML ──────────────────────────────────────────────────
SUBDIRS=()
while IFS= read -r -d '' d; do
  has_html "$d" && SUBDIRS+=("$d")
done < <(find "$FOLDER" -mindepth 1 -maxdepth 1 -type d \
           ! -name "_READY" ! -name "_stage" -print0 | sort -z)

if [ "${#SUBDIRS[@]}" -gt 0 ]; then
  # ── Recursive mode ────────────────────────────────────────────────────────
  echo "Recursive mode: ${FOLDER} + ${#SUBDIRS[@]} subfolder(s)"

  COMBINED_WORK_DIRS=()

  # Plan tasks for all folders before building
  if has_html "$FOLDER"; then
    plan_folder "$(sanitize_name "$FOLDER")" "$FOLDER"
    COMBINED_WORK_DIRS_PLAN=("$FOLDER")
  fi
  for subdir in "${SUBDIRS[@]}"; do
    _SUBNAME=$(basename "$subdir")
    _SAFE_SUB=$(sanitize_name "$_SUBNAME")
    plan_folder "$_SAFE_SUB" "$_SUBNAME"
    COMBINED_WORK_DIRS_PLAN+=("$_SAFE_SUB")
  done
  plan_combined

  # 1. Root folder
  if has_html "$FOLDER"; then
    build_and_deploy "$FOLDER" "$READY_BASE"
    COMBINED_WORK_DIRS+=("$FOLDER")
  else
    echo "  (root has no HTML — skipping root build)"
    mkdir -p "$READY_BASE"
  fi

  # 2. Each subfolder → isolated sibling → deploy to READY/subfolder
  for subdir in "${SUBDIRS[@]}"; do
    SUBNAME=$(basename "$subdir")
    SAFE_SUB=$(sanitize_name "$SUBNAME")
    echo ""
    echo "--- Isolating: '${SUBNAME}' → '${SAFE_SUB}'"
    rm -rf "$SAFE_SUB"
    cp -r "$subdir" "$SAFE_SUB"
    build_and_deploy "$SAFE_SUB" "${READY_BASE}/${SAFE_SUB}"
    COMBINED_WORK_DIRS+=("$SAFE_SUB")
  done

  # 3. Combined full book from all sections
  build_combined "${COMBINED_WORK_DIRS[@]}"

else
  # ── Normal mode ───────────────────────────────────────────────────────────
  plan_folder "$(sanitize_name "$FOLDER")" "$FOLDER"
  build_and_deploy "$FOLDER" "$READY_BASE"
fi

echo ""
echo "All done. Results in: ${READY_BASE}"

# Send complete event to progress UI
_RD_ESC=$(_pej "$READY_BASE")
curl -s -X POST "http://127.0.0.1:${PROGRESS_PORT}/event" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"type\":\"complete\",\"ready_dir\":\"${_RD_ESC}\"}" \
  2>/dev/null || true

# ── Monitor background pandoc jobs ───────────────────────────────────────────
if [ ${#PANDOC_BG_PIDS[@]} -gt 0 ]; then
  echo ""
  echo "━━━ Background pandoc jobs: ${#PANDOC_BG_PIDS[@]} running ━━━"

  # Associate each PID with a label, start time, and done flag
  declare -A PID_LABEL
  declare -A PID_DONE
  declare -A PID_START
  declare -A PID_ELAPSED
  NOW=$(date +%s)
  for pid in "${PANDOC_BG_PIDS[@]}"; do
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || echo "")
    if echo "$cmd" | grep -q "\-\-to pdf"; then
      PID_LABEL[$pid]="PDF"
    elif echo "$cmd" | grep -q "\-\-to epub"; then
      PID_LABEL[$pid]="EPUB"
    else
      PID_LABEL[$pid]="pandoc"
    fi
    PID_DONE[$pid]=0
    PID_START[$pid]=$NOW
    PID_ELAPSED[$pid]=0
  done

  elapsed_fmt() {
    local s=$1
    if [ "$s" -ge 60 ]; then
      printf "%dm%02ds" $(( s / 60 )) $(( s % 60 ))
    else
      printf "%ds" "$s"
    fi
  }

  TICK=0
  SPINNER='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  while true; do
    ALL_DONE=1
    LINE=""
    CURRENT=$(date +%s)
    for pid in "${PANDOC_BG_PIDS[@]}"; do
      if [ "${PID_DONE[$pid]}" -eq 1 ]; then
        T=$(elapsed_fmt "${PID_ELAPSED[$pid]}")
        LINE+="  [✓] ${PID_LABEL[$pid]} (PID ${pid}) — ${T}"
      elif kill -0 "$pid" 2>/dev/null; then
        ALL_DONE=0
        SP="${SPINNER:$(( TICK % ${#SPINNER} )):1}"
        T=$(elapsed_fmt $(( CURRENT - PID_START[$pid] )))
        LINE+="  [${SP}] ${PID_LABEL[$pid]} (PID ${pid}) running... ${T}"
      else
        wait "$pid" 2>/dev/null
        STATUS=$?
        PID_DONE[$pid]=1
        PID_ELAPSED[$pid]=$(( CURRENT - PID_START[$pid] ))
        T=$(elapsed_fmt "${PID_ELAPSED[$pid]}")
        if [ $STATUS -eq 0 ]; then
          LINE+="  [✓] ${PID_LABEL[$pid]} (PID ${pid}) done — ${T}"
        else
          LINE+="  [✗] ${PID_LABEL[$pid]} (PID ${pid}) failed (exit ${STATUS}) — ${T}"
        fi
      fi
      LINE+="\n"
    done

    # Rewrite status block in place
    printf "\033[${#PANDOC_BG_PIDS[@]}A"   # move cursor up N lines
    printf "${LINE}"

    [ "$ALL_DONE" -eq 1 ] && break
    sleep 3
    TICK=$(( TICK + 1 ))
  done

  echo ""
  echo "All pandoc jobs finished."
fi

stop_progress_server

echo ""
read -n 1 -s -r -p "Press any key to exit..."
echo ""
