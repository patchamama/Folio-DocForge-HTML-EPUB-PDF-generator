#!/usr/bin/env node
/**
 * merge-book.mjs — Merge multiple numbered markdown files into a single book
 *
 * Usage:
 *   node merge-book.mjs <input_dir/> [options]
 *
 * Options:
 *   --output <file>              Output file path (default: <input_dir>/book_full.md)
 *   --images-dest <path>         Copy all images to this folder and update references
 *   --toc-depth <n>              Table of contents depth (default: 2, range: 1-6, 0 to disable)
 *   --no-convert-emphasis        Keep ***, **, * as-is instead of converting to backticks
 *   --include-original-refs      Include lines with "🌐 View original web content" (excluded by default)
 *   --no-format-tables           Don't format table cells with backticks (formatted by default)
 *   --help                       Show this help
 *
 * Features:
 *   - Merges all files matching pattern \d+.md in numerical order
 *   - Filters out navigation lines containing "↑ Contents"
 *   - Converts ***, **, * to backticks (unless --no-convert-emphasis)
 *   - Removes escape characters from inline code content
 *   - Verifies all image references exist
 *   - Generates results.txt with missing images report
 *
 * Examples:
 *   node merge-book.mjs ../elo_academy/
 *   node merge-book.mjs ../elo_academy/ --output book.md --no-original-refs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { basename, dirname, join, resolve, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    inputDir: null,
    outputFile: null,  // null means use default (inputDir/book_full.md)
    imagesDest: null,  // null means keep original image paths
    tocDepth: 2,
    convertEmphasis: true,
    includeOriginalRefs: false,  // By default, exclude original web content refs
    formatTables: true,  // By default, format table cells with backticks
    showHelp: false
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--help' || arg === '-h') {
      args.showHelp = true
    } else if (arg === '--no-convert-emphasis') {
      args.convertEmphasis = false
    } else if (arg === '--include-original-refs') {
      args.includeOriginalRefs = true
    } else if (arg === '--no-format-tables') {
      args.formatTables = false
    } else if (arg === '--output' || arg === '-o') {
      args.outputFile = argv[++i]
    } else if (arg === '--images-dest') {
      args.imagesDest = argv[++i]
    } else if (arg === '--toc-depth') {
      const depth = parseInt(argv[++i], 10)
      if (isNaN(depth) || depth < 0 || depth > 6) {
        console.error('Error: --toc-depth must be between 0 and 6')
        process.exit(1)
      }
      args.tocDepth = depth
    } else if (!args.inputDir) {
      args.inputDir = arg
    }
  }

  return args
}

// ---------------------------------------------------------------------------
// Markdown processing
// ---------------------------------------------------------------------------

/**
 * Convert emphasis markers (***, **, *) to backticks for inline code
 * Also removes escape characters (e.g., \\ → \)
 * DOES NOT convert if entire line content is emphasized
 */
