'use strict';
/* =========================================================================
   Drawing editor (modal) shared by model drawings and drawn buildings.
   Shapes: rectangle, ellipse, polygon, line; move, reshape, rotate, mirror,
   reorder, colour (and for buildings: edge style). A photo can be loaded as a
   tracing guide; drawings traced on the map show that part of the map photo.
   Loaded after drawing.js and unit-art.js.
   ========================================================================= */
let AE = null;
const artEditorActive = () => !!AE;
const AE_TOOLS = [['select', 'Select', 'V'], ['poly', 'Polygon', 'P'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['line', 'Line', 'L']];
const AE_TEXT = {
  model: {
    title: 'Model drawing', defName: 'Model', fresh: 'Outline traced – add turrets, tracks and details, then Save',
    photo: 'Load a top-down photo of the model to draw over.',
    tips: 'Build a tank from a hull rectangle, two darker tracks (draw one, then Mirror ↕), a turret ellipse and a barrel line. The front faces right. “Faction colour”, “Darker” and “Lighter” change with each army.',
    line: 'Drag to draw a barrel or antenna. Set its thickness on the right.',
  },
  building: {
    title: 'Building drawing', defName: 'Building', fresh: 'Outline traced – add rooms, walls, roofs and details, then Save',
    photo: 'Load a top-down photo or plan of the building to draw over.',
    tips: 'Draw the floor plan with rectangles and polygons, walls with lines. “Ruined – broken walls” gives the shattered look of a ruin; “Stone tiles” a paved floor. Shapes cast a shadow automatically.',
    line: 'Drag to draw a wall, pipe or fence. Set its thickness on the right.',
  },
};
// Model editor (kept for unit-art.js): target = 'tpl' | 'unit' | 'munit'.
const openArtEditor = (id, target, fresh) => openDrawEditor({ mode: 'model', id, target, fresh });

function openDrawEditor({ mode = 'model', id = null, target = 'tpl', fresh = false }) {
  const list = mode === 'model' ? doc.unitArt : doc.customTerrain, src = id ? list.find(a => a.id === id) : null;
  if (id && (!src || !src.parts)) return;
  const tgt = mode === 'model' ? artTarget(target) : null;
  AE = {
    mode, id, target, fresh, name: src ? src.name : (mode === 'model' ? ui.tpl.name : '') || AE_TEXT[mode].defName,
    parts: src ? JSON.parse(JSON.stringify(src.parts)) : [], origin: src && src.origin, seed: (src && src.seed) || randSeed(),
    tool: src ? 'select' : 'rect', sel: -1, drag: null, poly: null, cur: null, faction: (tgt && tgt.faction) || doc.factions[0].id,
    snap: true, lineW: mode === 'model' ? 3 : 6, photo: null, photoScale: 1, photoOp: .5, refOp: .55, see: true, hist: [], fut: [], dirty: false, view: null,
  };
  const T = AE_TEXT[mode], el = document.createElement('div'); el.className = 'ae-back'; el.id = 'artEditor';
  el.innerHTML = `<div class="ae" role="dialog" aria-label="${T.title} editor">
    <div class="ae-top"><b>${T.title}</b><input id="aeName" maxlength="60" value="${esc(AE.name)}" aria-label="Drawing name">
      <div class="ae-tools">${AE_TOOLS.map(([k, l, key]) => `<button data-ae="tool" data-v="${k}" title="${l} (${key})">${l}<kbd>${key}</kbd></button>`).join('')}</div>
      <button data-ae="undo" title="Undo (⌘/Ctrl+Z)">↶</button><button data-ae="redo" title="Redo (⌘/Ctrl+Shift+Z)">↷</button>
      <button data-ae="zoomOut" title="Zoom out">−</button><button data-ae="fit" title="Fit drawing">Fit</button><button data-ae="zoomIn" title="Zoom in">+</button>
      <span class="ae-sp"></span><button data-ae="cancel">Cancel</button><button data-ae="save" class="on">Save drawing</button></div>
    <div class="ae-main"><div class="ae-stage"><svg id="aeSvg" xmlns="http://www.w3.org/2000/svg"></svg></div><aside class="ae-side" id="aeSide"></aside></div>
    <div class="ae-hint" id="aeHint"></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', aeClick); el.addEventListener('input', aeInput);
  const s = $('#aeSvg');
  s.addEventListener('pointerdown', aeDown); s.addEventListener('pointermove', aeMove); s.addEventListener('pointerup', aeUp);
  s.addEventListener('dblclick', () => { if (AE.poly) aeFinishPoly(); });
  s.addEventListener('wheel', e => { e.preventDefault(); aeZoom(Math.exp(-e.deltaY * .0015), aePt(e)); }, { passive: false });
  aeFit(); aeSide(); aeRender();
  if (fresh) toast(T.fresh);
}
function closeArtEditor() { const el = $('#artEditor'); if (el) el.remove(); AE = null; }

/* view */
function aeSize() { const st = $('#aeSvg'); return [st.clientWidth || 600, st.clientHeight || 400]; }
function aeFit() {
  const def = AE.mode === 'model' ? [-30, -18, 30, 18] : [-80, -50, 80, 50];
  const [x1, y1, x2, y2] = AE.parts.length ? partsBox(AE.parts) : def, [cw, ch] = aeSize(), w = Math.max(x2 - x1, 10), h = Math.max(y2 - y1, 8);
  AE.view = { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, s: Math.min(cw / (w * 1.5), ch / (h * 1.5)) };
}
function aeZoom(k, at) {
  const v = AE.view, ns = clamp(v.s * k, .3, 80); at = at || { x: v.cx, y: v.cy };
  v.cx = at.x - (at.x - v.cx) * v.s / ns; v.cy = at.y - (at.y - v.cy) * v.s / ns; v.s = ns; aeRender();
}
function aePt(e) { const s = $('#aeSvg'), p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(s.getScreenCTM().inverse()); return { x: q.x, y: q.y }; }
const aeSnap = v => AE.snap ? Math.round(v * 2) / 2 : Math.round(v * 100) / 100;
const aeSnapPt = p => ({ x: aeSnap(p.x), y: aeSnap(p.y) });

/* history */
function aeSave() { AE.hist.push(JSON.stringify(AE.parts)); if (AE.hist.length > 100) AE.hist.shift(); AE.fut = []; AE.dirty = true; }
function aeUndo(redo) {
  const from = redo ? AE.fut : AE.hist, to = redo ? AE.hist : AE.fut; if (!from.length) return;
  to.push(JSON.stringify(AE.parts)); AE.parts = JSON.parse(from.pop()); AE.sel = Math.min(AE.sel, AE.parts.length - 1); aeSide(); aeRender();
}

/* painting */
const aeHasPhoto = () => !!(AE.photo || (AE.origin && doc.ref && doc.ref.src));
function aeColors() {
  if (AE.mode === 'building') return TER_COLORS;
  const fa = doc.factions.find(x => x.id === AE.faction) || doc.factions[0]; return artColors(fa.color, fa.ink);
}
const aePaints = () => AE.mode === 'building' ? TER_PAINTS : ART_PAINTS;
function aePartSVG(p, i, pid = 'ae') { return AE.mode === 'building' ? bldPartSVG(p, i, AE.seed, pid) : partSVG(p, aeColors()); }
// Markup of the whole drawing as it will look (used for downloads).
function aeDrawingMarkup() {
  if (AE.mode === 'building') return buildingMarkup({ id: 'dl', parts: AE.parts, seed: AE.seed });
  return AE.parts.map(p => partSVG(p, aeColors())).join('');
}
function aeDefaultPaint(t) {
  if (AE.mode === 'building') return t === 'line' ? { paint: 'wall', edge: 'solid' } : { paint: AE.parts.length ? 'roof' : 'wall', edge: 'solid' };
  return { paint: t === 'line' ? 'metal' : AE.parts.length ? 'dark' : 'body' };
}

function aeRender() {
  const s = $('#aeSvg'); if (!s) return;
  const [cw, ch] = aeSize(), v = AE.view, W = cw / v.s, H = ch / v.s, x0 = v.cx - W / 2, y0 = v.cy - H / 2, px = 1 / v.s, C = aeColors();
  s.setAttribute('viewBox', `${f(x0)} ${f(y0)} ${f(W)} ${f(H)}`);
  let o = `<defs>${TILES_DEF('ae')}<pattern id="aeG1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="${f(px)}"/></pattern>` +
    `<pattern id="aeG10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="${f(px)}"/></pattern></defs>` +
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="#c7e07a"/>`;
  if (AE.origin && doc.ref && doc.ref.src) o += `<image href="${esc(doc.ref.src)}" x="${f(-AE.origin[0])}" y="${f(-AE.origin[1])}" width="${doc.w}" height="${doc.h}" preserveAspectRatio="xMidYMid meet" opacity="${AE.refOp}"/>`;
  if (AE.photo) { const k = AE.photoScale, pw = AE.photo.w * k, ph = AE.photo.h * k; o += `<image href="${AE.photo.src}" x="${f(-pw / 2)}" y="${f(-ph / 2)}" width="${f(pw)}" height="${f(ph)}" opacity="${AE.photoOp}"/>`; }
  if (v.s >= 5) o += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="url(#aeG1)" pointer-events="none"/>`;
  o += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="url(#aeG10)" pointer-events="none"/>`;
  o += `<path d="M${f(x0)},0H${f(x0 + W)}M0,${f(y0)}V${f(y0 + H)}" stroke="#0a84ff" stroke-opacity=".45" stroke-width="${f(px)}" stroke-dasharray="${f(6 * px)} ${f(4 * px)}" pointer-events="none"/>`;
  if (AE.mode === 'model') o += `<text x="${f(x0 + W - 12 * px)}" y="${f(-6 * px)}" text-anchor="end" font-family="${FONT}" font-size="${f(12 * px)}" font-weight="bold" fill="#0a5bb5" opacity=".7" pointer-events="none">FRONT ▶</text>`;
  // With a photo behind the drawing, shapes are see-through so the photo stays visible while tracing.
  const see = AE.see && aeHasPhoto() ? ' opacity=".55"' : '', cur = `cursor:${AE.tool === 'select' ? 'move' : 'crosshair'}`;
  if (AE.mode === 'building' && AE.parts.length) o += `<g pointer-events="none"${see}>${bldShadow(AE.parts)}</g>`;
  AE.parts.forEach((p, i) => { o += `<g data-i="${i}"${see} style="${cur}">${aePartSVG(p, i)}</g>`; });
  // selection: dashed box, reshape handles, orange rotate handle
  const hd = (x, y, k, cls = '') => `<circle class="ae-h ${cls}" data-h="${k}" cx="${f(x)}" cy="${f(y)}" r="${f(5.5 * px)}" stroke-width="${f(1.5 * px)}"/>`;
  const p = AE.parts[AE.sel];
  if (p) {
    const [bx1, by1, bx2, by2] = partBox(p), [ccx] = partCenter(p), ry = by1 - 22 * px;
    o += `<rect x="${f(bx1)}" y="${f(by1)}" width="${f(bx2 - bx1)}" height="${f(by2 - by1)}" fill="none" stroke="#0a84ff" stroke-width="${f(px)}" stroke-dasharray="${f(4 * px)} ${f(3 * px)}" pointer-events="none"/>`;
    o += `<path d="M${f(ccx)},${f(by1)}V${f(ry)}" stroke="#ff9f1a" stroke-width="${f(1.5 * px)}" pointer-events="none"/>` + hd(ccx, ry, 'rot', 'rot');
    if (p.t === 'ellipse') {
      const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      o += hd(p.cx + p.rx * c, p.cy + p.rx * sn, 'rx') + hd(p.cx + p.ry * sn, p.cy - p.ry * c, 'ry');
    } else p.pts.forEach((q, j) => { o += hd(q[0], q[1], 'v' + j); });
  }
  // drawing in progress
  const live = AE.drag && AE.drag.preview;
  if (live) o += `<g opacity=".75" pointer-events="none">${aePartSVG(live, AE.parts.length)}</g>`;
  if (AE.poly) {
    const pts = AE.cur ? [...AE.poly, [AE.cur.x, AE.cur.y]] : AE.poly, fillC = AE.mode === 'building' ? TER_COLORS.wall : C.body;
    if (pts.length > 1) o += `<polyline points="${pts.map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${fillC}" fill-opacity=".35" stroke="#0a84ff" stroke-width="${f(1.5 * px)}" pointer-events="none"/>`;
    AE.poly.forEach((q, j) => { o += `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f((j ? 3.5 : 5) * px)}" fill="${j ? '#fff' : '#ffd23f'}" stroke="#0a84ff" stroke-width="${f(1.5 * px)}" pointer-events="none"/>`; });
  }
  s.innerHTML = o;
  document.querySelectorAll('#artEditor [data-ae="tool"]').forEach(b => b.classList.toggle('on', b.dataset.v === AE.tool));
  const hints = {
    select: 'Click a shape to select it, drag to move it, drag the white handles to reshape and the orange handle to rotate (Shift: 15° steps). Drag empty space to pan, scroll to zoom.',
    poly: 'Click each corner. Shift: 15° steps. Finish with the yellow first point, a double-click or Enter. Backspace removes the last point, Esc cancels.',
    rect: 'Drag to draw a rectangle. Its corners can be dragged and it can be rotated afterwards.',
    ellipse: 'Drag to draw an ellipse or circle. Shift: circle.',
    line: AE_TEXT[AE.mode].line,
  };
  $('#aeHint').textContent = hints[AE.tool] + '  Map scale: 1 grid square = 1 px on the map; bold lines every 10 px.';
}
function aeSide() {
  const side = $('#aeSide'); if (!side) return;
  const p = AE.parts[AE.sel], C = aeColors(), T = AE_TEXT[AE.mode], P = aePaints();
  let h = sec(AE.mode === 'model' ? 'Preview' : 'Canvas', (AE.mode === 'model' ? row('Faction', I.sel('ae', 'faction', AE.faction, doc.factions.map(fa => [fa.id, fa.name]))) : '') + I.check('ae', 'snap', AE.snap, 'Snap to half-pixel grid') + `<div class="btns"><button data-ae="download" title="Download this drawing as an .svg file">Download SVG</button></div>`);
  if (p) {
    const swatch = ([k, l]) => `<button data-ae="paint" data-v="${k}" title="${l}" class="${p.paint === k ? 'on' : ''}" style="background:${C[k]}${k === 'tiles' ? ';background-image:linear-gradient(90deg,rgba(0,0,0,.2) 1px,transparent 1px),linear-gradient(rgba(0,0,0,.2) 1px,transparent 1px);background-size:6px 6px' : ''}"></button>`;
    const label = (P.find(([k]) => k === p.paint) || [0, AE.mode === 'model' ? 'Custom colour (stays fixed for every faction)' : 'Custom colour'])[1];
    h += sec('Selected shape', `<div class="ae-sw">${P.map(swatch).join('')}<label title="Custom colour"><input type="color" data-t="ae" data-k="custom" value="${isHex(p.paint) ? p.paint : C[p.paint] || '#888888'}"></label></div><p class="hint">${esc(label)}</p>` +
      (AE.mode === 'building' ? row('Edge', I.sel('ae', 'edge', p.edge || 'solid', EDGES)) : '') +
      (p.t === 'line' ? row('Thickness', I.range('ae', 'w', p.w, .5, AE.mode === 'model' ? 20 : 40, .5)) : '') +
      row('Rotate', `<span class="btns" style="margin:0">${[-90, -15, 15, 90].map(v => `<button data-ae="rot" data-v="${v}" title="Turn ${Math.abs(v)}° ${v < 0 ? 'anti-clockwise' : 'clockwise'}">${v < 0 ? '↺' : '↻'} ${Math.abs(v)}°</button>`).join('')}</span>`) +
      `<div class="btns"><button data-ae="dup" title="⌘/Ctrl+D">Duplicate</button><button data-ae="mirY" title="Mirrored copy across the horizontal centre line">Mirror ↕</button><button data-ae="mirX" title="Mirrored copy across the vertical centre line">Mirror ↔</button></div>` +
      `<div class="btns"><button data-ae="front">To front</button><button data-ae="back">To back</button><button class="danger" data-ae="del" title="Delete">Delete</button></div>`);
  } else if (AE.tool === 'line') h += sec('New lines', row('Thickness', I.range('ae', 'lineW', AE.lineW, .5, AE.mode === 'model' ? 20 : 40, .5)));
  h += sec('Tracing photo', `<p class="hint">${T.photo} It is only a guide and is not saved.</p>` +
    (AE.photo ? row('Size', I.range('ae', 'photoScale', AE.photoScale, .05, 4, .05)) + row('Opacity', I.range('ae', 'photoOp', AE.photoOp, .1, 1, .05)) + `<div class="btns"><button data-ae="photo">Replace…</button><button data-ae="photoClear">Remove</button></div>` : `<div class="btns"><button data-ae="photo">Load photo…</button></div>`) +
    (AE.origin && doc.ref ? row('Map photo', I.range('ae', 'refOp', AE.refOp, 0, 1, .05)) : '') +
    (aeHasPhoto() ? I.check('ae', 'see', AE.see, 'See-through shapes while tracing') : ''));
  h += sec('Tips', `<p class="hint">${T.tips}</p>`);
  side.innerHTML = h;
}
function aeClick(e) {
  const b = e.target.closest('[data-ae]'); if (!b) return;
  const p = AE.parts[AE.sel], cmd = b.dataset.ae;
  switch (cmd) {
    case 'tool': aeSetTool(b.dataset.v); return;
    case 'undo': aeUndo(false); return;
    case 'redo': aeUndo(true); return;
    case 'zoomIn': aeZoom(1.25); return;
    case 'zoomOut': aeZoom(.8); return;
    case 'fit': aeFit(); aeRender(); return;
    case 'cancel': if (!AE.dirty || confirm('Discard your changes to this drawing?')) closeArtEditor(); return;
    case 'save': aeCommit(); return;
    case 'download':
      if (!AE.parts.length) return toast('Draw at least one shape first');
      downloadSVGFile(AE.name || AE_TEXT[AE.mode].defName, AE.mode === 'building' ? (() => { const b = partsBox(AE.parts); return [b[0] - 4, b[1] - 4, b[2] - b[0] + 12, b[3] - b[1] + 12]; })() : artViewBox({ parts: AE.parts }), aeDrawingMarkup()); return;
    case 'photo': aePickPhoto(); return;
    case 'photoClear': AE.photo = null; aeSide(); aeRender(); return;
  }
  if (!p) return;
  aeSave();
  if (cmd === 'paint') p.paint = b.dataset.v;
  else if (cmd === 'rot') { const [cx, cy] = partCenter(p); rotatePart(p, +b.dataset.v, cx, cy); }
  else if (cmd === 'dup') { const c = JSON.parse(JSON.stringify(p)); shiftPart(c, 2, 2); AE.parts.push(c); AE.sel = AE.parts.length - 1; }
  else if (cmd === 'mirY' || cmd === 'mirX') { const c = JSON.parse(JSON.stringify(p)); mirrorPart(c, cmd === 'mirY' ? 'y' : 'x'); AE.parts.push(c); AE.sel = AE.parts.length - 1; }
  else if (cmd === 'front') { AE.parts.splice(AE.sel, 1); AE.parts.push(p); AE.sel = AE.parts.length - 1; }
  else if (cmd === 'back') { AE.parts.splice(AE.sel, 1); AE.parts.unshift(p); AE.sel = 0; }
  else if (cmd === 'del') { AE.parts.splice(AE.sel, 1); AE.sel = -1; }
  aeSide(); aeRender();
}
function aeInput(e) {
  const el = e.target;
  if (el.id === 'aeName') { AE.name = el.value; AE.dirty = true; return; }
  if (el.dataset.t !== 'ae') return;
  const k = el.dataset.k, v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
  const out = el.parentElement && el.parentElement.querySelector('output'); if (out) out.textContent = v;
  const p = AE.parts[AE.sel];
  if (k === 'faction') { AE.faction = v; aeSide(); }
  else if (['snap', 'lineW', 'photoScale', 'photoOp', 'refOp', 'see'].includes(k)) AE[k] = v;
  else if (k === 'w' && p) { if (!AE.editW) aeSave(); AE.editW = true; p.w = v; }
  else if (k === 'custom' && p) { aeSave(); p.paint = v.toLowerCase(); aeSide(); }
  else if (k === 'edge' && p) { aeSave(); p.edge = v; }
  aeRender();
}
function aePickPhoto() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const [x1, , x2] = AE.parts.length ? partsBox(AE.parts) : [-30, -18, 30, 18]; AE.photo = { src: r.result, w: img.naturalWidth, h: img.naturalHeight }; AE.photoScale = Math.round(Math.max(x2 - x1, 40) * 1.4 / img.naturalWidth * 100) / 100 || 1; aeSide(); aeRender(); }; img.src = r.result; };
    r.readAsDataURL(file);
  };
  inp.click();
}
function aeSetTool(t) { if (AE.poly && t !== 'poly') AE.poly = null; AE.tool = t; aeSide(); aeRender(); }

