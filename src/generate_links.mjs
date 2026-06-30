#!/usr/bin/env node
// generate_links.mjs — Extracts all external links from markdown files, grouped by h1 section.
// Output: a links.md file with # Links as root heading and ## per h1 section.
//
// Usage:
//   node src/generate_links.mjs file1.md [file2.md ...] [-o links.md]

import * as fs from "fs"

const argv = process.argv.slice(2)
let outputFile = null
const files = []

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "-o" || argv[i] === "--output") { outputFile = argv[++i]; continue }
  files.push(argv[i])
}

if (files.length === 0) {
  process.stderr.write("Usage: generate_links.mjs file.md ... [-o links.md]\n")
  process.exit(1)
}

// Strip inline markdown (bold, code, etc.) from heading text
function cleanHeading(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
}

// Extract markdown links [text](url) from a line, handling balanced parens in URLs.
// Returns [{text, url}] for external http(s) links only. Skips images (![...]).
function extractLinks(line) {
  const results = []
  let i = 0
  while (i < line.length) {
    // Find `[` not preceded by `!` (skip images)
    const lb = line.indexOf("[", i)
    if (lb === -1) break
    if (lb > 0 && line[lb - 1] === "!") { i = lb + 1; continue }

    // Find closing `]` (no nesting — same as CommonMark inline link text)
    let rb = lb + 1
    while (rb < line.length && line[rb] !== "]") rb++
    if (rb >= line.length) { i = lb + 1; continue }

    // Must be followed by `(`
    if (line[rb + 1] !== "(") { i = rb + 1; continue }

    // Scan URL with balanced parens to find closing `)`
    let depth = 1, j = rb + 2
    while (j < line.length && depth > 0) {
      if (line[j] === "(") depth++
      else if (line[j] === ")") depth--
      if (depth > 0) j++
    }
    if (depth !== 0) { i = rb + 2; continue } // unbalanced — skip

    const text = line.slice(lb + 1, rb)
    const url = line.slice(rb + 2, j).trim()

    if (/^https?:\/\//i.test(url)) {
      results.push({ text, url })
    }
    i = j + 1
  }
  return results
}

// Sections: [{title: string, links: [{text, url}]}]
const sections = []
let currentSection = null

function startSection(title) {
  currentSection = { title, links: [] }
  sections.push(currentSection)
}

function addLink(text, url) {
  if (!currentSection) return
  // Trim trailing punctuation that may have been captured in bare URLs
  url = url.replace(/[.,;:!?]+$/, "")
  // Skip anchor-only links
  if (url.startsWith("#")) return
  // Avoid duplicate URLs within the same section
  if (currentSection.links.some(l => l.url === url)) return
  currentSection.links.push({ text: cleanHeading(text || url), url })
}

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n")
  let inFence = false

  for (const line of lines) {
    // Track code fences — don't extract links from inside them
    if (/^(`{3,})/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue

    // H1 heading → new section
    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1) { startSection(cleanHeading(h1[1])); continue }

    // Skip lines with no URL at all (fast path)
    if (!line.includes("http")) continue

    // 1) Explicit markdown links [text](url) — balanced-paren URL scanner
    for (const { text, url } of extractLinks(line)) {
      addLink(text, url)
    }

    // 2) Bare URLs not already inside ]( ... ) link syntax
    const stripped = line.replace(/\[[^\]]*\]\([^)]*\)/g, "")  // remove explicit links
    const bareRe = /\bhttps?:\/\/[^\s)\]"'<>]+/g
    let m
    while ((m = bareRe.exec(stripped)) !== null) {
      addLink(m[0], m[0])
    }
  }
}

// Build output
const out = ["# Links", ""]

for (const { title, links } of sections) {
  if (links.length === 0) continue
  out.push(`### ${title}`, "")
  for (const { text, url } of links) {
    let label = text !== url ? text : url
    // Strip leading "- " that appears when the link was inside a markdown list item
    label = label.replace(/^-\s+/, "")
    // Use angle-bracket URL notation so markdown-it handles special chars
    // (&, #, balanced parens) without mis-parsing
    out.push(`- [${label}](<${url}>)`)
  }
  out.push("")
}

const hasLinks = sections.some(s => s.links.length > 0)

if (!hasLinks) {
  if (outputFile && fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
  process.exit(0)
}

const result = out.join("\n")
if (outputFile) {
  fs.writeFileSync(outputFile, result)
  process.stderr.write(`Written: ${outputFile}\n`)
} else {
  process.stdout.write(result)
}
