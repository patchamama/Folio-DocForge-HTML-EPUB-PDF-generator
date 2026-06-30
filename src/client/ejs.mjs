import { EditorView, keymap } from "@codemirror/view"
import { Facet } from "@codemirror/state"
import { createState, createPlaygroundState, getLangExtension } from "./editor.mjs"
import { Sandbox } from "./sandbox.mjs"
// TypeScript compiler — lazy-loaded from CDN on first Transpile click (same pattern as Pyodide)
let tsInstance = null, tsLoading = null
function getTypeScript() {
  if (tsInstance) return Promise.resolve(tsInstance)
  if (tsLoading) return tsLoading
  tsLoading = new Promise((resolve, reject) => {
    let script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/npm/typescript@5/lib/typescript.js"
    script.onload = () => { tsInstance = globalThis.ts; resolve(tsInstance) }
    script.onerror = reject
    document.head.appendChild(script)
  })
  return tsLoading
}

const EJS_VERSION = "1.4.0"

const tutorLangMap = { python: "3", java: "java", c: "c", cpp: "cpp" }

let pyodideInstance = null, pyodideLoading = null
function getPyodide() {
  if (pyodideInstance) return Promise.resolve(pyodideInstance)
  if (pyodideLoading) return pyodideLoading
  pyodideLoading = (async () => {
    let script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.0/full/pyodide.js"
    document.head.appendChild(script)
    await new Promise((resolve, reject) => {
      script.onload = resolve
      script.onerror = reject
    })
    pyodideInstance = await globalThis.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.0/full/"
    })
    return pyodideInstance
  })()
  return pyodideLoading
}

function runPython(code, output) {
  let spinner = document.createElement("div")
  spinner.className = "sandbox-output-spinner"
  spinner.appendChild(document.createTextNode("Ejecutando Python\u2026"))
  output.div.appendChild(spinner)
  function hideSpinner() { if (spinner.parentNode) spinner.parentNode.removeChild(spinner) }

  getPyodide().then(pyodide => {
    pyodide.setStdout({ batched: text => { hideSpinner(); output.out("log", [text]) } })
    pyodide.setStderr({ batched: text => { hideSpinner(); output.out("error", [text]) } })
    pyodide.runPythonAsync(code).then(() => {
      hideSpinner()
    }).catch(err => {
      hideSpinner()
      output.out("error", [err.message])
    })
  }).catch(err => {
    hideSpinner()
    output.out("error", ["Failed to load Pyodide: " + err.message])
  })
}