/* pointer */
function aeDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  const s = $('#aeSvg'), raw = aePt(e), p = aeSnapPt(raw); AE.editW = false;
  if (e.button === 1) { AE.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: AE.view.cx, cy: AE.view.cy }; s.setPointerCapture(e.pointerId); return; }
  if (AE.tool === 'poly') {
    if (!AE.poly) AE.poly = [];
    const q = aePolySnap(p, e.shiftKey), first = AE.poly[0], last = AE.poly[AE.poly.length - 1], px = 1 / AE.view.s;
    if (AE.poly.length >= 3 && Math.hypot(q.x - first[0], q.y - first[1]) < 8 * px) return aeFinishPoly();
    if (!last || Math.hypot(q.x - last[0], q.y - last[1]) > 2 * px) AE.poly.push([q.x, q.y]);
    aeRender(); return;
  }
  const h = e.target.closest('[data-h]');
  if (AE.tool === 'select' || h) {
    const part = e.target.closest('[data-i]');
    if (h && h.dataset.h === 'rot') { const sp = AE.parts[AE.sel], [cx, cy] = partCenter(sp); AE.drag = { type: 'rotate', cx, cy, a0: Math.atan2(raw.y - cy, raw.x - cx), orig: JSON.stringify(sp), saved: false }; }
    else if (h) AE.drag = { type: 'handle', h: h.dataset.h, saved: false };
    else if (part) { AE.sel = +part.dataset.i; AE.drag = { type: 'move', last: p, saved: false }; aeSide(); }
    else { if (AE.sel >= 0) { AE.sel = -1; aeSide(); } AE.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: AE.view.cx, cy: AE.view.cy }; }
    s.setPointerCapture(e.pointerId); aeRender(); return;
  }
  AE.drag = { type: 'new', start: p, preview: null }; s.setPointerCapture(e.pointerId);
}
function aePolySnap(p, shift) {
  const last = AE.poly && AE.poly[AE.poly.length - 1]; if (!shift || !last) return p;
  const dx = p.x - last[0], dy = p.y - last[1], L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: aeSnap(last[0] + Math.cos(a) * L), y: aeSnap(last[1] + Math.sin(a) * L) };
}
function aeMove(e) {
  const d = AE.drag;
  if (!d) { if (AE.poly) { AE.cur = aePolySnap(aeSnapPt(aePt(e)), e.shiftKey); aeRender(); } return; }
  if (d.type === 'pan') { AE.view.cx = d.cx - (e.clientX - d.sx) / AE.view.s; AE.view.cy = d.cy - (e.clientY - d.sy) / AE.view.s; aeRender(); return; }
  const raw = aePt(e), p = aeSnapPt(raw), part = AE.parts[AE.sel];
  if (d.type === 'move' && part) {
    const dx = p.x - d.last.x, dy = p.y - d.last.y; if (!dx && !dy) return;
    if (!d.saved) { aeSave(); d.saved = true; }
    shiftPart(part, dx, dy); d.last = p; aeRender(); return;
  }
  if (d.type === 'rotate' && part) {
    if (!d.saved) { aeSave(); d.saved = true; }
    let deg = (Math.atan2(raw.y - d.cy, raw.x - d.cx) - d.a0) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    const q = JSON.parse(d.orig); rotatePart(q, deg, d.cx, d.cy); AE.parts[AE.sel] = q; aeRender(); return;
  }
  if (d.type === 'handle' && part) {
    if (!d.saved) { aeSave(); d.saved = true; }
    if (d.h === 'rx' || d.h === 'ry') {
      const a = (part.rot || 0) * Math.PI / 180, dx = raw.x - part.cx, dy = raw.y - part.cy;
      if (d.h === 'rx') part.rx = Math.max(.5, aeSnap(Math.abs(dx * Math.cos(a) + dy * Math.sin(a))));
      else part.ry = Math.max(.5, aeSnap(Math.abs(-dx * Math.sin(a) + dy * Math.cos(a))));
    } else part.pts[+d.h.slice(1)] = [p.x, p.y];
    aeRender(); return;
  }
  if (d.type === 'new') {
    const a = d.start, x1 = Math.min(a.x, p.x), y1 = Math.min(a.y, p.y), x2 = Math.max(a.x, p.x), y2 = Math.max(a.y, p.y);
    if (AE.tool === 'rect') d.preview = { t: 'poly', pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], ...aeDefaultPaint('poly') };
    else if (AE.tool === 'ellipse') {
      let rx = (x2 - x1) / 2, ry = (y2 - y1) / 2; if (e.shiftKey) rx = ry = Math.max(rx, ry);
      d.preview = { t: 'ellipse', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx, ry, ...aeDefaultPaint('ellipse') };
    } else d.preview = { t: 'line', pts: [[a.x, a.y], [p.x, p.y]], w: AE.lineW, ...aeDefaultPaint('line') };
    aeRender();
  }
}
function aeUp() {
  const d = AE && AE.drag; if (!d) return; AE.drag = null;
  if (d.type === 'new' && d.preview) {
    const [x1, y1, x2, y2] = partBox(d.preview), big = d.preview.t === 'line' ? Math.hypot(d.preview.pts[1][0] - d.preview.pts[0][0], d.preview.pts[1][1] - d.preview.pts[0][1]) >= 1 : x2 - x1 >= 1 && y2 - y1 >= 1;
    if (big) { aeSave(); AE.parts.push(d.preview); AE.sel = AE.parts.length - 1; aeSide(); }
  }
  aeRender();
}
function aeFinishPoly() {
  const pts = (AE.poly || []).filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > .01);
  AE.poly = null; AE.cur = null;
  if (pts.length < 3) { aeRender(); return toast('A polygon needs at least three points'); }
  aeSave(); AE.parts.push({ t: 'poly', pts, ...aeDefaultPaint('poly') }); AE.sel = AE.parts.length - 1; aeSide(); aeRender();
}

