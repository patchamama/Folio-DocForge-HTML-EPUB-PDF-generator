#!/usr/bin/env node
/**
 * server.mjs — Interactive document converter
 * Usage:  node server.mjs
 * Opens:  http://localhost:7789/
 */
import http from 'node:http'
import fs   from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT      = 7789
const clients   = new Set()
let   activeJob   = null
let   planBuffer  = []   // replayed to SSE clients that connect after plan events fire
let   jobSnapshot = null // live task-status map for reconnecting clients

// ── SSE ───────────────────────────────────────────────────────────────────────
function broadcast(ev) {
  const msg = 'data: ' + JSON.stringify(ev) + '\n\n'
  for (const r of clients) r.write(msg)
  if (ev.type === 'task_plan') planBuffer.push(msg)
  if (jobSnapshot) {
    if (ev.type === 'task_start') jobSnapshot.tasks[ev.id] = { status: 'running', label: ev.label || '', folder: ev.folder || '' }
    if (ev.type === 'task_done')  { const t = jobSnapshot.tasks[ev.id]; if (t) t.status = 'done' }
    if (ev.type === 'task_fail')  { const t = jobSnapshot.tasks[ev.id]; if (t) t.status = 'failed' }
    if (ev.type === 'complete')   { jobSnapshot.complete = ev; jobSnapshot.active = false }
  }
}

// ── Directory browser ─────────────────────────────────────────────────────────
function browseDir(dirPath) {
  try {
    const real = path.resolve(dirPath)
    const raw  = fs.readdirSync(real, { withFileTypes: true })
    const dirs = [], files = []
    for (const e of raw) {
      if (e.name.startsWith('.')) continue
      const full = path.join(real, e.name)
      if (e.isDirectory()) {
        let htmlCount = 0, mdCount = 0
        try {
          for (const f of fs.readdirSync(full)) {
            if (f.endsWith('.html')) htmlCount++
            else if (f.endsWith('.md')) mdCount++
          }
        } catch {}
        dirs.push({ name: e.name, path: full, type: 'dir', htmlCount, mdCount })
      } else if (e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.html'))) {
        files.push({ name: e.name, path: full, type: 'file' })
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(real)
    return { ok: true, path: real, parent: parent !== real ? parent : null, dirs, files: files.slice(0, 20) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── Job helpers ───────────────────────────────────────────────────────────────
function countAssets(folderPath) {
  const imgExts = new Set(['.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp','.avif','.tiff'])
  const vidExts = new Set(['.mp4','.webm','.ogg','.mov','.avi','.mkv','.m4v'])
  let images = 0, videos = 0
  for (const sub of ['images', 'videos', '.']) {
    const dir = sub === '.' ? folderPath : path.join(folderPath, sub)
    try {
      for (const f of fs.readdirSync(dir)) {
        const ext = path.extname(f).toLowerCase()
        if (imgExts.has(ext)) images++
        else if (vidExts.has(ext)) videos++
      }
    } catch {}
  }
  return { images, videos }
}

function plan(phaseId, icon, label, id, taskLabel, folderPath = '', stats = null) {
  broadcast({ type: 'task_plan', phase_id: phaseId, phase_icon: icon, phase_label: label, id, label: taskLabel, phase_path: folderPath, phase_stats: stats })
}

function runStep(cmd, args, cwd, id, label, folder = '') {
  return new Promise((resolve, reject) => {
    broadcast({ type: 'task_start', id, label, folder })
    const p = spawn(cmd, args, { cwd, shell: false })
    const fwd = (d, level) => {
      for (const line of d.toString().split('\n'))
        if (line.trim()) broadcast({ type: 'log', message: line.trim(), level, task: label, folder })
    }
    p.stdout.on('data', d => fwd(d))
    p.stderr.on('data', d => fwd(d, 'warn'))
    p.on('close', code => {
      if (code === 0) { broadcast({ type: 'task_done', id, label }); resolve() }
      else            { broadcast({ type: 'task_fail', id, label, detail: 'Exit ' + code }); reject(new Error(cmd + ' exit ' + code)) }
    })
    p.on('error', err => { broadcast({ type: 'task_fail', id, label, detail: err.message }); reject(err) })
  })
}

async function cpDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  await new Promise((res, rej) => {
    const p = spawn('cp', ['-r', src + '/.', dst + '/'], { shell: false })
    p.on('close', c => c === 0 ? res() : rej(new Error('cp failed ' + c)))
    p.on('error', rej)
  })
}

// ── Conversion pipeline ───────────────────────────────────────────────────────

function hasHtml(dir) {
  try { return fs.readdirSync(dir).some(f => f.endsWith('.html')) } catch { return false }
}

function getHtmlSubdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !['_READY', '_stage'].includes(e.name))
      .map(e => path.join(dir, e.name))
      .filter(d => hasHtml(d))
      .sort()
  } catch { return [] }
}

function sanitizeName(name) {
  return name.replace(/[ ()[\]{}!@#$%^&*+=]/g, '_').replace(/_+/g, '_').replace(/_$/, '').slice(0, 40)
}

// Remove build artifacts but keep html/ejs.js to avoid expensive rollup rebuild
function softClean() {
  fs.rmSync(path.join(__dirname, 'converted'), { recursive: true, force: true })
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'html')))
      if (/^\d{2}_.*\.html$/.test(f) || f === 'index.html') fs.rmSync(path.join(__dirname, 'html', f))
  } catch {}
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'epub')))
      if (/^\d{2}_.*\.xhtml$/.test(f) || ['toc.xhtml', 'content.opf'].includes(f))
        fs.rmSync(path.join(__dirname, 'epub', f))
  } catch {}
  for (const f of ['book.epub', 'book.pdf', 'book.pandoc.pdf', 'book.pandoc.epub', 'book.html', 'links.md'])
    try { fs.rmSync(path.join(__dirname, f)) } catch {}
}

function planFolder(fid, flabel, outputs, epubMethods, pdfMethods, folderPath = '') {
  const ph = 'ph_' + fid, icon = '📁'
  const stats = folderPath ? countAssets(folderPath) : null
  plan(ph, icon, flabel, fid + '_assets',  'Copy images & videos', folderPath, stats)
  plan(ph, icon, flabel, fid + '_collect', 'HTML → Markdown',      folderPath)
  plan(ph, icon, flabel, fid + '_merge',   'Merge chapters',        folderPath)
  if (outputs.includes('html')) plan(ph, icon, flabel, fid + '_html', 'Render HTML', folderPath)
  if (outputs.includes('epub')) for (const m of epubMethods)
    plan(ph, icon, flabel, fid + '_epub_' + m, m === 'pandoc' ? 'EPUB (pandoc)' : 'EPUB (native)', folderPath)
  if (outputs.includes('pdf')) for (const m of pdfMethods)
    plan(ph, icon, flabel, fid + '_pdf_' + m, m === 'pandoc' ? 'PDF (pandoc)' : 'PDF (LaTeX)', folderPath)
  plan(ph, icon, flabel, fid + '_deploy', 'Deploy to READY', folderPath)
}

function planCombined(outputs, epubMethods, pdfMethods) {
  const ph = 'ph_combined', icon = '📚', label = 'Combined book'
  plan(ph, icon, label, 'cb_concat', 'Concatenate all chapters')
  plan(ph, icon, label, 'cb_assets', 'Merge all assets')
  if (outputs.includes('html')) plan(ph, icon, label, 'cb_html', 'Render HTML (full book)')
  if (outputs.includes('epub')) for (const m of epubMethods)
    plan(ph, icon, label, 'cb_epub_' + m, m === 'pandoc' ? 'EPUB (pandoc, full)' : 'EPUB (native, full)')
  if (outputs.includes('pdf')) for (const m of pdfMethods)
    plan(ph, icon, label, 'cb_pdf_' + m, m === 'pandoc' ? 'PDF (pandoc, full)' : 'PDF (LaTeX, full)')
  plan(ph, icon, label, 'cb_deploy', 'Deploy full book')
}

async function stageAssets(workDir) {
  for (const asset of ['images', 'videos']) {
    const src = path.join(workDir, asset)
    if (!fs.existsSync(src)) continue
    await cpDir(src, path.join(__dirname, 'html', asset))
    if (asset === 'images') {
      fs.mkdirSync(path.join(__dirname, 'epub', 'images'), { recursive: true })
      await cpDir(src, path.join(__dirname, 'epub', 'images'))
    }
  }
}

async function deployOutputs(readyDir, includeHtml) {
  fs.mkdirSync(readyDir, { recursive: true })
  for (const f of ['book.epub', 'book.pdf', 'book.pandoc.pdf', 'book.pandoc.epub', 'book.html']) {
    const src = path.join(__dirname, f)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(readyDir, f))
      broadcast({ type: 'log', message: '→ ' + f, level: 'ok' })
    }
  }
  if (includeHtml && fs.existsSync(path.join(__dirname, 'html')))
    await cpDir(path.join(__dirname, 'html'), path.join(readyDir, 'html'))
}