function chapterInteraction() {
  document.querySelectorAll("button.help").forEach(button => {
    button.style.display = "inline"
    button.addEventListener("click", showHelp)
  })
  // Imágenes clickeables → abrir pantalla completa en ventana nueva
  document.querySelectorAll("img").forEach(img => {
    if (img.closest(".snippet")) return // no tocar imágenes dentro de code snippets
    img.setAttribute("data-clickable", "")
    img.addEventListener("click", () => {
      let win = window.open("", "_blank")
      win.document.write(`<!DOCTYPE html><html><head><style>
        body { margin: 0; background: #000; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
      </style></head><body><img src="${img.src}" alt="${img.getAttribute("alt") || ""}"></body></html>`)
      win.document.close()
    })
  })

  document.body.addEventListener("keydown", e => {
    let active = document.activeElement
    if (e.key == "?" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (!active || (active.contentEditable != "true" && active.nodeName != "INPUT")) {
        e.preventDefault()
        showHelp()
      }
    }
    if (e.key == "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      let editor = active && maybeActivateCode(active)
      if (editor) {
        e.preventDefault()
        editor.focus()
      }
    }
  })

  let modName = /Mac/.test(navigator.platform) ? "Cmd-" : "Ctrl-"

  function showHelp() {
    let popup = document.body.appendChild(document.createElement("div"))
    popup.className = "popup"
    popup.appendChild(document.createElement("h2")).textContent = "Instructions"
    popup.appendChild(document.createElement("p")).textContent = `Code snippets on this page can be edited and run by clicking them or moving focus to them and pressing Enter. Executed snippets share their environment with other snippets ran on the page, and some pre-defined code for the chapter. When inside the code editor, the following keyboard shortcuts are available:`
    for (let [key, desc] of [
      [modName + "Enter", "Run code"],
      [modName + "j", "Revert code"],
      [modName + "↓", "Deactivate editor"],
      [modName + "Escape", "Reset environment"],
    ]) {
      let b = popup.appendChild(document.createElement("div"))
      b.appendChild(document.createElement("kbd")).textContent = key
      b.appendChild(document.createTextNode(": " + desc))
    }
    popup.tabIndex = 0
    popup.addEventListener("blur", () => popup.remove())
    popup.addEventListener("keydown", e => {
      if (e.key == "Escape") { e.preventDefault(); popup.remove() }
    })
    popup.focus()
  }

  document.body.addEventListener("mousedown", e => {
    for (let n = e.target; n; n = n.parentNode) {
      if (n.className == "c_ident") return
      let editor = maybeActivateCode(n)
      if (editor) {
        e.preventDefault()
        setTimeout(() => {
          let pos = editor.posAtCoords({ x: e.clientX, y: e.clientY }, false)
          editor.dispatch({ selection: { anchor: pos } })
          editor.focus()
        }, 20)
        return
      }
    }
  })

  function elt(type, attrs) {
    let firstChild = 1
    let node = document.createElement(type)
    if (attrs && typeof attrs == "object" && attrs.nodeType == null) {
      for (let attr in attrs) if (attrs.hasOwnProperty(attr)) {
        let value = attrs[attr]
        if (attr == "css") node.style.cssText = value
        else if (typeof value !== "string") node[attr] = value
        else node.setAttribute(attr, value)
      }
      firstChild = 2
    }
    for (let i = firstChild; i < arguments.length; ++i) {
      let child = arguments[i]
      if (typeof child == "string") child = document.createTextNode(child)
      node.appendChild(child)
    }
    return node
  }

  const contextFacet = Facet.define({
    combine(vs) { return vs[0] }
  })


  const extraKeys = keymap.of([
    {
      key: "ArrowDown", run(cm) {
        let { main } = cm.state.selection
        if (!main.empty || main.head < cm.state.doc.length) return false
        document.activeElement.blur()
        return true
      }
    },
    {
      key: "ArrowUp", run(cm) {
        let { main } = cm.state.selection
        if (!main.empty || main.head > 0) return false
        document.activeElement.blur()
        return true
      }
    },
    {
      key: "Escape", run(cm) {
        cm.contentDOM.blur()
        return true
      }
    },
    {
      key: "Mod-Enter", run(cm) {
        let context = cm.state.facet(contextFacet)
        if (context.isHTML) openInWindow(cm)
        else if (context.isTutor) openInPythonTutor(cm)
        else runCode(cm)
        return true
      }
    },
    {
      key: "Mod-j", run(cm) {
        revertCode(cm)
        return true
      }
    },
    {
      key: "Mod-ArrowDown", run(cm) {
        closeCode(cm)
        return true
      }
    },
    {
      key: "Mod-Escape", run(cm) {
        resetSandbox(cm.state.facet(contextFacet).sandbox)
        return true
      }
    }
  ])

  function maybeActivateCode(element) {
    if (element.nodeName == "PRE") {
      let lang = element.getAttribute("data-language")
      if (/^(javascript|html|python|java|c|cpp)$/.test(lang))
        return activateCode(element, lang)
    }
  }

  let nextID = 0
  let article = document.getElementsByTagName("article")[0]

  function activateCode(node, lang) {
    let scrollPos = pageYOffset, rect = node.getBoundingClientRect()
    if (rect.top < 0 && rect.height > 500) scrollPos -= Math.min(-rect.top, rect.height - 500)
    let codeId = node.querySelector("a").id
    let code = (window.localStorage && localStorage.getItem(codeId)) || node.textContent
    let wrap = node.parentNode.insertBefore(elt("div", { "class": "editor-wrap" }), node)
    let pollingScroll = null
    function pollScroll() {
      if (document.activeElement != editor.contentDOM) return
      let rect = editor.dom.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > innerHeight) editor.contentDOM.blur()
      else pollingScroll = setTimeout(pollScroll, 500)
    }
    let sandbox = node.getAttribute("data-sandbox")
    let context = {
      wrap: wrap,
      orig: node,
      lang,
      isHTML: lang == "html",
      isPython: lang == "python",
      isTutor: lang == "java" || lang == "c" || lang == "cpp",
      sandbox,
      meta: node.getAttribute("data-meta")
    }
    let editorState = createState(code, lang, [
      extraKeys,
      EditorView.domEventHandlers({
        focus: (e, view) => {
          clearTimeout(pollingScroll)
          pollingScroll = setTimeout(pollScroll, 500)
          showEditorControls(view)
        },
        blur: (e, view) => {
          setTimeout(() => {
            if (!view.hasFocus) hideEditorControls(view)
          }, 100)
        }
      }),
      EditorView.updateListener.of(debounce(update => {
        if (update.docChanged && window.localStorage)
          localStorage.setItem(codeId, editor.state.doc.toString())
      }, 250)),
      contextFacet.of(context)
    ])
    let editor = new EditorView({ state: editorState, parent: wrap })
    let out = wrap.appendChild(elt("div", { "class": "sandbox-output", "aria-live": "polite" }))
    context.output = new Sandbox.Output(out)
    if (lang == "html" && !sandbox) {
      sandbox = context.sandbox = "html" + nextID++
      node.setAttribute("data-sandbox", sandbox)
      sandboxSnippets[sandbox] = node
    }
    node.style.display = "none"
    // Cancel weird scroll stabilization magic from brower (which
    // doesn't work at all for this)
    window.scrollTo(pageXOffset, scrollPos)
    setTimeout(() => window.scrollTo(pageXOffset, scrollPos), 20)
    return editor
  }

  function openMenu(editor, node) {
    let menu = elt("div", { "class": "sandbox-open-menu" })
    let context = editor.state.facet(contextFacet)
    function click(e) {
      let target = e.target
      if (e.target.parentNode == menu) {
        for (let i = 0; i < menu.childNodes.length; ++i)
          if (target == menu.childNodes[i])
            items[i][1]()
      }
      menu.parentNode.removeChild(menu)
      window.removeEventListener("click", click)
    }
    setTimeout(() => window.addEventListener("click", click), 20)
    node.offsetParent.appendChild(menu)
  }

  function runCode(editor) {
    let context = editor.state.facet(contextFacet)
    context.output.clear()
    let val = editor.state.doc.toString()
    if (context.isPython) {
      runPython(val, context.output)
      return
    }
    getSandbox(context.sandbox, context.isHTML).then(box => {
      if (context.isHTML)
        box.setHTML(val, context.output).then(() => {
          if (context.orig.getAttribute("data-focus")) {
            box.win.focus()
            box.win.document.body.focus()
          }
        })
      else
        box.run(val, context.output).then(value => {
          if (value != null && context.meta && /\bexpr\b/.test(context.meta) && context.output.empty)
            box.out("log", [value])
        })
    })
  }

  function closeCode(editor) {
    let context = editor.state.facet(contextFacet)
    if (context.isHTML && context.sandbox) return
    context.wrap.remove()
    context.orig.style.display = ""
  }

  function revertCode(editor) {
    let context = editor.state.facet(contextFacet)
    editor.dispatch({
      selection: { anchor: 0 },
      changes: { from: 0, to: editor.state.doc.length, insert: context.orig.textContent }
    })
  }

  function openInWindow(editor) {
    let val = editor.state.doc.toString()
    if (!/<meta[^>]*charset/i.test(val))
      val = '<meta charset="utf-8">' + val
    let blob = new Blob([val], { type: "text/html;charset=utf-8" })
    window.open(URL.createObjectURL(blob), "_blank")
  }

  function openInPythonTutor(editor) {
    let context = editor.state.facet(contextFacet)
    let code = editor.state.doc.toString()
    let py = tutorLangMap[context.lang] || "3"
    let url = "https://pythontutor.com/visualize.html#code=" +
      encodeURIComponent(code) +
      "&cumulative=false&heapPrimitives=nevernest&mode=edit&origin=opt-frontend.js&py=" + py +
      "&rawInputLstJSON=%5B%5D&textReferences=false"
    window.open(url, "_blank")
  }

  function showEditorControls(editor) {
    if (editor.dom.parentNode.querySelector(".editor-controls")) return
    let context = editor.state.facet(contextFacet)
    let controls = elt("div", { class: "editor-controls" })
    if (context.isHTML) {
      controls.appendChild(elt("button", {
        onmousedown: e => { openInWindow(editor); e.preventDefault() },
        title: `Open in new window (${modName}Enter)`,
        "aria-label": "Open in new window"
      }, "↗"))
    } else if (context.isTutor) {
      controls.appendChild(elt("button", {
        onmousedown: e => { openInPythonTutor(editor); e.preventDefault() },
        title: `Open in Python Tutor (${modName}Enter)`,
        "aria-label": "Open in Python Tutor"
      }, "↗"))
    } else if (context.isPython) {
      controls.appendChild(elt("button", {
        onmousedown: e => { runCode(editor); e.preventDefault() },
        title: `Run code (${modName}Enter)`,
        "aria-label": "Run code"
      }, "▸"))
      controls.appendChild(elt("button", {
        onmousedown: e => { openInPythonTutor(editor); e.preventDefault() },
        title: "Open in Python Tutor",
        "aria-label": "Open in Python Tutor"
      }, "↗"))
    } else {
      controls.appendChild(elt("button", {
        onmousedown: e => { runCode(editor); e.preventDefault() },
        title: `Run code (${modName}Enter)`,
        "aria-label": "Run code"
      }, "▸"))
    }
    controls.appendChild(elt("button", {
      onmousedown: e => { revertCode(editor); e.preventDefault() },
      title: `Revert code (${modName}j)`,
      "aria-label": "Revert code"
    }, "▫"))
    if (!context.isHTML && !context.isPython && !context.isTutor) {
      controls.appendChild(elt("button", {
        onmousedown: e => { resetSandbox(context.sandbox); e.preventDefault() },
        title: `Reset sandbox (${modName}Escape)`,
        "aria-label": "Reset sandbox"
      }, "ø"))
    }
    editor.dom.parentNode.appendChild(controls)
  }

  function hideEditorControls(editor) {
    let controls = editor.dom.parentNode.querySelector(".editor-controls")
    if (controls) controls.remove()
  }

  let sandboxSnippets = {}
  {
    let snippets = document.getElementsByClassName("snippet")
    for (let i = 0; i < snippets.length; i++) {
      let snippet = snippets[i]
      if (snippet.getAttribute("data-language") == "html" &&
        snippet.getAttribute("data-sandbox"))
        sandboxSnippets[snippet.getAttribute("data-sandbox")] = snippet
    }
  }

  let sandboxes = {}
  async function getSandbox(name, forHTML) {
    name = name || "null"
    if (sandboxes.hasOwnProperty(name)) return sandboxes[name]
    let options = { loadFiles: window.page.load_files }, html
    if (sandboxSnippets.hasOwnProperty(name)) {
      let snippet = sandboxSnippets[name]
      options.place = node => placeFrame(node, snippet)
      if (!forHTML) html = snippet.textContent
    }
    let box = await Sandbox.create(options)
    if (html != null)
      box.win.document.documentElement.innerHTML = html
    sandboxes[name] = box
    return box
  }

  function resetSandbox(name) {
    if (!sandboxes.hasOwnProperty(name)) return
    let frame = sandboxes[name].frame
    frame.parentNode.removeChild(frame)
    delete sandboxes[name]
  }

  function placeFrame(frame, snippet) {
    let wrap = snippet.previousSibling, bot
    if (!wrap || wrap.className != "editor-wrap") {
      bot = snippet.getBoundingClientRect().bottom
      activateCode(snippet, "html")
      wrap = snippet.previousSibling
    } else {
      bot = wrap.getBoundingClientRect().bottom
    }
    wrap.insertBefore(frame, wrap.childNodes[1])
    if (bot < 50) {
      let newBot = wrap.getBoundingClientRect().bottom
      window.scrollBy(0, newBot - bot)
    }
  }
}

