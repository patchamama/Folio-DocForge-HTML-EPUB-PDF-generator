import {readFileSync} from "fs"
import {basename} from "path"

let [template, ...chapters] = process.argv.slice(2)

function esc(str) {
  return str.replace(/[<>&"]/g, ch => ch == "<" ? "&lt;" : ch == ">" ? "&gt;" : ch == "&" ? "&amp;" : "&quot;")
}

let navToc = ""      // machine-readable <nav epub:type="toc">
let userToc = ""     // user-visible <ol class="toc">
const section = /<h2\b[^>]*><a [^>]*?id="(h-[^"]*)".*?><\/a>(.*?)<\/h2>/g

for (let chapter of chapters) {
  let text = readFileSync(chapter, "utf8")
  let base = basename(chapter)
  let title = /<h1.*?>(.*?)<\/h1>/.exec(text)[1]

  navToc  += `        <li><a href="${base}">${esc(title)}</a>\n          <ol>\n`
  userToc += `      <li><a href="${base}">${esc(title)}\n        <ul>\n`

  for (let match; match = section.exec(text);) {
    navToc  += `            <li><a href="${base}#${match[1]}">${esc(match[2])}</a></li>\n`
    userToc += `          <li><a href="${base}#${match[1]}">${esc(match[2])}</a></li>\n`
  }

  navToc  += `          </ol>\n        </li>\n`
  userToc += `        </ul></li>\n`
}

console.log(readFileSync(template, "utf8")
  .replace("{{chapters_toc}}", userToc)
  .replace("{{full_toc}}", navToc))
