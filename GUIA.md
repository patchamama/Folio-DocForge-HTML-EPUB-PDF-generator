# Guía de Uso: Generar PDF, EPUB y HTML desde Markdown

---

## 1. Arquitectura del Sistema

El proyecto es un **pipeline de compilación de libro** basado en Node.js y GNU Make. Un mismo conjunto de archivos Markdown es el origen único de verdad; desde ellos se generan los tres formatos de salida sin duplicar contenido.

```
┌─────────────────────────────────────────────────────────┐
│                  Archivos Fuente (.md)                   │
│           00_intro.md, 01_valores.md, ...               │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│            Parser: markdown.mjs + pseudo_json.mjs       │
│  markdown-it con plugin custom → token stream           │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│            Transformador: transform.mjs                 │
│  Filtra condicionales ({{if}}), smart quotes,           │
│  genera IDs hash, extrae título (H1)                    │
└───────┬───────────┬─────────────────┬───────────────────┘
        │           │                 │
        ▼           ▼                 ▼
┌────────────┐ ┌──────────┐  ┌──────────────────┐
│render_html │ │render_    │  │ render_html      │
│.mjs        │ │latex.mjs │  │ .mjs --epub      │
│→ HTML      │ │→ .tex    │  │ → .xhtml         │
└─────┬──────┘ └────┬─────┘  └────────┬─────────┘
      │             │                 │
      ▼             ▼                 ▼
┌──────────┐  ┌──────────┐  ┌──────────────────┐
│html/*.html│ │xelatex   │  │ zip → book.epub  │
│           │ │→book.pdf │  │                  │
└──────────┘  └──────────┘  └──────────────────┘
```

### Componentes principales

| Archivo | Responsabilidad |
|---|---|
| `Makefile` | Orquestador. Define las reglas de compilación y dependencias. |
| `src/markdown.mjs` | Extiende markdown-it con sintaxis custom (`{{meta}}`, `{{figure}}`, etc.). |
| `src/pseudo_json.mjs` | Parser JSON relajado usado dentro de los bloques `{{ }}`. |
| `src/transform.mjs` | Post-procesa tokens: filtra `{{if}}`, genera IDs, extrae metadatos. |
| `src/render_html.mjs` | Convierte tokens → HTML. Soporta modo normal y modo `--epub`. |
| `src/render_latex.mjs` | Convierte tokens → LaTeX para PDF. |
| `src/chapter.html` | Template HTML para cada capítulo (usa mold-template). |
| `src/epub_chapter.html` | Template XHTML para cada capítulo EPUB. |
| `src/generate_epub_toc.mjs` | Genera el `toc.xhtml` del EPUB leyendo los H1 y H2 de los capítulos ya renderizados. |
| `src/add_images_to_epub.mjs` | Escanea `epub/img/` y rellena `content.opf` con las imágenes encontradas. |
| `pdf/book.tex` | Documento LaTeX "maestro" que hace `\input` de cada capítulo `.tex`. |
| `pdf/build.sh` | Ejecuta xelatex + makeindex el número de pasadas necesarias. |
| `epub/content.opf.src` | Template del manifiesto EPUB. `{{images}}` se reemplaza en runtime. |
| `epub/toc.xhtml.src` | Template del TOC EPUB. `{{full_toc}}` se reemplaza en runtime. |

---

## 2. Convención de Nombres de Archivo (CRÍTICA)

El Makefile descubre los capítulos automáticamente con este glob:

```makefile
CHAPTERS := $(basename $(shell ls [0-9][0-9]_*.md) .md)
```

**Tus archivos markdown DEBEN llamarse:**

```
00_introduccion.md
01_primer_tema.md
02_segundo_tema.md
...
```

Reglas:
- Dos dígitos numéricos al inicio (determina el orden).
- Guión bajo inmediatamente después de los dígitos.
- Solo letras minúsculas, dígitos y guiones bajos en el nombre (sin espacios ni caracteres especiales).
- El primer `# Título` dentro de cada archivo se extrae automáticamente como título del capítulo.

---