async function buildFolder(workDir, readyDir, fid, outputs, epubMethods, pdfMethods, lang) {
  const safeName   = sanitizeName(path.basename(workDir))
  const folderName = path.basename(workDir)

  broadcast({ type: 'log', message: '━━━ Building: ' + folderName, folder: folderName })

  broadcast({ type: 'task_start', id: fid + '_assets', label: 'Copy images & videos', folder: folderName })
  await stageAssets(workDir)
  broadcast({ type: 'task_done', id: fid + '_assets', label: 'Copy images & videos' })

  await runStep('node', ['_mdfromhtml/build-collection.mjs', workDir], __dirname, fid + '_collect', 'HTML → Markdown', folderName)
  await runStep('node', ['_mdfromhtml/merge-book.mjs', workDir,
    '--no-convert-emphasis', '--no-format-tables', '--toc-depth', '0'],
    __dirname, fid + '_merge', 'Merge chapters', folderName)

  const stagedMd = path.join(__dirname, '00_' + safeName + '.md')
  fs.copyFileSync(path.join(workDir, 'book_full.md'), stagedMd)
  softClean()

  try {
    if (outputs.includes('html'))
      await runStep('make', ['html', 'BOOK_LANG=' + lang], __dirname, fid + '_html', 'Render HTML', folderName)
    if (outputs.includes('epub'))
      for (const m of epubMethods) {
        const target = m === 'pandoc' ? 'book.pandoc.epub' : 'book.epub'
        await runStep('make', [target], __dirname, fid + '_epub_' + m, m === 'pandoc' ? 'EPUB (pandoc)' : 'EPUB (native)', folderName)
      }
    if (outputs.includes('pdf'))
      for (const m of pdfMethods) {
        const target = m === 'pandoc' ? 'pdf_pandoc' : 'book.pdf'
        await runStep('make', [target], __dirname, fid + '_pdf_' + m, m === 'pandoc' ? 'PDF (pandoc)' : 'PDF (LaTeX)', folderName)
      }

    broadcast({ type: 'task_start', id: fid + '_deploy', label: 'Deploy to READY', folder: folderName })
    await deployOutputs(readyDir, outputs.includes('html'))
    const mdReady = path.join(readyDir, 'markdown')
    fs.mkdirSync(mdReady, { recursive: true })
    for (const f of fs.readdirSync(workDir).filter(f => f.endsWith('.md')))
      try { fs.copyFileSync(path.join(workDir, f), path.join(mdReady, f)) } catch {}
    broadcast({ type: 'task_done', id: fid + '_deploy', label: 'Deploy to READY' })

  } finally {
    try { fs.unlinkSync(stagedMd) } catch {}
  }
}

async function buildCombined(workDirs, readyDir, outputs, epubMethods, pdfMethods, lang) {
  const CTX = 'combined'

  broadcast({ type: 'log', message: '━━━ Building combined full_book', folder: CTX })

  broadcast({ type: 'task_start', id: 'cb_concat', label: 'Concatenate all chapters', folder: CTX })
  let combined = ''
  for (const wd of workDirs) {
    const bf = path.join(wd, 'book_full.md')
    if (fs.existsSync(bf)) combined += fs.readFileSync(bf, 'utf8') + '\n\n'
  }
  const stagedMd = path.join(__dirname, '00_combined_full.md')
  fs.writeFileSync(stagedMd, combined)
  broadcast({ type: 'task_done', id: 'cb_concat', label: 'Concatenate all chapters' })

  softClean()

  broadcast({ type: 'task_start', id: 'cb_assets', label: 'Merge all assets', folder: CTX })
  for (const wd of workDirs) await stageAssets(wd)
  broadcast({ type: 'task_done', id: 'cb_assets', label: 'Merge all assets' })

  try {
    if (outputs.includes('html'))
      await runStep('make', ['html', 'BOOK_LANG=' + lang], __dirname, 'cb_html', 'Render HTML (full book)', CTX)
    if (outputs.includes('epub'))
      for (const m of epubMethods) {
        const target = m === 'pandoc' ? 'book.pandoc.epub' : 'book.epub'
        await runStep('make', [target], __dirname, 'cb_epub_' + m, m === 'pandoc' ? 'EPUB (pandoc, full)' : 'EPUB (native, full)', CTX)
      }
    if (outputs.includes('pdf'))
      for (const m of pdfMethods) {
        const target = m === 'pandoc' ? 'pdf_pandoc' : 'book.pdf'
        await runStep('make', [target], __dirname, 'cb_pdf_' + m, m === 'pandoc' ? 'PDF (pandoc, full)' : 'PDF (LaTeX, full)', CTX)
      }

    broadcast({ type: 'task_start', id: 'cb_deploy', label: 'Deploy full book', folder: CTX })
    await deployOutputs(readyDir, outputs.includes('html'))
    broadcast({ type: 'task_done', id: 'cb_deploy', label: 'Deploy full book' })

  } finally {
    try { fs.unlinkSync(stagedMd) } catch {}
  }
}