function convertEmphasisToCode(text) {
  const lines = text.split('\n')
  const processed = []

  for (const line of lines) {
    let trimmed = line.trim()

    // Remove trailing backslash for checking (markdown line break)
    const cleanedForCheck = trimmed.replace(/\\+$/, '')

    // Check if entire line is emphasized (skip conversion for full-line emphasis)
    // Patterns: ***entire line***, **entire line**, *entire line*
    // Must start and end with same emphasis markers, with content in between
    const isFullLineEmphasis = /^\*{1,3}[^*]+\*{1,3}$/.test(cleanedForCheck)

    if (isFullLineEmphasis) {
      // Keep the line as-is (don't convert full-line emphasis)
      // But remove trailing backslash
      processed.push(line.replace(/\\+$/, ''))
      continue
    }

    // Process partial emphasis within the line
    let processedLine = line

    // 1. Convert ***text*** to `text`
    processedLine = processedLine.replace(/\*\*\*([^*]+)\*\*\*/g, (match, content) => {
      // Remove escape characters
      const unescaped = content.replace(/\\\\/g, '\\').replace(/\\(.)/g, '$1')
      return '`' + unescaped + '`'
    })

    // 2. Convert **text** to `text`
    processedLine = processedLine.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
      // Remove escape characters
      const unescaped = content.replace(/\\\\/g, '\\').replace(/\\(.)/g, '$1')
      return '`' + unescaped + '`'
    })

    // 3. Convert *text* to `text` (but avoid matching already converted backticks)
    processedLine = processedLine.replace(/\*([^*`]+)\*/g, (match, content) => {
      // Remove escape characters
      const unescaped = content.replace(/\\\\/g, '\\').replace(/\\(.)/g, '$1')
      return '`' + unescaped + '`'
    })

    // Remove trailing backslash (markdown line break) from processed line
    processedLine = processedLine.replace(/\\+$/, '')

    processed.push(processedLine)
  }

  return processed.join('\n')
}

/**
 * Process a single markdown file according to options
 */
function processMarkdown(content, options) {
  const lines = content.split('\n')
  const processed = []

  for (const line of lines) {
    // Skip navigation lines containing "↑ Contents"
    if (line.includes('↑ Contents')) {
      continue
    }

    // Skip original web content reference if option is set
    if (!options.includeOriginalRefs && line.includes('🌐 View original web content')) {
      continue
    }

    // Convert emphasis to code if option is set
    let processedLine = line
    if (options.convertEmphasis) {
      processedLine = convertEmphasisToCode(processedLine)
    }

    processed.push(processedLine)
  }

  return processed.join('\n')
}

/**
 * Extract all image references from markdown content
 * Returns array of objects: { file: sourceFile, image: imagePath }
 */
function extractImageRefs(content, sourceFile) {
  const refs = []
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

  let match
  while ((match = imgRegex.exec(content)) !== null) {
    const imgPath = match[2]
    // Skip external URLs
    if (!/^https?:\/\//i.test(imgPath)) {
      refs.push({ file: sourceFile, image: imgPath })
    }
  }

  return refs
}

/**
 * Verify image existence relative to input directory
 * Returns array of missing image references
 */
function verifyImages(imageRefs, inputDir) {
  const missing = []

  for (const ref of imageRefs) {
    const imgPath = resolve(inputDir, ref.image)
    if (!existsSync(imgPath)) {
      missing.push(ref)
    }
  }

  return missing
}

// ---------------------------------------------------------------------------
// Table of Contents generation
// ---------------------------------------------------------------------------

/**
 * Generate GitHub-style anchor slug from heading text
 * Handles German special characters (ü→u, ö→o, ä→a, ß→ss)
 */
function toAnchor(text) {
  return text
    .toLowerCase()
    // Normalize German special characters
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ä/g, 'a')
    .replace(/ß/g, 'ss')
    // Strip markdown formatting chars
    .replace(/[*_`[\]()]/g, '')
    // Remove other special characters (but keep alphanumeric, spaces, and hyphens)
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/**
 * Deduplicate anchor names (append -2, -3, … for repeats)
 */
function makeAnchorDeduper() {
  const seen = new Map()
  return (text) => {
    const base = toAnchor(text)
    const count = (seen.get(base) || 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  }
}

/**
 * Extract headings from markdown content
 * Returns array of { level, text, anchor }
 * Removes escape characters from heading text
 */
function extractHeadings(content, maxDepth) {
  const headings = []
  const lines = content.split('\n')
  const dedupe = makeAnchorDeduper()

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      if (level <= maxDepth) {
        let text = match[2].trim()

        // Remove escape characters (e.g., \# → #, \\ → \)
        text = text.replace(/\\(.)/g, '$1')

        const anchor = dedupe(text)
        headings.push({ level, text, anchor })
      }
    }
  }

  return headings
}

/**
 * Build table of contents from headings
 * Returns markdown string with nested list
 */