## 3. Sintaxis Markdown Extendida

El parser custom añade estas construcciones sobre CommonMark estándar. Todas las opciones dentro de `{{ }}` usan un JSON relajado (sin comillas obligatorias en claves).

### 3.1 Metadatos del capítulo

```markdown
{{meta {load_files: ["code/archivo.js"]}}}
```
Se coloca al inicio del archivo. Cualquier propiedad que definas aquí queda disponible como metadato del capítulo. Si no necesitas nada de esto, puedes omitir esta línea completamente.

### 3.2 Figuras / Imágenes

```markdown
{{figure {url: "img/mi_imagen.png", alt: "Descripción accesible"}}}
```

Opciones disponibles:
- `url` — ruta a la imagen (relativa al directorio raíz del proyecto).
- `alt` — texto alternativo.
- `chapter: true` — centra la imagen y la convierte en imagen de capítulo.
- `chapter: "framed"` — imagen centrada con marco circular.
- `width` — solo aplica en PDF, por ejemplo `width: "8cm"`.

### 3.3 Citas / Epigrafos

Bloque:
```markdown
{{quote {author: "Nombre Autor", title: "Título de la obra"}

El texto de la cita va aquí.
Puede ser varios párrafos.

quote}}
```

Para hacer un epigrafo de capítulo (la cita que aparece al inicio, antes del título en PDF):
```markdown
{{quote {author: "Nombre", title: "Obra", chapter: true}

Texto del epigrafo.

quote}}
```

Si omites `author` y `title`, es un blockquote simple sin atribución.

### 3.4 Pistas / Hints (para ejercicios)

```markdown
{{hint

Este es el contenido de la pista. Solo aparece
en la versión HTML interactiva como un desplegable.

hint}}
```

En HTML se renderiza como `<details>`. En PDF se elimina. Si no tienes ejercicios, no uses esta sintaxis.

### 3.5 Términos de índice (solo PDF)

```markdown
((término))
```
El término aparece en el texto normalmente y se añade al índice del PDF. Se ignora en HTML y EPUB.

```markdown
{{index "término principal"}}
{{index [término, "subtérmino"]}}
{{indexsee "término A", "término B"}}
```
Estas directivas añaden entradas al índice sin modificar el texto visible. Solo tienen efecto en la compilación PDF.

### 3.6 Bloques condicionales

```markdown
{{if book

Este texto solo aparece en la versión EPUB (modo "book").

if}}

{{if interactive

Este texto solo aparece en la versión HTML interactiva.

if}}
```

Las etiquetas disponibles según el modo de compilación:
| Modo | Etiquetas definidas |
|---|---|
| HTML interactivo (`make html`) | `interactive`, `html` |
| EPUB (`make book.epub`) | `book`, `html` |
| PDF (`make book.pdf`) | `book`, `tex` |

### 3.7 Bloques de código con opciones

````markdown
```{lang: "javascript"}
console.log("hola")
```
````

Opciones en el bloque de código:
- `lang` — lenguaje para highlight: `javascript`, `html`, `css`, `json`, `http`, o `null` para sin highlight.
- `hidden: true` — el bloque no se renderiza (útil para setup de ejercicios).
- `focus: true` — marca visual en HTML interactivo.
- `sandbox: "nombre"` — agrupa bloques en un mismo sandbox de ejecución (solo HTML interactivo).

### 3.8 IDs manuales en elementos

```markdown
{{id "mi_id_custom"}}
## Mi Sección
```
Asigna un `id` específico al siguiente elemento HTML/LaTeX. Útil para enlaces internos precisos.

### 3.9 Nombres de teclas

```markdown
[Ctrl+S]{keyname}
```
Se renderiza con estilo de tecla física (small-caps en PDF, span con clase en HTML).

### 3.10 Sub y superíndices

```markdown
H~2~O        → H₂O   (subíndice)
x^2^         → x²    (superíndice)
```

---

## 4. Cosas Importantes a Tener en Cuenta

### 4.1 El sistema de highlighting de código