/* saving */
function aeCommit() {
  if (AE.poly && AE.poly.length >= 3) aeFinishPoly();
  if (!AE.parts.length) return toast('Draw at least one shape first');
  const name = (AE.name || '').trim() || AE_TEXT[AE.mode].defName, parts = JSON.parse(JSON.stringify(AE.parts)), isNew = !AE.id;
  pushHistory();
  if (AE.mode === 'building') {
    let c = AE.id && doc.customTerrain.find(x => x.id === AE.id);
    if (c) { const old = c.viewBox.split(' ').map(Number); Object.assign(c, { name, parts, seed: AE.seed }); finalizeBuilding(c); refitPieces(c, old); libSync(c); }
    else { c = finalizeBuilding({ id: uid(), name, kind: 'drawn', parts, seed: AE.seed }); doc.customTerrain.push(c); libAdd(c); ui.terrainType = 'custom:' + c.id; }
    closeArtEditor(); renderPanel(); render();
    return toast(isNew ? `“${name}” saved to your library – click the map to place it` : `“${name}” saved`);
  }
  let a = AE.id && doc.unitArt.find(x => x.id === AE.id);
  if (a) { const old = artViewBox(a); Object.assign(a, { name, parts }); refitUnits(a, old); }
  else { a = { id: uid(), name, parts }; doc.unitArt.push(a); }
  libAddArt(a);
  const target = AE.target; closeArtEditor();
  if (isNew) assignArt(target, a.id); else { renderPanel(); render(); }
  toast(`“${name}” saved${isNew ? ' and added to your library' : ''}`);
}
// When a drawing grows or shrinks, placed copies keep their scale (and buildings their position on the map).
function refitPieces(c, [ox, oy, ow, oh]) {
  const [nx, ny, nw, nh] = c.viewBox.split(' ').map(Number); if (ox === nx && oy === ny && ow === nw && oh === nh) return;
  for (const t of doc.terrain) if (t.type === 'custom' && t.custom === c.id) {
    const sx = t.w / ow, sy = t.h / oh, a = (t.rot || 0) * Math.PI / 180, dx = ((nx + nw / 2) - (ox + ow / 2)) * sx, dy = ((ny + nh / 2) - (oy + oh / 2)) * sy, r1 = v => Math.round(v * 10) / 10;
    t.x = r1(t.x + dx * Math.cos(a) - dy * Math.sin(a)); t.y = r1(t.y + dx * Math.sin(a) + dy * Math.cos(a)); t.w = r1(nw * sx); t.h = r1(nh * sy);
  }
}
function refitUnits(a, [, , ow, oh]) {
  const [, , nw, nh] = artViewBox(a); if (ow === nw && oh === nh) return;
  for (const u of [...doc.units, ui.tpl]) if (u.art === a.id) { const k = Math.min(u.w / ow, u.h / oh); u.w = Math.max(4, Math.round(nw * k)); u.h = Math.max(4, Math.round(nh * k)); }
}