async function runConversion({ inputType, inputPath, outputPath, outputs, epubMethod, pdfMethod, lang }) {
  const bookLang    = lang || 'en'
  outputs           = outputs || ['html', 'epub', 'pdf']
  const epubMethods = Array.isArray(epubMethod) ? epubMethod : [epubMethod || 'native']
  const pdfMethods  = Array.isArray(pdfMethod)  ? pdfMethod  : [pdfMethod  || 'latex']

  planBuffer  = []  // new job — discard previous plan events
  jobSnapshot = { tasks: {}, startTs: Date.now(), active: true, complete: null }

  // Backup existing NN_*.md so make doesn't pick them up during conversion
  const existingMd = fs.readdirSync(__dirname).filter(f => /^\d{2}_/.test(f) && f.endsWith('.md'))
  const backups = {}
  for (const f of existingMd) {
    const bk = '_srv_bk_' + f
    try { fs.renameSync(path.join(__dirname, f), path.join(__dirname, bk)); backups[bk] = f } catch {}
  }

  try {
    if (inputType === 'html') {
      const subdirs     = getHtmlSubdirs(inputPath)
      const rootHasHtml = hasHtml(inputPath)
      const folderName  = path.basename(inputPath)

      if (subdirs.length > 0) {
        // Recursive mode: each subfolder built separately, then combined book
        const readyBase = outputPath || path.join(inputPath, '_READY', folderName)
        const allDirs   = []

        if (rootHasHtml) {
          const fid = sanitizeName(folderName)
          planFolder(fid, folderName, outputs, epubMethods, pdfMethods, inputPath)
          allDirs.push({ workDir: inputPath, readyDir: readyBase, fid })
        }
        for (const sub of subdirs) {
          const name = path.basename(sub)
          const fid  = sanitizeName(name)
          planFolder(fid, name, outputs, epubMethods, pdfMethods, sub)
          allDirs.push({ workDir: sub, readyDir: path.join(readyBase, sanitizeName(name)), fid })
        }
        planCombined(outputs, epubMethods, pdfMethods)

        const builtWorkDirs = []
        for (const { workDir, readyDir, fid } of allDirs) {
          await buildFolder(workDir, readyDir, fid, outputs, epubMethods, pdfMethods, bookLang)
          builtWorkDirs.push(workDir)
        }
        await buildCombined(builtWorkDirs, path.join(readyBase, '_combined'), outputs, epubMethods, pdfMethods, bookLang)
        broadcast({ type: 'complete', ready_dir: readyBase })

      } else {
        // Single folder mode
        const fid      = sanitizeName(folderName)
        const readyDir = outputPath || path.join(inputPath, '_READY')
        planFolder(fid, folderName, outputs, epubMethods, pdfMethods, inputPath)
        await buildFolder(inputPath, readyDir, fid, outputs, epubMethods, pdfMethods, bookLang)
        broadcast({ type: 'complete', ready_dir: readyDir })
      }

    } else {
      // MD mode: stage files, clean, build, collect
      const folderName = path.basename(inputPath)
      const readyDir   = outputPath || path.join(inputPath, '_READY')

      plan('ph1', '📝', 'Prepare Markdown', 'prep_md',   'Stage Markdown files')
      plan('ph2', '🏗️', 'Build',            'clean_bld', 'Reset build artifacts')
      if (outputs.includes('html')) plan('ph2', '🏗️', 'Build', 'bhtml', 'Render HTML')
      if (outputs.includes('epub')) for (const m of epubMethods)
        plan('ph2', '🏗️', 'Build', 'bepub_' + m, m === 'pandoc' ? 'EPUB (pandoc)' : 'EPUB (native)')
      if (outputs.includes('pdf')) for (const m of pdfMethods)
        plan('ph2', '🏗️', 'Build', 'bpdf_' + m,  m === 'pandoc' ? 'PDF (pandoc)'  : 'PDF (LaTeX)')
      plan('ph3', '📦', 'Results', 'collect', 'Collect outputs')

      const created = []
      broadcast({ type: 'task_start', id: 'prep_md', label: 'Stage Markdown files', folder: folderName })
      const mdFiles = fs.readdirSync(inputPath).filter(f => f.endsWith('.md')).sort()
      for (let i = 0; i < mdFiles.length; i++) {
        const f        = mdFiles[i]
        const destName = /^\d{2}_/.test(f) ? f : String(i).padStart(2, '0') + '_' + f
        const dest     = path.join(__dirname, destName)
        fs.copyFileSync(path.join(inputPath, f), dest)
        created.push(dest)
      }
      await stageAssets(inputPath)
      broadcast({ type: 'task_done', id: 'prep_md', label: 'Stage Markdown files' })

      try {
        broadcast({ type: 'task_start', id: 'clean_bld', label: 'Reset build artifacts', folder: folderName })
        softClean()
        broadcast({ type: 'task_done', id: 'clean_bld', label: 'Reset build artifacts' })

        if (outputs.includes('html'))
          await runStep('make', ['html', 'BOOK_LANG=' + bookLang], __dirname, 'bhtml', 'Render HTML', folderName)
        if (outputs.includes('epub'))
          for (const m of epubMethods) {
            const target = m === 'pandoc' ? 'book.pandoc.epub' : 'book.epub'
            await runStep('make', [target], __dirname, 'bepub_' + m, m === 'pandoc' ? 'EPUB (pandoc)' : 'EPUB (native)', folderName)
          }
        if (outputs.includes('pdf'))
          for (const m of pdfMethods) {
            const target = m === 'pandoc' ? 'pdf_pandoc' : 'book.pdf'
            await runStep('make', [target], __dirname, 'bpdf_' + m, m === 'pandoc' ? 'PDF (pandoc)' : 'PDF (LaTeX)', folderName)
          }

        broadcast({ type: 'task_start', id: 'collect', label: 'Collect outputs', folder: folderName })
        await deployOutputs(readyDir, outputs.includes('html'))
        broadcast({ type: 'task_done', id: 'collect', label: 'Collect outputs' })
        broadcast({ type: 'complete', ready_dir: readyDir })

      } finally {
        for (const f of created) try { fs.unlinkSync(f) } catch {}
      }
    }

  } catch (e) {
    broadcast({ type: 'log', message: 'Error: ' + e.message, level: 'error' })
    broadcast({ type: 'complete', ready_dir: '', error: e.message })
  } finally {
    for (const [bk, orig] of Object.entries(backups))
      try { fs.renameSync(path.join(__dirname, bk), path.join(__dirname, orig)) } catch {}
    activeJob = null
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((res, rej) => {
    let b = ''
    req.on('data', c => (b += c))
    req.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } })
    req.on('error', rej)
  })
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' })
    res.write(':ok\n\n')
    for (const msg of planBuffer) res.write(msg)  // replay missed plan events
    if (jobSnapshot) res.write('data: ' + JSON.stringify({ type: 'state_snapshot', snapshot: jobSnapshot }) + '\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/browse') {
    return json(res, browseDir(url.searchParams.get('path') || __dirname))
  }

  if (req.method === 'POST' && url.pathname === '/api/open-folder') {
    try {
      const { folderPath } = await parseBody(req)
      if (!folderPath) return json(res, { ok: false })
      const isWSL = !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)
      if (isWSL) {
        const native = folderPath.replace(/^\/mnt\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':\\').replace(/\//g, '\\')
        spawn('explorer.exe', [native], { detached: true, stdio: 'ignore' }).unref()
      } else if (process.platform === 'darwin') {
        spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref()
      }
      return json(res, { ok: true })
    } catch (e) { return json(res, { ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    try {
      const { inputType, inputPath } = await parseBody(req)
      if (!inputPath) return json(res, { ok: false }, 400)
      const result = { ok: true, inputType, subdirs: [], rootHasHtml: false, mdCount: 0 }
      if (inputType === 'html') {
        result.rootHasHtml = hasHtml(inputPath)
        result.subdirs = getHtmlSubdirs(inputPath).map(d => path.basename(d))
      } else {
        try { result.mdCount = fs.readdirSync(inputPath).filter(f => f.endsWith('.md')).length } catch {}
      }
      return json(res, result)
    } catch (e) { return json(res, { ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    if (activeJob) return json(res, { ok: false, error: 'Job already running' }, 409)
    try {
      const params = await parseBody(req)
      if (!params.inputPath) return json(res, { ok: false, error: 'inputPath required' }, 400)
      activeJob = true
      runConversion(params)
      return json(res, { ok: true })
    } catch (e) { return json(res, { ok: false, error: e.message }, 400) }
  }

  if (req.method === 'GET' && url.pathname === '/api/status')
    return json(res, { active: !!activeJob })

  if (req.method === 'GET' && url.pathname === '/api/state')
    return json(res, { snapshot: jobSnapshot })

  const NOTES_FILE = path.join(__dirname, '.notes.txt')

  if (req.method === 'GET' && url.pathname === '/api/notes') {
    try {
      const text = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8') : ''
      return json(res, { ok: true, text })
    } catch (e) { return json(res, { ok: false, error: e.message }) }
  }

  if (req.method === 'POST' && url.pathname === '/api/notes') {
    try {
      const { text } = await parseBody(req)
      fs.writeFileSync(NOTES_FILE, text ?? '', 'utf8')
      return json(res, { ok: true })
    } catch (e) { return json(res, { ok: false, error: e.message }) }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(HTML)
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/'
  process.stdout.write('\n\u{1F4DA} Document Converter → ' + url + '\n\n')
  try {
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      spawn('/mnt/c/Windows/System32/cmd.exe', ['/c', 'start', url], { detached: true, stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' })
    }
  } catch {}
})

// ── Frontend HTML ─────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Document Converter</title>
<link rel="icon" id="favicon" type="image/png">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d0f17;--surface:#13161f;--surface2:#1a1d29;
  --border:#252836;--border2:#2f3347;
  --text:#e2e8f0;--muted:#5a6482;--muted2:#8892a4;
  --accent:#6366f1;--accent2:#818cf8;
  --green:#10b981;--green2:#34d399;
  --red:#ef4444;--blue2:#60a5fa;--yellow:#f59e0b;
  --r:0.75rem;
}
html.light{
  --bg:#f0f3fa;--surface:#ffffff;--surface2:#f4f6fb;
  --border:#dde3f0;--border2:#c8d0e4;
  --text:#1a1f35;--muted:#8b95b8;--muted2:#636d90;
  --accent:#6366f1;--accent2:#4f46e5;
  --green:#059669;--green2:#10b981;
  --red:#dc2626;--blue2:#2563eb;--yellow:#d97706;
}
html{font-size:14px}
body{font-family:'Inter','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5}
.app{max-width:860px;margin:0 auto;padding:2rem 1.5rem 4rem}

/* Header */
.hdr{display:flex;align-items:center;gap:.75rem;margin-bottom:2rem}
.hdr-title{font-size:1.2rem;font-weight:700;letter-spacing:-.01em}
.hdr-sub{color:var(--muted2);font-size:.75rem;margin-top:.1rem}
.badge{padding:.2rem .65rem;border-radius:9999px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);margin-left:auto}
.badge.running{border-color:rgba(99,102,241,.4);color:var(--accent2);background:rgba(99,102,241,.08)}
.badge.done{border-color:rgba(16,185,129,.4);color:var(--green2);background:rgba(16,185,129,.08)}

/* Steps indicator */
.steps{display:flex;align-items:center;margin-bottom:2rem;user-select:none}
.sdot{display:flex;align-items:center;flex:1}
.sdot:last-child .sline{display:none}
.snum{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;border:1.5px solid var(--border2);color:var(--muted);background:var(--surface2);flex-shrink:0;transition:all .2s}
.snum.active{border-color:var(--accent);color:var(--accent2);background:rgba(99,102,241,.1)}
.snum.done{border-color:var(--green);color:var(--green);background:rgba(16,185,129,.08)}
.slbl{font-size:.72rem;color:var(--muted);margin-left:.45rem;transition:color .2s;white-space:nowrap}
.slbl.active{color:var(--text)}
.sline{flex:1;height:1px;background:var(--border2);margin:0 .625rem}

/* Step sections */
.step{display:none}.step.active{display:block}
.sec-title{font-size:1rem;font-weight:700;margin-bottom:.2rem}
.sec-sub{font-size:.75rem;color:var(--muted2);margin-bottom:1.5rem}

/* Type cards */
.card-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.75rem}
.card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--r);padding:1.5rem;cursor:pointer;transition:all .15s;position:relative}
.card:hover{border-color:var(--border2);background:var(--surface2)}
.card.sel{border-color:var(--accent);background:rgba(99,102,241,.06)}
.card-icon{font-size:1.75rem;margin-bottom:.625rem;line-height:1}
.card-title{font-size:.9rem;font-weight:700;margin-bottom:.3rem}
.card-desc{font-size:.72rem;color:var(--muted2);line-height:1.6}
.card-check{position:absolute;top:.625rem;right:.625rem;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:.6rem;color:transparent;transition:all .15s}
.card.sel .card-check{border-color:var(--accent);background:var(--accent);color:#fff}

/* Browser */
.browser-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);margin-bottom:.875rem;overflow:hidden}
.browser-bar{display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:var(--surface2);border-bottom:1px solid var(--border)}
.browser-bar input{flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:.375rem;padding:.3rem .6rem;color:var(--text);font-size:.72rem;font-family:'JetBrains Mono',monospace;outline:none}
.browser-bar input:focus{border-color:var(--accent)}
.bbtn{background:var(--surface);border:1px solid var(--border2);border-radius:.375rem;padding:.25rem .55rem;color:var(--muted2);font-size:.72rem;cursor:pointer;white-space:nowrap;transition:all .1s}
.bbtn:hover{border-color:var(--accent);color:var(--accent2)}
.browser-list{max-height:240px;overflow-y:auto;padding:.3rem}
.browser-list::-webkit-scrollbar{width:4px}
.browser-list::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.bentry{display:flex;align-items:center;gap:.5rem;padding:.35rem .625rem;border-radius:.375rem;cursor:pointer;font-size:.75rem;transition:background .1s}
.bentry:hover{background:var(--surface2)}
.bentry.cur{background:rgba(99,102,241,.08)}
.bentry .bicon{width:.9rem;flex-shrink:0;text-align:center}
.bentry .bname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bentry .btag{font-size:.62rem;color:var(--muted);background:var(--border2);padding:.08rem .3rem;border-radius:.25rem;white-space:nowrap}
.bempty{text-align:center;color:var(--muted);font-size:.72rem;padding:1.25rem}

.sel-row{display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;background:rgba(99,102,241,.06);border:1.5px solid rgba(99,102,241,.25);border-radius:var(--r);font-size:.75rem;margin-bottom:.875rem}
.sel-path{flex:1;font-family:'JetBrains Mono',monospace;color:var(--accent2);word-break:break-all;font-size:.72rem}
.sel-x{color:var(--muted);cursor:pointer;padding:0 .25rem;font-size:1rem;line-height:1}
.sel-x:hover{color:var(--red)}

/* Use-folder button */
.use-btn{width:100%;padding:.45rem;border:1px dashed var(--border2);border-radius:.375rem;background:none;color:var(--muted2);font-size:.72rem;cursor:pointer;margin-bottom:.875rem;transition:all .1s}
.use-btn:hover{border-color:var(--accent);color:var(--accent2)}

/* Options */
.opt-group{margin-bottom:1.25rem}
.opt-label{font-size:.68rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem}
.opt-row{display:flex;align-items:center;gap:.75rem;padding:.45rem .5rem;border-radius:.375rem}
.opt-row:hover{background:var(--surface2)}
.opt-row input[type=checkbox]{accent-color:var(--accent);width:15px;height:15px;cursor:pointer;flex-shrink:0}
.opt-row label{flex:1;font-size:.8rem;cursor:pointer;user-select:none}
.mset{display:flex;gap:.4rem;margin-left:auto}
.mopt{display:flex;align-items:center;gap:.3rem;font-size:.7rem;cursor:pointer;padding:.18rem .45rem;border-radius:.3rem;border:1px solid var(--border2);background:var(--surface2);transition:all .1s;user-select:none}
.mopt:has(input:checked){border-color:rgba(99,102,241,.4);background:rgba(99,102,241,.08);color:var(--accent2)}
.mopt input[type=radio]{accent-color:var(--accent);cursor:pointer;width:11px;height:11px}
select.lsel{background:var(--surface2);border:1px solid var(--border2);border-radius:.375rem;padding:.35rem .65rem;color:var(--text);font-size:.8rem;outline:none;cursor:pointer}
select.lsel:focus{border-color:var(--accent)}

/* Buttons */
.btn-row{display:flex;align-items:center;justify-content:flex-end;gap:.75rem;margin-top:1.5rem}
.btn{padding:.5rem 1.1rem;border-radius:.5rem;font-size:.78rem;font-weight:600;border:none;cursor:pointer;transition:all .15s}
.btn-ghost{background:var(--surface2);color:var(--muted2);border:1px solid var(--border2)}
.btn-ghost:hover{border-color:var(--border);color:var(--text)}
.btn-pri{background:var(--accent);color:#fff}
.btn-pri:hover{background:var(--accent2)}
.btn-pri:disabled{opacity:.35;cursor:not-allowed}
.btn-start{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;padding:.6rem 1.6rem;font-size:.85rem}
.btn-start:hover{opacity:.9}

/* Progress view */
.pview{display:none}
.pview.on{display:block}
.back-link{display:inline-flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted2);cursor:pointer;border:none;background:none;padding:.2rem 0;margin-bottom:1.25rem;transition:color .1s}
.back-link:hover{color:var(--text)}
.phdr{display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem}
.phdr-title{font-size:1rem;font-weight:700}
.pbar-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:1.1rem 1.4rem;margin-bottom:1.1rem}
.pbar-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.55rem}
.pbar-lbl{font-size:.68rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em}
.pbar-ct{font-size:.78rem;font-weight:600;font-variant-numeric:tabular-nums}
.pbar-track{height:5px;background:var(--border2);border-radius:9999px;overflow:hidden}
.pbar-fill{height:100%;border-radius:9999px;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s;width:0%}
.pbar-fill.done{background:linear-gradient(90deg,var(--green),var(--green2))}
.phases{display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.1rem}
.phase{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.phase-hdr{padding:.55rem 1.1rem;display:flex;align-items:center;gap:.4rem;font-size:.68rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border-bottom:1px solid var(--border)}
.task{display:flex;align-items:center;gap:.65rem;padding:.45rem 1.1rem;border-bottom:1px solid var(--border);transition:background .12s}
.task:last-child{border-bottom:none}
.task.running{background:rgba(59,130,246,.04)}
.task.failed{background:rgba(239,68,68,.04)}
.ticon{width:1rem;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem}
.tlabel{flex:1;font-size:.75rem}
.task.pending .tlabel{color:var(--muted)}
.task.done .tlabel{color:var(--muted2)}
.task.failed .tlabel{color:var(--red)}
.ttime{font-size:.65rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{width:10px;height:10px;border:1.5px solid var(--border2);border-top-color:var(--blue2);border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
.log-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.log-hdr{padding:.45rem 1.1rem;font-size:.65rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.log-hdr button{font-size:.62rem;color:var(--muted);background:none;border:1px solid var(--border2);border-radius:.3rem;padding:.08rem .38rem;cursor:pointer}
.log-hdr button:hover{color:var(--text);border-color:var(--muted)}
.log-body{font-family:'JetBrains Mono','Fira Code',monospace;font-size:.65rem;color:var(--muted);max-height:200px;overflow-y:auto;padding:.65rem 1.1rem;line-height:1.7}
.log-body::-webkit-scrollbar{width:4px}
.log-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
.log-row{display:flex;gap:.4rem;align-items:baseline;min-width:0}
.log-row>:nth-child(2){flex:1;min-width:0;word-break:break-all}
.log-ctx{flex-shrink:0;font-size:.6rem;color:var(--muted);opacity:.65;padding-left:.5rem;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.ts{color:var(--border2);user-select:none}
.ok{color:var(--green)}.err{color:var(--red)}.run{color:var(--blue2)}.warn{color:var(--yellow)}
.banner{border-radius:var(--r);padding:1.1rem 1.4rem;margin-bottom:1.1rem;display:none;background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(16,185,129,.03));border:1px solid rgba(16,185,129,.25)}
.banner.show{display:flex;align-items:center;gap:1rem}
.banner-icon{font-size:1.75rem;line-height:1}
.banner-text h2{font-size:.9rem;font-weight:700;color:var(--green2);margin-bottom:.15rem}
.banner-text p{font-size:.72rem;color:var(--muted2)}

/* Destination picker */
.dest-default{display:flex;align-items:center;gap:.6rem;font-size:.78rem;color:var(--muted2)}
.dest-default code{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--muted2)}
.dest-chosen{margin-top:.4rem;font-size:.75rem;color:var(--muted2)}
.dest-chosen span{color:var(--text);font-family:'JetBrains Mono',monospace}

/* Theme toggle */
.theme-btn{background:none;border:1px solid var(--border2);border-radius:.5rem;padding:.3rem .55rem;color:var(--muted2);font-size:.9rem;cursor:pointer;transition:all .15s;line-height:1}
.theme-btn:hover{border-color:var(--accent);color:var(--accent2)}

/* Open-folder button on phase headers */
.phase-hdr{cursor:default}
.open-dir-btn{background:none;border:none;color:var(--muted);font-size:.8rem;cursor:pointer;padding:0 .25rem;border-radius:.25rem;transition:color .1s;line-height:1;vertical-align:middle;margin-left:.3rem}
.open-dir-btn:hover{color:var(--accent2)}
.phase-stats{margin-left:auto;display:flex;gap:.5rem;font-size:.62rem;font-weight:500;color:var(--muted);text-transform:none;letter-spacing:0}
.phase-stats span{display:flex;align-items:center;gap:.2rem}

/* Notes button */
.notes-btn{background:none;border:1px solid var(--border2);border-radius:.5rem;padding:.3rem .6rem;color:var(--muted2);font-size:.82rem;cursor:pointer;display:flex;align-items:center;gap:.35rem;transition:all .15s;position:relative}
.notes-btn:hover{border-color:var(--accent);color:var(--accent2)}
.notes-badge{position:absolute;top:-.35rem;right:-.35rem;min-width:16px;height:16px;border-radius:9999px;background:var(--accent);color:#fff;font-size:.58rem;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 .25rem;line-height:1;display:none}
.notes-badge.has{display:flex}

/* Notes modal */
.noverlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:1000;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .18s}
.noverlay.open{opacity:1;pointer-events:all}
.nmodal{background:var(--surface);border:1px solid var(--border2);border-radius:1rem;width:min(560px,92vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.4);transform:translateY(12px);transition:transform .18s}
.noverlay.open .nmodal{transform:translateY(0)}
.nmodal-hdr{display:flex;align-items:center;gap:.6rem;padding:1rem 1.25rem .75rem;border-bottom:1px solid var(--border)}
.nmodal-title{font-size:.9rem;font-weight:700;flex:1}
.ntodo{font-size:.7rem;color:var(--accent2);background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.25);border-radius:9999px;padding:.15rem .55rem;font-weight:600;display:none}
.ntodo.has{display:inline-flex;align-items:center;gap:.25rem}
.nmodal-close{background:none;border:none;color:var(--muted2);font-size:1.1rem;cursor:pointer;padding:.1rem .3rem;border-radius:.3rem;line-height:1}
.nmodal-close:hover{color:var(--text);background:var(--surface2)}
.nmodal-body{flex:1;overflow:hidden;display:flex;flex-direction:column;padding:1rem 1.25rem}
.nmodal-body textarea{flex:1;min-height:260px;background:var(--bg);border:1px solid var(--border2);border-radius:.5rem;color:var(--text);font-family:'JetBrains Mono','Fira Code',monospace;font-size:.75rem;line-height:1.65;padding:.75rem 1rem;resize:none;outline:none;transition:border-color .15s}
.nmodal-body textarea:focus{border-color:var(--accent)}
.nmodal-foot{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.25rem 1rem;gap:.75rem}
.nmodal-status{font-size:.68rem;color:var(--muted);flex:1}
.nmodal-status.saved{color:var(--green)}
.nmodal-status.err{color:var(--red)}
</style>
</head>
<body>
<div class="app">

  <div class="hdr">
    <div>
      <div class="hdr-title">&#x1F4DA; Document Converter</div>
      <div class="hdr-sub">HTML or Markdown &#x2192; HTML &middot; EPUB &middot; PDF</div>
    </div>
    <button class="theme-btn" id="theme-btn" onclick="toggleTheme()" title="Toggle light/dark"></button>
    <button class="notes-btn" onclick="openNotes()" title="Notes">
      &#x1F4DD; Notes
      <span class="notes-badge" id="notes-badge"></span>
    </button>
    <span class="badge" id="badge" style="margin-left:.5rem">Ready</span>
  </div>

  <!-- ── Notes modal ────────────────────────────────────────────────────── -->
  <div class="noverlay" id="noverlay" onclick="if(event.target===this)closeNotes()">
    <div class="nmodal">
      <div class="nmodal-hdr">
        <span style="font-size:1.1rem">&#x1F4DD;</span>
        <span class="nmodal-title">Notes</span>
        <span class="ntodo" id="ntodo"></span>
        <button class="nmodal-close" onclick="closeNotes()">&#x2715;</button>
      </div>
      <div class="nmodal-body">
        <textarea id="notes-ta" placeholder="Write your notes here. Use - [ ] for pending tasks and - [x] for done tasks.&#10;&#10;Example:&#10;- [ ] Check output PDF&#10;- [x] Update chapter 3&#10;- [ ] Send to reviewer"></textarea>
      </div>
      <div class="nmodal-foot">
        <span class="nmodal-status" id="notes-status"></span>
        <button class="btn btn-ghost" onclick="closeNotes()">Cancel</button>
        <button class="btn btn-pri" onclick="saveNotes()">&#x1F4BE; Save</button>
      </div>
    </div>
  </div>

  <!-- ── Wizard ──────────────────────────────────────────────────────────── -->
  <div id="wizard">
    <div class="steps" id="steps">
      <div class="sdot"><div class="snum active" id="sn1">1</div><span class="slbl active" id="sl1">Input</span><div class="sline"></div></div>
      <div class="sdot"><div class="snum" id="sn2">2</div><span class="slbl" id="sl2">Folder</span><div class="sline"></div></div>
      <div class="sdot"><div class="snum" id="sn3">3</div><span class="slbl" id="sl3">Options</span></div>
    </div>

    <!-- Step 1 -->
    <div class="step active" id="s1">
      <div class="sec-title">What's your input?</div>
      <div class="sec-sub">Choose how to start the conversion</div>
      <div class="card-grid">
        <div class="card" id="card-html" onclick="pickType('html')">
          <div class="card-check" id="chk-html">&#x2713;</div>
          <div class="card-icon">&#x1F310;</div>
          <div class="card-title">HTML Folder</div>
          <div class="card-desc">Folder with enriched HTML files. They get converted to Markdown first, then built into outputs.</div>
        </div>
        <div class="card" id="card-md" onclick="pickType('md')">
          <div class="card-check" id="chk-md">&#x2713;</div>
          <div class="card-icon">&#x1F4DD;</div>
          <div class="card-title">Markdown Folder</div>
          <div class="card-desc">Folder with <code>.md</code> files. Goes directly to building HTML, EPUB and PDF outputs.</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-pri" id="next1" onclick="goStep(2)" disabled>Next &#x2192;</button>
      </div>
    </div>

    <!-- Step 2 -->
    <div class="step" id="s2">
      <div class="sec-title">Select Folder</div>
      <div class="sec-sub" id="s2sub">Browse to the folder containing your files</div>

      <div class="browser-wrap">
        <div class="browser-bar">
          <button class="bbtn" onclick="browseUp()">&#x2191; Up</button>
          <input type="text" id="pathinp" placeholder="/path/to/folder" onkeydown="if(event.key==='Enter')browseGo()">
          <button class="bbtn" onclick="browseGo()">Go</button>
        </div>
        <div class="browser-list" id="blist"><div class="bempty">Loading&#x2026;</div></div>
      </div>

      <button class="use-btn" id="usebtn" onclick="useCurrentFolder()">&#x1F4C1; Use current folder &mdash; <span id="usepath" style="font-family:monospace;font-size:.95em"></span></button>

      <div class="sel-row" id="selrow" style="display:none">
        <span style="color:var(--muted2);white-space:nowrap">Selected:</span>
        <span class="sel-path" id="selpath"></span>
        <span class="sel-x" onclick="clearSel()" title="Clear">&#xD7;</span>
      </div>

      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(1)">&#x2190; Back</button>
        <button class="btn btn-pri" id="next2" onclick="goStep(3)" disabled>Next &#x2192;</button>
      </div>
    </div>

    <!-- Step 3 -->
    <div class="step" id="s3">
      <div class="sec-title">Output Options</div>
      <div class="sec-sub">Choose formats and conversion methods</div>

      <div class="opt-group">
        <div class="opt-label">Language (admonition labels)</div>
        <select class="lsel" id="lang">
          <option value="en">English (en)</option>
          <option value="de">Deutsch (de)</option>
          <option value="es">Espa&ntilde;ol (es)</option>
        </select>
      </div>

      <div class="opt-group">
        <div class="opt-label">Output Formats</div>
        <div class="opt-row">
          <input type="checkbox" id="o-html" checked onchange="updateTaskPreview()">
          <label for="o-html">HTML</label>
        </div>
        <div class="opt-row">
          <input type="checkbox" id="o-epub" checked onchange="updateTaskPreview()">
          <label for="o-epub">EPUB</label>
          <div class="mset">
            <label class="mopt"><input type="checkbox" name="epub-m" value="native" checked onchange="updateTaskPreview()"> Native</label>
            <label class="mopt"><input type="checkbox" name="epub-m" value="pandoc" onchange="updateTaskPreview()"> Pandoc</label>
          </div>
        </div>
        <div class="opt-row">
          <input type="checkbox" id="o-pdf" checked onchange="updateTaskPreview()">
          <label for="o-pdf">PDF</label>
          <div class="mset">
            <label class="mopt"><input type="checkbox" name="pdf-m" value="latex" checked onchange="updateTaskPreview()"> LaTeX</label>
            <label class="mopt"><input type="checkbox" name="pdf-m" value="pandoc" onchange="updateTaskPreview()"> Pandoc</label>
          </div>
        </div>
      </div>

      <div class="opt-group">
        <div class="opt-label">Estimated workload</div>
        <div id="task-est" style="font-size:.8rem;color:var(--muted2);padding:.2rem 0">Select a folder to estimate tasks</div>
      </div>

      <div class="opt-group">
        <div class="opt-label">Destination folder</div>
        <div class="dest-default">
          <span>Default: <code>_READY</code> inside source folder</span>
          <button class="bbtn" onclick="toggleDestBrowser()">Set custom&#x2026;</button>
        </div>
        <div id="dest-custom" style="display:none;margin-top:.5rem">
          <div class="browser-wrap" style="margin-bottom:.4rem">
            <div class="browser-bar">
              <button class="bbtn" onclick="oBrowseUp()">&#x2191; Up</button>
              <input type="text" id="opathinp" placeholder="/path/to/output" onkeydown="if(event.key==='Enter')oBrowseGo()">
              <button class="bbtn" onclick="oBrowseGo()">Go</button>
            </div>
            <div class="browser-list" id="oblist"><div class="bempty">Loading&#x2026;</div></div>
          </div>
          <div style="display:flex;gap:.5rem;align-items:center">
            <button class="bbtn" onclick="oUseFolder()">&#x1F4C1; Use this folder</button>
            <button class="bbtn" style="margin-left:auto" onclick="clearDest()">&#xD7; Reset to default</button>
          </div>
          <div id="dest-chosen-row" class="dest-chosen" style="display:none">Output &#x2192; <span id="dest-chosen-path"></span></div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-ghost" onclick="goStep(2)">&#x2190; Back</button>
        <button class="btn btn-start" onclick="startJob()">&#x25B6; Start Conversion</button>
      </div>
    </div>
  </div><!-- /wizard -->

  <!-- ── Progress view ───────────────────────────────────────────────────── -->
  <div id="pview" class="pview">
    <button class="back-link" onclick="resetWizard()">&#x2190; New conversion</button>
    <div class="phdr">
      <div class="phdr-title">Build Progress</div>
      <span class="badge running" id="pbadge">Running&#x2026;</span>
    </div>
    <div class="banner" id="banner">
      <div class="banner-icon">&#x1F389;</div>
      <div class="banner-text"><h2>Conversion complete</h2><p id="bannerp">Results ready.</p></div>
    </div>
    <div class="pbar-wrap">
      <div class="pbar-top"><span class="pbar-lbl">Progress</span><span class="pbar-ct" id="pcts">&#x2014; / &#x2014; tasks</span></div>
      <div class="pbar-track"><div class="pbar-fill" id="pbar"></div></div>
    </div>
    <div class="phases" id="phases"></div>
    <div class="log-wrap">
      <div class="log-hdr">Log <button onclick="document.getElementById('plog').innerHTML=''">clear</button></div>
      <div class="log-body" id="plog"></div>
    </div>
  </div>

</div><!-- /app -->
<script>
var S={step:1,type:null,selPath:null,browsePath:null,outPath:null,outBrowsePath:null,tasks:{},phases:[],startTs:0,timers:{},currentTask:{label:'',folder:''},analysis:null};
var _es=null;

// ── Task count formula ───────────────────────────────────────────────────────
function countTasks(analysis,outs,epubMs,pdfMs){
  if(!analysis||!analysis.ok)return null;
  var h=outs.indexOf('html')>=0?1:0;
  var e=outs.indexOf('epub')>=0?epubMs.length:0;
  var p=outs.indexOf('pdf')>=0?pdfMs.length:0;
  if(analysis.inputType==='md') return 2+h+e+p+1;
  var nSub=analysis.subdirs.length;
  var hasCombined=nSub>0;
  var nFolders=nSub+(analysis.rootHasHtml?1:0)||1;
  var perFolder=3+h+e+p+1;
  var combined=hasCombined?(2+h+e+p+1):0;
  return nFolders*perFolder+combined;
}

function getSelectedOpts(){
  var outs=[];
  if(document.getElementById('o-html').checked)outs.push('html');
  if(document.getElementById('o-epub').checked)outs.push('epub');
  if(document.getElementById('o-pdf').checked)outs.push('pdf');
  var eMs=Array.from(document.querySelectorAll('input[name="epub-m"]:checked')).map(function(i){return i.value;});
  var pMs=Array.from(document.querySelectorAll('input[name="pdf-m"]:checked')).map(function(i){return i.value;});
  if(!eMs.length)eMs=['native'];if(!pMs.length)pMs=['latex'];
  return{outs:outs,epubMs:eMs,pdfMs:pMs};
}

function updateTaskPreview(){
  var el=document.getElementById('task-est');if(!el)return;
  if(!S.analysis||!S.analysis.ok){el.textContent='Select a folder to estimate tasks';return;}
  var o=getSelectedOpts();
  var total=countTasks(S.analysis,o.outs,o.epubMs,o.pdfMs);
  var info='';
  if(S.analysis.inputType==='html'){
    var nSub=S.analysis.subdirs.length;
    if(nSub>0){
      var nF=nSub+(S.analysis.rootHasHtml?1:0);
      info=nF+' folder'+(nF!==1?'s':'')+' + combined build · ';
    } else {
      info='Single folder · ';
    }
  } else {
    info=(S.analysis.mdCount||0)+' markdown file'+(S.analysis.mdCount!==1?'s':'')+' · ';
  }
  el.textContent=info+(total||0)+' total tasks';
}

function analyzeFolder(){
  if(!S.selPath||!S.type)return;
  var el=document.getElementById('task-est');
  if(el)el.textContent='Analyzing…';
  fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({inputType:S.type,inputPath:S.selPath})})
    .then(function(r){return r.json();})
    .then(function(d){S.analysis=d;updateTaskPreview();})
    .catch(function(){S.analysis=null;if(el)el.textContent='Could not analyze folder';});
}

