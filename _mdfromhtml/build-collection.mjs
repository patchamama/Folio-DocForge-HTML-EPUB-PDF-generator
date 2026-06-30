#!/usr/bin/env node
/**
 * build-collection.mjs — Convert a folder of HTML files into a linked Markdown collection
 *
 * Usage:
 *   node build-collection.mjs <input_dir/> [output_dir/]
 *
 * Generates in output_dir:
 *   - NN.md          Individual chapter files with ← Prev | Contents | Next → navigation
 *   - content.md     Table of contents linking to each chapter
 *   - book.md        Single file with all chapters, TOC and anchor links
 *
 * Requirements: pandoc (system), Node.js 18+
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { basename, dirname, join, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertFile, patchHtmlVideoPlayers } from './html-to-md.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first h1 or h2 heading text from a markdown string */
function extractTitle(md) {
  for (const line of md.split('\n')) {
    const m = line.match(/^#{1,2}\s+(.+)/)
    if (m) return m[1].trim()
  }
  return null
}

/** GitHub-style anchor slug from heading text */
function toAnchor(text) {
  return text
    .toLowerCase()
    .replace(/[*_`[\]()]/g, '')      // strip markdown formatting chars
    .replace(/[^\w\s-]/g, '')        // remove other specials
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/** Navigation bar line (prev/next links + contents link) */
function navBar(prev, next, chapterFile) {
  const parts = []
  if (prev) parts.push(`[← ${prev.title}](${prev.file})`)
  parts.push(`[↑ Contents](content.md)`)
  if (next) parts.push(`[${next.title} →](${next.file})`)
  return parts.join(' · ')
}

/** Prepend and append navigation to a markdown string */
function addNav(md, prev, next, chapterFile) {
  const bar = navBar(prev, next, chapterFile)
  const sep = '\n\n---\n\n'

  // Check if md starts with web link (🌐 Ver contenido web original)
  const webLinkRegex = /^\[🌐 Ver contenido web original\]\([^\)]+\)\s*\n\s*---\s*\n\s*/
  const hasWebLink = webLinkRegex.test(md)

  if (hasWebLink) {
    // Extract web link and rest of content
    const match = md.match(webLinkRegex)
    const webLink = match[0]
    const content = md.slice(match[0].length)
    // Place web link, then nav bar, then content
    return `${webLink}${bar}${sep}${content.trimEnd()}${sep}${bar}\n`
  } else {
    return `${bar}${sep}${md.trimEnd()}${sep}${bar}\n`
  }
}

/** Deduplicate anchor names (append -2, -3, … for repeats) */
function makeAnchorDeduper() {
  const seen = new Map()
  return (text) => {
    const base = toAnchor(text)
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  }
}

// ---------------------------------------------------------------------------
// book.md builder
// ---------------------------------------------------------------------------

function buildBook(chapters) {
  const dedupe = makeAnchorDeduper()

  // Build TOC entries — one per chapter (first h1/h2 only)
  const tocLines = chapters.map(({ title, md }) => {
    const anchor = dedupe(title)
    return `- [${title}](#${anchor})`
  })

  // Reset deduper for body rendering (must produce same sequence)
  const dedupe2 = makeAnchorDeduper()

  // Build body: each chapter's content separated by ---
  const sections = chapters.map(({ title, md }) => {
    // Remove nav bars that were added to individual files (prev/next lines at top/bottom)
    // We strip the first and last nav paragraph if they contain "Contents"
    let content = md.trim()
    content = content
      .replace(/^[^\n]*\[↑ Contents\][^\n]*\n+---\n+/m, '')   // leading nav + separator
      .replace(/\n+---\n+[^\n]*\[↑ Contents\][^\n]*\n*$/m, '') // trailing separator + nav
      .trim()

    // Ensure blank line before first heading (h1-h5) if it doesn't have one
    if (/^#{1,5}\s/.test(content)) {
      content = '\n' + content
    }

    // Ensure anchor for the title heading matches TOC
    dedupe2(title)
    return content
  })

  const toc = `## Table of Contents\n\n${tocLines.join('\n')}`
  const body = sections.join('\n\n---\n')

  return `# Collection\n\n${toc}\n\n---\n\n${body}\n`
}

// ---------------------------------------------------------------------------
// 99.videos.md builder
// ---------------------------------------------------------------------------

/**
 * Build a video index file with:
 *   - One h1 section per chapter that contains videos
 *   - Under each h1: one entry per video with:
 *     - Heading using the local mp4 filename (linked to local file + CDN fallback)
 *     - Inline HTML <video> player for direct playback in the markdown viewer
 *
 * Format per video:
 *   ### ▶ display-name (no link, no .mp4)
 *   <video controls ...><source src="./videos/filename.mp4"></video>
 */
function buildVideosIndex(chapters) {
  const lines = ['# Videos\n']
  let hasAny = false

  for (const { title, file, videos } of chapters) {
    if (!videos || videos.length === 0) continue
    hasAny = true
    lines.push(`\n# ${title}\n`)
    for (const { filename, cdnUrl, posterUrl } of videos) {
      const localSrc = `./html/videos/${filename}`
      const displayName = filename.replace(/\.[^.]+$/, '')
      const posterAttr = posterUrl ? ` poster="${posterUrl}"` : ''

      lines.push(`\n### ▶ ${displayName}\n`)
      lines.push(`<video controls style="max-width:100%;width:100%"${posterAttr}>`)
      lines.push(`  <source src="${localSrc}" type="video/mp4">`)
      lines.push(`</video>\n`)
    }
    lines.push('\n---')
  }

  return hasAny ? lines.join('\n') + '\n' : null
}

// ---------------------------------------------------------------------------
// content.md builder
// ---------------------------------------------------------------------------

function buildContents(chapters) {
  const lines = chapters.map(({ title, file }) => `- [${title}](${file})`)
  return `# Contents\n\n${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`Usage:
  node build-collection.mjs <input_dir/> [output_dir/]

Options:
  --help    Show this help

Generates:
  - Individual .md files with ← Prev | Contents | Next → navigation
  - content.md with the table of contents
  - book.md with all chapters combined

Examples:
  node build-collection.mjs ../elo_academy/ ./output/
  node build-collection.mjs ../elo_academy/
`)
  process.exit(0)
}

// Check pandoc is available
try {
  execSync('pandoc --version', { stdio: 'ignore' })
} catch (_) {
  console.error('Error: pandoc is not installed or not in PATH.')
  process.exit(1)
}

const inputArg = resolve(args[0])
const outputArg = args[1] ? resolve(args[1]) : inputArg

if (!statSync(inputArg).isDirectory()) {
  console.error(`Error: ${inputArg} is not a directory.`)
  process.exit(1)
}

const htmlFiles = readdirSync(inputArg)
  .filter(f => extname(f).toLowerCase() === '.html')
  .sort()

if (htmlFiles.length === 0) {
  console.error(`No .html files found in ${inputArg}`)
  process.exit(1)
}

mkdirSync(outputArg, { recursive: true })

// ── Create md_original/ subfolder for pre-cleanup copies
const rawDir = join(outputArg, 'md_original')
mkdirSync(rawDir, { recursive: true })

// ── Step 1: Convert all HTML files to Markdown
console.log(`\nStep 1: Converting ${htmlFiles.length} HTML files...\n`)
const mdFiles = []
for (const htmlFile of htmlFiles) {
  const stem = basename(htmlFile, extname(htmlFile))
  const inFile = join(inputArg, htmlFile)
  const outFile = join(outputArg, stem + '.md')
  const rawFile = join(rawDir, stem + '.md')
  const { videos } = convertFile(inFile, outFile, rawFile)
  mdFiles.push({ stem, file: stem + '.md', outFile, videos })
}

// ── Step 2: Extract titles from converted markdown files
console.log('\nStep 2: Extracting titles...\n')
const chapters = mdFiles.map(({ stem, file, outFile, videos }) => {
  const md = readFileSync(outFile, 'utf-8')
  const title = extractTitle(md) || stem
  console.log(`  ${file}: "${title}"`)
  return { stem, file, outFile, title, md, videos }
})

// ── Step 3: Add prev/next navigation to each individual file
console.log('\nStep 3: Adding navigation to each chapter...\n')
for (let i = 0; i < chapters.length; i++) {
  const { outFile, title, md, file } = chapters[i]
  const prev = i > 0 ? { title: chapters[i - 1].title, file: chapters[i - 1].file } : null
  const next = i < chapters.length - 1 ? { title: chapters[i + 1].title, file: chapters[i + 1].file } : null
  const navigated = addNav(md, prev, next, file)
  writeFileSync(outFile, navigated, 'utf-8')
  // Update md in memory for book.md (use the navigated version so strips cleanly)
  chapters[i].md = navigated
  console.log(`  ${file}${prev ? ' ← ' + prev.title.slice(0, 20) : ''}${next ? ' → ' + next.title.slice(0, 20) : ''}`)
}

// ── Step 4: Generate content.md
console.log('\nStep 4: Generating content.md...\n')
const contentMd = buildContents(chapters)
const contentPath = join(outputArg, 'content.md')
writeFileSync(contentPath, contentMd, 'utf-8')
console.log(`  → ${contentPath}`)

// ── Step 5: Generate book.md
console.log('\nStep 5: Generating book.md...\n')
const bookMd = buildBook(chapters)
const bookPath = join(outputArg, 'book.md')
writeFileSync(bookPath, bookMd, 'utf-8')
console.log(`  → ${bookPath}`)

// ── Step 6: Generate 99.videos.md (video index with thumbnails)
console.log('\nStep 6: Generating 99.videos.md...\n')
const videosMd = buildVideosIndex(chapters)
if (videosMd) {
  const videosPath = join(outputArg, '999.md')
  writeFileSync(videosPath, videosMd, 'utf-8')
  console.log(`  → ${videosPath}`)
} else {
  console.log('  (no videos found)')
}

// ── Step 7: Patch broken video.js players in source HTML files
//    Replaces each vjs_video_ div with a clickable poster image linked to the
//    CDN video URL so the HTML files are directly viewable in a browser.
console.log('\nStep 7: Patching video players in source HTML files...\n')
let patchedCount = 0
for (const htmlFile of htmlFiles) {
  const inFile = join(inputArg, htmlFile)
  const original = readFileSync(inFile, 'utf-8')
  const patched = patchHtmlVideoPlayers(original)
  if (patched !== original) {
    writeFileSync(inFile, patched, 'utf-8')
    console.log(`  → patched: ${htmlFile}`)
    patchedCount++
  }
}
if (patchedCount === 0) console.log('  (no video players to patch)')

console.log(`\nDone. ${chapters.length} chapters processed.\n`)
