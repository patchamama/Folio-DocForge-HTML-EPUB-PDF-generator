# ============================================================
# Makefile adaptado para tu propio libro
# ============================================================
# Uso:
#   make html          → Genera HTML en html/
#   make book.epub     → Genera book.epub
#   make book.pdf      → Genera book.pdf (requiere texlive)
#   make all           → Todo lo anterior
#
# Variables:
#   BOOK_LANG          → Idioma de labels de admoniciones (es/en). Default: es
#                        Ejemplo: make html BOOK_LANG=en
#
# Requisitos:
#   - Node.js (npm install antes de compilar)
#   - texlive            (solo para PDF)
#   - Inkscape           (solo si tienes imágenes SVG)
# ============================================================

# Idioma para labels de admoniciones (es / en)
BOOK_LANG ?= en

# Descubre automáticamente los archivos NN_nombre.md
CHAPTERS := $(basename $(shell ls [0-9][0-9]_*.md) .md)

# Último capítulo (el resumen de links se añade al final de su HTML)
LAST_CHAP := $(lastword $(CHAPTERS))

# Descubre automáticamente las imágenes SVG (para conversión a PDF en LaTeX)
SVGS := $(wildcard img/*.svg)

# Directorio para archivos convertidos (GFM → formato interno)
CONVERTED_DIR := converted

# Fuentes del cliente JS (editor interactivo + sandbox)
CLIENT_SRCS := $(wildcard src/client/*.mjs)

# ── Preparación automática ─────────────────────────────────
# prepare_book.mjs lee los NN_*.md, extrae títulos y genera
# pdf/book.tex, epub/toc.xhtml.src y epub/content.opf.src a partir
# de las plantillas *.tmpl.  Se ejecuta siempre (es barato) y se
# trata como dependencia de cualquier target que necesite esos archivos.
prepare:
	node src/prepare_book.mjs

# ── Objetivo principal ─────────────────────────────────────
all: html book.epub book.pdf pdf_pandoc book.pandoc.epub

# ============================================================
# CONVERSIÓN GFM → FORMATO INTERNO
# ============================================================
# convert_gfm.mjs traduce sintaxis GFM estándar (![alt](url),
# <!-- figure-options -->, > [!NOTE], etc.) al formato interno del
# proyecto ({{figure}}, {{quote}}, etc.).  Cada .md se convierte una
# sola vez; html, epub y tex leen el archivo convertido resultante.
# .SECONDARY evita que make los borre como archivos intermedios.
.SECONDARY: $(foreach CHAP,$(CHAPTERS),$(CONVERTED_DIR)/$(CHAP).md) $(CONVERTED_DIR)/links.md

$(CONVERTED_DIR)/%.md: %.md src/convert_gfm.mjs
	@mkdir -p $(CONVERTED_DIR)
	node src/convert_gfm.mjs --lang $(BOOK_LANG) $< -o $@

# ============================================================
# LINKS SUMMARY
# ============================================================
# Genera links.md con todos los enlaces externos del libro agrupados por h1.
# El contenido se añade al final del último capítulo en el HTML.
links.md: $(foreach CHAP,$(CHAPTERS),$(CHAP).md) src/generate_links.mjs
	node src/generate_links.mjs $(foreach CHAP,$(CHAPTERS),$(CHAP).md) -o links.md

$(CONVERTED_DIR)/links.md: links.md
	@mkdir -p $(CONVERTED_DIR)
	@if [ -f links.md ]; then \
	  { printf '{{meta {}}}\n\n'; cat links.md; } > $(CONVERTED_DIR)/links.md; \
	else \
	  rm -f $(CONVERTED_DIR)/links.md; \
	fi

# ============================================================
# HTML
# ============================================================
# Genera un .html por cada capítulo en html/ y el bundle JS del cliente
html: html/ejs.js $(foreach CHAP,$(CHAPTERS),html/$(CHAP).html)

html/%.html: $(CONVERTED_DIR)/%.md src/render_html.mjs src/chapter.html
	node src/render_html.mjs --name $(notdir $<) $< > $@

# Último capítulo: el resumen de links se añade al final si existe converted/links.md.
html/$(LAST_CHAP).html: $(CONVERTED_DIR)/$(LAST_CHAP).md $(CONVERTED_DIR)/links.md src/render_html.mjs src/chapter.html
	{ cat $(CONVERTED_DIR)/$(LAST_CHAP).md; \
	  if [ -f $(CONVERTED_DIR)/links.md ]; then echo; tail -n +2 $(CONVERTED_DIR)/links.md; fi; } | \
		node src/render_html.mjs --name $(LAST_CHAP).md - > $@

# Bundle del cliente: editor CodeMirror + sandbox interactivo
html/ejs.js: $(CLIENT_SRCS)
	npx rollup -c src/client/rollup.config.mjs

# ============================================================
# PDF
# ============================================================
# Genera los archivos .tex intermedios y las imágenes PDF
tex: $(foreach CHAP,$(CHAPTERS),pdf/$(CHAP).tex) $(patsubst img/%.svg,img/generated/%.pdf,$(SVGS))

# Regla: cada .md convertido se renderiza en .tex
pdf/%.tex: $(CONVERTED_DIR)/%.md src/render_latex.mjs
	node src/render_latex.mjs --name $(notdir $<) $< > $@

# Compila el PDF final usando xelatex (vía build.sh)
book.pdf: prepare tex
	@echo "Building PDF (3 xelatex passes, may take a few minutes)..."
	cd pdf && sh build.sh book > build.log 2>&1
	mv pdf/book.pdf .
	@echo "Done: book.pdf (log: pdf/build.log)"

# Versión mobile del PDF (papel A5, márgenes reducidos)
pdf/book_mobile.tex: prepare
	cat pdf/book.tex | sed -e 's/natbib}/natbib}\n\\usepackage[a5paper, left=5mm, right=5mm]{geometry}/' | sed -e 's/setmonofont.Scale=0.8./setmonofont[Scale=0.75]/' > pdf/book_mobile.tex

book_mobile.pdf: pdf/book_mobile.tex tex
	cd pdf && sh build.sh book_mobile > /dev/null
	mv pdf/book_mobile.pdf .

# Convierte SVG → PDF usando Inkscape (solo si tienes SVGs)
# --export-text-to-path convierte texto a curvas para evitar problemas de fuentes
img/generated/%.pdf: img/%.svg
	inkscape $< --export-filename=$@ --export-type=pdf --export-text-to-path

# ============================================================
# EPUB
# ============================================================
# Genera cada capítulo como .xhtml dentro de epub/
epub/%.xhtml: $(CONVERTED_DIR)/%.md src/render_html.mjs src/epub_chapter.html
	node src/render_html.mjs --epub --name $(notdir $<) $< > $@

# Genera el TOC del EPUB a partir de los .xhtml ya generados
epub/toc.xhtml: prepare $(foreach CHAP,$(CHAPTERS),epub/$(CHAP).xhtml)
	node src/generate_epub_toc.mjs epub/toc.xhtml.src $(foreach CHAP,$(CHAPTERS),epub/$(CHAP).xhtml) > $@

# Ensamblaje final del EPUB:
#   1. Copia las imágenes referenciadas dentro de epub/
#   2. Genera content.opf con la lista de imágenes
#   3. Empaqueta todo en un ZIP con la estructura EPUB
book.epub: prepare epub/toc.xhtml \
           $(foreach CHAP,$(CHAPTERS),epub/$(CHAP).xhtml) \
           epub/style.css src/add_images_to_epub.mjs
	rm -f $@
	grep '<img' epub/*.xhtml | sed -e 's/.*src="\([^"]*\)".*/\1/' | xargs -I{} rsync -R "{}" epub >/dev/null 2>&1; true
	node src/add_images_to_epub.mjs
	cd epub; zip -X ../$@ mimetype
	cd epub; zip -X ../$@ -r * -x mimetype -x *.src -x *.tmpl

# ============================================================
# PDF VÍA PANDOC
# ============================================================
# Genera book.pandoc.pdf directamente desde los HTML generados,
# preservando estilos CSS y resaltado de código.
#
# Requisitos adicionales:
#   - pandoc           (ya instalado en el sistema)
#   - Un motor PDF compatible con HTML+CSS:
#       weasyprint  →  pip install weasyprint        (recomendado)
#       wkhtmltopdf →  https://wkhtmltopdf.org       (alternativa)
#         nota: wkhtmltopdf no soporta CSS custom properties
#
# Variables:
#   PANDOC_ENGINE   Motor PDF a usar (default: weasyprint)
#
# Uso:
#   make pdf_pandoc
#   make pdf_pandoc PANDOC_ENGINE=wkhtmltopdf
# ============================================================
PANDOC_ENGINE ?= weasyprint

pdf_pandoc: html
	node src/strip_code_spans.mjs $(foreach CHAP,$(CHAPTERS),html/$(CHAP).html) > pdf_pandoc_tmp1.html
	node src/add_toc_to_pandoc_html.mjs pdf_pandoc_tmp1.html > pdf_pandoc_tmp2.html
	sed 's|src="\./|src="html/|g' pdf_pandoc_tmp2.html > pdf_pandoc_tmp.html
	pandoc pdf_pandoc_tmp.html \
		--from html --to pdf \
		--pdf-engine=$(PANDOC_ENGINE) \
		--css html/css/ejs.css \
		--css html/css/pandoc.css \
		--resource-path=html \
		--highlight-style=tango \
		--standalone \
		--metadata title="" \
		--metadata toc-title="Content" \
		-o book.pandoc.pdf
	rm -f pdf_pandoc_tmp1.html pdf_pandoc_tmp2.html pdf_pandoc_tmp.html

# ============================================================
# EPUB VÍA PANDOC
# ============================================================
# Genera book.pandoc.epub desde los HTML generados usando pandoc.
# Alternativa al EPUB nativo (book.epub) que se genera con zip.
#
# Requisitos:
#   - pandoc (ya instalado en el sistema)
# ============================================================
book.pandoc.epub: html
	node src/strip_code_spans.mjs $(foreach CHAP,$(CHAPTERS),html/$(CHAP).html) > epub_pandoc_tmp.html
	pandoc epub_pandoc_tmp.html \
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
		$(if $(wildcard cover.jpg),--epub-cover-image=cover.jpg,$(if $(wildcard cover.png),--epub-cover-image=cover.png,)) \
		-o book.pandoc.epub
	rm -f epub_pandoc_tmp.html
	# Post-process nav.xhtml: ol→ul (EPUB readers ignore list-style:none on ol),
	# remove landmarks nav (renders "Table of Contents" in some readers)
	unzip -p $@ EPUB/nav.xhtml | \
		sed -e 's/<ol/<ul/g' -e 's/<\/ol>/<\/ul>/g' \
		    -e '/<nav epub:type="landmarks"/,/<\/nav>/d' > /tmp/_nav.xhtml
	mkdir -p /tmp/_enav/EPUB && mv /tmp/_nav.xhtml /tmp/_enav/EPUB/nav.xhtml
	cd /tmp/_enav && zip $(CURDIR)/$@ EPUB/nav.xhtml > /dev/null
	rm -rf /tmp/_enav

# ============================================================
# Limpieza
# ============================================================
clean:
	rm -rf $(CONVERTED_DIR)
	rm -f html/[0-9][0-9]_*.html html/ejs.js
	rm -f links.md
	rm -f pdf/[0-9][0-9]_*.tex pdf/book.tex pdf/book_mobile.tex
	rm -f epub/[0-9][0-9]_*.xhtml epub/toc.xhtml epub/toc.xhtml.src epub/content.opf epub/content.opf.src
	rm -f book.pdf book_mobile.pdf book.epub book.pandoc.pdf book.pandoc.epub book.html pdf_pandoc_tmp.html epub_pandoc_tmp.html
	rm -rf epub/img img/generated

.PHONY: all html tex prepare clean pdf_pandoc book.pandoc.epub links.md