// ── Modal de índice (TOC) ────────────────────────────────────────
function openIndexModal() {
  let article = document.querySelector("article")
  if (!article) return

  let overlay = document.createElement("div")
  overlay.className = "idx-overlay"
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)

  let modal = document.createElement("div")
  modal.className = "idx-modal"
  overlay.appendChild(modal)

  // Header
  let header = document.createElement("div")
  header.className = "idx-header"
  let titleEl = document.createElement("span")
  titleEl.textContent = "Content"
  let closeBtn = document.createElement("button")
  closeBtn.className = "idx-close"
  closeBtn.textContent = "\u00D7"
  closeBtn.addEventListener("click", () => overlay.remove())
  header.appendChild(titleEl)
  header.appendChild(closeBtn)
  modal.appendChild(header)

  // TOC list — h1 and h2 with anchors only
  let list = document.createElement("ul")
  list.className = "idx-list"
  article.querySelectorAll("h1, h2").forEach(h => {
    let anchor = h.querySelector("a[id]")
    if (!anchor) return
    let li = document.createElement("li")
    li.className = h.tagName === "H1" ? "idx-h1" : "idx-h2"
    let a = document.createElement("a")
    a.href = "#" + anchor.id
    a.textContent = h.textContent.trim()
    a.addEventListener("click", () => overlay.remove())
    li.appendChild(a)
    list.appendChild(li)
  })
  modal.appendChild(list)

  // Focus trap: close on Escape
  const onKey = e => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey) } }
  document.addEventListener("keydown", onKey)
  overlay.addEventListener("remove", () => document.removeEventListener("keydown", onKey))
  closeBtn.focus()
}

