#!/usr/bin/env node
/**
 * html-to-md.mjs — Convert Articulate Rise HTML lesson files to Markdown
 *
 * Usage:
 *   node html-to-md.mjs <input.html> [output.md]
 *   node html-to-md.mjs <input_dir/> [output_dir/]   # converts all .html files
 *
 * Requirements: pandoc (system)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { basename, dirname, join, resolve, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Load user-configurable cleanup patterns from cleanup.json (optional)
// ---------------------------------------------------------------------------

let cleanupPatterns = []
try {
  const cleanupPath = join(__dirname, 'cleanup.json')
  const config = JSON.parse(readFileSync(cleanupPath, 'utf-8'))
  cleanupPatterns = (config.patterns || []).filter(p => !p.disabled).map(p => ({
    re: new RegExp(p.pattern, p.flags !== undefined ? p.flags : 'g'),
    // Unescape \n, \t, \r so JSON "\\n" becomes an actual newline in replacements.
    // String.replace() does not interpret these escape sequences itself.
    replacement: (p.replacement !== undefined ? p.replacement : '')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
  }))
} catch (_) {
  // cleanup.json is optional — silently ignored if missing or invalid
}

// ---------------------------------------------------------------------------
// ELO community authentication for downloading streamed lesson videos.
// The lesson videos (assets/NAME.mp4) are NOT embedded in the saved HTML —
// they are served by community.elo.com behind authentication. To download
// them we need a valid session Cookie header.
//
// Provide the cookie via either:
//   1. Environment variable:  ELO_COOKIE='cookie-header-value'
//   2. A file next to this script:  _mdfromhtml/elo-auth.json
//        { "cookie": "cookie-header-value" }
//
// Grab the value from your browser DevTools → Network → any request to
// community.elo.com → Request Headers → Cookie.
// ---------------------------------------------------------------------------

let eloCookie = process.env.ELO_COOKIE || ''
if (!eloCookie) {
  try {
    const authPath = join(__dirname, 'elo-auth.json')
    const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
    eloCookie = auth.cookie || ''
  } catch (_) {
    // elo-auth.json is optional
  }
}

// ---------------------------------------------------------------------------
// HTML pre-processing — extract <main class="lesson-main"> and strip noise
// ---------------------------------------------------------------------------

function extractMain(html) {
  // Extract <main>...</main> block
  const mainStart = html.indexOf('<main ')
  if (mainStart === -1) {
    // Fallback: try <div class="lesson-main">
    const divIdx = html.indexOf('class="lesson-main"')
    if (divIdx === -1) return html // return full html as-is
    const tagStart = html.lastIndexOf('<div', divIdx)
    return extractDivBlock(html, tagStart)
  }
  const mainEnd = html.lastIndexOf('</main>') + 7
  return html.slice(mainStart, mainEnd)
}

function extractDivBlock(html, startIdx) {
  let depth = 1
  let i = startIdx + 4
  while (i < html.length && depth > 0) {
    const openTag = html.indexOf('<div', i)
    const closeTag = html.indexOf('</div', i)
    if (closeTag === -1) break
    if (openTag !== -1 && openTag < closeTag) {
      depth++
      i = openTag + 4
    } else {
      depth--
      if (depth === 0) return html.slice(startIdx, closeTag + 6)
      i = closeTag + 6
    }
  }
  return html.slice(startIdx)
}

function stripElements(html, tag) {
  // Remove <tag ...>...</tag> blocks (may be nested — handled via regex for most cases)
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi')
  return html.replace(re, '')
}

// ---------------------------------------------------------------------------
// Video embed extraction — replaces YouTube iframes and native <video> players
// with clean text markers BEFORE pandoc sees them.
// Must run on the raw HTML (before extractMain) so the poster image is also
// suppressed (not extracted by extractEmbeddedImages).
// ---------------------------------------------------------------------------

/**
 * Find the index of the n-th occurrence of `needle` at or after `fromIndex`.
 * Uses repeated indexOf for O(n) total scanning.
 */
function findMatchingClose(html, openTag, closeTag, startIdx) {
  let depth = 0
  let i = startIdx

  while (i < html.length) {
    const nextOpen = html.indexOf(openTag, i + 1)
    const nextClose = html.indexOf(closeTag, i + 1)
    if (nextClose === -1) return -1           // malformed HTML

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen
    } else {
      if (depth === 0) return nextClose + closeTag.length
      depth--
      i = nextClose
    }
  }
  return -1
}

/**
 * Replace YouTube <iframe srcdoc="..."> blocks and video.js <div class="video-js">
 * containers with simple text markers that postprocess() converts to markdown links.
 *
 * Markers produced:
 *   <p>YOUTUBE:https://www.youtube.com/watch?v=VIDEO_ID</p>
 *   <p>VIDEO-EMBED:filename.mp4|https://original-cdn-url.mp4|https://poster-url.jpg</p>
 *
 * When outputPath is provided, also extracts the video binary:
 *   1. Decodes base64 src="data:video/…;base64,…" and saves to videos/filename
 *   2. Falls back to downloading from the CDN URL via curl if base64 is absent/broken
 */
/**
 * Save a video file to videoDir.
 * Try 1: decode base64 from divContent.
 * Try 2: copy from local path (relative URL resolved against inputDir).
 * Try 3: curl download from absolute CDN URL.
 * Returns true if saved successfully.
 */
function sanitizeVideoFilename(raw) {
  let name = raw
  try { name = decodeURIComponent(name) } catch (_) { /* leave as-is if malformed */ }
  // Replace any char not safe in a filename with underscore
  name = name.replace(/[^A-Za-z0-9.\-_]/g, '_')
  // Collapse consecutive underscores
  name = name.replace(/_+/g, '_')
  // Trim underscores from base portion (preserve extension)
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const base = name.slice(0, dot).replace(/^_+|_+$/g, '')
    name = (base || 'video') + name.slice(dot)
  }
  return name
}

// ---------------------------------------------------------------------------
// ELO Rise course video resolver
//
// The streamed lesson videos (assets/NAME.mp4) are NOT in the saved HTML and
// their real on-server filename differs from the reference in the page. They
// live in the Rise SCORM package on community.elo.com. To download one we must:
//   1. Read the course launch URL from the HTML:  …/course/(PKG)/(SCO)/
//   2. Follow its 303 redirect to learn the real content GUID:
//        …/content/(PKG)/(REAL-SCO)/scormdriver/indexAPI.html
//   3. Fetch  …/content/(PKG)/(REAL-SCO)/scormcontent/index.html , which embeds
//      the course data as base64 JSON inside  deserialize("…") .
//   4. From that JSON, every {type:"video"} entry maps originalUrl → key, where
//      `key` is the actual filename under  scormcontent/assets/ .
//
// The whole ELO_25 export is a single Rise package shared by all lessons, so we
// resolve the content base + video manifest, cached per course launch URL.
// A collection folder may contain files from multiple Rise courses (different
// GUIDs), so we cache per-URL rather than globally.
// ---------------------------------------------------------------------------

// Map<launchUrl, { contentBase, manifest }>
const eloResolvedCache = new Map()

// Active values for the file currently being processed (set by ensureEloResolved)
let eloContentBase = null      // 'https://…/scormcontent'  (null until resolved)
let eloVideoManifest = null    // [{ base: decoded-name-without-ext, key }]

function curlWithAuth(args) {
  const cookieArg = eloCookie ? `-H "Cookie: ${eloCookie.replace(/"/g, '\\"')}" ` : ''
  return execSync(`curl --silent --show-error --max-time 60 ${cookieArg}${args}`,
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
}

/** Build the course launch URL (…/course/(PKG)/(SCO)/) from the lesson HTML. */
function extractCourseLaunchUrl(html) {
  const m = /de\.elo\.sol\.learning\.wbt\/course\/(\([^)]+\))\/(\([^)]+\))/.exec(html)
  if (!m) return ''
  return 'https://community.elo.com/community/plugin/de.elo.ix.plugin.rest/' +
    `de.elo.sol.learning.wbt/course/${m[1]}/${m[2]}/?ticket=de.elo.ix.client.ticket_from_cookie`
}

/** Follow the launch redirect to derive the real scormcontent base URL. */
function resolveEloContentBase(launchUrl) {
  try {
    // Dump response headers (no -L) and read the 303 Location, which points to
    // …/content/(PKG)/(REAL-SCO)/scormdriver/indexAPI.html
    const headers = curlWithAuth(`-o /dev/null -D - "${launchUrl}"`)
    const loc = /^location:\s*(\S+)/im.exec(headers)
    if (!loc) return ''
    const m = /(https:\/\/.*\/content\/\([^)]+\)\/\([^)]+\))\/scormdriver/.exec(loc[1])
    return m ? `${m[1]}/scormcontent` : ''
  } catch (e) {
    console.warn(`  ⚠ could not resolve ELO content base: ${e.message}`)
    return ''
  }
}

/** Fetch + parse the course index.html into a video manifest [{base, key}]. */
function loadEloVideoManifest(contentBase) {
  try {
    const index = curlWithAuth(`"${contentBase}/index.html"`)
    const m = /deserialize\("([A-Za-z0-9+/=]+)"\)/.exec(index)
    if (!m) return []
    const data = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'))
    const videos = []
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return }
      if (o && typeof o === 'object') {
        if (o.type === 'video' && o.key) {
          let base = o.key
          try { base = decodeURIComponent(o.key) } catch (_) { }
          base = base.replace(/\.[^.]+$/, '')   // strip extension
          videos.push({ base, key: o.key })
        }
        Object.values(o).forEach(walk)
      }
    }
    walk(data)
    return videos
  } catch (e) {
    console.warn(`  ⚠ could not load ELO video manifest: ${e.message}`)
    return []
  }
}

/** Resolve content base + manifest per course GUID (cached per launch URL). */
function ensureEloResolved(html) {
  // Reset active values for each file — they will be set below if resolved.
  eloContentBase = null
  eloVideoManifest = null
  if (!eloCookie) return
  const launchUrl = extractCourseLaunchUrl(html)
  if (!launchUrl) return

  // Return cached result for this course GUID without hitting the network again.
  if (eloResolvedCache.has(launchUrl)) {
    const cached = eloResolvedCache.get(launchUrl)
    eloContentBase = cached.contentBase
    eloVideoManifest = cached.manifest
    return
  }

  eloContentBase = resolveEloContentBase(launchUrl)
  if (eloContentBase) {
    eloVideoManifest = loadEloVideoManifest(eloContentBase)
    if (eloVideoManifest.length) {
      console.log(`  → ELO course resolved: ${eloVideoManifest.length} videos available for download`)
    }
  }
  // Cache so subsequent files from the same course skip the network round-trip.
  eloResolvedCache.set(launchUrl, { contentBase: eloContentBase, manifest: eloVideoManifest })
}

