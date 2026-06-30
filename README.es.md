# Índice del proyecto — Generar PDF / EPUB / HTML desde Markdown

## 📦 Subproyectos

Este proyecto incluye varios subproyectos de utilidades para procesar documentos Markdown y construir un catálogo de cursos con búsqueda avanzada:

| Subproyecto | Objetivo | Inicio rápido |
|---|---|---|
| **[_mdformater](_mbformater/)** | Extraer, formatear y reimportar bloques de código en documentos Markdown | `node _mbformater/format-docs.mjs "docs/archivo.md" --auto` |
| **[_mdImageDownloader](_mdImageDownloader/)** | Descargar imágenes remotas y convertir URLs a rutas locales relativas | `node _mdImageDownloader/download-images.mjs "docs/archivo.md"` |
| **[_mdsplit](_mdsplit/)** | Dividir archivos Markdown en capítulos por nivel de encabezado | `python3 _mdsplit/mdsplit.py input.md -o output_dir -hl 1` |
| **[_mdtranslator](_mbtranslator/)** | Extraer, traducir y reimportar contenido Markdown (i18n) | `node _mbtranslator/translate-prepare.mjs "docs/archivo.md"` |
| **[_Course_catalog_Generator](_Course_catalog_Generator/)** | Genera el catálogo HTML de cursos (`course_catalog_generator.py`, necesita la ruta del directorio) + backend de búsqueda full-text, semántica y RAG con Ollama (`catalog_server.py`). Lanzador todo-en-uno: `start.sh` / `start.bat`. Consola Elasticsearch + chat IA: `test-elasticsearch.sh` / `.bat` → abre `es_test.html` y `chat_interface.html` | `cd _Course_catalog_Generator && ./start.sh "/ruta/cursos"` |
| **[_youtube_downloader](_youtube_downloader/)** | Descargar subtítulos (SRT) y vídeos de YouTube para indexación y análisis con IA | `python3 _youtube_downloader/downloader.py --file urls.txt --no-video` |
| **[_pdf_collector](_pdf_collector/)** | Convertir subtítulos SRT, HTML y PDF en PDFs estructurados y Markdown para notebooks de IA (NotebookLLM) | `./collect.sh ~/Videos ~/training-data` |


### Flujo de trabajo completo

El conjunto de subproyectos forma un pipeline para crear un catálogo completo de formación con búsqueda avanzada e integración con IA:

```
YouTube / Cursos
      │
      ├─► _youtube_downloader   → descarga subtítulos .srt y vídeos .mp4
      │
      ├─► _pdf_collector        → convierte .srt/.html/.pdf/.md → PDF/Markdown
      │                           listos para NotebookLLM u otras IAs
      │
      ├─► Pipeline MD→HTML/PDF  → genera documentación navegable
      │   (convert_gfm → render_html → render_latex)
      │
      └─► _Course_catalog_Generator
              │
              ├─ course_catalog_generator.py  → genera course_catalog.html
              ├─ catalog_server.py            → servidor Flask con búsqueda
              ├─ es_indexer.py                → indexa todo en Elasticsearch
              └─ /api/ask (RAG)               → respuestas con Ollama
```

### Ejemplos de flujos de trabajo

**Preparar un documento para traducción:**

```bash
node _mbtranslator/translate-prepare.mjs "docs/manual.md"
# Crea la carpeta _translated/ con las cadenas extraídas
```

**Descargar todas las imágenes de un documento:**

```bash
node _mdImageDownloader/download-images.mjs "docs/capitulo.md"
# Reemplaza URLs remotas con rutas locales ./imgs/capitulo/
```

**Formatear bloques de código en un documento:**

```bash
node _mbformater/format-docs.mjs "docs/guia.md" --auto
# Extrae, formatea con Prettier/Black y reimporta automáticamente
```

**Dividir un archivo Markdown grande en capítulos:**

```bash
python3 _mdsplit/mdsplit.py documento_largo.md -o capitulos -hl 1
# Crea un archivo .md separado por cada encabezado h1
```

**Descargar subtítulos de YouTube para una lista de vídeos (sin descargar el vídeo):**

```bash
# Desde un archivo de URLs (una por línea)
python3 _youtube_downloader/downloader.py --file urls.txt --no-video
# Crea archivos .srt en downloads/ — listos para indexar o convertir

# Para una URL concreta
python3 _youtube_downloader/downloader.py https://www.youtube.com/watch?v=VIDEO_ID --no-video
```

**Descargar subtítulos y el vídeo completo:**