function buildTOC(allHeadings) {
  if (allHeadings.length === 0) return ''

  const lines = ['# Content', '']

  for (const heading of allHeadings) {
    // Indent based on level (level 1 = no indent, level 2 = 2 spaces, etc.)
    const indent = '  '.repeat(heading.level - 1)
    lines.push(`${indent}- [${heading.text}](#${heading.anchor})`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Image copying and path updating
// ---------------------------------------------------------------------------

/**
 * Copy all images to a destination folder and return a mapping of old → new paths
 * Handles filename collisions by appending numbers
 */
function copyImagesToDestination(imageRefs, inputDir, imagesDest, outputFile) {
  // Create destination folder if it doesn't exist
  mkdirSync(imagesDest, { recursive: true })

  const pathMapping = new Map() // oldPath → newRelativePath
  const usedNames = new Map()   // basename → count (for collision handling)

  for (const ref of imageRefs) {
    const oldPath = ref.image

    // Skip if already processed (duplicate reference)
    if (pathMapping.has(oldPath)) continue

    // Resolve absolute path to source image
    const sourcePath = resolve(inputDir, oldPath)

    if (!existsSync(sourcePath)) {
      // Skip missing images (already reported in verification)
      continue
    }

    // Get original filename and extension
    const origName = basename(sourcePath)
    const ext = extname(origName)
    const nameWithoutExt = basename(origName, ext)

    // Handle filename collisions
    const count = (usedNames.get(origName) || 0) + 1
    usedNames.set(origName, count)

    const finalName = count === 1 ? origName : `${nameWithoutExt}_${count}${ext}`
    const destPath = join(imagesDest, finalName)

    // Copy image
    try {
      copyFileSync(sourcePath, destPath)
    } catch (error) {
      console.warn(`  Warning: Could not copy ${sourcePath}: ${error.message}`)
      continue
    }

    // Calculate relative path from output file to copied image
    const outputDir = dirname(resolve(outputFile))
    const relPath = relative(outputDir, destPath).replace(/\\/g, '/')

    pathMapping.set(oldPath, relPath)
  }

  return pathMapping
}

/**
 * Update image references in markdown content using path mapping
 */
function updateImageReferences(content, pathMapping) {
  let updated = content

  for (const [oldPath, newPath] of pathMapping) {
    // Escape special regex characters in old path
    const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Replace all occurrences of this image path
    const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedOld}\\)`, 'g')
    updated = updated.replace(regex, `![$1](${newPath})`)
  }

  return updated
}

// ---------------------------------------------------------------------------
// Content post-processing
// ---------------------------------------------------------------------------

/**
 * Remove trailing backslashes from all lines
 * These are markdown line breaks that we don't want in the merged book
 */
function removeTrailingBackslashes(text) {
  return text.split('\n').map(line => line.replace(/\\+$/, '')).join('\n')
}

/**
 * Consolidate consecutive separator lines (---) into a single separator
 * Removes duplicates even if separated by blank lines
 */
function consolidateSeparators(text) {
  const lines = text.split('\n')
  const result = []
  let lastWasSeparator = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '---') {
      if (!lastWasSeparator) {
        result.push(line)
        lastWasSeparator = true
      }
      // Skip duplicate separators
    } else if (trimmed === '' && lastWasSeparator) {
      // Skip blank lines immediately after separator
      continue
    } else {
      lastWasSeparator = false
      result.push(line)
    }
  }

  return result.join('\n')
}

/**
 * Format table cells with backticks:
 * - All header cells wrapped in backticks
 * - First column of each row wrapped in backticks
 * - Removes all markdown formatting (backticks, asterisks, underscores) before adding backticks
 */
function formatTableCells(text) {
  const lines = text.split('\n')
  const result = []
  let inTable = false
  let isHeaderRow = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect table rows (start with | and end with |)
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|')
    const isSeparator = /^\|\s*[-:]+\s*(\|\s*[-:]+\s*)*\|$/.test(trimmed)

    if (isTableRow && !isSeparator) {
      // Parse cells
      const cells = line.split('|').slice(1, -1) // Remove empty first/last

      // Check if this is a header row (next line is separator)
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : ''
      isHeaderRow = /^\|\s*[-:]+\s*(\|\s*[-:]+\s*)*\|$/.test(nextLine)

      // Format cells
      const formattedCells = cells.map((cell, index) => {
        const content = cell.trim()

        // Remove ALL markdown formatting: backticks, asterisks, underscores
        // This ensures clean content regardless of previous formatting
        const cleanContent = content
          .replace(/[`*_]/g, '')  // Remove all backticks, asterisks, and underscores
          .replace(/\s+/g, ' ')   // Normalize multiple spaces to single space
          .trim()

        // Wrap in backticks if:
        // - It's a header row (all cells)
        // - It's the first column (index 0)
        if (isHeaderRow || index === 0) {
          return ` \`${cleanContent}\` `
        } else {
          return ` ${cleanContent} `
        }
      })

      result.push('|' + formattedCells.join('|') + '|')
      inTable = true
    } else {
      result.push(line)
      if (!isTableRow && inTable) {
        inTable = false
      }
    }
  }

  return result.join('\n')
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