/* Tracing a building on the map: the outline becomes the floor plan, then the
   editor opens with the map photo behind it (same flow as models). */
const TRACE_LOOKS = { building: { paint: 'wall', edge: 'solid' }, ruin: { paint: 'tiles', edge: 'broken' }, platform: { paint: 'metal', edge: 'hazard' } };
function finishBuildingTrace(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), r1 = v => Math.round(v * 10) / 10;
  const cx = r1((Math.min(...xs) + Math.max(...xs)) / 2), cy = r1((Math.min(...ys) + Math.max(...ys)) / 2);
  if (Math.max(...xs) - Math.min(...xs) < 4 || Math.max(...ys) - Math.min(...ys) < 4) return toast('That outline is too small');
  const n = doc.customTerrain.filter(c => c.parts).length + 1;
  const c = finalizeBuilding({ id: uid(), name: 'Building ' + n, kind: 'drawn', seed: randSeed(), origin: [cx, cy], parts: [{ t: 'poly', pts: pts.map(([x, y]) => [r1(x - cx), r1(y - cy)]), ...(TRACE_LOOKS[ui.traceStyle] || TRACE_LOOKS.building) }] });
  pushHistory(); doc.customTerrain.push(c); libAdd(c);
  const [vx, vy, vw, vh] = c.viewBox.split(' ').map(Number), piece = { id: uid(), type: 'custom', custom: c.id, x: r1(cx + vx + vw / 2), y: r1(cy + vy + vh / 2), w: vw, h: vh, rot: 0, seed: 1 };
  doc.terrain.push(piece); ui.trace = null; ui.terrainType = 'custom:' + c.id;
  ui.sel = [{ k: 'ter', id: piece.id }]; renderPanel(); render();
  openDrawEditor({ mode: 'building', id: c.id, fresh: true });
}
Object.assign(ACT, {
  bldNew() { openDrawEditor({ mode: 'building' }); },
  bldEdit(b) { openDrawEditor({ mode: 'building', id: b.dataset.v }); },
  bldSvg(b) { const c = designById(b.dataset.v); if (c) { const [x, y, w, h] = c.viewBox.split(' ').map(Number); downloadSVGFile(c.name, c.parts ? [x - 4, y - 4, w + 12, h + 12] : [x, y, w, h], c.markup); } },
});