/**
 * Map a referenced video filename (e.g. "ELO 25 Tipps & Hinweise - Fazit-.mp4")
 * to its absolute download URL using the cached manifest. The manifest `key` is
 * truncated, so match the entry whose decoded base is the longest prefix of the
 * requested (decoded) name. Returns '' if no match.
 */
function resolveEloVideoUrl(relUrl) {
  if (!eloContentBase || !eloVideoManifest || !eloVideoManifest.length) return ''
  let reqBase = relUrl.replace(/\?.*$/, '').split('/').pop()
  try { reqBase = decodeURIComponent(reqBase) } catch (_) { }
  reqBase = reqBase.replace(/\.[^.]+$/, '')
  let best = null
  for (const e of eloVideoManifest) {
    if (reqBase.startsWith(e.base) && (!best || e.base.length > best.base.length)) best = e
  }
  return best ? `${eloContentBase}/assets/${best.key}` : ''
}

/**
 * Download a video over HTTP with the ELO session cookie. Verifies the response
 * is actually a video (curl HTTP 2xx + non-trivial size), removing any partial
 * file (e.g. a 401 HTML error page) on failure. Returns true on success.
 */
function downloadVideoWithAuth(absUrl, videoPath, filename) {
  mkdirSync(dirname(videoPath), { recursive: true })
  const cookieArg = eloCookie ? `-H "Cookie: ${eloCookie.replace(/"/g, '\\"')}" ` : ''
  try {
    const httpCode = execSync(
      `curl -L --silent --show-error --max-time 300 ${cookieArg}-w "%{http_code}" -o "${videoPath}" "${absUrl}"`,
      { encoding: 'utf-8' }
    ).trim()
    const size = existsSync(videoPath) ? statSync(videoPath).size : 0
    if (httpCode.startsWith('2') && size > 1024) {
      console.log(`  → video downloaded: ${filename} (${(size / 1024 / 1024).toFixed(1)} MB)`)
      return true
    }
    // Failure: remove the partial/error-page file so it isn't referenced as a video
    try { if (existsSync(videoPath)) execSync(`rm -f "${videoPath}"`) } catch (_) { }
    if (httpCode === '401' || httpCode === '403') {
      console.warn(`  ⚠ video download unauthorized (HTTP ${httpCode}): ${filename}` +
        (eloCookie ? ' — cookie may be expired' : ' — set ELO_COOKIE or elo-auth.json'))
    } else {
      console.warn(`  ⚠ video download failed (HTTP ${httpCode}, ${size} bytes): ${filename}`)
    }
  } catch (e) {
    try { if (existsSync(videoPath)) execSync(`rm -f "${videoPath}"`) } catch (_) { }
    console.warn(`  ⚠ video download error: ${e.message}`)
  }
  return false
}

function saveVideoFile(filename, url, divContent, videoDir, inputDir = null) {
  const videoPath = join(videoDir, filename)
  if (existsSync(videoPath)) return true   // already saved

  // Try 1: decode base64 src="data:video/…;base64,…"
  const b64Match = /\bsrc=(?:["']|&(?:amp;(?:amp;)?)?quot;)data:video\/[^;]+;base64,([A-Za-z0-9+/=\s]+)(?:["']|&(?:amp;(?:amp;)?)?quot;)/.exec(divContent)
  if (b64Match) {
    try {
      const b64 = b64Match[1].replace(/\s/g, '')
      mkdirSync(videoDir, { recursive: true })
      const buf = Buffer.from(b64, 'base64')
      writeFileSync(videoPath, buf)
      console.log(`  → video (base64): ${filename} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
      return true
    } catch (e) {
      console.warn(`  ⚠ video base64 extraction failed: ${e.message}`)
    }
  }

  // Try 2: copy from local filesystem when URL is relative
  if (url && inputDir && !/^https?:\/\//i.test(url)) {
    const localRel = decodeURIComponent(url.replace(/\?.*$/, ''))
    const localPath = join(inputDir, localRel)
    if (existsSync(localPath)) {
      try {
        mkdirSync(videoDir, { recursive: true })
        copyFileSync(localPath, videoPath)
        console.log(`  → video (local copy): ${filename}`)
        return true
      } catch (e) {
        console.warn(`  ⚠ video local copy failed: ${e.message}`)
      }
    }
  }

  // Try 3: download via curl (with ELO auth cookie).
  //   - absolute URL → download directly
  //   - relative assets/NAME.mp4 → map to the real scormcontent asset via the
  //     course video manifest (handles the truncated/renamed server filename)
  let absUrl = ''
  if (url && /^https?:\/\//i.test(url)) {
    absUrl = url
  } else if (url) {
    absUrl = resolveEloVideoUrl(url)
  }
  if (absUrl) {
    if (downloadVideoWithAuth(absUrl, videoPath, filename)) return true
  }

  console.warn(`  ⚠ video not saved: ${filename}`)
  return false
}

/**
 * Replace video embeds with markers and collect video metadata.
 *
 * videoDir: folder where video files are saved (e.g. <inputDir>/videos/).
 *           Pass null to skip file extraction.
 *
 * Returns { result: string, videos: Array<{filename, cdnUrl, posterUrl}> }
 *
 * Markers produced:
 *   <p>YOUTUBE:https://…</p>
 *   <p>VIDEO-EMBED:filename.mp4|https://cdn-url|https://poster-url.jpg</p>
 *
 * Handles three cases:
 *   1. YouTube iframes
 *   2. Original vjs_video_ div (HTML not yet patched)
 *   3. Already-patched vjs-video-patched div (HTML patched by a previous run)
 */
function markVideoEmbeds(html, videoDir = null, inputDir = null) {
  let result = html
  const videos = []                    // [{filename, cdnUrl, posterUrl}]
  const seenFilenames = new Set()
  // Resolve the ELO course content base + video manifest once (cached across files)
  ensureEloResolved(html)

  // ── 1. YouTube: <iframe ...> whose content contains youtube.com/embed/VIDEO_ID
  {
    const YT_SEARCH_LIMIT = 150_000
    let pos = 0
    while (true) {
      const iframeStart = result.indexOf('<iframe', pos)
      if (iframeStart === -1) break
      const searchWindow = result.slice(iframeStart, iframeStart + YT_SEARCH_LIMIT)
      const ytMatch = /youtube\.com\/embed\/([A-Za-z0-9_-]+)/.exec(searchWindow)
      if (ytMatch) {
        const iframeEnd = findMatchingClose(result, '<iframe', '</iframe>', iframeStart)
        if (iframeEnd === -1) { pos = iframeStart + 7; continue }
        const watchUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`
        const marker = `<p>YOUTUBE:${watchUrl}</p>`
        result = result.slice(0, iframeStart) + marker + result.slice(iframeEnd)
        pos = iframeStart + marker.length
      } else {
        pos = iframeStart + 7
      }
    }
  }

  // ── 2. Original vjs_video_ divs (HTML not yet patched)
  //    Strategy: find data-savepage-src first (avoids scanning large base64 blobs),
  //    then look backward for the enclosing vjs container div.
  {
    const srcRe = /data-savepage-src=(?:&amp;amp;quot;|&amp;quot;|&quot;|")([^"&]+\.(?:mp4|webm|ogg|mov|avi)(?:\?[^"&]*)?)[&"]/gi
    const VJS_PREFIXES = ['<div id=&amp;amp;quot;vjs_video_', '<div id=&amp;quot;vjs_video_', '<div id=&quot;vjs_video_', '<div id="vjs_video_']

    const byFilename = new Map()   // filename → { pos, url }
    let m
    while ((m = srcRe.exec(result)) !== null) {
      const url = m[1]
      const filename = sanitizeVideoFilename(url.replace(/\?.*$/, '').split('/').pop())
      if (!byFilename.has(filename)) byFilename.set(filename, { pos: m.index, url })
    }

    const replacements = []
    const usedDivStarts = new Set()

    for (const [filename, { pos: srcPos, url }] of byFilename) {
      const before = result.slice(0, srcPos)
      let divStart = -1
      for (const prefix of VJS_PREFIXES) {
        const idx = before.lastIndexOf(prefix)
        if (idx > divStart) divStart = idx
      }
      if (divStart === -1 || usedDivStarts.has(divStart)) continue
      usedDivStarts.add(divStart)

      // Poster CDN URL is on the outer div's  poster="https://…"  attribute
      const divOpening = result.slice(divStart, divStart + 2000)
      const posterMatch = /\bposter="(https?:\/\/[^"]+)"/.exec(divOpening)
      const posterUrl = posterMatch ? posterMatch[1] : ''

      replacements.push({ divStart, filename, url, posterUrl })
    }

    replacements.sort((a, b) => b.divStart - a.divStart)
    for (const { divStart, filename, url, posterUrl } of replacements) {
      const divEnd = findMatchingClose(result, '<div', '</div>', divStart)
      if (divEnd === -1) continue

      if (videoDir) saveVideoFile(filename, url, result.slice(divStart, divEnd), videoDir, inputDir)

      const cdnUrlClean = url.replace(/\?.*$/, '')
      if (!seenFilenames.has(filename)) {
        seenFilenames.add(filename)
        videos.push({ filename, cdnUrl: cdnUrlClean, posterUrl })
      }
      const marker = `<p>VIDEO-EMBED:${filename}|${cdnUrlClean}|${posterUrl}</p>`
      result = result.slice(0, divStart) + marker + result.slice(divEnd)
    }
  }

  // ── 3. Already-patched vjs-video-patched divs (HTML patched by a previous run)
  //    Extract CDN URL and poster URL from the injected <a href> / <img src>.
  {
    const replacements = []
    let searchPos = 0
    while (true) {
      const markerPos = result.indexOf('class="vjs-video-patched"', searchPos)
      if (markerPos === -1) break
      const divStart = result.lastIndexOf('<div', markerPos)
      if (divStart === -1) { searchPos = markerPos + 1; continue }

      const window2k = result.slice(divStart, divStart + 2000)
      // Accept both absolute (https://) and relative URLs
      const hrefMatch = /\bhref="([^"]+\.(?:mp4|webm|ogg|mov|avi)[^"]*)"/.exec(window2k)
      const imgMatch = /\bimg src="(https?:\/\/[^"]+)"/.exec(window2k)
      if (!hrefMatch) { searchPos = markerPos + 1; continue }

      const cdnUrl = hrefMatch[1]
      const posterUrl = imgMatch ? imgMatch[1] : ''
      const filename = sanitizeVideoFilename(cdnUrl.replace(/\?.*$/, '').split('/').pop())
      const divEnd = findMatchingClose(result, '<div', '</div>', divStart)
      if (divEnd === -1) { searchPos = markerPos + 1; continue }

      replacements.push({ divStart, divEnd, filename, cdnUrl, posterUrl })
      searchPos = divEnd
    }

    replacements.sort((a, b) => b.divStart - a.divStart)
    for (const { divStart, divEnd, filename, cdnUrl, posterUrl } of replacements) {
      if (videoDir) saveVideoFile(filename, cdnUrl, '', videoDir, inputDir)

      const cdnUrlClean2 = cdnUrl.replace(/\?.*$/, '')
      if (!seenFilenames.has(filename)) {
        seenFilenames.add(filename)
        videos.push({ filename, cdnUrl: cdnUrlClean2, posterUrl })
      }
      const marker = `<p>VIDEO-EMBED:${filename}|${cdnUrlClean2}|${posterUrl}</p>`
      result = result.slice(0, divStart) + marker + result.slice(divEnd)
    }
  }

  return { result, videos }
}