// ── Wizard navigation ────────────────────────────────────────────────────────
function goStep(n){
  S.step=n;
  ['s1','s2','s3'].forEach(function(id,i){
    document.getElementById(id).classList.toggle('active',i+1===n);
  });
  for(var i=1;i<=3;i++){
    var sn=document.getElementById('sn'+i),sl=document.getElementById('sl'+i);
    if(i<n){sn.className='snum done';sn.textContent='\\u2713';sl.className='slbl';}
    else if(i===n){sn.className='snum active';sn.textContent=i;sl.className='slbl active';}
    else{sn.className='snum';sn.textContent=i;sl.className='slbl';}
  }
  if(n===2){
    document.getElementById('s2sub').textContent=S.type==='html'
      ?'Browse to the folder containing your HTML files'
      :'Browse to the folder containing your Markdown files';
    if(!S.browsePath) browse('${__dirname.replace(/\\/g, '/')}');
  }
  if(n===3) analyzeFolder();
}

// ── Input type ───────────────────────────────────────────────────────────────
function pickType(t){
  S.type=t;
  document.getElementById('card-html').classList.toggle('sel',t==='html');
  document.getElementById('card-md').classList.toggle('sel',t==='md');
  document.getElementById('next1').disabled=false;
}

// ── Browser ──────────────────────────────────────────────────────────────────
function browse(p){
  var list=document.getElementById('blist');
  list.innerHTML='<div class="bempty">Loading\\u2026</div>';
  fetch('/api/browse?path='+encodeURIComponent(p))
    .then(function(r){return r.json();})
    .then(function(d){
      S.browsePath=d.path||p;
      document.getElementById('pathinp').value=S.browsePath;
      document.getElementById('usepath').textContent=S.browsePath.split('/').pop()||S.browsePath;
      renderList(d);
    })
    .catch(function(e){list.innerHTML='<div class="bempty" style="color:var(--red)">'+esc(e.message)+'</div>';});
}