// ── Toolbar: tema, fuente, ancho, playground ───────────────────
function initToolbar() {
  let root = document.documentElement
  let toolbar = document.createElement("div")
  toolbar.className = "toolbar"
  document.body.appendChild(toolbar)

  // Home — ir al inicio
  let homeBtn = document.createElement("button")
  homeBtn.textContent = "\u2302"   // ⌂
  homeBtn.title = "Go to top"
  homeBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }))
  toolbar.appendChild(homeBtn)

  // Index — modal con TOC
  let idxBtn = document.createElement("button")
  idxBtn.textContent = "\u2630"   // ☰
  idxBtn.title = "Table of contents"
  idxBtn.addEventListener("click", openIndexModal)
  toolbar.appendChild(idxBtn)

  // Tema claro / oscuro
  let savedTheme = (window.localStorage && localStorage.getItem("ejs-theme")) || "light"
  if (savedTheme === "dark") root.setAttribute("data-theme", "dark")
  let themeBtn = document.createElement("button")
  themeBtn.title = "Modo claro/oscuro"
  function syncThemeBtn() { themeBtn.textContent = root.getAttribute("data-theme") === "dark" ? "\u2600" : "\u263D" }
  syncThemeBtn()
  themeBtn.addEventListener("click", () => {
    let isDark = root.getAttribute("data-theme") === "dark"
    root.setAttribute("data-theme", isDark ? "light" : "dark")
    if (window.localStorage) localStorage.setItem("ejs-theme", isDark ? "light" : "dark")
    syncThemeBtn()
  })
  toolbar.appendChild(themeBtn)

  // Tamaño de fuente
  let fontSizes = [14, 16, 18, 20, 22, 24]
  let fontIdx = Math.max(0, Math.min(fontSizes.length - 1,
    parseInt((window.localStorage && localStorage.getItem("ejs-font-idx")) || "3")))
  root.style.setProperty("--font-size-base", fontSizes[fontIdx] + "px")

  let fontSmBtn = document.createElement("button")
  fontSmBtn.textContent = "A\u2212"
  fontSmBtn.title = "Reducir fuente"
  fontSmBtn.addEventListener("click", () => {
    if (fontIdx > 0) {
      fontIdx--
      root.style.setProperty("--font-size-base", fontSizes[fontIdx] + "px")
      if (window.localStorage) localStorage.setItem("ejs-font-idx", fontIdx)
    }
  })
  toolbar.appendChild(fontSmBtn)

  let fontLgBtn = document.createElement("button")
  fontLgBtn.textContent = "A+"
  fontLgBtn.title = "Aumentar fuente"
  fontLgBtn.addEventListener("click", () => {
    if (fontIdx < fontSizes.length - 1) {
      fontIdx++
      root.style.setProperty("--font-size-base", fontSizes[fontIdx] + "px")
      if (window.localStorage) localStorage.setItem("ejs-font-idx", fontIdx)
    }
  })
  toolbar.appendChild(fontLgBtn)

  // Ancho de texto
  let widths = ["26em", "35em", "48em", "62em"]
  let widthIdx = Math.max(0, Math.min(widths.length - 1,
    parseInt((window.localStorage && localStorage.getItem("ejs-width-idx")) || "1")))
  root.style.setProperty("--article-max-width", widths[widthIdx])

  let wNarBtn = document.createElement("button")
  wNarBtn.textContent = "\u25C0"
  wNarBtn.title = "Texto m\u00E1s estrecho"
  wNarBtn.addEventListener("click", () => {
    if (widthIdx > 0) {
      widthIdx--
      root.style.setProperty("--article-max-width", widths[widthIdx])
      if (window.localStorage) localStorage.setItem("ejs-width-idx", widthIdx)
    }
  })
  toolbar.appendChild(wNarBtn)

  let wWideBtn = document.createElement("button")
  wWideBtn.textContent = "\u25B6"
  wWideBtn.title = "Texto m\u00E1s ancho"
  wWideBtn.addEventListener("click", () => {
    if (widthIdx < widths.length - 1) {
      widthIdx++
      root.style.setProperty("--article-max-width", widths[widthIdx])
      if (window.localStorage) localStorage.setItem("ejs-width-idx", widthIdx)
    }
  })
  toolbar.appendChild(wWideBtn)

  // Playground
  let pgBtn = document.createElement("button")
  pgBtn.textContent = "</>"
  pgBtn.title = "Editor Playground"
  pgBtn.addEventListener("click", () => openPlayground())
  toolbar.appendChild(pgBtn)

  // Settings de estilos
  let settingsBtn = document.createElement("button")
  settingsBtn.textContent = "\u2699"
  settingsBtn.title = "Style settings"
  settingsBtn.addEventListener("click", openSettings)
  toolbar.appendChild(settingsBtn)
}

