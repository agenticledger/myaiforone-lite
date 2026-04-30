/**
 * Shared Canvas Module — file preview panel for any page.
 *
 * Usage:
 *   <link rel="stylesheet" href="/canvas.css">
 *   <script src="/canvas.js"></script>
 *   <script>
 *     Canvas.init({ getAgentId: () => selectedAgent });
 *   </script>
 *
 * Requires: mammoth.browser.min.js, jszip.min.js, xlsx.full.min.js (loaded before this script)
 * Expects CSS variables from the host page: --bg-surface, --border-dim, --font-mono, etc.
 */

window.Canvas = (function() {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────
  let canvasOpen = false;
  let canvasFile = null; // {path, name, ext, type, content}
  let _getAgentId = () => '';
  let _escapeHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Presentation (fullscreen) mode state
  let presentationActive = false;
  let presentationFiles = [];
  let presentationIndex = -1;

  // ─── Init ───────────────────────────────────────────────────────
  function init(opts) {
    if (opts.getAgentId) _getAgentId = opts.getAgentId;
    if (opts.escapeHtml) _escapeHtml = opts.escapeHtml;
  }

  // ─── File type detection ────────────────────────────────────────
  function getFileType(ext) {
    if (['html','htm'].includes(ext)) return 'html';
    if (['csv','tsv'].includes(ext)) return 'csv';
    if (['xlsx','xls'].includes(ext)) return 'xlsx';
    if (['md','markdown'].includes(ext)) return 'markdown';
    if (['svg'].includes(ext)) return 'svg';
    if (['png','jpg','jpeg','gif','webp'].includes(ext)) return 'image';
    if (['pdf'].includes(ext)) return 'pdf';
    if (['docx','doc'].includes(ext)) return 'docx';
    if (['pptx','ppt'].includes(ext)) return 'pptx';
    if (['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','sh','bash','zsh','sql','r','swift','kt','scala','lua','pl','php','css','scss','less'].includes(ext)) return 'code';
    if (['json'].includes(ext)) return 'json';
    if (['xml','yaml','yml','toml','ini','cfg','conf'].includes(ext)) return 'code';
    return 'text';
  }

  function getFileIcon(ext) {
    const icons = {
      pdf:'📄', csv:'📊', tsv:'📊', xlsx:'📊', xls:'📊',
      json:'📋', md:'📝', markdown:'📝', txt:'📝',
      png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', svg:'🖼️', webp:'🖼️',
      html:'🌐', htm:'🌐',
      docx:'📃', doc:'📃',
      pptx:'📽️', ppt:'📽️',
      zip:'📦',
      js:'⚡', ts:'⚡', py:'🐍', rb:'💎', go:'🔷', rs:'🦀',
      java:'☕', c:'⚙️', cpp:'⚙️', h:'⚙️',
      sh:'🐚', bash:'🐚', zsh:'🐚',
      sql:'🗃️', xml:'📰', yaml:'📰', yml:'📰',
    };
    return icons[ext] || '📁';
  }

  // ─── Toggle / Close ─────────────────────────────────────────────
  function _clearResizeInlineStyles() {
    const wrap = document.getElementById('chatBodyWrap');
    if (!wrap) return;
    const msgs = wrap.querySelector('.chat-messages');
    const panel = document.getElementById('canvasPanel');
    if (msgs) msgs.style.flex = '';
    if (panel) panel.style.width = '';
  }

  function toggle() {
    canvasOpen = !canvasOpen;
    const wrap = document.getElementById('chatBodyWrap');
    const btn = document.querySelector('.canvas-toggle-btn');
    if (wrap) wrap.classList.toggle('canvas-open', canvasOpen);
    if (btn) btn.classList.toggle('active', canvasOpen);
    if (canvasOpen) _initResize();
    else _clearResizeInlineStyles();
  }

  function close() {
    if (presentationActive) exitPresentation();
    canvasOpen = false;
    canvasFile = null;
    const wrap = document.getElementById('chatBodyWrap');
    const btn = document.querySelector('.canvas-toggle-btn');
    if (wrap) wrap.classList.remove('canvas-open');
    if (btn) btn.classList.remove('active');
    _clearResizeInlineStyles();
  }

  function isOpen() { return canvasOpen; }
  function currentFile() { return canvasFile; }

  // ─── Resize handle ─────────────────────────────────────────────
  function _initResize() {
    const handle = document.getElementById('canvasResizeHandle');
    if (!handle || handle._resizeInit) return;
    handle._resizeInit = true;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const wrap = document.getElementById('chatBodyWrap');
      const panel = document.getElementById('canvasPanel');
      if (!wrap || !panel) return;

      wrap.classList.add('canvas-resizing');
      handle.classList.add('dragging');

      const onMove = e => {
        const rect = wrap.getBoundingClientRect();
        const pxFromRight = rect.right - e.clientX;
        const totalW = rect.width;
        const pct = Math.max(20, Math.min(80, (pxFromRight / totalW) * 100));
        panel.style.width = pct + '%';
        const msgs = wrap.querySelector('.chat-messages');
        if (msgs) msgs.style.flex = `0 0 ${100 - pct}%`;
      };

      const onUp = () => {
        wrap.classList.remove('canvas-resizing');
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ─── Open file in canvas ────────────────────────────────────────
  async function openFile(encodedPath) {
    const path = decodeURIComponent(encodedPath);
    const name = path.split('/').pop() || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const type = getFileType(ext);
    const agentId = _getAgentId();

    canvasFile = { path, name, ext, type, content: null };
    canvasOpen = true;
    setTimeout(_initResize, 50);

    const wrap = document.getElementById('chatBodyWrap');
    const toggleBtn = document.querySelector('.canvas-toggle-btn');
    if (wrap) wrap.classList.add('canvas-open');
    if (toggleBtn) toggleBtn.classList.add('active');

    const panel = document.getElementById('canvasPanel');
    if (panel) {
      panel.innerHTML = `
        <div class="canvas-resize-handle" id="canvasResizeHandle"></div>
        <div class="canvas-header">
          <span class="canvas-file-icon">${getFileIcon(ext)}</span>
          <span class="canvas-filename" title="${_escapeHtml(path)}">${_escapeHtml(name)}</span>
          <button class="canvas-header-btn" onclick="Canvas.download('${encodeURIComponent(path)}')" title="Download">&#x2B07;</button>
          <button class="canvas-header-btn" onclick="Canvas.enterPresentation()" title="Presentation mode">&#x26F6;</button>
          <button class="canvas-header-btn" onclick="Canvas.close()" title="Close">&#x2715;</button>
        </div>
        <div class="canvas-content" id="canvasContent" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
          Loading...
        </div>
      `;
      // Re-init resize since we just replaced the handle
      const handle = document.getElementById('canvasResizeHandle');
      if (handle) handle._resizeInit = false;
      _initResize();
    }

    try {
      const dlBase = `/api/agents/${agentId}/download?path=${encodeURIComponent(path)}`;

      if (type === 'image') {
        const content = document.getElementById('canvasContent');
        if (content) { content.style = ''; content.innerHTML = `<img src="${dlBase}&inline=true" alt="${_escapeHtml(name)}" />`; }
        return;
      }

      if (type === 'pdf') {
        const content = document.getElementById('canvasContent');
        if (content) { content.style = ''; content.innerHTML = `<iframe src="${dlBase}&inline=true" style="width:100%;height:100%;border:none"></iframe>`; }
        return;
      }

      if (type === 'docx') {
        const res = await fetch(dlBase);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const content = document.getElementById('canvasContent');
        if (content) { content.style = ''; content.innerHTML = `<div class="canvas-docx">${result.value}</div>`; }
        return;
      }

      if (type === 'pptx') {
        const res = await fetch(dlBase);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const slideFiles = Object.keys(zip.files)
          .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
          .sort((a, b) => parseInt(a.match(/slide(\d+)/)[1]) - parseInt(b.match(/slide(\d+)/)[1]));

        const mediaFiles = Object.keys(zip.files).filter(f => /^ppt\/media\//i.test(f) && !zip.files[f].dir);
        const mediaMap = {};
        for (const mf of mediaFiles) {
          try { const blob = await zip.files[mf].async('blob'); mediaMap[mf.split('/').pop()] = URL.createObjectURL(blob); } catch {}
        }

        const slides = [];
        const parser = new DOMParser();
        for (const sf of slideFiles) {
          const xmlText = await zip.files[sf].async('text');
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
          const shapes = xmlDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sp');
          const shapeTexts = [];
          if (shapes.length > 0) {
            for (const shape of shapes) {
              const pNodes = shape.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'p');
              const lines = [];
              for (const p of pNodes) {
                const pTexts = p.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't');
                const lineText = Array.from(pTexts).map(t => t.textContent).join('');
                if (lineText.trim()) lines.push(lineText);
              }
              if (lines.length > 0) shapeTexts.push(lines);
            }
          } else {
            const textNodes = xmlDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't');
            const allT = Array.from(textNodes).map(t => t.textContent).join(' ');
            if (allT.trim()) shapeTexts.push([allT]);
          }

          const slideNum = sf.match(/slide(\d+)/)[1];
          const relPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
          const slideImages = [];
          if (zip.files[relPath]) {
            const relXml = await zip.files[relPath].async('text');
            const relDoc = parser.parseFromString(relXml, 'text/xml');
            const rels = relDoc.getElementsByTagName('Relationship');
            for (const rel of rels) {
              const target = rel.getAttribute('Target') || '';
              if (/\.(png|jpg|jpeg|gif|bmp|svg|webp|tiff|emf|wmf)$/i.test(target)) {
                const imgName = target.split('/').pop();
                if (mediaMap[imgName]) slideImages.push(mediaMap[imgName]);
              }
            }
          }
          slides.push({ shapeTexts, images: slideImages });
        }

        if (slides.length === 0) {
          const content = document.getElementById('canvasContent');
          if (content) { content.style = ''; content.innerHTML = '<div style="padding:20px;color:var(--text-muted)">No slides found.</div>'; }
          return;
        }

        window._pptxSlides = slides;
        window._pptxCurrentSlide = 0;
        const content = document.getElementById('canvasContent');
        if (content) { content.style = ''; _renderPptxSlide(content, 0, slides); }
        return;
      }

      if (type === 'xlsx') {
        const res = await fetch(dlBase);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        window._xlsxWorkbook = wb;
        window._xlsxCurrentSheet = 0;
        _renderXlsxSheet(0);
        return;
      }

      // Fetch as text for all other types
      const res = await fetch(dlBase);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      canvasFile.content = text;

      const content = document.getElementById('canvasContent');
      if (!content) return;
      content.style = '';

      if (type === 'svg') {
        content.innerHTML = `<div class="canvas-svg">${text}</div>`;
      } else if (type === 'json') {
        try {
          const parsed = JSON.parse(text);
          content.innerHTML = `<div class="json-tree"><ul>${_renderJsonTree(parsed, '', 0)}</ul></div>`;
          content.querySelectorAll('.json-toggle').forEach(tog => {
            tog.addEventListener('click', function() {
              const children = this.parentElement.querySelector('.json-children');
              if (children) {
                const collapsed = children.classList.toggle('collapsed');
                this.textContent = collapsed ? '\u25B6' : '\u25BC';
                const summary = this.parentElement.querySelector('.json-summary');
                if (summary) summary.style.display = collapsed ? 'inline' : 'none';
              }
            });
          });
        } catch { content.innerHTML = `<pre>${_escapeHtml(text)}</pre>`; }
      } else if (type === 'html') {
        const blob = new Blob([text], { type: 'text/html' });
        content.innerHTML = `<iframe src="${URL.createObjectURL(blob)}" sandbox="allow-scripts allow-same-origin" style="width:100%;height:100%;border:none;background:#fff"></iframe>`;
      } else if (type === 'csv') {
        content.innerHTML = _renderCsvTable(text, ext === 'tsv' ? '\t' : ',');
      } else if (type === 'markdown') {
        content.innerHTML = `<div class="canvas-md">${_formatMarkdown(text)}</div>`;
      } else if (type === 'code') {
        content.innerHTML = `<pre><code>${_escapeHtml(text)}</code></pre>`;
      } else {
        content.innerHTML = `<pre>${_escapeHtml(text)}</pre>`;
      }
    } catch (err) {
      const content = document.getElementById('canvasContent');
      if (content) content.innerHTML = `<div style="padding:20px;color:var(--text-muted)">Failed to load file: ${_escapeHtml(err.message)}</div>`;
    }
  }

  // ─── Presentation (fullscreen) mode ─────────────────────────────
  async function enterPresentation() {
    if (!canvasFile) return;
    const panel = document.getElementById('canvasPanel');
    if (!panel) return;
    presentationActive = true;
    panel.classList.add('canvas-fullscreen');
    document.body.classList.add('canvas-fullscreen-active');
    document.addEventListener('keydown', _presentationKeyHandler);

    // Fetch sibling files in same source + folder for prev/next nav
    presentationFiles = [];
    presentationIndex = -1;
    try {
      const agentId = _getAgentId();
      if (agentId) {
        const r = await fetch(`/api/agents/${agentId}/files`);
        if (r.ok) {
          const j = await r.json();
          const all = (j.files || []);
          const cur = all.find(f => f.path === canvasFile.path);
          const sameFolder = cur
            ? all.filter(f => f.source === cur.source && (f.folder || '') === (cur.folder || ''))
            : all;
          sameFolder.sort((a, b) => a.name.localeCompare(b.name));
          presentationFiles = sameFolder;
          presentationIndex = sameFolder.findIndex(f => f.path === canvasFile.path);
        }
      }
    } catch { /* ignore */ }

    _renderPresentationNav();
  }

  function exitPresentation() {
    presentationActive = false;
    presentationFiles = [];
    presentationIndex = -1;
    const panel = document.getElementById('canvasPanel');
    if (panel) panel.classList.remove('canvas-fullscreen');
    document.body.classList.remove('canvas-fullscreen-active');
    const nav = document.getElementById('canvasPresentationNav');
    if (nav) nav.remove();
    document.removeEventListener('keydown', _presentationKeyHandler);
  }

  function _presentationKeyHandler(e) {
    if (!presentationActive) return;
    if (e.key === 'Escape') { e.preventDefault(); exitPresentation(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); presentationNavigate(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); presentationNavigate(-1); }
  }

  function _renderPresentationNav() {
    let nav = document.getElementById('canvasPresentationNav');
    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'canvasPresentationNav';
      nav.className = 'canvas-presentation-nav';
      document.body.appendChild(nav);
    }
    const total = presentationFiles.length;
    const cur = presentationIndex;
    const hasPrev = cur > 0;
    const hasNext = cur >= 0 && cur < total - 1;
    const counter = total > 0 && cur >= 0
      ? `${_escapeHtml(canvasFile?.name || '')} &nbsp;·&nbsp; ${cur + 1} / ${total}`
      : _escapeHtml(canvasFile?.name || '');
    nav.innerHTML = `
      <button class="presentation-nav-btn" onclick="Canvas.presentationNavigate(-1)" ${hasPrev ? '' : 'disabled'} title="Previous file (←)">&#x25C0; Prev</button>
      <span class="presentation-counter">${counter}</span>
      <button class="presentation-nav-btn" onclick="Canvas.presentationNavigate(1)" ${hasNext ? '' : 'disabled'} title="Next file (→)">Next &#x25B6;</button>
      <button class="presentation-nav-btn presentation-exit" onclick="Canvas.exitPresentation()" title="Exit presentation (Esc)">&#x2715;</button>
    `;
  }

  function presentationNavigate(dir) {
    if (!presentationActive || presentationFiles.length === 0) return;
    let idx = presentationIndex + dir;
    if (idx < 0 || idx >= presentationFiles.length) return;
    presentationIndex = idx;
    const next = presentationFiles[idx];
    // openFile rebuilds panel innerHTML (header + content) but preserves the
    // panel element + its classList, so the canvas-fullscreen class persists.
    // The bottom nav lives on document.body, so it also persists — we just
    // re-render its label/counter to reflect the new file.
    openFile(encodeURIComponent(next.path)).then(() => {
      _renderPresentationNav();
    });
  }

  // ─── Download helper ────────────────────────────────────────────
  function download(encodedPath) {
    const path = decodeURIComponent(encodedPath);
    const agentId = _getAgentId();
    const a = document.createElement('a');
    a.href = `/api/agents/${agentId}/download?path=${encodeURIComponent(path)}`;
    a.download = path.split('/').pop() || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ─── PPTX rendering ────────────────────────────────────────────
  function _renderPptxSlide(container, index, slides) {
    const slide = slides[index];
    const total = slides.length;
    let textHtml = '';
    slide.shapeTexts.forEach((lines, si) => {
      if (si === 0 && lines.length > 0) {
        textHtml += `<div class="pptx-slide-title">${_escapeHtml(lines[0])}</div>`;
        textHtml += '<div class="pptx-slide-text">';
        lines.slice(1).forEach(l => { textHtml += `<p>${_escapeHtml(l)}</p>`; });
        textHtml += '</div>';
      } else {
        textHtml += '<div class="pptx-slide-text">';
        lines.forEach(l => { textHtml += `<p>${_escapeHtml(l)}</p>`; });
        textHtml += '</div>';
      }
    });
    let imgHtml = '';
    if (slide.images.length > 0) {
      imgHtml = '<div class="pptx-slide-images">';
      slide.images.forEach(src => { imgHtml += `<img src="${src}" alt="Slide image" />`; });
      imgHtml += '</div>';
    }
    container.innerHTML = `
      <div class="pptx-viewer">
        <div class="pptx-nav">
          <button class="pptx-nav-btn" onclick="Canvas.navigateSlide(-1)" ${index === 0 ? 'disabled' : ''}>&#x25C0; Prev</button>
          <span class="pptx-slide-counter">Slide ${index + 1} of ${total}</span>
          <button class="pptx-nav-btn" onclick="Canvas.navigateSlide(1)" ${index === total - 1 ? 'disabled' : ''}>Next &#x25B6;</button>
        </div>
        <div class="pptx-slide">
          ${textHtml || '<div style="color:var(--text-muted);font-style:italic">No text content on this slide</div>'}
          ${imgHtml}
        </div>
      </div>`;
  }

  function navigateSlide(direction) {
    const slides = window._pptxSlides;
    if (!slides) return;
    let idx = window._pptxCurrentSlide + direction;
    if (idx < 0) idx = 0;
    if (idx >= slides.length) idx = slides.length - 1;
    window._pptxCurrentSlide = idx;
    const content = document.getElementById('canvasContent');
    if (content) _renderPptxSlide(content, idx, slides);
  }

  // ─── CSV table ──────────────────────────────────────────────────
  function _parseCsvLine(line, delim) {
    const cells = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i+1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === delim) { cells.push(current); current = ''; }
        else { current += ch; }
      }
    }
    cells.push(current);
    return cells;
  }

  function _renderCsvTable(text, delimiter) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return '<pre>Empty file</pre>';
    const headers = _parseCsvLine(lines[0], delimiter);
    const rows = lines.slice(1).map(l => _parseCsvLine(l, delimiter));
    const tableId = 'csvTable-' + Math.random().toString(36).slice(2,8);
    let html = `<table class="canvas-csv-table" id="${tableId}"><thead><tr>`;
    headers.forEach((h, i) => {
      html += `<th onclick="Canvas.sortTable('${tableId}',${i})" title="Click to sort">${_escapeHtml(h.trim())} &#x25B4;&#x25BE;</th>`;
    });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>' + row.map(c => `<td>${_escapeHtml(c.trim())}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function sortTable(tableId, colIdx) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const tbody = table.querySelector('tbody');
    const rows = [...tbody.querySelectorAll('tr')];
    const dir = table.dataset.sortCol === String(colIdx) && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    table.dataset.sortCol = colIdx;
    table.dataset.sortDir = dir;
    rows.sort((a, b) => {
      const aVal = a.cells[colIdx]?.textContent || '';
      const bVal = b.cells[colIdx]?.textContent || '';
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) return dir === 'asc' ? aNum - bNum : bNum - aNum;
      return dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  // ─── XLSX sheets ────────────────────────────────────────────────
  function _renderXlsxSheet(sheetIndex) {
    const wb = window._xlsxWorkbook;
    if (!wb) return;
    const content = document.getElementById('canvasContent');
    if (!content) return;
    content.style = '';
    window._xlsxCurrentSheet = sheetIndex;
    const sheet = wb.Sheets[wb.SheetNames[sheetIndex]];
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    let html = '';
    if (wb.SheetNames.length > 1) {
      html += '<div class="canvas-xlsx-tabs">';
      wb.SheetNames.forEach((sn, i) => {
        html += `<button class="${i === sheetIndex ? 'active' : ''}" onclick="Canvas.renderSheet(${i})">${_escapeHtml(sn)}</button>`;
      });
      html += '</div>';
    }
    html += _renderCsvTable(csvText, ',');
    content.innerHTML = html;
  }

  // ─── JSON tree ──────────────────────────────────────────────────
  function _renderJsonTree(val, key, depth) {
    const maxExpandDepth = 2;
    if (val === null) {
      const kp = key !== '' ? `<span class="json-key">"${_escapeHtml(key)}"</span>: ` : '';
      return `<li>${kp}<span class="json-null">null</span></li>`;
    }
    if (typeof val === 'string') {
      const kp = key !== '' ? `<span class="json-key">"${_escapeHtml(key)}"</span>: ` : '';
      return `<li>${kp}<span class="json-string">"${_escapeHtml(val)}"</span></li>`;
    }
    if (typeof val === 'number') {
      const kp = key !== '' ? `<span class="json-key">"${_escapeHtml(key)}"</span>: ` : '';
      return `<li>${kp}<span class="json-number">${val}</span></li>`;
    }
    if (typeof val === 'boolean') {
      const kp = key !== '' ? `<span class="json-key">"${_escapeHtml(key)}"</span>: ` : '';
      return `<li>${kp}<span class="json-bool">${val}</span></li>`;
    }
    const isArray = Array.isArray(val);
    const entries = isArray ? val.map((v, i) => [i, v]) : Object.entries(val);
    const count = entries.length;
    const collapsed = depth >= maxExpandDepth;
    const openBracket = isArray ? '[' : '{';
    const closeBracket = isArray ? ']' : '}';
    const summary = isArray ? `[...] ${count} items` : `{...} ${count} keys`;
    const arrow = collapsed ? '\u25B6' : '\u25BC';
    const kp = key !== '' ? `<span class="json-key">"${_escapeHtml(key)}"</span>: ` : '';
    let html = `<li>${kp}<span class="json-toggle">${arrow}</span><span class="json-bracket">${openBracket}</span>`;
    html += `<span class="json-summary" style="display:${collapsed ? 'inline' : 'none'}">${summary}</span>`;
    html += `<ul class="json-children${collapsed ? ' collapsed' : ''}">`;
    entries.forEach(([k, v]) => { html += _renderJsonTree(v, isArray ? '' : String(k), depth + 1); });
    html += `</ul><span class="json-bracket">${closeBracket}</span></li>`;
    return html;
  }

  // ─── Markdown formatter ─────────────────────────────────────────
  function _formatMarkdown(text) {
    if (!text) return '';
    let html = _escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
    html = html.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border-dim);margin:1em 0">');
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    return html;
  }

  // ─── File path injection for message formatting ─────────────────
  function injectFileButtons(html, escapeHtmlFn) {
    const fileExts = 'csv|json|txt|md|pdf|xlsx|xls|docx|doc|pptx|ppt|png|jpg|jpeg|gif|svg|html|zip|xml|yaml|yml|tsv';
    const filePathRegex = new RegExp(`((?:~\\/|FileStorage\\/|\\/)[\\w.@/ -]*\\.(?:${fileExts}))`, 'gi');
    return html.replace(filePathRegex, (match) => {
      const decoded = match.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const fileName = decoded.split('/').pop();
      return `<code>${match}</code> <button class="download-btn" onclick="Canvas.download('${encodeURIComponent(decoded)}')" title="Download ${fileName}">&#x2B07; ${fileName}</button> <button class="canvas-btn" onclick="Canvas.openFile('${encodeURIComponent(decoded)}')" title="Preview in canvas">&#x25A8; Preview</button>`;
    });
  }

  // ─── Canvas panel HTML ──────────────────────────────────────────
  function getPanelHtml() {
    if (canvasFile) {
      return `<div class="canvas-panel" id="canvasPanel">
        <div class="canvas-resize-handle" id="canvasResizeHandle"></div>
        <div class="canvas-header">
          <span class="canvas-file-icon">${getFileIcon(canvasFile.ext)}</span>
          <span class="canvas-filename" title="${_escapeHtml(canvasFile.path)}">${_escapeHtml(canvasFile.name)}</span>
          <button class="canvas-header-btn" onclick="Canvas.download('${encodeURIComponent(canvasFile.path)}')" title="Download">&#x2B07;</button>
          <button class="canvas-header-btn" onclick="Canvas.enterPresentation()" title="Presentation mode">&#x26F6;</button>
          <button class="canvas-header-btn" onclick="Canvas.close()" title="Close">&#x2715;</button>
        </div>
        <div class="canvas-content" id="canvasContent"></div>
      </div>`;
    }
    return `<div class="canvas-panel" id="canvasPanel">
      <div class="canvas-resize-handle" id="canvasResizeHandle"></div>
      <div class="canvas-header">
        <span class="canvas-file-icon">&#x25A8;</span>
        <span class="canvas-filename" style="color:var(--text-muted)">No file open</span>
        <button class="canvas-header-btn" onclick="Canvas.close()" title="Close">&#x2715;</button>
      </div>
      <div class="canvas-content" style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:13px">
        <div style="text-align:center">
          <div style="font-size:32px;opacity:.3;margin-bottom:8px">&#x25A8;</div>
          <div>Click "Preview" on a file path to open it here</div>
        </div>
      </div>
    </div>`;
  }

  // ─── Public API ─────────────────────────────────────────────────
  return {
    init,
    toggle,
    close,
    isOpen,
    currentFile,
    openFile,
    download,
    enterPresentation,
    exitPresentation,
    presentationNavigate,
    navigateSlide,
    sortTable,
    renderSheet: _renderXlsxSheet,
    injectFileButtons,
    getPanelHtml,
    getFileType,
    getFileIcon,
  };
})();

// Backwards compat — global function aliases
function openInCanvas(p) { Canvas.openFile(p); }
function closeCanvas() { Canvas.close(); }
function toggleCanvas() { Canvas.toggle(); }
function navigatePptxSlide(d) { Canvas.navigateSlide(d); }
function sortCsvTable(t,c) { Canvas.sortTable(t,c); }
function renderXlsxSheet(i) { Canvas.renderSheet(i); }
