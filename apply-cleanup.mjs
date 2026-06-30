#!/usr/bin/env node
/**
 * apply-cleanup.mjs
 * Applies the regex patterns from _mdfromhtml/cleanup.json to a markdown file
 * and writes the result to new.md in the same directory.
 *
 * Usage: node apply-cleanup.mjs <path/to/file.md>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Parse args ──────────────────────────────────────────────────────────────

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node apply-cleanup.mjs <path/to/file.md>')
  process.exit(1)
}

// ── Load cleanup patterns ────────────────────────────────────────────────────

const cleanupPath = join(__dirname, '_mdfromhtml', 'cleanup.json')
let cleanupPatterns = []
try {
  const config = JSON.parse(readFileSync(cleanupPath, 'utf-8'))
  cleanupPatterns = (config.patterns || []).map(p => ({
    re: new RegExp(p.pattern, p.flags !== undefined ? p.flags : 'g'),
    replacement: p.replacement !== undefined ? p.replacement : ''
  }))
  console.log(`Loaded ${cleanupPatterns.length} patterns from cleanup.json`)
} catch (err) {
  console.error(`Failed to load cleanup.json: ${err.message}`)
  process.exit(1)
}

// ── Read input file ──────────────────────────────────────────────────────────

let content
try {
  content = readFileSync(inputPath, 'utf-8')
} catch (err) {
  console.error(`Failed to read "${inputPath}": ${err.message}`)
  process.exit(1)
}

// ── Apply patterns ───────────────────────────────────────────────────────────

for (const { re, replacement } of cleanupPatterns) {
  re.lastIndex = 0  // reset stateful global regexes
  content = content.replace(re, replacement)
}

// ── Write output ─────────────────────────────────────────────────────────────

const outDir = dirname(inputPath)
const outPath = join(outDir, 'new.md')
writeFileSync(outPath, content, 'utf-8')
console.log(`Written: ${outPath}`)