// ── Quiz interactivo ─────────────────────────────────────────────
function initQuizzes() {
  let article = document.querySelector("article")
  if (!article) return

  // Each quiz UL (with at least one data-correct checkbox) and each .quiz-text-input
  // becomes its own independent quiz block — no heading-based grouping needed.
  let quizEls = [...article.querySelectorAll("ul, .quiz-text-input")].filter(el =>
    el.tagName === "UL"
      ? !!el.querySelector(".quiz-input[data-correct]")
      : el.classList.contains("quiz-text-input")
  )

  if (quizEls.length === 0) return
  let allSections = []

  quizEls.forEach(el => {
    let isCheckboxList = el.tagName === "UL"
    let section = {
      checkboxLists: isCheckboxList ? [el] : [],
      textInputEls:  isCheckboxList ? [] : [el],
      summaryEl: null
    }
    allSections.push(section)

    let block = document.createElement("div")
    block.className = "quiz-block"
    el.parentNode.insertBefore(block, el)
    block.appendChild(el)

    let allCheckboxes = section.checkboxLists.flatMap(ul => [...ul.querySelectorAll(".quiz-input")])
    let allTextPairs = section.textInputEls.map(div => ({
      field: div.querySelector(".quiz-text-field"),
      answers: (div.dataset.answers || "").split("|").map(a => a.trim()).filter(Boolean)
    })).filter(p => p.field)

    let btns = document.createElement("div")
    btns.className = "quiz-buttons"
    btns.style.display = "none"

    const updateVisibility = () => {
      const anyChecked = allCheckboxes.some(i => i.checked)
      const anyTyped  = allTextPairs.some(p => p.field.value.trim() !== "")
      btns.style.display = (anyChecked || anyTyped) ? "" : "none"
    }
    allCheckboxes.forEach(i => i.addEventListener("change", updateVisibility))
    allTextPairs.forEach(p => p.field.addEventListener("input", updateVisibility))

    let verifyBtn = document.createElement("button")
    verifyBtn.className = "quiz-btn"
    verifyBtn.textContent = "Check answers"
    verifyBtn.addEventListener("click", () => {
      verifyQuiz(allCheckboxes); verifyTextInputs(allTextPairs); updateAllSummaries(allSections)
    })

    let solBtn = document.createElement("button")
    solBtn.className = "quiz-btn"
    solBtn.textContent = "View solutions"
    solBtn.addEventListener("click", () => {
      showSolution(allCheckboxes); showTextSolutions(allTextPairs)
      updateVisibility(); updateAllSummaries(allSections)
    })

    let resetBtn = document.createElement("button")
    resetBtn.className = "quiz-btn"
    resetBtn.textContent = "Reset quiz"
    resetBtn.addEventListener("click", () => {
      resetQuiz(allCheckboxes); resetTextInputs(allTextPairs)
      updateVisibility(); updateAllSummaries(allSections)
    })

    btns.appendChild(verifyBtn); btns.appendChild(solBtn); btns.appendChild(resetBtn)
    block.appendChild(btns)
  })

  // Insert summary after each quiz-block
  allSections.forEach(section => {
    let firstEl = section.checkboxLists[0] || section.textInputEls[0]
    let block = firstEl.parentNode // .quiz-block
    let summaryEl = document.createElement("div")
    summaryEl.className = "quiz-summary"
    section.summaryEl = summaryEl
    block.parentNode.insertBefore(summaryEl, block.nextSibling)
    updateSectionSummary(section)
  })
}

function verifyQuiz(inputs) {
  inputs.forEach(input => {
    let correct = "correct" in input.dataset
    let li = input.closest("li")
    input.classList.toggle("correct", input.checked === correct)
    input.classList.toggle("incorrect", input.checked !== correct)
    li.classList.toggle("quiz-correct", input.checked === correct)
    li.classList.toggle("quiz-incorrect", input.checked !== correct)
  })
}

function showSolution(inputs) {
  inputs.forEach(input => {
    input.checked = "correct" in input.dataset
    let li = input.closest("li")
    input.classList.add("correct")
    input.classList.remove("incorrect")
    li.classList.add("quiz-correct")
    li.classList.remove("quiz-incorrect")
  })
}

function resetQuiz(inputs) {
  inputs.forEach(input => {
    input.checked = false
    input.classList.remove("correct", "incorrect")
    let li = input.closest("li")
    li.classList.remove("quiz-correct", "quiz-incorrect")
  })
}

function verifyTextInputs(textPairs) {
  textPairs.forEach(({field, answers}) => {
    const val = field.value.toLowerCase().replace(/\s/g, "")
    if (val === "") { field.classList.remove("correct", "incorrect"); return }
    const ok = answers.some(a => a.toLowerCase().replace(/\s/g, "") === val)
    field.classList.toggle("correct", ok)
    field.classList.toggle("incorrect", !ok)
  })
}

function showTextSolutions(textPairs) {
  textPairs.forEach(({field, answers}) => {
    if (answers.length > 0) field.value = answers[0]
    field.classList.add("correct")
    field.classList.remove("incorrect")
  })
}

function resetTextInputs(textPairs) {
  textPairs.forEach(({field}) => {
    field.value = ""
    field.classList.remove("correct", "incorrect")
  })
}

function updateSectionSummary(section) {
  let correct = 0, total = 0
  section.checkboxLists.forEach(ul => {
    ul.querySelectorAll(".quiz-input").forEach(input => {
      total++
      if (input.classList.contains("correct")) correct++
    })
  })
  section.textInputEls.forEach(div => {
    let field = div.querySelector(".quiz-text-field")
    if (field && (field.classList.contains("correct") || field.classList.contains("incorrect"))) {
      total++
      if (field.classList.contains("correct")) correct++
    }
  })
  let pct = total > 0 ? Math.round(correct / total * 100) : 0
  section.summaryEl.innerHTML =
    "Result: <strong>" + correct + "/" + total + "</strong> correct " +
    '<span class="quiz-bar-track"><span class="quiz-bar-fill" style="width:' + pct + '%"></span></span> ' + pct + "%"
}

function updateAllSummaries(sections) {
  sections.forEach(s => s.summaryEl && updateSectionSummary(s))
}