function renderList(d){
  var list=document.getElementById('blist');
  if(!d.ok){list.innerHTML='<div class="bempty" style="color:var(--red)">'+esc(d.error)+'</div>';return;}
  if(!d.dirs.length&&!d.files.length){list.innerHTML='<div class="bempty">Empty folder</div>';return;}
  var h='';
  d.dirs.forEach(function(e){
    var tags='';
    if(e.htmlCount)tags+='<span class="btag">'+e.htmlCount+' html</span> ';
    if(e.mdCount)tags+='<span class="btag">'+e.mdCount+' md</span>';
    h+='<div class="bentry" onclick=\\'browse('+JSON.stringify(e.path)+')\\'>'
      +'<span class="bicon">&#x1F4C1;</span><span class="bname">'+esc(e.name)+'</span>'+tags+'</div>';
  });
  d.files.forEach(function(e){
    var ico=e.name.endsWith('.html')?'&#x1F310;':'&#x1F4C4;';
    h+='<div class="bentry"><span class="bicon">'+ico+'</span><span class="bname">'+esc(e.name)+'</span></div>';
  });
  list.innerHTML=h;
}

function browseUp(){
  if(!S.browsePath)return;
  var parts=S.browsePath.replace(/\\/$/,'').split('/');
  parts.pop();
  browse(parts.join('/')||'/');
}