```bash
python3 _youtube_downloader/downloader.py https://www.youtube.com/watch?v=VIDEO_ID --video
# Crea TITULO_VIDEO_ID.mp4 + .en.srt + .es.srt en downloads/

# Con directorio de salida personalizado
python3 _youtube_downloader/downloader.py --file urls.txt --video --output ./mis_videos
```

**Recopilar materiales de curso y convertirlos a PDF/Markdown para NotebookLLM:**

```bash
# Linux / macOS
./collect.sh ~/Videos ~/training-data
# Convierte .srt → PDF, .html → PDF, copia .pdf, fusiona .md
# Resultado en training-data/PDF-to-notebookllm/{srt,html,pdf,markdowns}/

# Windows
collect.bat D:\Videos D:\training-data
```

**Generar el catálogo de cursos e iniciar el backend (todo en uno):**

```bash
# Linux / macOS — crea venv, instala dependencias, genera catálogo, arranca servidor
cd _Course_catalog_Generator && ./start.sh "/ruta/a/mis/cursos"

# Windows
cd _Course_catalog_Generator && start.bat "C:\ruta\a\mis\cursos"

# Paso a paso (manual):
python3 _Course_catalog_Generator/course_catalog_generator.py "/ruta/a/mis/cursos"
# → genera course_catalog.md + course_catalog.html

python3 _Course_catalog_Generator/catalog_server.py --path "/ruta/a/mis/cursos"
# → backend en http://localhost:5000, abrir course_catalog.html en el navegador
```

**Iniciar la consola Elasticsearch + chat IA:**

```bash
# Linux / macOS — configura Docker, indexa archivos, arranca backend, abre es_test.html
cd _Course_catalog_Generator && ./test-elasticsearch.sh

# Windows
cd _Course_catalog_Generator && test-elasticsearch.bat

# Frontends disponibles:
#   es_test.html         — consola de búsqueda avanzada (BM25 + kNN semántico + filtros)
#   chat_interface.html  — chat IA sobre los documentos indexados (Ollama RAG)
```

**Indexar manualmente con Elasticsearch (sin Docker wrapper):**

```bash
cd _Course_catalog_Generator

# 1. Copiar y editar la configuración
cp .env.example .env
# Editar .env → COURSES_PATH=/ruta/a/mis/cursos

# 2. Levantar Elasticsearch en Docker
docker-compose up -d elasticsearch

# 3. Indexar todos los archivos con embeddings multilingüe
python3 es_indexer.py --path "/ruta/cursos"
# Reindexar desde cero:
python3 es_indexer.py --path "/ruta/cursos" --reset
# Solo BM25 sin vectores (más rápido):
python3 es_indexer.py --path "/ruta/cursos" --no-vectors
```

**Búsqueda semántica por API:**

```bash
# Búsqueda full-text básica
curl "http://localhost:5000/api/search?q=instalacion+ELO"

# Búsqueda Elasticsearch BM25
curl "http://localhost:5000/api/es-search?q=Benutzer+Verwaltung&lang=de"

# Búsqueda semántica kNN (requiere vectores indexados)
curl "http://localhost:5000/api/es-search?q=abreviatura&lang=es&semantic=1"

# Pregunta al asistente RAG (requiere Ollama corriendo)
curl -X POST http://localhost:5000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "¿Cómo se instala ELO?", "lang": "es"}'
```

---

### Documentación de subproyectos

| Subproyecto | Documentación |
|---|---|
| `_mdformater` | [README](_mdformater/README.md) · [Guía PDF](_mdformater/README_PDF.md) |
| `_mdImageDownloader` | [README](_mdImageDownloader/README.md) |
| `_mdsplit` | [README](_mdsplit/README.md) |
| `_mdtranslator` | [README](_mdtranslator/README.md) · [Inicio rápido](_mdtranslator/TRANSLATION_QUICK_START.md) |
| `_Course_catalog_Generator` | [Backend servidor (búsqueda + API RAG)](_Course_catalog_Generator/CATALOG_SERVER_README.md) · [Integración Elasticsearch](_Course_catalog_Generator/ELASTICSEARCH_README.md) · [Arquitectura de búsqueda](_Course_catalog_Generator/docs/SEARCH_ARCHITECTURE.md) |
| `_youtube_downloader` | [README](_youtube_downloader/README.md) |
| `_pdf_collector` | [README](_pdf_collector/README.md) |

---

## Tabla de contenidos

