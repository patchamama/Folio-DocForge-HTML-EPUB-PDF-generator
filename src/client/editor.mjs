import {EditorView, keymap, lineNumbers} from "@codemirror/view"
import {EditorState, Compartment} from "@codemirror/state"
import {minimalSetup} from "codemirror"
import {html} from "@codemirror/lang-html"
import {javascript, typescriptLanguage} from "@codemirror/lang-javascript"
import {css} from "@codemirror/lang-css"
import {bracketMatching, syntaxHighlighting, StreamLanguage} from "@codemirror/language"
import {classHighlighter} from "@lezer/highlight"
import {php} from "@codemirror/lang-php"
import {http} from "@codemirror/legacy-modes/mode/http"
import {python} from "@codemirror/legacy-modes/mode/python"
import {java, c, cpp} from "@codemirror/legacy-modes/mode/clike"
import {pascal} from "@codemirror/legacy-modes/mode/pascal"
import {go} from "@codemirror/legacy-modes/mode/go"
import {yaml} from "@codemirror/legacy-modes/mode/yaml"
import {xml} from "@codemirror/legacy-modes/mode/xml"

let modeCompartment = new Compartment

export function getLangExtension(mode) {
  switch(mode) {
    case "html":       return html()
    case "css":        return css()
    case "typescript": return typescriptLanguage
    case "php":        return php()
    case "python":     return StreamLanguage.define(python)
    case "java":       return StreamLanguage.define(java)
    case "c":          return StreamLanguage.define(c)
    case "cpp":        return StreamLanguage.define(cpp)
    case "pascal":     return StreamLanguage.define(pascal)
    case "go":         return StreamLanguage.define(go)
    case "yaml":       return StreamLanguage.define(yaml)
    case "xml":        return StreamLanguage.define(xml)
    case "http":       return StreamLanguage.define(http)
    default:           return javascript()
  }
}

export function createState(code, mode, extensions = []) {
  return EditorState.create({
    doc: code,
    extensions: [
      extensions,
      modeCompartment.of(getLangExtension(mode)),
      minimalSetup,
      syntaxHighlighting(classHighlighter),
      bracketMatching(),
      lineNumbers(),
      EditorView.contentAttributes.of({"aria-label": "Code editor"})
    ]
  })
}

export function updateLanguage(mode) {
  return modeCompartment.reconfigure(getLangExtension(mode))
}

export function createPlaygroundState(code, mode, extraExtensions = []) {
  let compartment = new Compartment
  let state = EditorState.create({
    doc: code,
    extensions: [
      compartment.of(getLangExtension(mode)),
      minimalSetup,
      syntaxHighlighting(classHighlighter),
      bracketMatching(),
      lineNumbers(),
      EditorView.contentAttributes.of({"aria-label": "Playground editor"}),
      extraExtensions
    ]
  })
  return {state, compartment}
}