function browseGo(){
  var p=document.getElementById('pathinp').value.trim();
  if(p)browse(p);
}

function useCurrentFolder(){
  if(!S.browsePath)return;
  selectPath(S.browsePath);
}

function selectPath(p){
  S.selPath=p;
  document.getElementById('selpath').textContent=p;
  document.getElementById('selrow').style.display='flex';
  document.getElementById('next2').disabled=false;
}

function clearSel(){
  S.selPath=null;
  document.getElementById('selrow').style.display='none';
  document.getElementById('next2').disabled=true;
}

// ── Start job ────────────────────────────────────────────────────────────────
function startJob(){
  var outs=[];
  if(document.getElementById('o-html').checked)outs.push('html');
  if(document.getElementById('o-epub').checked)outs.push('epub');
  if(document.getElementById('o-pdf').checked)outs.push('pdf');
  if(!outs.length){alert('Select at least one output format.');return;}

  var epubMs=Array.from(document.querySelectorAll('input[name="epub-m"]:checked')).map(function(i){return i.value;});
  var pdfMs=Array.from(document.querySelectorAll('input[name="pdf-m"]:checked')).map(function(i){return i.value;});
  if(!epubMs.length)epubMs=['native'];
  if(!pdfMs.length)pdfMs=['latex'];
  var params={
    inputType:S.type,
    inputPath:S.selPath,
    outputPath:S.outPath||null,
    outputs:outs,
    epubMethod:epubMs,
    pdfMethod:pdfMs,
    lang:document.getElementById('lang').value
  };

  document.getElementById('wizard').style.display='none';
  var pv=document.getElementById('pview');pv.classList.add('on');

  // Reset progress
  S.phases=[];S.tasks={};S.startTs=Date.now();S.currentTask={label:'',folder:''};
  for(var k in S.timers)clearInterval(S.timers[k]);S.timers={};
  document.getElementById('phases').innerHTML='';
  document.getElementById('plog').innerHTML='';
  document.getElementById('pbar').style.width='0%';
  document.getElementById('pbar').classList.remove('done');
  document.getElementById('pcts').textContent='\\u2014 / \\u2014 tasks';
  document.getElementById('banner').className='banner';
  document.getElementById('pbadge').className='badge running';
  document.getElementById('pbadge').textContent='Running\\u2026';

  // Pre-populate total from analysis so bar shows N/M immediately
  if(S.analysis&&S.analysis.ok){
    var o=getSelectedOpts();
    var tot=countTasks(S.analysis,o.outs,o.epubMs,o.pdfMs);
    if(tot)document.getElementById('pcts').textContent='0 / '+tot+' tasks';
  }

  // Wait for SSE open before POSTing — avoids race where plan events fire before SSE connects
  connectSSE(function(){
    fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)})
      .catch(function(e){addLog('Failed to start: '+e.message,'err');});
  });
}