function preprocess(html) {
  let out = extractMain(html)
  // Strip noisy elements
  out = stripElements(out, 'svg')
  out = stripElements(out, 'script')
  out = stripElements(out, 'style')
  out = stripElements(out, 'nav')
  // Remove visually-hidden navigation text (lesson counter, "Continued")
  out = out.replace(/<[^>]+class="[^"]*visually-hidden[^"]*"[^>]*>.*?<\/[^>]+>/gs, '')
  // Remove copy-button arc elements
  out = out.replace(/<[^>]+arc-button[^>]*>[\s\S]*?<\/[^>]+>/g, '')
  return out
}

// ---------------------------------------------------------------------------
// Pandoc call
// ---------------------------------------------------------------------------

function runPandoc(htmlContent) {
  const tmpFile = join(tmpdir(), `html-to-md-${randomBytes(6).toString('hex')}.html`)
  writeFileSync(tmpFile, `<html><body>${htmlContent}</body></html>`, 'utf-8')
  try {
    const result = execSync(
      `pandoc "${tmpFile}" -f html -t markdown-raw_html+pipe_tables+fenced_code_blocks --wrap=none`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    )
    return result
  } finally {
    try { execSync(`rm -f "${tmpFile}"`) } catch (_) { }
  }
}

// ---------------------------------------------------------------------------
// Markdown post-processing
// ---------------------------------------------------------------------------

// Skip blank lines, ::: fenced-div markers, and bare <div>/<div ...> lines
function skipNoise(lines, startIdx) {
  let j = startIdx
  while (j < lines.length) {
    const t = lines[j].trim()
    if (t === '' || /^:::/.test(t) || /^<\/?div[^>]*>$/.test(t)) {
      j++
    } else {
      break
    }
  }
  return j
}

// Find the next "real" text line, skipping noise; return [index, trimmedText]
function nextMeaningful(lines, startIdx) {
  const j = skipNoise(lines, startIdx)
  return [j, j < lines.length ? lines[j].trim() : null]
}

// ---------------------------------------------------------------------------
// Emphasis (bold/italic) spacing fix
// ---------------------------------------------------------------------------

/**
 * Fix misplaced emphasis markers line by line:
 *  1. Word-boundary underscores → asterisks  (' _word' → ' *word', 'word_ ' → 'word* ')
 *  2. Space before closing marker + no space after → move space to after marker
 *     ('text **word' → 'text** word')  — applied up to 5 passes per line.
 * Skips headings, table rows, code-fence lines, and image lines.
 */
function fixEmphasis(text) {
  const hadTrailingNewline = text.endsWith('\n')

  // ── Pass 0: whole-text fixes (no per-line context needed)
  // Rendering artifact from HTML conversion: ***.*** → .
  text = text.replace(/\*\*\*\.\*\*\*/g, '.')
  // Remove trailing escaped asterisk: \* at end of line (pandoc artifact)
  text = text.replace(/\\\*\s*$/gm, '')
  // Strip italic markers adjacent to backticks: *` → `, `* → `
  text = text.replace(/\*(`)/g, '$1')
  text = text.replace(/(`)\*/g, '$1')
  // Remove standalone ** or *** lines (orphan markers on their own line)
  text = text.replace(/^\s*\*{2,}\s*$/gm, '')

  // ── Fix opening marker glued to previous word: 'word** Text' → 'word **Text'
  // Uses left-to-right state tracking to distinguish openers from closers.
  const fixGluedOpener = (ln) => {
    const parts = []
    let lastEnd = 0
    const markerRe = /(\*{1,3})/g
    let m
    while ((m = markerRe.exec(ln)) !== null) {
      parts.push({ text: ln.substring(lastEnd, m.index), type: 'text' })
      const charBefore = m.index > 0 ? ln[m.index - 1] : ''
      const charAfter = m.index + m[0].length < ln.length ? ln[m.index + m[0].length] : ''
      parts.push({
        text: m[0], type: 'marker', len: m[0].length,
        charBefore, charAfter
      })
      lastEnd = m.index + m[0].length
    }
    parts.push({ text: ln.substring(lastEnd), type: 'text' })

    const open = { 1: false, 2: false, 3: false }
    const fixed = []
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]
      if (part.type === 'text') { fixed.push(part.text); continue }
      const isWordBefore = /[A-Za-zÄÖÜäöüß0-9.,;:!?)]$/.test(part.charBefore)

      if (open[part.len]) {
        // Expect closer — accept it
        open[part.len] = false
        fixed.push(part.text)
      } else {
        // Expect opener
        if (isWordBefore && part.charAfter === ' ') {
          // Glued opener: word** space → word **
          open[part.len] = true
          fixed.push(' ' + part.text)
          // Consume the space after the marker
          if (pi + 1 < parts.length && parts[pi + 1].type === 'text' && parts[pi + 1].text.startsWith(' ')) {
            parts[pi + 1].text = parts[pi + 1].text.substring(1)
          }
        } else {
          // Normal opener or other — pass through, mark as open if followed by word char
          const isWordAfter = /^[A-Za-zÄÖÜäöüß0-9(]/.test(part.charAfter)
          if (isWordAfter || part.charAfter === '*') open[part.len] = true
          fixed.push(part.text)
        }
      }
    }
    return fixed.join('')
  }

  // ── Remove unmatched (orphan) emphasis markers using stack-based matching.
  // Decomposes *** into * + ** (or ** + *) when a shorter opener is on the stack.
  // Only pairs markers when the span between them contains word characters.
  const removeOrphanMarkers = (ln) => {
    const tokens = []
    let lastEnd = 0
    const re = /(\*{1,3})/g
    let m
    while ((m = re.exec(ln)) !== null) {
      if (m.index > lastEnd) tokens.push({ type: 'text', text: ln.substring(lastEnd, m.index) })
      tokens.push({ type: 'marker', text: m[0], len: m[0].length })
      lastEnd = m.index + m[0].length
    }
    if (lastEnd < ln.length) tokens.push({ type: 'text', text: ln.substring(lastEnd) })

    const openStack = []       // [{tokenIdx, len}]
    const matched = new Set()  // token indices that are matched (keep)
    const partialKeep = new Map() // tokenIdx → stars to keep (for split ***)

    const hasWordContent = (fromIdx, toIdx) => {
      for (let j = fromIdx + 1; j < toIdx; j++)
        if (tokens[j].type === 'text' && /[A-Za-zÄÖÜäöüß0-9]/.test(tokens[j].text)) return true
      return false
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.type !== 'marker') continue

      // 1. Try exact-length match from stack
      let exactIdx = -1
      for (let s = openStack.length - 1; s >= 0; s--)
        if (openStack[s].len === tok.len) { exactIdx = s; break }
      if (exactIdx >= 0 && hasWordContent(openStack[exactIdx].tokenIdx, i)) {
        matched.add(openStack[exactIdx].tokenIdx)
        matched.add(i)
        openStack.splice(exactIdx, 1)
        continue
      }

      // 2. Decomposition for *** (len 3) only
      if (tok.len === 3) {
        let found2 = -1, found1 = -1
        for (let s = openStack.length - 1; s >= 0; s--) {
          if (openStack[s].len === 2 && found2 < 0) found2 = s
          if (openStack[s].len === 1 && found1 < 0) found1 = s
        }
        if (found2 >= 0 && hasWordContent(openStack[found2].tokenIdx, i)) {
          matched.add(openStack[found2].tokenIdx); matched.add(i)
          partialKeep.set(i, 2) // keep ** (closer), * becomes new opener
          openStack.splice(found2, 1)
          openStack.push({ tokenIdx: i, len: 1 })
          continue
        }
        if (found1 >= 0 && hasWordContent(openStack[found1].tokenIdx, i)) {
          matched.add(openStack[found1].tokenIdx); matched.add(i)
          partialKeep.set(i, 1) // keep * (closer), ** becomes new opener
          openStack.splice(found1, 1)
          openStack.push({ tokenIdx: i, len: 2 })
          continue
        }
      }

      // 3. No match — push as new opener
      openStack.push({ tokenIdx: i, len: tok.len })
    }

    // Anything left on stack is orphan — remove
    if (openStack.length === 0) return ln
    const orphanSet = new Set(openStack.map(s => s.tokenIdx))
    const parts = []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.type === 'text') parts.push(tok.text)
      else if (orphanSet.has(i)) {
        if (partialKeep.has(i)) parts.push('*'.repeat(partialKeep.get(i)))
        // else: fully orphan → emit nothing
      } else parts.push(tok.text)
    }
    let result = parts.join('')
    result = result.replace(/  +/g, ' ').trimEnd()
    return result
  }

  const lines = text.split('\n')
  const result = []
  for (let line of lines) {
    const t = line.trim()
    // Skip lines without emphasis markers
    if (!t.includes('*') && !t.includes('_')) { result.push(line); continue }

    // Apply glued-opener + orphan fix to headings and tables (skip other fixes)
    if (/^#{1,6}\s/.test(t) || t.startsWith('|')) {
      line = fixGluedOpener(line)
      line = removeOrphanMarkers(line)
      result.push(line)
      continue
    }
    // Skip code fences and standalone images entirely
    if (t.startsWith('`') || t.startsWith('!')) {
      result.push(line); continue
    }

    // Fix bold/italic markers wrapping list dash: **- item text** → - **item text**
    line = line.replace(/^(\s*)(\*+)- (.+?)(\*+)$/, '$1- $2$3$4')
    // Convert word-boundary underscore italic to asterisk
    // ' _word' → ' *word'  and  'word_ ' → 'word* '
    line = line.replace(/([ (]|^)_([^\s_])/gm, '$1*$2')
    line = line.replace(/([^\s_])_([ ,.:;!?)\n]|$)/gm, '$1*$2')
    // Fix split bold/italic initial letter: ' **L**ightweight' → ' **L** ightweight'
    line = line.replace(/ (\*+)([A-Z])(\*+)([A-Za-z]+)/g, ' $1$2$3 $4')
    // Remove trailing space before closing asterisks at end of line: 'text **' → 'text**'
    line = line.replace(/ (\*{1,3})$/, '$1')

    // Fix opening marker glued to previous word (before closing-space fix)
    line = fixGluedOpener(line)

    // Fix closing marker with space before it and no space after → move space to after.
    // Uses backreference \2 and requires space/paren/line-start before opening marker to
    // avoid matching closing markers of previous spans as new openers:
    //   '**word **next' → '**word** next'
    // Applied iteratively to handle multiple spans on the same line.
    for (let i = 0; i < 5; i++) {
      const before = line
      line = line.replace(/(^|[ \t(])(\*{1,3})([^\n*]+) \2([^\s*\n])/gm, '$1$2$3$2 $4')
      if (line === before) break
    }

    // Remove orphan (unmatched) markers — must run last
    line = removeOrphanMarkers(line)

    result.push(line)
  }

  let output = result.join('\n')
  // Collapse 3+ consecutive blank lines (artifact from standalone ** removal)
  output = output.replace(/\n{3,}/g, '\n\n')
  // Preserve original trailing newline behavior
  if (!hadTrailingNewline) output = output.replace(/\n+$/, '')
  return output
}