// Keyboard while the editor is open (always swallows keys so the map below is untouched).
function artEditorKey(e) {
  if (!AE) return false;
  const el = e.target, typing = el.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(el.type);
  if (typing) return true;
  const mod = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, p = AE.parts[AE.sel];
  const run = cmd => aeClick({ target: { closest: () => ({ dataset: { ae: cmd } }) } });
  if (mod && k === 'z') { e.preventDefault(); aeUndo(e.shiftKey); return true; }
  if (mod && k === 'y') { e.preventDefault(); aeUndo(true); return true; }
  if (mod && k === 'd') { e.preventDefault(); if (p) run('dup'); return true; }
  if (mod) return true;
  if (AE.poly) {
    if (k === 'Enter') { e.preventDefault(); aeFinishPoly(); return true; }
    if (k === 'Escape') { e.preventDefault(); AE.poly = null; aeRender(); return true; }
    if (k === 'Backspace') { e.preventDefault(); AE.poly.pop(); aeRender(); return true; }
  }
  if ((k === 'Delete' || k === 'Backspace') && p) { e.preventDefault(); run('del'); return true; }
  if (k === 'Escape') { e.preventDefault(); if (AE.sel >= 0) { AE.sel = -1; aeSide(); aeRender(); } return true; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (arrows && p) { e.preventDefault(); aeSave(); const st = e.shiftKey ? 5 : .5; shiftPart(p, arrows[0] * st, arrows[1] * st); aeRender(); return true; }
  const tool = { v: 'select', p: 'poly', r: 'rect', o: 'ellipse', l: 'line' }[k];
  if (tool) aeSetTool(tool);
  return true;
}
window.addEventListener('resize', () => { if (AE) aeRender(); });