function resetWizard(){
  if(activeSSE)activeSSE=false;
  document.getElementById('wizard').style.display='';
  document.getElementById('pview').classList.remove('on');
  clearSel();
  clearDest();
  faviconIdle();
  goStep(1);
}

// ── SSE ──────────────────────────────────────────────────────────────────────
var activeSSE=false;
function connectSSE(cb){
  if(_es)_es.close();
  activeSSE=true;
  _es=new EventSource('/events');
  var fired=false;
  function ready(){if(!fired){fired=true;if(cb)cb();}}
  _es.onopen=ready;
  _es.onmessage=function(e){
    ready(); // fallback: fire cb on first message if onopen didn't fire
    try{handleEv(JSON.parse(e.data));}catch(err){}
  };
  _es.onerror=function(){};
}

function fmt(ms){
  if(ms<1000)return ms+'ms';
  if(ms<60000)return (ms/1000).toFixed(1)+'s';
  return Math.floor(ms/60000)+'m'+String(Math.floor((ms%60000)/1000)).padStart(2,'0')+'s';
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function ticon(st){
  if(st==='done')return '<span style="color:var(--green)">\\u2713</span>';
  if(st==='failed')return '<span style="color:var(--red)">\\u2717</span>';
  if(st==='skip')return '<span style="color:var(--muted)">\\u2014</span>';
  if(st==='running')return '<span class="spin"></span>';
  return '<span style="color:var(--border2)">\\u25CB</span>';
}

function cid(id){return id.replace(/[^a-zA-Z0-9_-]/g,'_');}

function updProg(){
  var all=Object.values(S.tasks);
  var done=all.filter(function(t){return t.status==='done'||t.status==='failed'||t.status==='skip';}).length;
  var pct=all.length?Math.round(done/all.length*100):0;
  document.getElementById('pbar').style.width=pct+'%';
  document.getElementById('pcts').textContent=done+' / '+all.length+' tasks';
  if(pct===100)document.getElementById('pbar').classList.add('done');
  faviconProgress(pct);
}

function renderPhases(){
  var c=document.getElementById('phases');c.innerHTML='';
  S.phases.forEach(function(ph){
    var d=document.createElement('div');d.className='phase';
    var iconEl=ph.path?'<button class="open-dir-btn" onclick="openFolder('+JSON.stringify(ph.path)+')" title="Open folder">'+esc(ph.icon)+'</button>':esc(ph.icon);
    var statsHtml='';
    if(ph.stats){var parts=[];if(ph.stats.images)parts.push('<span>&#x1F4F8; '+ph.stats.images+'</span>');if(ph.stats.videos)parts.push('<span>&#x1F3AC; '+ph.stats.videos+'</span>');if(parts.length)statsHtml='<div class="phase-stats">'+parts.join('')+'</div>';}
    var h='<div class="phase-hdr">'+iconEl+' '+esc(ph.label)+statsHtml+'</div>';
    ph.tasks.forEach(function(tid){
      var t=S.tasks[tid];if(!t)return;
      var id=cid(tid);
      h+='<div class="task '+t.status+'" id="t-'+id+'">'
        +'<span class="ticon">'+ticon(t.status)+'</span>'
        +'<span class="tlabel">'+esc(t.label)+'</span>'
        +'<span class="ttime" id="tt-'+id+'">'+(t.elapsed||'')+'</span>'
        +'</div>';
    });
    d.innerHTML=h;c.appendChild(d);
  });
}

function patchTask(id){
  var t=S.tasks[id];if(!t)return;
  var row=document.getElementById('t-'+cid(id));if(!row){renderPhases();return;}
  row.className='task '+t.status;
  row.querySelector('.ticon').innerHTML=ticon(t.status);
  row.querySelector('.tlabel').textContent=t.label;
  var tt=document.getElementById('tt-'+cid(id));if(tt)tt.textContent=t.elapsed||'';
}

function startTimer(id){
  stopTimer(id);
  S.timers[id]=setInterval(function(){
    var t=S.tasks[id];if(!t||t.status!=='running'){stopTimer(id);return;}
    var el=document.getElementById('tt-'+cid(id));
    if(el)el.textContent=fmt(Date.now()-t.startMs);
  },200);
}
function stopTimer(id){if(S.timers[id]){clearInterval(S.timers[id]);delete S.timers[id];}}

function addLog(msg,cls,taskLbl,folderLbl){
  var ts=new Date().toLocaleTimeString('en',{hour12:false});
  var log=document.getElementById('plog');
  var d=document.createElement('div');d.className='log-row';
  var ctx='';
  if(taskLbl||folderLbl){
    var parts=[];
    if(folderLbl)parts.push('<span style="opacity:.55">'+esc(folderLbl)+'</span>');
    if(taskLbl)parts.push(esc(taskLbl));
    ctx='<span class="log-ctx">'+parts.join(' &#x203A; ')+'</span>';
  }
  d.innerHTML='<span class="ts">['+ts+']</span> <span class="'+(cls||'')+'">'+esc(msg)+'</span>'+ctx;
  log.appendChild(d);log.scrollTop=log.scrollHeight;
}

function handleEv(ev){
  if(ev.type==='state_snapshot'){
    var snap=ev.snapshot;
    if(!snap)return;
    S.startTs=snap.startTs||S.startTs;
    // Patch task statuses from server snapshot
    Object.keys(snap.tasks||{}).forEach(function(id){
      var st=snap.tasks[id];
      if(S.tasks[id]){
        S.tasks[id].status=st.status;
        if(st.status==='running')S.currentTask={label:st.label||'',folder:st.folder||''};
      }
    });
    renderPhases();updProg();
    if(snap.complete)handleEv(snap.complete);
    return;
  }
  if(ev.type==='task_plan'){
    var ph=S.phases.find(function(p){return p.id===ev.phase_id;});
    if(!ph){ph={id:ev.phase_id,icon:ev.phase_icon||'\\uD83D\\uDCC1',label:ev.phase_label||ev.phase_id,path:ev.phase_path||'',stats:ev.phase_stats||null,tasks:[]};S.phases.push(ph);}
    if(ph.tasks.indexOf(ev.id)===-1)ph.tasks.push(ev.id);
    if(!S.tasks[ev.id])S.tasks[ev.id]={id:ev.id,label:ev.label||ev.id,status:'pending',elapsed:''};
    renderPhases();updProg();return;
  }
  if(ev.type==='task_start'){
    S.currentTask={label:ev.label||ev.id,folder:ev.folder||''};
    var t=S.tasks[ev.id];
    if(t){t.status='running';t.startMs=Date.now();t.elapsed='';}
    patchTask(ev.id);startTimer(ev.id);
    addLog('\\u25B6 '+(ev.label||ev.id),'run','','');return;
  }
  if(ev.type==='task_done'){
    var t=S.tasks[ev.id];
    if(t){t.status='done';t.elapsed=fmt(Date.now()-(t.startMs||Date.now()));}
    stopTimer(ev.id);patchTask(ev.id);updProg();
    addLog('\\u2713 '+(ev.label||ev.id)+(t?' \\u00B7 '+t.elapsed:''),'ok');return;
  }
  if(ev.type==='task_fail'){
    var t=S.tasks[ev.id];
    if(t){t.status='failed';t.elapsed=fmt(Date.now()-(t.startMs||Date.now()));}
    stopTimer(ev.id);patchTask(ev.id);updProg();
    addLog('\\u2717 '+(ev.label||ev.id)+(ev.detail?' \\u2014 '+ev.detail:''),'err');return;
  }
  if(ev.type==='task_skip'){
    var t=S.tasks[ev.id];if(t){t.status='skip';t.elapsed='';}
    stopTimer(ev.id);patchTask(ev.id);updProg();
    addLog('\\u2014 '+(ev.label||ev.id)+' (skipped)');return;
  }
  if(ev.type==='log'){
    var cls=ev.level==='ok'?'ok':ev.level==='error'?'err':ev.level==='warn'?'warn':'';
    var tl=ev.task||S.currentTask.label,fl=ev.folder||S.currentTask.folder;
    addLog(ev.message||'',cls,tl,fl);return;
  }
  if(ev.type==='complete'){
    var elapsed=fmt(Date.now()-S.startTs);
    var badge=document.getElementById('pbadge');
    badge.textContent=ev.error?'Failed':'Complete \\u2713';
    badge.className='badge '+(ev.error?'':'done');
    if(!ev.error){
      document.getElementById('banner').classList.add('show');
      document.getElementById('bannerp').textContent='Done in '+elapsed+(ev.ready_dir?' \\u2014 '+ev.ready_dir:'');
      document.getElementById('pbar').style.width='100%';
      document.getElementById('pbar').classList.add('done');
      addLog('\\uD83C\\uDF89 Done in '+elapsed,'ok');
      faviconDone();
    }else{
      addLog('Error: '+ev.error,'err');
      faviconError();
    }
    return;
  }
}

// ── Favicon progress ─────────────────────────────────────────────────────────
(function(){
  var _cv=document.createElement('canvas');_cv.width=_cv.height=32;
  var _ctx=_cv.getContext('2d');
  var _link=document.getElementById('favicon');

  function draw(pct,state){
    var S32=32,cx=16,cy=16,r=14,lw=4;
    _ctx.clearRect(0,0,S32,S32);

    if(state==='idle'){
      // Book icon: indigo circle + white "F"
      _ctx.fillStyle='#6366f1';
      _ctx.beginPath();_ctx.arc(cx,cy,r,0,Math.PI*2);_ctx.fill();
      _ctx.fillStyle='#fff';
      _ctx.font='bold 16px sans-serif';
      _ctx.textAlign='center';_ctx.textBaseline='middle';
      _ctx.fillText('F',cx,cy+1);
    } else if(state==='done'){
      _ctx.fillStyle='#10b981';
      _ctx.beginPath();_ctx.arc(cx,cy,r,0,Math.PI*2);_ctx.fill();
      _ctx.fillStyle='#fff';
      _ctx.font='bold 17px sans-serif';
      _ctx.textAlign='center';_ctx.textBaseline='middle';
      _ctx.fillText('\\u2713',cx,cy+1);
    } else if(state==='error'){
      _ctx.fillStyle='#ef4444';
      _ctx.beginPath();_ctx.arc(cx,cy,r,0,Math.PI*2);_ctx.fill();
      _ctx.fillStyle='#fff';
      _ctx.font='bold 18px sans-serif';
      _ctx.textAlign='center';_ctx.textBaseline='middle';
      _ctx.fillText('!',cx,cy+1);
    } else {
      // Progress arc
      // Track
      _ctx.strokeStyle='#2f3347';_ctx.lineWidth=lw;
      _ctx.beginPath();_ctx.arc(cx,cy,r-lw/2,0,Math.PI*2);_ctx.stroke();
      // Arc (starts at top = -π/2)
      var end=-Math.PI/2+(Math.PI*2)*(pct/100);
      _ctx.strokeStyle= pct===100?'#10b981':'#6366f1';
      _ctx.lineWidth=lw;_ctx.lineCap='round';
      _ctx.beginPath();_ctx.arc(cx,cy,r-lw/2,-Math.PI/2,end);_ctx.stroke();
      // Number
      var fs=pct<10?13:pct<100?12:10;
      _ctx.fillStyle='#e2e8f0';
      _ctx.font='bold '+fs+'px sans-serif';
      _ctx.textAlign='center';_ctx.textBaseline='middle';
      _ctx.fillText(pct+'%',cx,cy+0.5);
    }
    _link.href=_cv.toDataURL('image/png');
  }

  window.faviconIdle=function(){draw(0,'idle');};
  window.faviconProgress=function(pct){draw(pct,'progress');};
  window.faviconDone=function(){draw(100,'done');};
  window.faviconError=function(){draw(0,'error');};

  faviconIdle();
})();

// ── Destination browser ──────────────────────────────────────────────────────
function toggleDestBrowser(){
  var el=document.getElementById('dest-custom');
  var shown=el.style.display!=='none';
  el.style.display=shown?'none':'block';
  if(!shown&&!S.outBrowsePath) oBrowse(S.selPath||'${__dirname.replace(/\\/g, '/')}');
}
function oBrowse(p){
  var list=document.getElementById('oblist');
  list.innerHTML='<div class="bempty">Loading\\u2026</div>';
  fetch('/api/browse?path='+encodeURIComponent(p))
    .then(function(r){return r.json();})
    .then(function(d){
      S.outBrowsePath=d.path||p;
      document.getElementById('opathinp').value=S.outBrowsePath;
      var h='';
      (d.dirs||[]).forEach(function(e){h+='<div class="bentry" onclick="oBrowse('+JSON.stringify(e.path)+')"><span class="bicon">&#x1F4C1;</span><span class="bname">'+esc(e.name)+'</span></div>';});
      list.innerHTML=h||'<div class="bempty">No subfolders</div>';
    })
    .catch(function(e){list.innerHTML='<div class="bempty" style="color:var(--red)">'+esc(e.message)+'</div>';});
}
function oBrowseUp(){
  if(!S.outBrowsePath)return;
  var parts=S.outBrowsePath.replace(/\\/$/,'').split('/');parts.pop();
  oBrowse(parts.join('/')||'/');
}
function oBrowseGo(){var p=document.getElementById('opathinp').value.trim();if(p)oBrowse(p);}
function oUseFolder(){
  if(!S.outBrowsePath)return;
  S.outPath=S.outBrowsePath;
  document.getElementById('dest-chosen-path').textContent=S.outPath;
  document.getElementById('dest-chosen-row').style.display='block';
}
function clearDest(){
  S.outPath=null;S.outBrowsePath=null;
  document.getElementById('dest-custom').style.display='none';
  document.getElementById('dest-chosen-row').style.display='none';
}

// ── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(light){
  document.documentElement.classList.toggle('light',light);
  document.getElementById('theme-btn').textContent=light?'\\uD83C\\uDF19':'\\u2600\\uFE0F';
}
function toggleTheme(){
  var light=!document.documentElement.classList.contains('light');
  localStorage.setItem('theme',light?'light':'dark');
  applyTheme(light);
}
function initTheme(){applyTheme(localStorage.getItem('theme')==='light');}