// ── Playground editor modal ─────────────────────────────────────
function openPlayground(maximized) {
  let overlay = document.createElement("div")
  overlay.className = "playground-overlay"
  document.body.appendChild(overlay)

  let modal = document.createElement("div")
  modal.className = "playground-modal"
  overlay.appendChild(modal)

  // Header
  let header = document.createElement("div")
  header.className = "playground-header"
  modal.appendChild(header)

  let langSelect = document.createElement("select")
    ;["javascript", "typescript", "python", "html", "css", "java", "c", "cpp", "pascal", "go", "yaml", "xml", "json", "http", "php"].forEach(lang => {
      let opt = document.createElement("option")
      opt.value = lang; opt.textContent = lang
      langSelect.appendChild(opt)
    })
  header.appendChild(langSelect)

  let runBtn = document.createElement("button")
  runBtn.textContent = "\u25B8 Execute"
  header.appendChild(runBtn)

  let winBtn = document.createElement("button")
  winBtn.textContent = "\u2197 Window"
  header.appendChild(winBtn)

  let transpileBtn = document.createElement("button")
  transpileBtn.textContent = "\u21C4 Transpile"
  header.appendChild(transpileBtn)

  let tutorBtn = document.createElement("button")
  tutorBtn.textContent = "\u2197 Tutor"
  header.appendChild(tutorBtn)

  let codiLink = document.createElement("a")
  codiLink.href = "https://codi.link/"
  codiLink.target = "_blank"
  codiLink.rel = "noopener noreferrer"
  codiLink.className = "playground-link"
  codiLink.textContent = "codi.link"
  header.appendChild(codiLink)

  let maxBtn = document.createElement("button")
  maxBtn.textContent = "\u2922"
  maxBtn.title = "Maximizar"
  maxBtn.addEventListener("click", () => {
    let isMax = overlay.classList.toggle("playground-maximized")
    maxBtn.textContent = isMax ? "\u2921" : "\u2922"
    maxBtn.title = isMax ? "Restaurar" : "Maximizar"
  })
  header.appendChild(maxBtn)

  let detachBtn = document.createElement("button")
  detachBtn.textContent = "\u2197"
  detachBtn.title = "Abrir en nueva ventana"
  header.appendChild(detachBtn)

  let closeBtn = document.createElement("button")
  closeBtn.className = "playground-close"
  closeBtn.textContent = "\u2715"
  closeBtn.addEventListener("click", () => overlay.remove())
  header.appendChild(closeBtn)

  // Body con editor y output
  let bodyDiv = document.createElement("div")
  bodyDiv.className = "playground-body"
  modal.appendChild(bodyDiv)

  let savedCode = (window.localStorage && localStorage.getItem("playground-code")) || ""
  let savedLang = (window.localStorage && localStorage.getItem("playground-lang")) || langSelect.value
  langSelect.value = savedLang
  let { state, compartment } = createPlaygroundState(savedCode, langSelect.value, [
    EditorView.updateListener.of(update => {
      if (update.docChanged && window.localStorage)
        localStorage.setItem("playground-code", update.state.doc.toString())
    })
  ])
  let view = new EditorView({ state, parent: bodyDiv })

  let outputDiv = document.createElement("div")
  outputDiv.className = "sandbox-output playground-output"
  bodyDiv.appendChild(outputDiv)
  let output = new Sandbox.Output(outputDiv)

  // Sincronizar visibilidad de botones según lenguaje
  function syncButtons() {
    let lang = langSelect.value
    runBtn.style.display = (lang === "javascript" || lang === "python") ? "" : "none"
    winBtn.style.display = (lang === "html" || lang === "json" || lang === "xml") ? "" : "none"
    transpileBtn.style.display = lang === "typescript" ? "" : "none"
    tutorBtn.style.display = (lang === "python" || lang === "java" || lang === "c" || lang === "cpp") ? "" : "none"
  }
  syncButtons()

  langSelect.addEventListener("change", () => {
    view.dispatch({ effects: compartment.reconfigure(getLangExtension(langSelect.value)) })
    syncButtons()
    if (window.localStorage) localStorage.setItem("playground-lang", langSelect.value)
  })

  runBtn.addEventListener("click", () => {
    output.clear()
    let code = view.state.doc.toString()
    if (langSelect.value === "python") {
      runPython(code, output)
    } else {
      try {
        let fakeConsole = {
          log: (...a) => output.out("log", a),
          error: (...a) => output.out("error", a),
          warn: (...a) => output.out("warn", a)
        }
        let result = (new Function("console", code))(fakeConsole)
        if (result && typeof result.then === "function")
          result.then(v => { if (v !== undefined) output.out("log", [v]) })
            .catch(e => output.out("error", [e.toString()]))
        else if (result !== undefined) output.out("log", [result])
      } catch (e) { output.out("error", [e.toString()]) }
    }
  })

  winBtn.addEventListener("click", () => {
    let val = view.state.doc.toString()
    let lang = langSelect.value
    let mime = lang === "json" ? "application/json" :
               lang === "xml"  ? "application/xml"  :
               "text/html;charset=utf-8"
    if (lang === "html" && !/<meta[^>]*charset/i.test(val))
      val = '<meta charset="utf-8">' + val
    window.open(URL.createObjectURL(new Blob([val], { type: mime })), "_blank")
  })

  transpileBtn.addEventListener("click", async () => {
    output.clear()
    let origText = transpileBtn.textContent
    transpileBtn.disabled = true
    transpileBtn.textContent = "Loading…"
    try {
      let ts = await getTypeScript()
      let code = view.state.doc.toString()
      let result = ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
      })
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.outputText } })
      langSelect.value = "javascript"
      view.dispatch({ effects: compartment.reconfigure(getLangExtension("javascript")) })
      if (window.localStorage) localStorage.setItem("playground-lang", "javascript")
      syncButtons()
    } catch (e) {
      output.out("error", ["Transpile error: " + e.message])
    } finally {
      transpileBtn.disabled = false
      transpileBtn.textContent = origText
    }
  })

  tutorBtn.addEventListener("click", () => {
    let code = view.state.doc.toString()
    let py = tutorLangMap[langSelect.value] || "3"
    window.open("https://pythontutor.com/visualize.html#code=" + encodeURIComponent(code) +
      "&cumulative=false&heapPrimitives=nevernest&mode=edit&origin=opt-frontend.js&py=" + py +
      "&rawInputLstJSON=%5B%5D&textReferences=false", "_blank")
  })

  detachBtn.addEventListener("click", () => {
    if (window.localStorage) localStorage.setItem("playground-code", view.state.doc.toString())
    let code = view.state.doc.toString()
    let isDark = document.documentElement.getAttribute("data-theme") === "dark"
    let bg = isDark ? "#1e1e2e" : "#fff", fg = isDark ? "#cdd6f4" : "#000", bdr = isDark ? "#45475a" : "#ccc"
    let escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Playground \u2014 ${langSelect.value}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{height:100vh;display:flex;flex-direction:column;background:${bg};color:${fg}}
.bar{padding:6px 10px;border-bottom:1px solid ${bdr};display:flex;gap:8px;align-items:center;font-family:sans-serif}
.bar span{font-size:13px;font-weight:600}.bar button{background:transparent;border:1px solid ${bdr};color:inherit;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:13px}
textarea{flex:1;width:100%;padding:12px;border:none;outline:none;resize:none;font-family:'Consolas','Courier New',monospace;font-size:15px;line-height:1.6;background:${bg};color:${fg};tab-size:2}
</style></head><body><div class="bar"><span>${langSelect.value}</span><button id="cb">Copiar</button></div>
<textarea id="e">${escaped}</textarea>
<script>document.getElementById('e').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();let s=e.target,i=s.selectionStart;s.value=s.value.slice(0,i)+'  '+s.value.slice(s.selectionEnd);s.selectionStart=s.selectionEnd=i+2}});
document.getElementById('cb').addEventListener('click',()=>{navigator.clipboard.writeText(document.getElementById('e').value).then(()=>{let b=document.getElementById('cb');b.textContent='\u2713';setTimeout(()=>{b.textContent='Copiar'},1500)})})</script>
</body></html>`
    window.open(URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })), "_blank")
  })

  if (maximized) {
    overlay.classList.add("playground-maximized")
    maxBtn.textContent = "\u2921"
    maxBtn.title = "Restore"
  }

  view.focus()
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove() })
  let escHandler = e => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", escHandler) } }
  document.addEventListener("keydown", escHandler)
}

// ── Settings panel: ajustar fuentes y colores de elementos ────
function openSettings() {
  const ELEMS = [
    { label: "Inline code",     sel: "code",       props: ["font-size", "color", "background-color"] },
    { label: "H1",              sel: "h1",         props: ["font-size", "color"] },
    { label: "H2",              sel: "h2",         props: ["font-size", "color"] },
    { label: "H3",              sel: "h3",         props: ["font-size", "color"] },
    { label: "Italic (em)",     sel: "em",         props: ["color"] },
    { label: "Bold",            sel: "strong",     props: ["color"] },
    { label: "Links (a)",       sel: "a",          props: ["color"] },
    { label: "Blockquote",      sel: "blockquote", props: ["font-size", "color"] }
  ]

  function rgbToHex(rgb) {
    let m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
    if (!m) return "#000000"
    return "#" + [1,2,3].map(i => parseInt(m[i]).toString(16).padStart(2,"0")).join("")
  }
  function isTransp(v) { return !v || v === "transparent" || /rgba\([\d,\s]+,\s*0\)/.test(v) }
  function normalize(v) {
    if (isTransp(v)) return "transparent"
    if (v && v.startsWith("#")) {
      let r = parseInt(v.slice(1,3),16), g = parseInt(v.slice(3,5),16), b = parseInt(v.slice(5,7),16)
      return `rgb(${r}, ${g}, ${b})`
    }
    return v
  }

  // Leer valores iniciales (computed)
  let init = {}, current = {}
  ELEMS.forEach(({ sel, props }) => {
    let el = document.querySelector("article " + sel)
    if (!el) return
    let cs = getComputedStyle(el)
    init[sel] = {}
    props.forEach(p => { init[sel][p] = cs.getPropertyValue(p) })
    current[sel] = { ...init[sel] }
  })

  // Style dinámico para preview en vivo
  let dynStyle = document.getElementById("ejs-settings-style")
  if (!dynStyle) {
    dynStyle = document.createElement("style")
    dynStyle.id = "ejs-settings-style"
    document.head.appendChild(dynStyle)
  }

  // ── Overlay + modal ──
  let overlay = document.createElement("div")
  overlay.className = "settings-overlay"
  document.body.appendChild(overlay)

  let modal = document.createElement("div")
  modal.className = "settings-modal"
  overlay.appendChild(modal)

  // Header
  let hdr = document.createElement("div")
  hdr.className = "settings-header"
  let hTitle = document.createElement("span")
  hTitle.textContent = "Style settings"
  hdr.appendChild(hTitle)
  let closeBtn = document.createElement("button")
  closeBtn.className = "settings-close"
  closeBtn.textContent = "\u2715"
  closeBtn.addEventListener("click", () => overlay.remove())
  hdr.appendChild(closeBtn)
  modal.appendChild(hdr)

  // Body: una fila por elemento
  let bodyDiv = document.createElement("div")
  bodyDiv.className = "settings-body"
  modal.appendChild(bodyDiv)

  ELEMS.forEach(({ label, sel, props }) => {
    if (!init[sel]) return
    let row = document.createElement("div")
    row.className = "settings-row"

    let lbl = document.createElement("div")
    lbl.className = "settings-label"
    lbl.textContent = label
    row.appendChild(lbl)

    let ctrls = document.createElement("div")
    ctrls.className = "settings-controls"

    props.forEach(prop => {
      let g = document.createElement("div")
      g.className = "settings-prop-group"

      let pL = document.createElement("label")
      pL.textContent = prop === "font-size" ? "Size" : prop === "color" ? "Color" : "Background"
      g.appendChild(pL)

      if (prop === "font-size") {
        let inp = document.createElement("input")
        inp.type = "number"
        inp.className = "settings-size-input"
        inp.value = parseInt(init[sel]["font-size"])
        inp.min = 8; inp.max = 48; inp.step = 1
        inp.addEventListener("input", () => { current[sel]["font-size"] = inp.value + "px"; update() })
        g.appendChild(inp)
        let u = document.createElement("span")
        u.className = "settings-unit"
        u.textContent = "px"
        g.appendChild(u)
      } else {
        let raw = init[sel][prop], tp = isTransp(raw)
        let inp = document.createElement("input")
        inp.type = "color"
        inp.value = tp ? "#f0f0f0" : rgbToHex(raw)
        inp.disabled = tp
        inp.addEventListener("input", () => { current[sel][prop] = inp.value; update() })
        g.appendChild(inp)

        if (prop === "background-color") {
          let tL = document.createElement("label")
          tL.className = "settings-transp-label"
          let cb = document.createElement("input")
          cb.type = "checkbox"
          cb.checked = tp
          cb.addEventListener("change", () => {
            current[sel][prop] = cb.checked ? "transparent" : inp.value
            inp.disabled = cb.checked
            update()
          })
          tL.appendChild(cb)
          tL.appendChild(document.createTextNode(" Transparent"))
          g.appendChild(tL)
        }
      }
      ctrls.appendChild(g)
    })

    row.appendChild(ctrls)
    bodyDiv.appendChild(row)
  })

  // ── Sección de CSS generado ──
  let outSec = document.createElement("div")
  outSec.className = "settings-output-section"

  let outLbl = document.createElement("div")
  outLbl.className = "settings-output-label"
  outLbl.textContent = "Generated CSS \u2014 copy and paste at the end of css/ejs.css:"
  outSec.appendChild(outLbl)

  let textarea = document.createElement("textarea")
  textarea.className = "settings-css-output"
  textarea.readOnly = true
  outSec.appendChild(textarea)

  let copyBtn = document.createElement("button")
  copyBtn.className = "settings-copy-btn"
  copyBtn.textContent = "Copy"
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(textarea.value).then(() => {
      copyBtn.textContent = "\u2713"
      setTimeout(() => { copyBtn.textContent = "Copy" }, 1500)
    })
  })
  outSec.appendChild(copyBtn)
  modal.appendChild(outSec)

  // ── Actualizar preview + CSS generado ──
  function update() {
    let live = "", out = ""
    ELEMS.forEach(({ sel, props }) => {
      if (!current[sel]) return
      let lp = [], op = []
      props.forEach(p => {
        let v = current[sel][p]
        lp.push(p + ": " + v)
        if (normalize(v) !== normalize(init[sel][p])) op.push("  " + p + ": " + v + ";")
      })
      live += sel + " { " + lp.join("; ") + " }\n"
      if (op.length) out += sel + " {\n" + op.join("\n") + "\n}\n"
    })
    dynStyle.textContent = live
    textarea.value = out || "/* No changes */"
  }
  update()

  // ── Close handlers ──
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove() })
  let esc = e => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", esc) } }
  document.addEventListener("keydown", esc)
}

function initTOC() {
  let wrap = document.getElementById("toc-wrap")
  if (!wrap) return
  let article = document.querySelector("article")
  if (!article) return

  // Collect h1 and h2 elements that have an anchor child (injected by render_html)
  let headings = []
  article.querySelectorAll("h1, h2").forEach(h => {
    let anchor = h.querySelector("a[id]")
    if (!anchor) return
    headings.push({tag: h.tagName, id: anchor.id, text: h.textContent.trim()})
  })
  if (headings.length === 0) return

  // Build nested list: h1 → top level, h2 → nested under h1
  let topOl = document.createElement("ul")
  topOl.className = "toc-list"
  let lastH1Li = null
  let subOl = null      // ul for h2 items

  headings.forEach(({tag, id, text}) => {
    let li = document.createElement("li")
    let a = document.createElement("a")
    a.href = "#" + id
    a.textContent = text
    li.appendChild(a)

    if (tag === "H1") {
      topOl.appendChild(li)
      lastH1Li = li
      subOl = null
    } else {
      // H2 — nest under the last H1
      let parent = lastH1Li || topOl
      if (!subOl) {
        subOl = document.createElement("ul")
        parent.appendChild(subOl)
      }
      subOl.appendChild(li)
    }
  })

  // Toggle button
  let btn = document.createElement("button")
  btn.className = "toc-toggle"
  btn.textContent = "Content"
  btn.addEventListener("click", () => btn.classList.toggle("open"))

  wrap.appendChild(btn)
  wrap.appendChild(topOl)
}

function debounce(fn, delay = 50) {
  let timeout
  return arg => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => fn(arg), delay)
  }
}

function initVideos() {
  document.querySelectorAll("video").forEach(v => {
    if (v.readyState >= 1) {
      v.currentTime = 1
    } else {
      v.addEventListener("loadedmetadata", () => { v.currentTime = 1 }, { once: true })
    }
  })
}

if (window.page && /^chapter|hints$/.test(window.page.type)) {
  console.log("[ejs.js] versión " + EJS_VERSION)
  chapterInteraction()
  initToolbar()
  initQuizzes()
  initTOC()
  initVideos()
  // 3rd-edition-style anchor
  let { hash } = document.location
  if (/^#[phic]_./.test(hash)) {
    let exists = document.getElementById(hash.replace(/_/, "-"))
    if (exists) {
      document.location.hash = hash.replace(/_/, "-")
    } else {
      let chapter = /\/[^\/]+\.html/.exec(document.location)
      if (chapter) document.location = `https://eloquentjavascript.net/3rd_edition${chapter[0]}${hash}`
    }
  }
}