0. [Subproyectos](#-subproyectos)
1. [Visión general](#1-visión-general)
2. [Requisitos previos](#2-requisitos-previos)
3. [Estructura de directorios](#3-estructura-de-directorios)
4. [Arquitectura y flujo de datos](#4-arquitectura-y-flujo-de-datos)
5. [Cómo añadir un nuevo capítulo](#5-cómo-añadir-un-nuevo-capítulo)
6. [Objetivos de compilación](#6-objetivos-de-compilación)
7. [Formatos de salida](#7-formatos-de-salida)
   - [HTML (interactivo)](#71-html-interactivo)
   - [EPUB (nativo)](#72-epub-nativo)
   - [EPUB (vía Pandoc)](#73-epub-vía-pandoc)
   - [PDF (vía LaTeX)](#74-pdf-vía-latex)
   - [PDF (vía Pandoc)](#75-pdf-vía-pandoc)
8. [Referencia de sintaxis Markdown](#8-referencia-de-sintaxis-markdown)
9. [Configuración](#9-configuración)
10. [Funcionalidades del cliente](#10-funcionalidades-del-cliente)
11. [Problemas conocidos y TODOs](#11-problemas-conocidos-y-todos)
12. [Ideas y trabajo futuro](#12-ideas-y-trabajo-futuro)

---

## 1. Visión general

Este proyecto es un **pipeline de publicación multi-formato**: un único conjunto de archivos Markdown produce páginas HTML interactivas, un ebook EPUB y un documento PDF, todo desde una única fuente de verdad.

El pipeline se construye alrededor de un procesador Markdown personalizado que entiende GitHub Flavored Markdown (GFM) más una capa de extensiones específicas del proyecto (admonitions, bloques condicionales, quizzes, términos de índice, opciones de figura, nombres de teclas y más). Un conversor GFM→interno normaliza la fuente, un renderizador basado en tokens produce salida específica por formato, y Make orquesta todo el proceso.

**Decisiones de diseño clave:**

- **Fuente única.** Un archivo `.md` por capítulo. HTML, EPUB y PDF leen el mismo intermedio convertido.
- **GFM primero.** Los archivos fuente son Markdown válido de GitHub para que se rendericen correctamente en GitHub. Las funciones personalizadas usan comentarios HTML (`<!-- directiva -->`) que GitHub ignora.
- **Renderizado basado en tokens.** El parser Markdown emite un stream de tokens; un transformador lo post-procesa; renderers específicos por formato recorren el stream y emiten HTML o LaTeX.
- **Driven por Make.** `Makefile` gestiona el seguimiento de dependencias, compilaciones incrementales y el orden correcto de cada etapa.

---

## 2. Requisitos previos

| Herramienta | Necesaria para | Instalación |
|---|---|---|
| Node.js (18+) | Todas las etapas | https://nodejs.org |
| npm | Instalar dependencias | Incluido con Node |
| Make | Ejecutar el build | Normalmente preinstalado |
| XeLaTeX (texlive) | `book.pdf` | `apt install texlive-xetex texlive-fonts-extra texlive-lang-spanish` |
| Inkscape | Conversión SVG → PDF para LaTeX | `apt install inkscape` |
| Pandoc | `book.pandoc.pdf`, `book.pandoc.epub` | https://pandoc.org |
| WeasyPrint | Motor PDF de Pandoc (por defecto) | `pip install weasyprint` |
| Python 3.10+ | `_Course_catalog_Generator`, `_youtube_downloader`, `_pdf_collector` | https://python.org |
| Docker + Docker Compose | Elasticsearch (opcional) | https://www.docker.com |
| Ollama | Asistente RAG (opcional) | https://ollama.ai |
| ffmpeg | Descarga de vídeos YouTube | https://ffmpeg.org |

**Configuración inicial:**

```bash
npm install          # instalar dependencias Node
make html            # compilar HTML interactivo
make book.epub       # compilar EPUB nativo
make book.pdf        # compilar PDF (requiere texlive + inkscape)
make all             # compilar todo
```

---

## 3. Estructura de directorios

```
raíz del proyecto/
├── 00_ejemplos.md          # Fuentes de capítulos (patrón NN_nombre.md)
├── Makefile                # Orquestación del build
├── package.json            # Dependencias Node.js
├── book.html               # Redirección generada al último capítulo
│
├── src/                    # Scripts de procesamiento del lado servidor
│   ├── convert_gfm.mjs     # Etapa 1: GFM → formato interno
│   ├── markdown.mjs        # Etapa 2: Parser Markdown (stream de tokens)
│   ├── pseudo_json.mjs     # Parser JSON tolerante para metadatos
│   ├── transform.mjs       # Etapa 3: Post-procesado de tokens
│   ├── render_html.mjs     # Etapa 4: Renderer HTML / EPUB
│   ├── render_latex.mjs    # Etapa 4: Renderer LaTeX
│   ├── prepare_book.mjs    # Etapa 5: Descubrimiento de capítulos y expansión de plantillas
│   ├── generate_epub_toc.mjs   # Etapa 5: TOC EPUB de capítulos renderizados
│   ├── add_images_to_epub.mjs  # Etapa 6: Manifiesto de imágenes EPUB
│   ├── strip_code_spans.mjs    # Limpieza HTML pre-Pandoc
│   ├── chapter.html        # Plantilla HTML de capítulo (mold-template)
│   └── epub_chapter.html   # Plantilla de capítulo EPUB (XHTML)
│
│   └── client/             # Código del navegador (empaquetado por Rollup)
│       ├── index.mjs       # Punto de entrada
│       ├── ejs.mjs         # Principal: toolbar, TOC, quizzes, settings, playground
│       ├── sandbox.mjs     # Ejecución JS aislada (Web Workers)
│       ├── code.mjs        # Parsing de bloques de código y estado
│       ├── editor.mjs      # Configuración del editor CodeMirror
│       └── rollup.config.mjs
│
├── converted/              # Intermedio: archivos .md convertidos desde GFM
│
├── html/                   # Salida HTML generada
│   ├── ejs.js              # Script cliente empaquetado
│   ├── css/
│   │   ├── ejs.css         # Hoja de estilos principal (temas oscuro/claro)
│   │   └── pandoc.css      # Overrides para salida Pandoc
│   └── NN_nombre.html      # Un archivo por capítulo
│
├── epub/                   # Assets EPUB y archivos generados
│   ├── mimetype
│   ├── META-INF/container.xml
│   ├── style.css
│   ├── font/               # Fuentes embebidas (Cinzel Bold, PT Mono)
│   ├── toc.xhtml.tmpl      # Plantilla TOC
│   ├── content.opf.tmpl    # Plantilla manifiesto OPF
│   └── NN_nombre.xhtml     # Archivos de capítulo generados
│
├── pdf/                    # Fuentes LaTeX y compilación
│   ├── book.tex.tmpl       # Plantilla documento LaTeX
│   ├── book.tex            # Documento principal generado
│   ├── build.sh            # xelatex + makeindex loop
│   └── NN_nombre.tex       # Archivos de capítulo generados
│
├── img/                    # Recursos de imagen (PNG, JPG, SVG)
│   └── generated/          # Conversiones SVG → PDF (para LaTeX)
│
├── _Course_catalog_Generator/   # Catálogo de cursos con búsqueda avanzada
│   ├── course_catalog_generator.py  # Genera course_catalog.html
│   ├── catalog_server.py            # Servidor Flask (búsqueda + API RAG)
│   ├── es_indexer.py                # Indexador Elasticsearch
│   ├── es_test.html                 # Consola de pruebas ES + chat RAG
│   ├── docker-compose.yml           # Stack Docker (ES + backend)
│   ├── env.py                       # Configuración local
│   └── synonyms/                    # Thesaurus multilingüe (EN/ES/DE)
│
├── _youtube_downloader/    # Descargador de YouTube
│   ├── downloader.py       # Script principal (yt-dlp wrapper)
│   └── downloads/          # Carpeta de salida por defecto
│
└── _pdf_collector/         # Recopilador y convertidor para IA
    ├── collect.py           # Script principal
    ├── collect.sh           # Launcher Linux/macOS (crea venv automáticamente)
    └── collect.bat          # Launcher Windows
```

---

## 4. Arquitectura y flujo de datos

Cada capítulo sigue el mismo pipeline. Las etapas se numeran en el orden en que se ejecutan.

```
  ┌─────────────────────┐
  │  NN_nombre.md        │  ← fuente (GFM + comentarios HTML personalizados)
  └──────────┬──────────┘
             │
        ┌────▼────┐
        │ Etapa 1 │  convert_gfm.mjs   (sintaxis GFM → meta-markup interno)
        └────┬────┘
             │  converted/NN_nombre.md
        ┌────▼────┐
        │ Etapa 2 │  markdown.mjs       (parseo → stream de tokens)
        └────┬────┘
             │
        ┌────▼────┐
        │ Etapa 3 │  transform.mjs      (bloques condicionales, IDs, metadatos)
        └────┬────┘
             │  tokens + metadatos
       ┌─────┴─────┐
       │            │
  ┌────▼────┐ ┌────▼────┐
  │ Etapa 4a│ │ Etapa 4b│
  │ HTML/EPUB│ │  LaTeX  │
  └────┬────┘ └────┬────┘
       │            │
       ▼            ▼
  html/*.html   pdf/*.tex
  epub/*.xhtml
       │            │
       │       ┌────▼────┐
       │       │ build.sh │  xelatex × 3 + makeindex
       │       └────┬────┘
       │            │  book.pdf
  ┌────▼────┐       │
  │ Etapa 5 │       │
  │  EPUB   │       │
  │ assembly│       │
  └────┬────┘       │
       │  book.epub  │
       ▼            ▼
   Salidas finales
```

### Detalles de etapas

| Etapa | Script | Entrada | Salida | Rol |
|---|---|---|---|---|
| 1 | `convert_gfm.mjs` | `NN_nombre.md` | `converted/NN_nombre.md` | Traduce extensiones GFM (imágenes, admonitions, quizzes, kbd, sub/sup) a la sintaxis de token interna |
| 2 | `markdown.mjs` | `.md` convertido | array de tokens | Instancia markdown-it personalizada con reglas de bloque para meta-bloques `{{ }}` e inline para `[texto]{nombre}` |
| 3 | `transform.mjs` | array de tokens | tokens + metadatos | Evalúa bloques `if`, genera IDs hash estables para anclas, extrae metadatos de página, aplica comillas tipográficas |
| 4a | `render_html.mjs` | tokens | `.html` o `.xhtml` | Recorre tokens y emite HTML. Usa @lezer para resaltado de sintaxis. Aplica plantilla vía mold-template |
| 4b | `render_latex.mjs` | tokens | `.tex` | Recorre tokens y emite LaTeX. Gestiona escape TeX, listings, comandos de índice, cajas de admonition |
| 5 | `prepare_book.mjs` | `NN_*.md` (raw) | `pdf/book.tex`, `epub/*.src` | Descubre capítulos, extrae títulos, rellena placeholders de plantillas para PDF y EPUB |
| 5 | `generate_epub_toc.mjs` | `epub/toc.xhtml.src` + `.xhtml` renderizados | `epub/toc.xhtml` | Construye TOC de dos niveles (h1 + h2) escaneando capítulos renderizados para anclas |
| 6 | `add_images_to_epub.mjs` | `epub/content.opf.src` + `epub/img/` | `epub/content.opf` | Añade entradas del manifiesto de imágenes para cada imagen referenciada |

---

## 5. Cómo añadir un nuevo capítulo

### Paso 1 — Crear el archivo fuente

Nómbralo `NN_nombre.md` donde `NN` es un número de dos dígitos que determina el orden de lectura. El archivo se descubre automáticamente; no se requiere ningún cambio de configuración.

```
01_introduccion.md
02_valores.md
...
```

### Paso 2 — Escribir el contenido

Usa Markdown estándar de GitHub. El primer `# Encabezado` se convierte en el título del capítulo en todas partes (HTML `<title>`, TOC EPUB, TOC PDF, redirección `book.html`).

Funciones personalizadas disponibles:

- Admonitions: `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]`
- Figuras con opciones: `<!-- figure-options: {chapter: true, width: "6cm"} -->`
- Citas con atribución: `<!-- quote: {author: "…", title: "…"} -->`
- Pistas (colapsibles en HTML, ocultas en PDF): `<!-- hint -->…<!-- /hint -->`
- Bloques condicionales: `<!-- if: book -->…<!-- endif -->`
- Términos de índice: `<!-- index: "término" -->`, `<!-- index-inline -->palabra<!-- /index-inline -->`
- Teclas de teclado: `<kbd>Ctrl+S</kbd>`
- Sub/superíndices: `<sub>2</sub>`, `<sup>n</sup>`

### Paso 3 — Colocar imágenes

Pon las imágenes en `img/`. Referencialas con la sintaxis estándar:

```markdown
![Texto alternativo](img/archivo.png)
```

Los SVGs se convierten automáticamente a PDF para el build de LaTeX (requiere Inkscape).

### Paso 4 — Compilar

```bash
make html            # solo el HTML del nuevo capítulo (y todos los demás, incremental)
make book.epub       # EPUB nativo
make book.pdf        # PDF con LaTeX
make all             # todo
```

### Paso 5 — Iterar

Edita el `.md`, ejecuta `make html`, abre `html/NN_nombre.html` en el navegador. El HTML interactivo es el ciclo de retroalimentación más rápido.

---

## 6. Objetivos de compilación

| Comando | Qué produce | Notas |
|---|---|---|
| `make prepare` | `pdf/book.tex`, `epub/toc.xhtml.src`, `epub/content.opf.src`, `book.html` | Siempre se ejecuta (barato). Llamado automáticamente por otros objetivos |
| `make html` | `html/NN_*.html` + `html/ejs.js` | Incremental por capítulo |
| `make tex` | `pdf/NN_*.tex` + `img/generated/*.pdf` | SVG→PDF vía Inkscape |
| `make book.pdf` | `book.pdf` | Requiere texlive. Ejecuta xelatex 3+ pasadas + makeindex |
| `make book_mobile.pdf` | `book_mobile.pdf` | Papel A5, márgenes más ajustados (para tablets/teléfonos) |
| `make book.epub` | `book.epub` | EPUB nativo ensamblado con zip |
| `make pdf_pandoc` | `book.pandoc.pdf` | PDF vía Pandoc + WeasyPrint. Incluye TOC |
| `make book.pandoc.epub` | `book.pandoc.epub` | EPUB vía Pandoc. nav.xhtml post-procesado |
| `make all` | Todo lo anterior | Objetivo por defecto |
| `make clean` | Elimina todos los archivos generados | Los `.md` fuente e `img/` no se tocan |

**Variable de idioma:** las etiquetas de admonition están localizadas.

```bash
make html BOOK_LANG=es     # etiquetas en español (Note → Nota, etc.)
make html BOOK_LANG=en     # etiquetas en inglés (por defecto)
```

---

## 7. Formatos de salida

### 7.1 HTML (interactivo)

**Objetivo:** `make html`
**Salida:** `html/NN_nombre.html` (uno por capítulo) + `html/ejs.js` (bundle cliente)

Cada página HTML es autónoma excepto por la hoja de estilos compartida y el script cliente. Funcionalidades:

- **Alternancia tema oscuro/claro** — controlada por variables CSS bajo `[data-theme="dark"]`
- **TOC colapsable de dos niveles** — botón "Content", construido en el cliente escaneando anclas h1/h2
- **Bloques de código con resaltado de sintaxis** — parsers @lezer para 14 lenguajes
- **Playground interactivo** — editor CodeMirror que se abre bajo demanda
- **Sistema de quizzes** — checkboxes agrupados por sección h2, con botones Comprobar / Soluciones / Reiniciar
- **Panel de configuración** — overrides de tamaño de fuente y color en vivo por elemento, con un textarea CSS diff para copiar

El bundle cliente (`html/ejs.js`) se construye con Rollup desde `src/client/`. Recompílalo cuando cambien los fuentes del cliente:

```bash
npx rollup -c src/client/rollup.config.mjs
```

### 7.2 EPUB (nativo)

**Objetivo:** `make book.epub`
**Salida:** `book.epub`

Ensamblado manualmente como archivo ZIP con la estructura EPUB estándar.

**Detección de portada:** `prepare_book.mjs` busca `cover.jpg` y luego `cover.png` en la raíz del proyecto. Si se encuentra, se genera un `titlepage.xhtml` y se añade a la columna vertebral (spine) antes del TOC.

### 7.3 EPUB (vía Pandoc)

**Objetivo:** `make book.pandoc.epub`
**Salida:** `book.pandoc.epub`

Usa la salida HTML como entrada. El pipeline:

1. `strip_code_spans.mjs` concatena todos los HTMLs de capítulos, elimina `<nav>`, `<div id="toc-wrap">`, `<input>`s de quizzes y `<span>`s de sintaxis
2. Pandoc convierte el HTML limpio a EPUB con `--toc --toc-depth=2 --metadata toc-title="Content"`
3. Un paso de post-procesado parchea `nav.xhtml` dentro del zip EPUB

### 7.4 PDF (vía LaTeX)

**Objetivo:** `make book.pdf`
**Salida:** `book.pdf`

Usa XeLaTeX con la clase KOMA-Script `scrbook`.

**Secuencia de compilación (`pdf/build.sh`):**

```
xelatex book.tex       ← pasada 1 (layout)
xelatex book.tex       ← pasada 2 (referencias cruzadas)
makeindex              ← generar índice desde .idx
xelatex book.tex       ← pasada 3 (índice insertado)
```

**Variante móvil:** `make book_mobile.pdf` produce una versión en papel A5 con márgenes más ajustados, pensada para lectores electrónicos y tabletas.

### 7.5 PDF (vía Pandoc)

**Objetivo:** `make pdf_pandoc`
**Salida:** `book.pandoc.pdf`

Misma preparación de entrada que la ruta EPUB de Pandoc. Pandoc usa WeasyPrint como motor PDF. Los archivos CSS (`ejs.css` + `pandoc.css`) se pasan vía `--css` para que la salida herede la tipografía y los colores de sintaxis del proyecto.

---

## 8. Referencia de sintaxis Markdown

Todo lo que aparece a continuación es GFM válido que también se renderiza en GitHub. Las partes personalizadas usan comentarios HTML, que GitHub muestra como invisibles.

### Bloques de código

````markdown
```js
console.log("hola");
```
````

Lenguajes soportados para resaltado de sintaxis: `js`, `ts`, `py`, `java`, `c`, `cpp`, `php`, `go`, `css`, `html`, `xml`, `yaml`, `pascal`, `json`.

### Imágenes y figuras

```markdown
![Texto alternativo](img/archivo.png)
```

Las opciones se establecen mediante un comentario HTML **inmediatamente antes** de la imagen:

| Opción | Efecto |
|---|---|
| `chapter: true` | Centrada, 75% de ancho, estilo portada de capítulo |
| `chapter: "framed"` | Marco circular (`\fbox` en PDF) |
| `chapter: "square-framed"` | Marco doble con esquinas redondeadas (`\doublebox` en PDF) |
| `width: "6cm"` | Ancho explícito (solo PDF) |

```markdown
<!-- figure-options: {chapter: true} -->

![Imagen de portada](img/hero.jpg)
```

### Admonitions

```markdown
> [!NOTE]
> Aviso informativo.

> [!WARNING]
> Algo a tener en cuenta.

> [!TIP]
> Un atajo útil.

> [!IMPORTANT]
> Información crítica.

> [!CAUTION]
> Acción que puede causar daño.
```

Las etiquetas se localizan según `BOOK_LANG` (por defecto `en`).

### Citas con atribución

```markdown
<!-- quote: {author: "Nombre", title: "Obra"} -->

> El texto citado va aquí.
```

### Pistas (ejercicios)

```markdown
<!-- hint -->

La respuesta implica un bucle `for...of`.

<!-- /hint -->
```

Renderizado como `<details>` colapsable en HTML. Eliminado completamente en PDF.

### Bloques condicionales

| Condición | Incluido en |
|---|---|
| `book` | EPUB + PDF |
| `interactive` | Solo HTML |
| `html` | HTML + EPUB |
| `tex` | Solo PDF (LaTeX) |

```markdown
<!-- if: interactive -->

Este párrafo es solo para HTML.

<!-- endif -->
```

### Quizzes

```markdown
## Título del quiz

¿Qué afirmaciones son verdaderas?

- [x] Opción correcta
- [ ] Opción incorrecta
- [x] Otra opción correcta
```

### Términos de índice (solo PDF)

```markdown
<!-- index: "término" -->
<!-- index: ["término", "subtérmino"] -->
<!-- indexsee: "término", "véase también" -->

El concepto de <!-- index-inline -->recursión<!-- /index-inline --> es clave.
```

### Teclas de teclado

```markdown
Pulsa <kbd>Ctrl+S</kbd> para guardar.
```

### Sub- y superíndices

```markdown
H<sub>2</sub>O      →  H₂O
O(n<sup>2</sup>)    →  O(n²)
```

### Enlaces internos

```markdown
[el capítulo de valores](values)
```

### Bloques de código ocultos

```markdown
<!-- code-options: {hidden: true} -->

```js
// código de configuración invisible para el lector
let estado = {};
```
```

### IDs manuales

```markdown
<!-- id: "mi-seccion" -->

## Encabezado de sección
```

---

## 9. Configuración

| Ajuste | Dónde | Por defecto | Efecto |
|---|---|---|---|
| `BOOK_LANG` | Variable de Makefile | `en` | Idioma para etiquetas de admonition |
| `PANDOC_ENGINE` | Variable de Makefile | `weasyprint` | Motor PDF usado por Pandoc |
| Imagen de portada | `cover.jpg` o `cover.png` en la raíz | ninguna | Añade página de portada a PDF y EPUB |
| Profundidad TOC (LaTeX) | `\setcounter{tocdepth}{2}` en `book.tex.tmpl` | 2 | Niveles mostrados en el TOC del PDF |
| Profundidad TOC (Pandoc) | `--toc-depth=2` en Makefile | 2 | Lo mismo para el TOC generado por Pandoc |
| Tamaño de fuente base | Variable CSS `--font-size-base` en `ejs.css` | 20 px | Tamaño del texto HTML |
| Ancho del artículo | Variable CSS `--article-max-width` en `ejs.css` | 35 em | Ancho de la columna de contenido HTML |

### Configuración del catálogo de cursos (`_Course_catalog_Generator/env.py`)

| Ajuste | Por defecto | Descripción |
|---|---|---|
| `SEARCH_BASE_PATH` | `"//servidor/Schulungen"` | Directorio raíz escaneado para archivos de cursos |
| `HOST` | `"0.0.0.0"` | Interfaz de red. Usar `"127.0.0.1"` para solo local |
| `PORT` | `5000` | Puerto TCP del servidor |
| `MAX_RESULTS` | `50` | Máximo de archivos coincidentes por búsqueda |
| `ES_URL` | `None` | URL de Elasticsearch (ej. `http://localhost:9200`) |

---

## 10. Funcionalidades del cliente

El bundle cliente (`html/ejs.js`) se compila desde `src/client/` por Rollup. Se ejecuta en el navegador después de que cada capítulo HTML se carga.

### Toolbar

| Botón | Acción |
|---|---|
| `</>` | Abre el playground de código (editor CodeMirror) |
| `⚙` | Abre el panel de configuración (overrides de estilos en vivo) |

### TOC colapsable

`initTOC()` escanea el artículo en busca de elementos h1 y h2 que tengan un ancla `<a id="…">` (inyectada por `render_html.mjs`). Construye una `<ul>` de dos niveles y la inserta en `<div id="toc-wrap">` con un botón de alternancia "Content".

### Sistema de quizzes

`initQuizzes()` agrupa las entradas de checkbox por el h2 precedente más cercano. Para cada grupo añade tres botones:

- **Comprobar respuestas** — resalta selecciones correctas/incorrectas
- **Soluciones** — revela todas las respuestas correctas
- **Reiniciar** — borra los resaltados y desmarca todo

### Panel de configuración

Abre un overlay modal. Cada elemento configurable (h1–h3, code, em, strong, a, blockquote) expone un control de tamaño de fuente y un selector de color. Los cambios se aplican en vivo vía una etiqueta `<style>` inyectada. Un textarea de solo lectura en la parte inferior muestra únicamente las propiedades CSS que difieren de los valores por defecto, listas para pegar en `ejs.css`.

### Playground

Un editor basado en CodeMirror que se abre en un overlay. No está maximizado por defecto.

---

## 11. Problemas conocidos y TODOs

| ID | Archivo | Descripción |
|---|---|---|
| FIXME-1 | `src/render_html.mjs:57` | El resaltado de sintaxis HTTP no está implementado. La entrada del parser existe pero el modo stream no produce tokens que coincidan con la lista de clases con estilo |
| FIXME-2 | `src/render_latex.mjs:317` | `meta_hint_open` devuelve una cadena vacía en vez de filtrar el bloque hint completo del stream de tokens. El contenido del hint sigue llegando al renderer y produce espacio en blanco en el PDF |

---

## 12. Ideas y trabajo futuro

- **Más formatos de salida.** La arquitectura de stream de tokens facilita añadir un tercer renderer. Candidatos: texto plano (accesibilidad), Markdown-a-Markdown (para linting en CI), o un formato personalizado para servicios de impresión bajo demanda.
- **Servidor de desarrollo con recarga en vivo.** Un pequeño servidor HTTP de Node que observe `converted/` y vuelva a ejecutar `render_html.mjs` + recargue el tab del navegador en caliente. Aceleraría drásticamente el ciclo edición → vista previa.
- **Filtro Lua de Pandoc para nav.xhtml.** El paso de post-procesado actual que parchea `nav.xhtml` dentro del zip EPUB (ol→ul, eliminación de landmarks) se hace con `sed` y shell. Un filtro Lua de Pandoc podría hacer la misma transformación limpiamente en tiempo de generación.
- **Imagen de portada del primer capítulo.** `prepare_book.mjs` actualmente solo busca `cover.jpg` / `cover.png` en la raíz del proyecto. Un diseño anterior también escaneaba la primera imagen de los capítulos como fallback.
- **Tests automatizados.** `package.json` tiene un script `test` que delega en `make test`, pero aún no existe ningún objetivo de test. Los tests de instantánea que comparan la salida HTML/TeX renderizada con baselines conocidos detectarían regresiones en el pipeline.
- **EPUB en modo oscuro.** La hoja de estilos EPUB nativa (`epub/style.css`) no tiene variante de tema oscuro. Los lectores EPUB 3 que soportan `prefers-color-scheme` podrían ser objetivo con un bloque `@media` que refleje las variables CSS de `ejs.css`.
- **Índice buscable en HTML.** Los términos de índice son actualmente solo PDF. Recopilarlos durante la pasada de renderizado HTML y generar una página de índice buscable (o integrarlos con el TOC) mejoraría la experiencia interactiva.
- **Integración de Ollama mejorada.** El endpoint `/api/ask` actual soporta RAG básico. Se podría añadir historial de conversación, selección dinámica de modelos y mejores prompts con contexto de múltiples fuentes.
- **Indexación incremental ES.** `es_indexer.py` ya soporta indexación incremental por hash de archivo. Se podría automatizar como watcher de directorio o tarea cron para mantener el índice actualizado sin intervención manual.