`render_html.mjs` importa CodeMirror y @lezer para hacer syntax highlighting server-side al generar el HTML. Esto significa que el HTML de salida ya contiene `<span>` con clases de color. **No necesitas JavaScript en el browser para que los bloques de código se vean coloridos.**

Los lenguajes soportados por defecto son: `javascript`, `html`, `css`, `json`, `http`. Si necesitas otro lenguaje, tendrás que añadir el parser correspondiente en `src/render_html.mjs` (líneas 50-56) e importar el paquete de npm.

### 4.2 Smart quotes automáticos

El sistema convierte comillas rectas `"` y `'` en comillas tipográficas (`"` `"` `'` `'`) automáticamente. En modo tex las convierte a los comandos LaTeX equivalentes (`` ` `` y `'`).

### 4.3 IDs de anclaje son hashes

Cada párrafo, heading y bloque de código recibe automáticamente un `id` basado en un hash SHA-1 de su contenido. Esto hace que los enlaces internos sean **estables** incluso si reordenan el contenido, pero significa que no puedes predecir el id sin compilar.

### 4.4 La compilación PDF requiere software adicional

Para generar PDFs necesitas instalar:
- **texlive** (distribución completa o con los paquetes: `xelatex`, `listings`, `graphicx`, `hyperref`, `fontspec`, `scrbook`, `natbib`, `epigraph`, `makeidx`, `bookmark`, `ucharclasses`, `pdfpages`, `arabxetex`).
- **Fuentes**: Cinzel, Inconsolata LGC, PT Mono, y opcionalmente Symbola (para emojis) y TW-Sung (para CJK).
- **Inkscape** — solo si tienes imágenes SVG (las convierte a PDF automáticamente con la regla `img/generated/%.pdf`).

Si no necesitas PDF, puedes ignorar todo esto y solo usar `make html` y `make book.epub`.

### 4.5 La compilación EPUB requiere una estructura de directorio específica

El directorio `epub/` debe contener estos archivos estáticos antes de compilar:
```
epub/
├── META-INF/
│   └── container.xml        ← NUNCA modificar
├── mimetype                 ← NUNCA modificar (debe ser "application/epub+zip" sin salto de línea)
├── content.opf.src          ← Template del manifiesto (modificar con tus datos)
├── toc.xhtml.src            ← Template del TOC visual (modificar con tus capítulos)
├── titlepage.xhtml          ← Página de portada
├── style.css                ← Estilo global del EPUB
└── font/                    ← Fuentes embebidas (opcional pero recomendado)
    ├── cinzel_bold.otf
    └── pt_mono.otf
```

Los archivos `.xhtml` de cada capítulo y el `toc.xhtml` final se **generan automáticamente** por el Makefile.

### 4.6 El template HTML usa mold-template

La sintaxis del template (`src/chapter.html`) NO es Jinja2 ni EJS estándar. Es **mold-template**:
- `<<t expresión>>` — escapa y renderiza texto.
- `<<h expresión>>` — renderiza HTML sin escapar.
- `<<if condición>> ... <</if>>` — condicional.

### 4.7 Enlaces entre capítulos

Los enlaces internos se resuelven automáticamente. Si escribes:
```markdown
[el capítulo anterior](valores)
```
y tienes un archivo `01_valores.md`, el sistema lo convierte en `01_valores.html` (o `.xhtml` en EPUB). El texto `?` dentro de un enlace interno se reemplaza por el número del capítulo destino.

### 4.8 El modo interactivo (ejs.js) es específico de Eloquent JavaScript

El archivo `html/ejs.js` (generado por rollup desde `src/client/`) es el sistema de sandbox interactivo que permite ejecutar código JavaScript en el browser. Este componente está estrechamente acoplado con el sistema de ejercicios de Eloquent JavaScript. **Si no necesitas ejecución interactiva de código, no lo necesitas.** Los bloques de código se renderizarán igualmente con highlighting, pero no serán editables ni ejecutables.

---

## 5. Pasos para Usar el Sistema con Tus Propios Markdowns

### Paso 1: Copiar y preparar el proyecto

```bash
# Clona o copia el proyecto completo
cp -r Generate-pdf-epub-html-from-md mi_libro
cd mi_libro

# Instala dependencias
npm install
```

### Paso 2: Crear tus archivos markdown

Sigue la convención de nombres `NN_nombre.md`:

```bash
# Elimina los markdowns originales de Eloquent JavaScript
rm -f [0-9][0-9]_*.md

# Crea los tuyos
touch 00_introduccion.md
touch 01_primer_capitulo.md
touch 02_segundo_capitulo.md
```

Cada archivo debe tener al menos un `# Título` como primera línea de contenido (puede tener `{{meta ...}}` antes):

```markdown
# Mi Primer Capítulo

Aquí empieza el contenido...
```

### Paso 3: Reemplazar el Makefile

Reemplaza el `Makefile` actual por el Makefile adaptado que está al final de esta guía (`Makefile.adaptado`). Este nuevo Makefile elimina todas las dependencias específicas de Eloquent JavaScript (sandbox interactivo, ejercicios, tests, zips).

### Paso 4: Adaptar los templates

**Template HTML** (`src/chapter.html`):
- Cambia el título en la línea `<title>`: reemplaza `Eloquent JavaScript` por el título de tu libro.
- Si no necesitas navegación prev/next, puedes simplificar la `<nav>`.
- Si no necesitas el script interactivo, elimina la línea `<script src="ejs.js"></script>`.

**Template EPUB** (`src/epub_chapter.html`):
- Cambia el `lang="en-US"` por tu idioma, ej: `lang="es"`.

### Paso 5: Adaptar la configuración EPUB

Edita `epub/content.opf.src`:
- Cambia `<dc:title>` por el título de tu libro.
- Cambia `<dc:creator>` por tu nombre.
- Cambia `<dc:identifier>` por un identificador único (puede ser un ISBN o cualquier string).
- Cambia `<dc:language>` por tu idioma (`es`, `en`, etc.).
- Reemplaza todos los `<item id="cNN_nombre".../>` del `<manifest>` por los capítulos de tu libro.
- Reemplaza todos los `<itemref idref="cNN_nombre".../>` del `<spine>` por los mismos capítulos en orden.

Edita `epub/toc.xhtml.src`:
- Reemplaza la lista manual en `<ol class="toc">` con los capítulos de tu libro.
- La sección `<nav epub:type="toc">` se genera automáticamente por `generate_epub_toc.mjs` (no la toques).

Edita `epub/titlepage.xhtml`:
- Cambia el texto y la imagen de portada por los tuyos.

### Paso 6: Adaptar la configuración PDF

Si quieres compilar PDF, edita `pdf/book.tex`:
- Cambia `\author{...}`, `\title{...}`, `\subtitle{...}`.
- Reemplaza todos los `\input{NN_nombre.tex}` por los nombres de tus capítulos.
- Si no tienes imágenes SVG, puedes eliminar la línea de `\graphicspath` o ajustarla.
- Si no necesitas índice, elimina `\makeindex` y `\printindex`.

### Paso 7: Compilar

```bash
# Solo HTML (más rápido, sin dependencias externas)
make html

# Solo EPUB
make book.epub

# Solo PDF (requiere texlive instalado)
make book.pdf

# Todo
make all
```

### Paso 8: Verificar el resultado

- **HTML**: Los archivos generados van a `html/`. Abre cualquiera en el browser.
- **EPUB**: Se genera `book.epub` en la raíz. Puedes abrirlo con Calibre o любой lector EPUB para verificar.
- **PDF**: Se genera `book.pdf` en la raíz.

---

## 6. Makefile Adaptado (Makefile.adaptado)

Este archivo está en la raíz del proyecto como `Makefile.adaptado`. Para usarlo:

```bash
cp Makefile.adaptado Makefile
```

---

## 7. Referencia Rápida de Sintaxis

| Sintaxis | Efecto |
|---|---|
| `# Título` | Título del capítulo (se extrae como metadato) |
| `## Sección` | Sección (aparece en TOC del EPUB) |
| `### Subsección` | Subsección |
| `` ```{lang: "javascript"} `` | Bloque de código con highlight |
| `` ```{lang: null} `` | Bloque de código sin highlight |
| `{{figure {url: "img/x.png", alt: "..."}}}` | Imagen |
| `{{quote {author: "A", title: "T"} ... quote}}` | Cita con atribución |
| `{{if book ... if}}` | Texto solo en EPUB/PDF |
| `{{if interactive ... if}}` | Texto solo en HTML |
| `{{hint ... hint}}` | Pista desplegable (HTML) / eliminada (PDF) |
| `((término))` | Término de índice (solo PDF) |
| `[texto]{keyname}` | Nombre de tecla |
| `H~2~O` | Subíndice |
| `x^2^` | Superíndice |
| `[texto](otro_capitulo)` | Enlace interno entre capítulos |
| `[texto](otro_capitulo#seccion)` | Enlace interno con ancla |
| `{{id "mi_id"}}` | Asigna id custom al siguiente elemento |
| `` ```javascript `` (GFM) | Convertido a `` ```{lang: "javascript"} `` por convert_gfm.mjs |
| `` ```py `` / `` ```ts `` / `` ```yml `` | Alias GFM → nombre canónico (ver sección 9) |
| `<div class="admonition note">` | Admonición Note (HTML crudo, ver sección 10) |
| `<div class="admonition warning">` | Admonición Warning |
| `<div class="admonition tip">` | Admonición Tip |

---

## 8. Scripts que Puedes Eliminar

Si no necesitas el sistema de ejercicios interactivos de Eloquent JavaScript, estos archivos no se utilizan con el Makefile adaptado y puedes eliminarlos:

```
src/build_code.mjs        — extrae código de los markdowns para el sandbox
src/chapter_info.mjs      — genera metadatos de ejercicios
src/extract_hints.mjs     — extrae pistas (si no tienes pistas)
src/run_tests.mjs         — testa el código de los ejercicios
src/check_links.mjs       — valida enlaces (útil durante desarrollo, opcional)
src/varify.mjs            — transpiler ES6→CommonJS para tests
src/require.js            — shim de require para tests
src/client/               — todo el directorio (sandbox interactivo)
code/                     — todo el directorio (code examples de Eloquent JS)
```

Los scripts que **DEBEN permanecer** son:

```
src/markdown.mjs          — parser (OBLIGATORIO)
src/pseudo_json.mjs       — parser JSON relajado (OBLIGATORIO, usado por markdown.mjs)
src/transform.mjs         — transformador de tokens (OBLIGATORIO)
src/render_html.mjs       — renderizador HTML (OBLIGATORIO)
src/render_latex.mjs      — renderizador LaTeX (solo si vas a hacer PDF)
src/chapter.html          — template HTML (OBLIGATORIO)
src/epub_chapter.html     — template EPUB (OBLIGATORIO para EPUB)
src/generate_epub_toc.mjs — genera TOC del EPUB (OBLIGATORIO para EPUB)
src/add_images_to_epub.mjs— manifiesto de imágenes EPUB (OBLIGATORIO para EPUB)
src/convert_gfm.mjs       — conversor GFM → formato custom (opcional, ver sección 11)
```

---

## 9. Lenguajes de Código Soportados

El sistema soporta syntax highlighting para los siguientes lenguajes. En el fence de código puedes usar el nombre canónico directamente o cualquiera de sus alias (el script `convert_gfm.mjs` los convierte automáticamente):

| Lenguaje canónico | Alias aceptados en fence GFM | Ejemplo de sintaxis |
|---|---|---|
| `javascript` | `js`, `mjs`, `cjs` | `` ```javascript `` |
| `typescript` | `ts`, `mts` | `` ```ts `` |
| `python` | `py` | `` ```py `` |
| `java` | — | `` ```java `` |
| `php` | — | `` ```php `` |
| `go` | `golang` | `` ```golang `` |
| `css` | — | `` ```css `` |
| `html` | `htm` | `` ```htm `` |
| `xml` | — | `` ```xml `` |
| `yaml` | `yml` | `` ```yml `` |
| `json` | — | `` ```json `` |
| `http` | — | `` ```http `` |

En el formato custom del proyecto el fence se escribe siempre con la sintaxis de opciones:

````markdown
```{lang: "javascript"}
console.log("hola")
```
````

Si necesitas un bloque de código sin highlighting usa `lang: null`.

---

## 10. Admoniciones (NOTE / WARNING / TIP)

Las admoniciones son cuadros destacados que se usan para llamar la atención del lector. Se implementan como bloques de HTML crudo que pasan directamente al output (markdown-it tiene `html: true` habilitado).

### Sintaxis

```html
<div class="admonition note">
<p><strong>Note:</strong> Texto del aviso.</p>
</div>
```

### Tipos disponibles

| Tipo | Clase CSS | Label en inglés | Label en español (convert_gfm.mjs --lang es) |
|---|---|---|---|
| Nota | `admonition note` | Note | Nota |
| Advertencia | `admonition warning` | Warning | Advertencia |
| Consejo | `admonition tip` | Tip | Consejo |

### Estilo

Las clases `.admonition.note`, `.admonition.warning` y `.admonition.tip` están definidas en ambos archivos de estilo:
- `html/css/ejs.css` — para la versión HTML interactiva.
- `epub/style.css` — para la versión EPUB.

Cada tipo tiene un borde izquierdo y fondo de color distinto (azul para note, ámbar para warning, verde para tip).

### Conversión desde GFM

Si tu Markdown original usa el formato de admonition de GitHub:

```markdown
> [!NOTE]
> Este es un aviso.
```

El script `convert_gfm.mjs` lo convierte automáticamente al bloque HTML necesario (ver sección 11).

---

## 11. Script de Conversión GFM → Formato Custom

El script `src/convert_gfm.mjs` convierte un archivo Markdown estándar de GitHub Flavored Markdown (GFM) al formato custom que espera el sistema de compilación del proyecto.

### Uso

```bash
# Conversión con labels en inglés (por defecto)
node src/convert_gfm.mjs entrada.md > salida.md

# Conversión con labels en español
node src/convert_gfm.mjs --lang es entrada.md > salida.md
```

### Transformaciones que realiza

El script aplica las siguientes conversiones (solo fuera de bloques de código):

1. **Fences con lenguaje GFM → sintaxis custom:** Una línea como `` ```js `` se convierte en `` ```{lang: "javascript"} ``. Se soportan todos los alias listados en la sección 9. Si el lenguaje no está en el mapa de alias conocidos, la línea se deja sin cambios.

2. **Imágenes de bloque:** Una línea que contenga solo una imagen markdown `![alt](url)` se convierte en `{{figure {url: "url", alt: "alt"}}}`. Las imágenes inline (dentro de texto) se dejan sin cambios.

3. **Admonitions GFM → HTML:** Las secuencias de admonition de GitHub:
   ```markdown
   > [!NOTE]
   > Contenido de la nota.
   ```
   se convierten en:
   ```html
   <div class="admonition note">
   <p><strong>Note:</strong> Contenido de la nota.</p>
   </div>
   ```
   Los tipos soportados son `NOTE`, `WARNING` y `TIP`. El flag `--lang es` cambia los labels a español.

### Ejemplo completo

Entrada (`entrada.md`):
````markdown
# Mi Capítulo

![diagrama](img/linked-list.svg)

```python
def hola():
    print("hola mundo")
```

> [!WARNING]
> No olvides hacer backup antes de ejecutar este script.
````

Salida (`node src/convert_gfm.mjs entrada.md`):
````markdown
# Mi Capítulo

{{figure {url: "img/linked-list.svg", alt: "diagrama"}}}

```{lang: "python"}
def hola():
    print("hola mundo")
```

<div class="admonition warning">
<p><strong>Warning:</strong> No olvides hacer backup antes de ejecutar este script.</p>
</div>
````

### Nota importante

El script no valida el output generado. Es responsabilidad del usuario compilar con `make html` o los otros targets del Makefile para verificar que el markdown convertido es válido.