function postprocess(md, inputPath = '', skipCleanup = false) {
  // ── Pre-pass: unescape pandoc-escaped chars in video/youtube marker lines.
  // Pandoc converts <p>VIDEO-EMBED:file_name|url|poster</p> to markdown and
  // escapes special chars: _ → \_, | → \|, ` → \`, * → \*, etc.
  // We must restore the raw marker before the regex below tries to parse it.
  md = md.replace(/^(?:VIDEO-EMBED|VIDEO-LOCAL|YOUTUBE):[^\n]+$/gm,
    line => line.replace(/\\([_|`*{}[\]()#+\-.!|\\])/g, '$1'))

  // ── Pre-pass: convert video markers injected by markVideoEmbeds()
  md = md.replace(/^YOUTUBE:(https?:\/\/\S+)$/gm,
    (_, url) => `[▶ YouTube Video](${url})`)
  md = md.replace(/^VIDEO-EMBED:([^\n]+?)[ \t]*\\?\|[ \t]*([^\n]+?)[ \t]*(?:\\?\|[ \t]*([^\n]*))?$/gm,
    (_, filename, url, posterUrl = '') => {
      // Clean pandoc artifacts from each part: unescape \x sequences, strip
      // backtick code-span wrapping (`url`), strip query string (?v=1 etc.)
      const cleanPart = s => s
        .replace(/\\([_|`*{}[\]()#+\-.!\\])/g, '$1')  // unescape \x
        .trim()
        .replace(/^`([\s\S]*?)`$/, '$1')               // strip `...` code span
        .trim()
        .replace(/\?[^)|\s]*$/, '')                    // strip query string
      const cleanFilename = cleanPart(filename)
      const cleanUrl = cleanPart(url)
      const cleanPoster = cleanPart(posterUrl || '')
      // Path in markdown: relative to source folder (ELO_25_Upgrade/).
      // build-from-html-folder.sh copies videos/ into html/videos/, so from
      // the source folder the correct path is ./html/videos/.
      const mdSrc = `./html/videos/${cleanFilename}`
      const displayName = cleanFilename.replace(/\.[^.]+$/, '')  // strip .mp4
      const posterAttr = cleanPoster ? ` poster="${cleanPoster}"` : ''
      return [
        `### ▶ ${displayName}`,
        ``,
        `<video controls style="max-width:100%;width:100%"${posterAttr}>`,
        `  <source src="${mdSrc}" type="video/mp4">`,
        `</video>`,
      ].join('\n')
    })
  // Legacy marker (pre-existing converted files without CDN url)
  md = md.replace(/^VIDEO-LOCAL:(\S+)$/gm,
    (_, filename) => {
      const displayName = filename.replace(/\.[^.]+$/, '')
      return [
        `### ▶ ${displayName}`,
        ``,
        `<video controls style="max-width:100%;width:100%">`,
        `  <source src="./html/videos/${filename}" type="video/mp4">`,
        `</video>`,
      ].join('\n')
    })

  // ── Pre-pass: strip code fence attributes  e.g.  ``` {.block-text__code ...}
  md = md.replace(/^(``` *)(\{[^}]*\})\s*$/mg, '$1')

  // ── Pre-pass: clean color/style spans  [text]{style="..."}  → text
  md = md.replace(/\[([^\]]+)\]\{style="[^"]*"\}/g, '$1')

  // ── Pre-pass: remove visually-hidden spans  [•]{.visually-hidden-always}
  md = md.replace(/\[[^\]]*\]\{[^}]*visually-hidden[^}]*\}/g, '')

  // ── Pre-pass: remove empty spans  []{...}  (must run before arc cleanup)
  md = md.replace(/\[\]\{[^}]*\}/g, '')

  // ── Pre-pass: remove copy-button artifacts  [[Copy]{element="text"}]
  md = md.replace(/\[\[[^\]]*\]\{[^}]*\}\]/g, '')
  // and arc-element attributes  {arc-...}
  md = md.replace(/\{arc-[^}]+\}/g, '')

  // ── Pre-pass: remove bare [] left over after attribute removal (not images)
  md = md.replace(/(?<!!)(\[\])(?!\()/g, '')

  // ── Pre-pass: clean link/image attrs  [text](url){.attrs}  →  [text](url)
  //    Handles URLs that contain parentheses (e.g. wiki links)
  md = md.replace(/(\[[^\]]*\]\([^()]*(?:\([^()]*\)[^()]*)*\))\{[^}]*\}/g, '$1')

  // ── Pre-pass: remove standalone attribute blocks {.class attr="value" ...}
  //    These are typically Pandoc attributes that appear alone on a line
  md = md.replace(/^\s*\{[^}]+\}\s*$/mg, '')

  // ── Pre-pass: convert escaped brackets patterns to code inline
  //    Pattern: \[text\].\[text\].\[text\] → `[text].[text].[text]`
  //    These are typically technical content (SQL table names, paths, etc.)
  md = md.replace(/(\\\[[^\]\\]+\\\](?:\.\\\[[^\]\\]+\\\])+)/g, (match) => {
    const unescaped = match.replace(/\\/g, '')
    return '`' + unescaped + '`'
  })

  // ── Pre-pass: convert Windows paths with escaped backslashes to code inline
  //    Pattern: C:\\path\\to\\file → `C:\path\to\file`
  md = md.replace(/\b([A-Z]:\\\\[^\s`]+)/g, (match) => {
    const unescaped = match.replace(/\\\\/g, '\\')
    return '`' + unescaped + '`'
  })

  // ── Pre-pass: replace non-breaking spaces first (needed before emphasis fix)
  md = md.replace(/\u00a0/g, ' ')

  // ── Pre-pass: collapse empty emphasis artifacts from whitespace-only HTML spans
  //    e.g. "**** *" → "*** ", "* *" → " "
  md = md.replace(/\*{4} \*/g, '*** ')    // bold+italic end + italic space
  md = md.replace(/\* \*{4}/g, ' ***')    // italic space + bold+italic start
  md = md.replace(/\*{3} \*{3}/g, ' ')
  md = md.replace(/\*{2} \*{2}/g, ' ')
  md = md.replace(/\* \*/g, ' ')

  const lines = md.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // ── Remove raw div wrappers
    if (/^<\/?div[^>]*>\s*$/.test(trimmed)) { i++; continue }

    // ── Remove ::: fenced-div markers (pandoc)
    if (/^:::/.test(trimmed)) { i++; continue }

    // ── Remove standalone Pandoc attribute blocks {.class attr="value" ...}
    if (/^\{[^}]+\}$/.test(trimmed)) { i++; continue }

    // ── Remove "Lesson N of M" navigation text
    if (/^Lesson \d+ of \d+$/.test(trimmed)) { i++; continue }

    // ── Remove "Continued" navigation text
    if (trimmed === 'Continued') { i++; continue }

    // ── Fix lesson title heading: "#  {#section .lesson-header__title ...}"
    //    The real title follows as the next meaningful line
    if (/^#{1,2}\s+\{#section/.test(trimmed)) {
      const [j, text] = nextMeaningful(lines, i + 1)
      if (text && !/^Lesson \d+/.test(text)) {
        out.push(`# ${text}`)
        i = j + 1
      } else {
        i++ // skip the malformed heading
      }
      continue
    }

    // ── Standalone section-number line (digit(s) left by stripped "Numbered divider" span)
    //    Merge with the following heading to produce  "## N. Heading text"
    if (/^\d+$/.test(trimmed)) {
      const [j, text] = nextMeaningful(lines, i + 1)
      if (text && /^#{1,6}\s*$/.test(text)) {
        // Empty heading follows — find the heading text after it
        const [k, headingText] = nextMeaningful(lines, j + 1)
        if (headingText && !/^#{1,6}/.test(headingText)) {
          out.push(`### ${trimmed}. ${headingText}`)
          i = k + 1
        } else {
          out.push(`### ${trimmed}.`)
          i = j + 1
        }
      } else if (text) {
        // No heading follows — just add a section break
        out.push(`---`)
        i++
      } else {
        i++
      }
      continue
    }

    // ── Clean empty headings (e.g. "### " alone) — grab text from next meaningful line
    if (/^#{1,6}\s*$/.test(trimmed)) {
      const hashes = trimmed.replace(/\s+$/, '')
      const [j, text] = nextMeaningful(lines, i + 1)
      if (text && !/^#{1,6}/.test(text)) {
        out.push(`${hashes} ${text}`)
        i = j + 1
      } else {
        i++ // nothing useful, drop the empty heading
      }
      continue
    }

    // ── Clean checkbox list items:  "-   ::: block-list__checkbox"
    if (/^(\s*-\s+):::.*block-list__checkbox/.test(line)) {
      const indent = (line.match(/^(\s*-\s+)/) || ['', '-   '])[1]
      i++ // skip the ::: checkbox line
      // Skip []{.block-list__checkbox__icon} line
      if (i < lines.length && /\[\]\{\.block-list__checkbox/.test(lines[i])) i++
      // Collect actual content lines (indented block under the list item)
      const contentLines = []
      while (i < lines.length) {
        const cur = lines[i]
        const ct = cur.trim()
        if (ct === '' && contentLines.length > 0) { i++; break }
        if (ct === '' || /^:::/.test(ct) || /^<\/?div/.test(ct)) { i++; continue }
        if (/^    /.test(cur) || contentLines.length > 0) {
          contentLines.push(ct)
          i++
        } else {
          break
        }
      }
      if (contentLines.length > 0) out.push(`${indent}${contentLines.join(' ')}`)
      continue
    }

    // ── Clean numbered list items:  "N.  ::: block-list__number"
    if (/^(\s*\d+\.\s+):::.*block-list__number/.test(line)) {
      const indent = (line.match(/^(\s*\d+\.\s+)/) || ['', '1. '])[1]
      i++ // skip the ::: line
      // Skip the bare number line (e.g. "    1")
      if (i < lines.length && /^\s+\d+\s*$/.test(lines[i])) i++
      // Collect actual content
      const contentLines = []
      while (i < lines.length) {
        const cur = lines[i]
        const ct = cur.trim()
        if (ct === '' && contentLines.length > 0) { i++; break }
        if (ct === '' || /^:::/.test(ct) || /^<\/?div/.test(ct)) { i++; continue }
        if (/^    /.test(cur) || contentLines.length > 0) {
          contentLines.push(ct)
          i++
        } else {
          break
        }
      }
      if (contentLines.length > 0) out.push(`${indent}${contentLines.join(' ')}`)
      continue
    }

    // ── Compact loose list items: bare "- " marker with content on next indented line
    //    This happens when visually-hidden bullets are stripped leaving an empty list marker
    const looseListMatch = line.match(/^(\s*[-*+]\s+)\s*$/)
    if (looseListMatch) {
      const [j, text] = nextMeaningful(lines, i + 1)
      if (text && lines[j] && /^    /.test(lines[j])) {
        out.push(`${looseListMatch[1].trimEnd()} ${text}`)
        i = j + 1
        continue
      }
    }

    // ── Emit the line (trimEnd only)
    out.push(line.trimEnd())
    i++
  }

  // ── Normalize consecutive blank lines (max 1)
  const normalized = []
  let blankCount = 0
  for (const line of out) {
    if (line === '') {
      if (++blankCount <= 1) normalized.push(line)
    } else {
      blankCount = 0
      normalized.push(line)
    }
  }

  // ── Convert fully-bold paragraphs to NOTE admonitions
  //    Matches a line that is entirely wrapped in **...** with no internal **
  //    e.g. "**Beachten Sie...**" → "> [!NOTE]\n> Beachten Sie..."
  let result = normalized.join('\n')

  // ── CRITICAL: Remove lines starting with +--- or +:=== BEFORE other processing
  result = result.split('\n').filter(line => {
    const trimmed = line.trim()
    return !trimmed.startsWith('+---') && !trimmed.startsWith('+:===')
  }).join('\n')

  // ── CRITICAL: Normalize lines with 4+ dashes to exactly ---
  result = result.split('\n').map(line => {
    const trimmed = line.trim()
    if (/^-{4,}$/.test(trimmed)) return '---'
    return line
  }).join('\n')

  // ── CRITICAL: Handle lines with 10+ consecutive spaces
  const criticalSpaceLines = result.split('\n')
  const criticalSpaceResult = []
  for (let i = 0; i < criticalSpaceLines.length; i++) {
    const line = criticalSpaceLines[i]

    // Skip if line already has pipe (already a table)
    if (line.includes('|')) {
      criticalSpaceResult.push(line)
      continue
    }

    // Match: text, 10+ spaces, text (allow leading spaces)
    const match = line.match(/^\s*([A-Za-z][^\s]*(?:\s+[^\s]+)*?)\s{10,}([A-Za-z].+)$/)
    if (match) {
      const next1 = i + 1 < criticalSpaceLines.length ? criticalSpaceLines[i + 1] : ''
      const next2 = i + 2 < criticalSpaceLines.length ? criticalSpaceLines[i + 2] : ''

      // Check if this looks like a table header (next lines have pipes)
      if (next1.includes('|') || next2.includes('|')) {
        // Convert to table header
        criticalSpaceResult.push('| ' + match[1].trim() + ' | ' + match[2].trim() + ' |')
      } else {
        // Just normalize spaces to single space (don't split)
        criticalSpaceResult.push(match[1].trim() + ' ' + match[2].trim())
      }
    } else {
      criticalSpaceResult.push(line)
    }
  }
  result = criticalSpaceResult.join('\n')

  result = result.replace(
    /^\*\*((?:[^*\n]|\*(?!\*))+)\*\*$/mg,
    (_, content) => `> [!NOTE]\n> ${content}`
  )

  // ── Convert **Hinweis:** paragraphs to TIP admonitions
  //    Matches bold "Hinweis:" at start of line, converts to > [!TIP]
  result = result.replace(
    /^\*\*Hinweis:\*\*\s*(.+?)$/mg,
    (_, content) => `> [!TIP]\n> ${content}`
  )

  // ── Convert Tipp: paragraphs to TIP admonitions
  //    Matches "Tipp:" at start of line (with or without bold)
  result = result.replace(
    /^(\*\*)?Tipp:(\*\*)?\s*(.+?)$/mg,
    (_, b1, b2, content) => `> [!TIP]\n> ${content}`
  )

  // ── Convert grid tables (with +---+ borders) to pipe tables
  //    MUST run AFTER critical cleanup
  result = convertGridTables(result)

  // ── Convert pandoc's simple dash tables to pipe tables
  result = convertDashTables(result)

  // ── Clean up lines with excessive indentation after tables
  //    These are table rows that didn't get converted properly
  const indentCleanLines = result.split('\n')
  const indentCleanResult = []
  for (let i = 0; i < indentCleanLines.length; i++) {
    const line = indentCleanLines[i]
    // Check if line starts with 10+ spaces and previous line was a table or empty after a table
    if (/^\s{10,}\S/.test(line)) {
      const prevLine = i > 0 ? indentCleanLines[i - 1] : ''
      // If previous line is empty or a table divider, this is likely a malformed table row
      if (prevLine.trim() === '' || /^[|\s-]+$/.test(prevLine)) {
        // Try to split by multiple spaces and format as table row
        const trimmed = line.trim()
        const cells = trimmed.split(/\s{5,}/).map(c => c.trim()).filter(c => c)
        if (cells.length >= 2) {
          indentCleanResult.push('| ' + cells.join(' | ') + ' |')
          continue
        }
      }
      // Otherwise, just remove excessive indentation
      indentCleanResult.push(line.replace(/^\s{10,}/, ''))
    } else {
      indentCleanResult.push(line)
    }
  }
  result = indentCleanResult.join('\n')

  // ── Normalize horizontal rules: 4+ dashes → exactly 3 dashes
  result = result.replace(/^-{4,}$/mg, '---')

  // ── Remove any remaining grid table border lines (+---+, +:===) and long dash lines
  //    These should already be converted, but this is a safety cleanup
  //    Matches lines like: +---+---+  or  +-----+-----+  or  +:===  or  ------...------
  result = result.split('\n').filter(line => {
    const trimmed = line.trim()
    return !/^\+[-+]+\+\s*$/.test(trimmed) &&
      !/^[-\s]{50,}$/.test(trimmed) &&
      !trimmed.startsWith('+:===')
  }).join('\n')

  // ── Fix tables missing separator row (| --- | --- |)
  const tableFix = result.split('\n')
  const tableFixResult = []
  let inTable = false
  let tableHasSeparator = false

  for (let i = 0; i < tableFix.length; i++) {
    const line = tableFix[i]
    const prevLine = i > 0 ? tableFix[i - 1] : ''
    const nextLine = i + 1 < tableFix.length ? tableFix[i + 1] : ''

    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|')
    const isSeparator = /^\|\s*-+\s*(\|\s*-+\s*)*\|$/.test(line.trim())
    const prevIsTable = prevLine.trim().startsWith('|')

    // Detect start of new table
    if (isTableRow && !prevIsTable) {
      inTable = true
      tableHasSeparator = false
    }

    // Detect end of table
    if (!isTableRow && inTable) {
      inTable = false
    }

    // Track if we've seen a separator in current table
    if (isSeparator && inTable) {
      tableHasSeparator = true
    }

    tableFixResult.push(line)

    // After first row of table (header), add separator if missing
    if (inTable && isTableRow && !isSeparator && !tableHasSeparator) {
      const nextIsTable = nextLine.trim().startsWith('|')
      const nextIsSeparator = /^\|\s*-+\s*/.test(nextLine.trim())

      // Add separator if:
      // 1. Next line is a table row but NOT a separator (multi-row table without separator)
      // 2. Next line is NOT a table row at all (single-row table)
      if ((nextIsTable && !nextIsSeparator) || !nextIsTable) {
        // Count columns
        const cols = line.split('|').slice(1, -1).length
        const separator = '| ' + Array(cols).fill('---').join(' | ') + ' |'
        tableFixResult.push(separator)
        tableHasSeparator = true
      }
    }
  }
  result = tableFixResult.join('\n')

  // ── Clean up multiple spaces around table separators |
  const cleanedLines = result.split('\n').map(line => {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Remove multiple spaces after |
      line = line.replace(/\|\s{2,}/g, '| ')
      // Remove multiple spaces before |
      line = line.replace(/\s{2,}\|/g, ' |')
    }
    return line
  })
  result = cleanedLines.join('\n')

  // ── Remove empty table rows (| | | |)
  result = result.split('\n').filter(line => {
    // Check if line is a table row with only empty cells
    if (/^\|.*\|$/.test(line.trim())) {
      // Remove all | and check if only whitespace remains
      const content = line.replace(/\|/g, '').trim()
      return content.length > 0 || /^-+$/.test(line.replace(/\|/g, '').trim()) // Keep separators
    }
    return true
  }).join('\n')

  // ── Remove bold from headings (### **Text** → ### Text)
  result = result.split('\n').map(line => {
    if (/^#{1,6}\s/.test(line)) {
      // Remove all ** or __ markers from heading
      line = line.replace(/\*\*/g, '')
      line = line.replace(/__/g, '')
    }
    return line
  }).join('\n')

  // ── Remove inline style attributes {style="..."}
  result = result.replace(/\{style="[^"]*"\}/g, '')

  // ── Add blank lines between paragraphs ending with period
  const paragraphLines = result.split('\n')
  const spacedLines = []
  for (let i = 0; i < paragraphLines.length; i++) {
    const line = paragraphLines[i]
    const nextLine = i + 1 < paragraphLines.length ? paragraphLines[i + 1] : ''

    spacedLines.push(line)

    // Check if current line ends with period and next line is not empty and also has content
    const currentEndsWithPeriod = line.trim().endsWith('.')
    const nextLineNotEmpty = nextLine.trim().length > 0
    const nextLineEndsWithPeriod = nextLine.trim().endsWith('.')
    const nextIsNotSpecial = !nextLine.trim().startsWith('#') &&
      !nextLine.trim().startsWith('-') &&
      !nextLine.trim().startsWith('*') &&
      !nextLine.trim().startsWith('>') &&
      !nextLine.trim().startsWith('|') &&
      !nextLine.trim().startsWith('```')

    // Add blank line if current ends with period, next is regular text that also ends with period
    if (currentEndsWithPeriod && nextLineNotEmpty && nextLineEndsWithPeriod && nextIsNotSpecial) {
      spacedLines.push('')
    }
  }
  result = spacedLines.join('\n')

  // ── Extend quotes that end with colon followed by blank line and text
  const quoteExtendLines = result.split('\n')
  const quoteExtended = []
  for (let i = 0; i < quoteExtendLines.length; i++) {
    const line = quoteExtendLines[i]
    const trimmed = line.trim()

    // Check if this is a quote line ending with colon
    if (trimmed.startsWith('>') && trimmed.endsWith(':')) {
      const nextLine = i + 1 < quoteExtendLines.length ? quoteExtendLines[i + 1] : ''
      const lineAfterNext = i + 2 < quoteExtendLines.length ? quoteExtendLines[i + 2] : ''

      // Check if next line is blank and line after that has text (not a heading, list, etc.)
      if (nextLine.trim() === '' &&
        lineAfterNext.trim() !== '' &&
        !lineAfterNext.trim().startsWith('>') &&
        !lineAfterNext.trim().startsWith('#') &&
        !lineAfterNext.trim().startsWith('-') &&
        !lineAfterNext.trim().startsWith('*') &&
        !lineAfterNext.trim().startsWith('|') &&
        !/^\d+\./.test(lineAfterNext.trim())) {
        // Add the quote line with colon
        quoteExtended.push(line)
        // Convert the blank line to quote continuation (just ">")
        quoteExtended.push('>')
        // Convert the text line to quote
        const indent = lineAfterNext.match(/^\s*/)[0]
        quoteExtended.push(indent + '> ' + lineAfterNext.trim())
        i += 2 // skip the next two lines as we've processed them
        continue
      }
    }

    quoteExtended.push(line)
  }
  result = quoteExtended.join('\n')

  // ── Split lines with 3+ spaces between words (if second word is capitalized and first doesn't end with period)
  result = result.split('\n').map(line => {
    // Skip if line is already a heading, table, list, or quote
    if (line.trim().startsWith('#') ||
      line.trim().startsWith('|') ||
      line.trim().startsWith('>') ||
      line.trim().startsWith('-') ||
      line.trim().startsWith('*') ||
      /^\d+\./.test(line.trim())) {
      return line
    }

    // Match pattern: word1 (no period at end) + 3+ spaces + Word2 (capitalized)
    const match = line.match(/^(.+[^.\s])\s{3,}([A-ZÄÖÜ].*)$/)
    if (match) {
      // Split into two lines with blank line between
      return `${match[1]}\n\n${match[2]}`
    }
    return line
  }).join('\n')

  // ── Final pass: convert short standalone lines without punctuation to h5
  const finalPassLines = result.split('\n')
  const finalLines = []
  let idx = 0

  while (idx < finalPassLines.length) {
    const line = finalPassLines[idx]
    const trimmed = line.trim()

    // Skip if empty or already a heading/list/etc
    if (!trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('!') ||
      /^```/.test(trimmed) ||
      /^---$/.test(trimmed) ||
      /^\d+\./.test(trimmed) ||
      /^\[.*\]\(/.test(trimmed)) {  // standalone markdown links — don't promote to heading
      finalLines.push(line)
      idx++
      continue
    }

    // Check if line could be converted to h5 (doesn't end with punctuation)
    if (!/[.!?]$/.test(trimmed)) {
      // Do NOT convert if line has 10+ consecutive spaces (likely table header that wasn't processed)
      if (/\s{10,}/.test(trimmed)) {
        finalLines.push(line)
        idx++
        continue
      }

      // Do NOT convert very long lines (likely regular paragraphs)
      if (trimmed.length > 120) {
        finalLines.push(line)
        idx++
        continue
      }

      // Look for consecutive group of potential heading lines
      const groupStart = idx
      const group = []
      let j = idx

      while (j < finalPassLines.length) {
        const currentLine = finalPassLines[j]
        const currentTrimmed = currentLine.trim()

        // Stop if empty or ends with punctuation or is special markup
        if (!currentTrimmed ||
          /[.!?]$/.test(currentTrimmed) ||
          currentTrimmed.startsWith('#') ||
          currentTrimmed.startsWith('-') ||
          currentTrimmed.startsWith('*') ||
          currentTrimmed.startsWith('>') ||
          currentTrimmed.startsWith('|') ||
          /^```/.test(currentTrimmed) ||
          /^---$/.test(currentTrimmed) ||
          /^\d+\./.test(currentTrimmed)) {
          break
        }

        // Stop if line has 10+ spaces or is too long
        if (/\s{10,}/.test(currentTrimmed) || currentTrimmed.length > 120) {
          break
        }

        group.push({ index: j, line: currentLine, trimmed: currentTrimmed })
        j++
      }

      // Check if this group should be converted
      if (group.length > 0) {
        // Get context: line before group and line after group
        const lineBeforeGroup = groupStart > 0 ? finalPassLines[groupStart - 1].trim() : ''
        const lineAfterGroup = j < finalPassLines.length ? finalPassLines[j].trim() : ''

        const hasBlankBefore = lineBeforeGroup === ''
        const hasBlankAfter = lineAfterGroup === ''
        const hasPeriodBefore = lineBeforeGroup.length > 0 && /\.$/.test(lineBeforeGroup)
        const hasPeriodAfter = lineAfterGroup.length > 0 && /\.$/.test(lineAfterGroup)

        // Convert group if it's "isolated" by blanks/periods in any combination
        const shouldConvertGroup =
          (hasBlankBefore && hasBlankAfter) ||
          (hasPeriodBefore && hasPeriodAfter) ||
          (hasBlankBefore && hasPeriodAfter) ||
          (hasPeriodBefore && hasBlankAfter)

        if (shouldConvertGroup) {
          // Convert all lines in the group to h5
          for (const item of group) {
            if (item.trimmed.length > 3) {
              finalLines.push(`##### ${item.trimmed}`)
            } else {
              finalLines.push(item.line)
            }
          }
          idx = j
          continue
        }
      }
    }

    finalLines.push(line)
    idx++
  }
  result = finalLines.join('\n')

  // ── Ensure blank lines around headings (h1-h5)
  const headingLines = result.split('\n')
  const headingSpaced = []
  for (let i = 0; i < headingLines.length; i++) {
    const line = headingLines[i]
    const prevLine = i > 0 ? headingLines[i - 1] : ''
    const nextLine = i + 1 < headingLines.length ? headingLines[i + 1] : ''
    const trimmed = line.trim()
    const isHeading = /^#{1,5}\s/.test(trimmed)

    // Add blank line before heading if previous line is not empty and not already blank
    if (isHeading && prevLine.trim().length > 0) {
      // Check if last added line was blank
      if (headingSpaced.length > 0 && headingSpaced[headingSpaced.length - 1].trim() !== '') {
        headingSpaced.push('')
      }
    }

    headingSpaced.push(line)

    // Add blank line after heading if next line exists and is not empty
    if (isHeading && nextLine.trim().length > 0) {
      headingSpaced.push('')
    }
  }
  result = headingSpaced.join('\n')

  // ── Convert isolated list items to checkboxes
  //    If a line starts with "- " and is NOT part of a multi-item list (isolated),
  //    convert it to "-  [ ] " for interactive checkboxes
  //    IMPORTANT: Ignores blank lines when determining isolation (items separated
  //    by blank lines are still considered part of the same list)
  const isolatedListLines = result.split('\n')
  const isolatedListResult = []

  // Helper: find previous non-empty line
  function findPrevNonEmpty(lines, startIdx) {
    for (let j = startIdx - 1; j >= 0; j--) {
      if (lines[j].trim() !== '') return lines[j].trim()
    }
    return ''
  }

  // Helper: find next non-empty line
  function findNextNonEmpty(lines, startIdx) {
    for (let j = startIdx + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '') return lines[j].trim()
    }
    return ''
  }

  for (let i = 0; i < isolatedListLines.length; i++) {
    const line = isolatedListLines[i]
    const trimmed = line.trim()

    // Check if this line is a list item (starts with "- ")
    const isListItem = /^-\s+/.test(trimmed)

    if (isListItem) {
      // Find previous and next non-empty lines (skipping blank lines)
      const prevNonEmpty = findPrevNonEmpty(isolatedListLines, i)
      const nextNonEmpty = findNextNonEmpty(isolatedListLines, i)

      // Check if previous non-empty line is also a list item
      const prevIsListItem = /^-\s+/.test(prevNonEmpty)
      // Check if next non-empty line is also a list item
      const nextIsListItem = /^-\s+/.test(nextNonEmpty)

      // If isolated (neither prev nor next non-empty lines are list items), convert to checkbox
      if (!prevIsListItem && !nextIsListItem) {
        // Preserve indentation: find where "- " starts and replace it with "-  [ ] "
        const match = line.match(/^(\s*)-\s+/)
        if (match) {
          const indent = match[1]
          const rest = line.slice(match[0].length)
          isolatedListResult.push(`${indent}-  [ ] ${rest}`)
          continue
        }
      }
    }

    isolatedListResult.push(line)
  }
  result = isolatedListResult.join('\n')

  // ── Fix emphasis marker spacing (bold/italic)
  result = fixEmphasis(result)

  if (!skipCleanup) {
    // ── Apply user-configured cleanup patterns from cleanup.json
    for (const { re, replacement } of cleanupPatterns) {
      re.lastIndex = 0   // reset stateful global regexes
      result = result.replace(re, replacement)
    }

    // ── Strip indentation from standalone image lines
    //    4+ leading spaces make CommonMark treat them as code blocks, not images.
    //    A standalone image line has only whitespace + ![...](...)  on that line.
    result = result.replace(/^[ \t]{1,}(!\[[^\]]*\]\([^)]+\))[ \t]*$/gm, '$1')

    // ── Normalize consecutive blank lines again after cleanup
    result = result.replace(/\n{4,}/g, '\n\n\n')
  }

  // ── Add web link at the beginning
  if (inputPath) {
    const filename = basename(inputPath, '.html')
    const webLink = `[🌐 View original web content](../Web/${filename}.html)\n\n---\n\n`
    result = webLink + result
  }

  // ── Remove lines with getCoverImage() — JS artifact, not content
  result = result.replace(/^[^\n]*'background-image'\s*:\s*getCoverImage\(\)[^\n]*\n?/gm, '')

  // ── Convert {{figure {url: "...", alt: "..."}}} to standard markdown image
  //    (.*?)"\}{2,} backtracks to find the last " before closing }}}
  //    Handles normal "alt" and double-quoted ""alt"" patterns
  result = result.replace(
    /\{\{figure \{url: "([^"]+)", alt: (.*?)"\}{2,}/g,
    (_, url, altRaw) => {
      const alt = altRaw.replace(/^["""']+|["""']+$/g, '').trim()
      return `![${alt}](${url})`
    }
  )

  // ── Fix doubled quotes in <img> tags
  //    =""+value"+ → ="value"  (extra leading/trailing quotes around non-empty values)
  //    Leaves ="" (legitimate empty attribute value) untouched.
  result = result.replace(/<img\b[^>]*>/g, tag =>
    tag
      .replace(/[""]/g, '')
      .replace(/\s*data-clickable="[^"]*"/g, '')
      .replace(/src="([^"\s]+)""+/g,   'src="$1"')
      .replace(/src=""+([^"\s]+)""+/g, 'src="$1"')
      .replace(/alt=""+([^"\s]+)""+/g, 'alt="$1"')
      .replace(/alt="([^"\s]+)""+/g,   'alt="$1"')
  )

  return result.trim() + '\n'
}

// ---------------------------------------------------------------------------
// Table conversion helpers
// ---------------------------------------------------------------------------

function convertGridTables(md) {
  // Grid tables: +---+ lines separate rows, cells can span multiple lines
  // Strategy: Find table blocks and parse row by row
  const lines = md.split('\n')
  const result = []
  let i = 0

  while (i < lines.length) {
    // Detect start of grid table
    if (/^\+[-+]+\+$/.test(lines[i])) {
      // Collect entire table block
      const tableStart = i
      i++ // skip first +---+ line

      const tableRows = []
      let currentCellLines = []

      while (i < lines.length) {
        const line = lines[i]

        if (/^\+[-+]+\+$/.test(line)) {
          // Row separator - finalize current row
          if (currentCellLines.length > 0) {
            tableRows.push(currentCellLines)
            currentCellLines = []
          }
          i++
          // Check if this is the last separator (next line is not | or +)
          if (i >= lines.length || (!lines[i].startsWith('|') && !lines[i].startsWith('+'))) {
            break
          }
        } else if (line.startsWith('|')) {
          currentCellLines.push(line)
          i++
        } else {
          // End of table
          break
        }
      }

      // Finalize last row if any
      if (currentCellLines.length > 0) {
        tableRows.push(currentCellLines)
      }

      // Convert to pipe table
      if (tableRows.length >= 1) {
        const parsedRows = []

        for (const rowLines of tableRows) {
          if (rowLines.length === 0) continue

          // Determine column count from first line
          const firstLine = rowLines[0]
          const numCols = (firstLine.match(/\|/g) || []).length - 1

          if (numCols === 0) continue

          // Initialize cells array
          const cells = Array(numCols).fill(null).map(() => [])

          // Accumulate text for each column across all lines in this row
          for (const rowLine of rowLines) {
            const parts = rowLine.split('|')
            // Remove first and last empty strings from split
            const cellParts = parts.slice(1, parts.length - 1)

            for (let col = 0; col < numCols; col++) {
              if (col < cellParts.length) {
                const text = cellParts[col].trim()
                if (text) cells[col].push(text)
              }
            }
          }

          // Join multi-line cell content with space
          parsedRows.push(cells.map(cellParts => cellParts.join(' ')))
        }

        if (parsedRows.length >= 1) {
          const header = parsedRows[0]
          const dataRows = parsedRows.slice(1)

          // Build pipe table
          result.push('| ' + header.join(' | ') + ' |')
          result.push('| ' + header.map(() => '---').join(' | ') + ' |')

          for (const row of dataRows) {
            // Ensure same column count
            while (row.length < header.length) row.push('')
            result.push('| ' + row.join(' | ') + ' |')
          }

          result.push('') // blank line after table
        }
      }
    } else {
      result.push(lines[i])
      i++
    }
  }

  return result.join('\n')
}

function convertDashTables(md) {
  // Pandoc simple tables: lines of dashes separating header/rows
  // Format:
  //   ---- ----
  //   Col1 Col2
  //   text text
  //   ---- ----

  const lines = md.split('\n')
  const output = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Check for a line that's mostly dashes and spaces (table separator)
    // Allow leading/trailing whitespace
    if (/^\s*-{4,}.*-{4,}\s*$/.test(line)) {
      // This might be a simple table
      const tableStart = i
      i++ // skip first dash line

      // Collect table rows until we hit another dash line or empty line
      const tableRows = []
      while (i < lines.length) {
        const rowLine = lines[i]
        if (/^\s*-{4,}.*-{4,}\s*$/.test(rowLine)) {
          // End of table (closing dash line)
          i++
          break
        }
        if (rowLine.trim() === '') {
          // Empty line might end table, but check if there's more
          if (i + 1 < lines.length && /^\s*-{4,}/.test(lines[i + 1])) {
            // Empty line before closing dash, include it
            i++
            continue
          }
          break
        }
        tableRows.push(rowLine)
        i++
      }

      if (tableRows.length >= 1) {
        // Try to parse as table
        // Split by multiple spaces (2+) but preserve leading/trailing space patterns
        const parsedRows = []

        for (const row of tableRows) {
          // Use 2+ spaces as delimiter
          const cells = row.split(/\s{2,}/).map(c => c.trim()).filter(c => c)
          if (cells.length > 0) parsedRows.push(cells)
        }

        if (parsedRows.length >= 1 && parsedRows[0].length >= 2) {
          // Valid table: first row is header
          const header = parsedRows[0]
          const dataRows = parsedRows.slice(1)

          output.push('| ' + header.join(' | ') + ' |')
          output.push('| ' + header.map(() => '---').join(' | ') + ' |')

          for (const row of dataRows) {
            while (row.length < header.length) row.push('')
            output.push('| ' + row.join(' | ') + ' |')
          }
          output.push('')
          continue
        }
      }

      // Not a valid table, backtrack and keep original lines
      i = tableStart + 1
      output.push(line)
    } else {
      output.push(line)
      i++
    }
  }

  return output.join('\n')
}

// ---------------------------------------------------------------------------
// Image extraction helpers
// ---------------------------------------------------------------------------

/** Map MIME subtype to a file extension */
function mimeExtToFileExt(mimeType) {
  const mt = mimeType.toLowerCase()
  const map = {
    'png': '.png', 'jpeg': '.jpg', 'jpg': '.jpg', 'gif': '.gif',
    'webp': '.webp', 'svg+xml': '.svg', 'bmp': '.bmp',
    'tiff': '.tiff', 'tif': '.tif', 'x-icon': '.ico',
    'vnd.microsoft.icon': '.ico'
  }
  return map[mt] || ('.' + mt.replace(/[^a-z0-9]/g, '').slice(0, 6))
}

/**
 * Extract base64-embedded images from the raw HTML before pandoc processing.
 * Finds all  src="data:image/TYPE;base64,DATA"  attributes, saves the decoded
 * bytes as real files in the output images folder, and replaces the src value
 * with a relative file path  ./images/<chapter>/<NNN>.ext  so that the rest of
 * the pipeline treats them like normal file-based images.
 *
 * Returns { html: modifiedHtml, count: N }  where N is the number of unique
 * images extracted (used to offset the counter in processImages).
 */
function extractEmbeddedImages(html, outputPath) {
  const outputDir = dirname(outputPath)
  const imgFolderName = basename(outputPath, '.md')
  const imgFolderPath = join(outputDir, 'images', imgFolderName)

  const seen = new Map()  // dedup key → relPath
  let counter = 1

  // Normalise double-encoded src=&amp;quot;data:image/...&amp;quot; → src=&quot;data:image/...&quot;
  // This form appears in Articulate Rise exports where the src attribute is doubly
  // entity-encoded (e.g. src=&amp;quot;data:image/png;base64,...&amp;quot;)
  const preNormalised = html.replace(
    /src=&amp;quot;(data:image\/[^&]+)&amp;quot;/gi,
    (_m, uri) => `src=&quot;${uri}&quot;`
  )

  // Normalise  src=&quot;data:image/...&quot;  →  src="data:image/..."
  // This form appears in some saved HTML files where the attribute value contains
  // entity-encoded quotes (e.g. src=&quot;data:image/png;base64,...&quot;)
  const normalised = preNormalised.replace(
    /src=&quot;(data:image\/[^&]+)&quot;/gi,
    (_m, uri) => `src="${uri}"`
  )

  // Matches both single- and double-quoted src="data:image/TYPE;base64,DATA"
  // Base64 chars are [A-Za-z0-9+/=] — never contain quotes, so [^"'] is safe.
  const modified = normalised.replace(
    /src=(["'])(data:image\/([^;]+);base64,([^"']+))\1/gi,
    (_match, quote, _dataUri, mimeType, b64raw) => {
      const b64 = b64raw.replace(/\s/g, '')  // strip embedded whitespace
      // Dedup key: total length + first 64 chars (fast approximation)
      const key = `${b64.length}:${b64.slice(0, 64)}`

      if (seen.has(key)) {
        return `src=${quote}${seen.get(key)}${quote}`
      }

      const ext = mimeExtToFileExt(mimeType)
      const newName = String(counter).padStart(3, '0') + ext
      const relPath = `./images/${imgFolderName}/${newName}`
      const absPath = join(imgFolderPath, newName)

      mkdirSync(imgFolderPath, { recursive: true })
      writeFileSync(absPath, Buffer.from(b64, 'base64'))

      seen.set(key, relPath)
      counter++
      return `src=${quote}${relPath}${quote}`
    }
  )

  const count = counter - 1
  if (count > 0) {
    console.log(`  → embedded images: ${count} extracted to ${imgFolderPath}/`)
  }
  return { html: modified, count }
}

// ---------------------------------------------------------------------------
// Image copying and renumbering (file-referenced images)
// ---------------------------------------------------------------------------

/**
 * Copy file-referenced images to the output images folder and renumber them.
 * startCounter should be embeddedCount + 1 so numbering is consecutive with
 * any images already extracted by extractEmbeddedImages.
 * Paths that already start with "./images/" were placed by extractEmbeddedImages
 * and are skipped (they're already in the right location with the right names).
 */
function processImages(md, inputPath, outputPath, startCounter = 1) {
  const inputDir = dirname(inputPath)
  const outputDir = dirname(outputPath)
  const imgFolderName = basename(outputPath, '.md')
  const imgFolderPath = join(outputDir, 'images', imgFolderName)

  // Collect all image references in document order (first occurrence assigns the number)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const seen = new Map() // originalPath → { srcPath, newRelPath, newName }
  let counter = startCounter

  let match
  while ((match = imgRegex.exec(md)) !== null) {
    const rawPath = match[2]  // as it appears in the markdown (may have %22 etc.)
    // Strip leading/trailing %22 (URL-encoded "), &quot; (HTML entity), or literal " '
    // that pandoc sometimes inserts when src had doubly-encoded attributes
    const imgPath = rawPath.replace(/^(?:%22|&quot;|["'])+|(?:%22|&quot;|["'])+$/g, '')
    // Skip external URLs and already-placed embedded images
    if (seen.has(rawPath) || /^https?:\/\//i.test(imgPath)) continue
    if (imgPath.startsWith('./images/') || imgPath.startsWith('data:')) continue
    const srcPath = resolve(inputDir, imgPath)
    const ext = extname(imgPath).toLowerCase() || '.png'
    const newName = String(counter).padStart(3, '0') + ext
    const newRelPath = `./images/${imgFolderName}/${newName}`
    seen.set(rawPath, { srcPath, newRelPath, newName })  // key = rawPath for md replacement
    counter++
  }

  if (seen.size === 0) return md

  // Create the images folder (images/<chapter-name>/)
  mkdirSync(imgFolderPath, { recursive: true })

  // Copy images with new names — track which ones succeeded and which are missing
  let copied = 0
  const copiedPaths = new Set()
  const missingPaths = new Set()
  for (const [rawPath, { srcPath, newRelPath, newName }] of seen) {
    const destPath = join(imgFolderPath, newName)
    try {
      copyFileSync(srcPath, destPath)
      copied++
      copiedPaths.add(rawPath)
    } catch (e) {
      if (e.code === 'ENOENT') {
        // Source image doesn't exist (lazy-loaded / not downloaded when page was saved).
        console.warn(`  Warning: image not found (skipped): ${srcPath}`)
        missingPaths.add(rawPath)
      } else {
        console.warn(`  Warning: could not copy ${srcPath}: ${e.message}`)
      }
    }
  }

  // Update markdown: replace paths for copied images, remove refs for missing ones
  let result = md
  for (const [oldPath, { newRelPath }] of seen) {
    const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (copiedPaths.has(oldPath)) {
      result = result.replace(new RegExp(`\\]\\(${escaped}\\)`, 'g'), `](${newRelPath})`)
    } else if (missingPaths.has(oldPath)) {
      // Remove the entire ![alt](path) image reference — file doesn't exist locally
      result = result.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '')
    }
  }

  if (copied > 0) console.log(`  → images: ${copied} copied to ${imgFolderPath}/`)
  return result
}

// ---------------------------------------------------------------------------
// Main conversion logic
// ---------------------------------------------------------------------------

/**
 * Convert a single HTML file to Markdown.
 * Videos are saved to <inputDir>/videos/ (same folder as the source HTML).
 * Returns { videos: Array<{filename, cdnUrl, posterUrl}> }
 */
function convertFile(inputPath, outputPath, rawOutputPath = null) {
  console.log(`Converting: ${inputPath}`)
  const html = readFileSync(inputPath, 'utf-8')
  // Videos are always saved alongside the source HTML, not the output markdown.
  const inputDir = dirname(inputPath)
  const videoDir = join(inputDir, 'videos')
  const { result: htmlNoVideo, videos } = markVideoEmbeds(html, videoDir, inputDir)
  // Extract base64-embedded images before pandoc so they become regular file refs
  const { html: htmlWithFileRefs, count: embeddedCount } = extractEmbeddedImages(htmlNoVideo, outputPath)
  const cleaned = preprocess(htmlWithFileRefs)
  const pandocRaw = runPandoc(cleaned)
  // Start file-image counter after the embedded images to keep numbering consecutive
  if (rawOutputPath) {
    const rawMd = processImages(postprocess(pandocRaw, inputPath, true), inputPath, outputPath, embeddedCount + 1)
    writeFileSync(rawOutputPath, rawMd, 'utf-8')
  }
  const md = processImages(postprocess(pandocRaw, inputPath), inputPath, outputPath, embeddedCount + 1)
  writeFileSync(outputPath, md, 'utf-8')
  console.log(`  → ${outputPath}`)
  return { videos }
}

// ---------------------------------------------------------------------------
// Export for use by other scripts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTML source patcher — fix broken video.js players for browser viewing
// ---------------------------------------------------------------------------

/**
 * Patch broken video.js players in a saved HTML page so they are viewable
 * directly in a browser without JavaScript/CDN dependencies.
 *
 * Replaces each  <div id="vjs_video_…">…</div>  with a simple clickable
 * poster image that opens the CDN video URL in a new tab:
 *
 *   <div class="vjs-video-patched" …>
 *     <a href="CDN_MP4_URL" target="_blank">
 *       <img src="POSTER_CDN_URL">
 *       <span>▶</span>           ← play-button overlay
 *     </a>
 *   </div>
 *
 * Idempotent: already-patched divs (class="vjs-video-patched") are skipped.
 * Returns the modified HTML string (does NOT write to disk).
 */
/** Build the patched video HTML block (shared by first-time patch and already-patched update) */
function buildPatchedVideoHtml(url, posterUrl) {
  const imgTag = posterUrl
    ? `<img src="${posterUrl}" alt="Video thumbnail" style="max-width:100%;display:block;width:100%;border-radius:4px">`
    : ''
  return [
    '<div class="vjs-video-patched" style="position:relative;display:inline-block;max-width:100%;width:100%;margin:1em 0">',
    `  <a href="${url}" target="_blank" rel="noopener noreferrer" title="Click to play video"`,
    '     style="display:block;position:relative;text-decoration:none">',
    `    ${imgTag}`,
    '    <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
    '                 background:rgba(0,0,0,0.65);color:#fff;border-radius:50%;',
    '                 width:72px;height:72px;display:flex;align-items:center;',
    '                 justify-content:center;font-size:32px;pointer-events:none;',
    '                 box-shadow:0 2px 8px rgba(0,0,0,0.5)">&#9654;</span>',
    '  </a>',
    `  <p style="margin:0.4em 0 0;text-align:center;font-size:0.85em">`,
    `    <a href="${url}" target="_blank" rel="noopener noreferrer">&#x2197; Open video in new window</a>`,
    '  </p>',
    '</div>',
  ].join('\n')
}

function patchHtmlVideoPlayers(html) {
  let result = html

  // ── Case A: Patch original vjs_video_ divs (first time)
  if (html.includes('id="vjs_video_') || html.includes('id=&quot;vjs_video_') || html.includes('id=&amp;quot;vjs_video_') || html.includes('id=&amp;amp;quot;vjs_video_')) {
    const srcRe = /data-savepage-src=(?:&amp;amp;quot;|&amp;quot;|&quot;|")([^"&]+\.(?:mp4|webm|ogg|mov|avi)(?:\?[^"&]*)?)[&"]/gi
    const VJS_PREFIXES = ['<div id=&amp;amp;quot;vjs_video_', '<div id=&amp;quot;vjs_video_', '<div id=&quot;vjs_video_', '<div id="vjs_video_']

    const byFilename = new Map()
    let m
    while ((m = srcRe.exec(result)) !== null) {
      const url = m[1]
      const filename = sanitizeVideoFilename(url.replace(/\?.*$/, '').split('/').pop())
      if (!byFilename.has(filename)) byFilename.set(filename, { pos: m.index, url })
    }

    const replacements = []
    const usedDivStarts = new Set()

    for (const [, { pos: srcPos, url }] of byFilename) {
      const before = result.slice(0, srcPos)
      let divStart = -1
      for (const prefix of VJS_PREFIXES) {
        const idx = before.lastIndexOf(prefix)
        if (idx > divStart) divStart = idx
      }
      if (divStart === -1 || usedDivStarts.has(divStart)) continue
      usedDivStarts.add(divStart)

      const divOpening = result.slice(divStart, divStart + 2000)
      const posterMatch = /\bposter="(https?:\/\/[^"]+)"/.exec(divOpening)
      const posterUrl = posterMatch ? posterMatch[1] : ''

      replacements.push({ divStart, url, posterUrl })
    }

    replacements.sort((a, b) => b.divStart - a.divStart)
    for (const { divStart, url, posterUrl } of replacements) {
      const divEnd = findMatchingClose(result, '<div', '</div>', divStart)
      if (divEnd === -1) continue
      result = result.slice(0, divStart) + buildPatchedVideoHtml(url, posterUrl) + result.slice(divEnd)
    }
  }

  // ── Case B: Update already-patched divs that are missing the "Open video" link
  if (result.includes('class="vjs-video-patched"') && !result.includes('Open video in new window')) {
    const replacements = []
    let searchPos = 0
    while (true) {
      const markerPos = result.indexOf('class="vjs-video-patched"', searchPos)
      if (markerPos === -1) break
      const divStart = result.lastIndexOf('<div', markerPos)
      if (divStart === -1) { searchPos = markerPos + 1; continue }

      const window2k = result.slice(divStart, divStart + 2000)
      const hrefMatch = /\bhref="(https?:\/\/[^"]+)"/.exec(window2k)
      const imgMatch = /\bimg src="(https?:\/\/[^"]+)"/.exec(window2k)
      if (!hrefMatch) { searchPos = markerPos + 1; continue }

      const divEnd = findMatchingClose(result, '<div', '</div>', divStart)
      if (divEnd === -1) { searchPos = markerPos + 1; continue }

      replacements.push({ divStart, divEnd, url: hrefMatch[1], posterUrl: imgMatch ? imgMatch[1] : '' })
      searchPos = divEnd
    }

    replacements.sort((a, b) => b.divStart - a.divStart)
    for (const { divStart, divEnd, url, posterUrl } of replacements) {
      result = result.slice(0, divStart) + buildPatchedVideoHtml(url, posterUrl) + result.slice(divEnd)
    }
  }

  return result
}

export { convertFile, patchHtmlVideoPlayers }

// ---------------------------------------------------------------------------
// CLI entry point (only runs when this file is executed directly)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`Usage:
  node html-to-md.mjs <input.html> [output.md]
  node html-to-md.mjs <input_dir/> [output_dir/]

Options:
  --help    Show this help

Examples:
  node html-to-md.mjs ../elo_academy/15.html 15.md
  node html-to-md.mjs ../elo_academy/ ./output/
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
  const outputArg = args[1] ? resolve(args[1]) : null
  const inputStat = statSync(inputArg)

  if (inputStat.isDirectory()) {
    // Batch mode: convert all .html files in the directory
    const htmlFiles = readdirSync(inputArg).filter(f => extname(f).toLowerCase() === '.html')
    if (htmlFiles.length === 0) {
      console.error(`No .html files found in ${inputArg}`)
      process.exit(1)
    }
    const outDir = outputArg || inputArg
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    for (const file of htmlFiles) {
      const inFile = join(inputArg, file)
      const outFile = join(outDir, basename(file, extname(file)) + '.md')
      convertFile(inFile, outFile)
    }
    console.log(`\nDone: converted ${htmlFiles.length} file(s).`)
  } else {
    // Single file mode
    const outFile = outputArg || join(dirname(inputArg), basename(inputArg, extname(inputArg)) + '.md')
    convertFile(inputArg, outFile)
    console.log('\nDone.')
  }
}