// ── Open folder ──────────────────────────────────────────────────────────────
function openFolder(p){
  fetch('/api/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folderPath:p})})
    .catch(function(){});
}

// ── Notes ────────────────────────────────────────────────────────────────────
function countPending(text){
  return (text.match(/^- \[ \]/gm)||[]).length;
}

function syncNotesBadge(text){
  var n=countPending(text);
  var badge=document.getElementById('notes-badge');
  var todo=document.getElementById('ntodo');
  if(n>0){
    badge.textContent=n;badge.className='notes-badge has';
    todo.textContent='\\u25A1 '+n+' pending';todo.className='ntodo has';
  }else{
    badge.className='notes-badge';
    todo.className='ntodo';
  }
}

function openNotes(){
  var ov=document.getElementById('noverlay');
  document.getElementById('notes-status').textContent='';
  document.getElementById('notes-status').className='nmodal-status';
  fetch('/api/notes').then(function(r){return r.json();}).then(function(d){
    var ta=document.getElementById('notes-ta');
    ta.value=d.text||'';
    syncNotesBadge(ta.value);
    ov.classList.add('open');
    setTimeout(function(){ta.focus();},120);
  }).catch(function(){
    document.getElementById('notes-ta').value='';
    ov.classList.add('open');
  });
  // live pending count while typing
  document.getElementById('notes-ta').oninput=function(){syncNotesBadge(this.value);};
}

function closeNotes(){
  document.getElementById('noverlay').classList.remove('open');
  document.getElementById('notes-ta').oninput=null;
}

function saveNotes(){
  var text=document.getElementById('notes-ta').value;
  var st=document.getElementById('notes-status');
  st.textContent='Saving…';st.className='nmodal-status';
  fetch('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.ok){
        st.textContent='Saved \\u2713';st.className='nmodal-status saved';
        syncNotesBadge(text);
      }else{
        st.textContent='Error: '+(d.error||'unknown');st.className='nmodal-status err';
      }
    })
    .catch(function(e){st.textContent='Error: '+e.message;st.className='nmodal-status err';});
}

// Keyboard shortcut: Ctrl+S inside textarea saves
document.addEventListener('keydown',function(e){
  if(e.key==='s'&&(e.ctrlKey||e.metaKey)&&document.getElementById('noverlay').classList.contains('open')){
    e.preventDefault();saveNotes();
  }
  if(e.key==='Escape'&&document.getElementById('noverlay').classList.contains('open')){
    closeNotes();
  }
});

// ── Resume active job on page load ───────────────────────────────────────────
function checkActiveJob(){
  fetch('/api/state').then(function(r){return r.json();}).then(function(d){
    if(d.snapshot){
      var snap=d.snapshot;
      // Switch straight to progress view
      document.getElementById('wizard').style.display='none';
      var pv=document.getElementById('pview');pv.classList.add('on');
      S.phases=[];S.tasks={};S.startTs=snap.startTs||Date.now();
      S.currentTask={label:'',folder:''};
      for(var k in S.timers)clearInterval(S.timers[k]);S.timers={};
      document.getElementById('phases').innerHTML='';
      document.getElementById('plog').innerHTML='';
      document.getElementById('pbar').style.width='0%';
      document.getElementById('pbar').classList.remove('done');
      document.getElementById('banner').className='banner';
      var running=snap.active;
      document.getElementById('pbadge').className='badge '+(running?'running':snap.complete&&!snap.complete.error?'done':'');
      document.getElementById('pbadge').textContent=running?'Running\\u2026':snap.complete&&!snap.complete.error?'Complete \\u2713':'Resumed';
      // SSE will replay planBuffer + send state_snapshot
      connectSSE();
    }
  }).catch(function(){});
}

// Init
initTheme();
browse('${__dirname.replace(/\\/g, '/')}');
checkActiveJob();
// Load initial notes badge on startup
fetch('/api/notes').then(function(r){return r.json();}).then(function(d){if(d.text)syncNotesBadge(d.text);}).catch(function(){});
</script>
</body>
</html>`