function mergeBook(inputDir, options) {
  // Find all numbered markdown files
  const allFiles = readdirSync(inputDir)
  const numberedFiles = allFiles
    .filter(f => /^\d+\.md$/.test(f))
    .sort((a, b) => {
      // Sort numerically (not lexicographically)
      const numA = parseInt(a.match(/^(\d+)\.md$/)[1], 10)
      const numB = parseInt(b.match(/^(\d+)\.md$/)[1], 10)
      return numA - numB
    })

  if (numberedFiles.length === 0) {
    console.error(`Error: No numbered markdown files (\\d+.md) found in ${inputDir}`)
    process.exit(1)
  }

  console.log(`Found ${numberedFiles.length} numbered markdown files\n`)

  // Process each file
  const chapters = []
  const allImageRefs = []

  for (const file of numberedFiles) {
    const filePath = join(inputDir, file)
    const content = readFileSync(filePath, 'utf-8')

    // Extract image references before processing
    const imageRefs = extractImageRefs(content, file)
    allImageRefs.push(...imageRefs)

    // Process markdown content
    const processed = processMarkdown(content, options)

    chapters.push({
      file,
      content: processed
    })

    console.log(`  ✓ ${file} (${imageRefs.length} images)`)
  }

  // Verify all images exist
  console.log('\nVerifying images...')
  const missingImages = verifyImages(allImageRefs, inputDir)

  if (missingImages.length > 0) {
    console.log(`  ⚠ ${missingImages.length} missing image(s) found`)

    // Generate results.txt with missing images report
    const reportLines = ['Missing Images Report', '='.repeat(50), '']
    for (const ref of missingImages) {
      reportLines.push(`Source: ${ref.file}`)
      reportLines.push(`Image:  ${ref.image}`)
      reportLines.push('')
    }

    const reportPath = join(inputDir, 'results.txt')
    writeFileSync(reportPath, reportLines.join('\n'), 'utf-8')
    console.log(`  → Report saved to ${reportPath}`)
  } else {
    console.log(`  ✓ All ${allImageRefs.length} images verified`)
  }

  // Copy images to destination if specified
  let pathMapping = null
  if (options.imagesDest) {
    console.log(`\nCopying images to ${options.imagesDest}...`)
    const imagesDest = resolve(options.imagesDest)
    pathMapping = copyImagesToDestination(allImageRefs, inputDir, imagesDest, options.outputFile)
    console.log(`  ✓ ${pathMapping.size} image(s) copied`)

    // Update image references in all chapters
    for (const chapter of chapters) {
      chapter.content = updateImageReferences(chapter.content, pathMapping)
    }
  }

  // Extract headings for table of contents
  let toc = ''
  if (options.tocDepth > 0) {
    console.log(`\nGenerating table of contents (depth: ${options.tocDepth})...`)
    const allHeadings = []

    for (const chapter of chapters) {
      const headings = extractHeadings(chapter.content, options.tocDepth)
      allHeadings.push(...headings)
    }

    toc = buildTOC(allHeadings)
    console.log(`  ✓ ${allHeadings.length} headings extracted`)
  }

  // Combine all chapters with separator
  console.log('\nMerging chapters...')
  const separator = '\n\n---\n\n'
  const combined = chapters.map(ch => ch.content.trim()).join(separator)

  // Build final content: TOC + separator + chapters
  let finalContent = options.tocDepth > 0
    ? `${toc}\n\n---\n\n${combined}\n`
    : `${combined}\n`

  // Post-process: remove trailing backslashes
  console.log('\nPost-processing...')
  finalContent = removeTrailingBackslashes(finalContent)
  console.log('  ✓ Removed trailing backslashes')

  // Post-process: consolidate consecutive separators
  finalContent = consolidateSeparators(finalContent)
  console.log('  ✓ Consolidated separators')

  // Post-process: format table cells with backticks
  if (options.formatTables) {
    finalContent = formatTableCells(finalContent)
    console.log('  ✓ Formatted table cells')
  }

  // Write output file
  const outputPath = resolve(options.outputFile)
  writeFileSync(outputPath, finalContent, 'utf-8')

  console.log(`\n✓ Merged ${chapters.length} chapters into ${outputPath}`)
  const optsStr = [
    `tocDepth=${options.tocDepth}`,
    `convertEmphasis=${options.convertEmphasis}`,
    `includeOriginalRefs=${options.includeOriginalRefs}`,
    `formatTables=${options.formatTables}`,
    options.imagesDest ? `imagesDest=${options.imagesDest}` : null
  ].filter(Boolean).join(', ')
  console.log(`  Options: ${optsStr}`)

  return {
    chapters: chapters.length,
    images: allImageRefs.length,
    missing: missingImages.length
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = parseArgs(process.argv)

  if (args.showHelp || !args.inputDir) {
    console.log(`Usage:
  node merge-book.mjs <input_dir/> [options]

Options:
  --output <file>              Output file path (default: <input_dir>/book_full.md)
  --images-dest <path>         Copy all images to this folder and update references
  --toc-depth <n>              Table of contents depth (default: 2, range: 1-6, 0 to disable)
  --no-convert-emphasis        Keep ***, **, * as-is instead of converting to backticks
  --include-original-refs      Include lines with "🌐 View original web content" (excluded by default)
  --no-format-tables           Don't format table cells with backticks (formatted by default)
  --help                       Show this help

Features:
  - Merges all files matching pattern \\d+.md in numerical order
  - Generates output in the same folder as input files (by default)
  - Generates table of contents with specified depth (default: 2 levels)
  - Optionally copies all images to a central location with updated references
  - Filters out navigation lines containing "↑ Contents"
  - Excludes "🌐 View original web content" links by default
  - Converts ***, **, * to backticks (except full-line emphasis)
  - Formats table headers and first columns with backticks (by default)
  - Consolidates consecutive separator lines (---)
  - Removes escape characters from inline code content
  - Verifies all image references exist
  - Generates results.txt with missing images report

Examples:
  node merge-book.mjs ../elo_academy/                              # Output: ../elo_academy/book_full.md
  node merge-book.mjs ../elo_academy/ --output ./book.md           # Output: ./book.md
  node merge-book.mjs ../elo_academy/ --toc-depth 3                # 3-level TOC
  node merge-book.mjs ../elo_academy/ --images-dest ./book_images  # Copy images to ./book_images/
  node merge-book.mjs ./output/ --no-convert-emphasis              # Keep emphasis markers
  node merge-book.mjs ./output/ --include-original-refs            # Include web content links
  node merge-book.mjs ./output/ --no-format-tables                 # Don't format tables
  node merge-book.mjs ./output/ --toc-depth 0                      # Disable TOC
`)
    process.exit(args.showHelp ? 0 : 1)
  }

  const inputDir = resolve(args.inputDir)

  if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
    console.error(`Error: ${inputDir} is not a valid directory`)
    process.exit(1)
  }

  // Set default output file to input directory if not specified
  if (!args.outputFile) {
    args.outputFile = join(inputDir, 'book_full.md')
  }

  try {
    mergeBook(inputDir, args)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    process.exit(1)
  }
}

export { mergeBook, convertEmphasisToCode }
