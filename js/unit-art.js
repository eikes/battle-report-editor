'use strict';
/* =========================================================================
   Model drawings: a unit can be shown as a drawing (e.g. a top-down tank)
   instead of a counter. Drawings are made in the drawing editor, traced on
   the map / reference photo, or uploaded as SVG. Loaded after editor.js and
   uses its helpers (doc, ui, f, esc, uid, render, ...).

   doc.unitArt: drawn    { id, name, parts: [part], origin?: [x, y] }
                uploaded { id, name, kind: 'svg', viewBox, markup, tintMarkup, tint }
   part: { t: 'poly', pts: [[x, y], ...], paint }
       | { t: 'ellipse', cx, cy, rx, ry, paint }
       | { t: 'line', pts: [[x, y], [x, y]], w, paint }
   Coordinates are map pixels centred on 0,0; the front of a model faces right.
   `paint` is a palette name (ART_PAINTS) or a #rrggbb colour.
   ========================================================================= */
const ART_PAINTS = [['body', 'Faction colour'], ['dark', 'Darker'], ['light', 'Lighter'], ['ink', 'Symbol colour'], ['metal', 'Metal grey'], ['black', 'Black'], ['white', 'White']];
const ART_SW = 1.2;
const LOOKS = [['counter', 'Counter (shape + symbol)'], ['model', 'Model drawing']];

function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
}
const artColors = (fill, ink) => ({ body: fill, dark: shade(fill, -.38), light: shade(fill, .4), ink, metal: '#8a9097', black: '#1a1a1a', white: '#f2f2f2' });
const paintOf = (p, C) => C[p] || (/^#[0-9a-f]{6}$/i.test(p || '') ? p : C.body);

function partSVG(p, C, extra = '') {
  const fill = paintOf(p.paint, C), st = `stroke="#111111" stroke-width="${ART_SW}" stroke-linejoin="round"`;
  if (p.t === 'ellipse') return `<ellipse cx="${f(p.cx)}" cy="${f(p.cy)}" rx="${f(p.rx)}" ry="${f(p.ry)}" fill="${fill}" ${st}${extra}/>`;
  if (p.t === 'line') {
    const d = `M${f(p.pts[0][0])},${f(p.pts[0][1])}L${f(p.pts[1][0])},${f(p.pts[1][1])}`;
    return `<g fill="none" stroke-linecap="square"${extra}><path d="${d}" stroke="#111111" stroke-width="${f(p.w + ART_SW * 2)}"/><path d="${d}" stroke="${fill}" stroke-width="${f(p.w)}"/></g>`;
  }
  return `<polygon points="${p.pts.map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${fill}" ${st}${extra}/>`;
}
function partBox(p) {
  if (p.t === 'ellipse') return [p.cx - p.rx, p.cy - p.ry, p.cx + p.rx, p.cy + p.ry];
  const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]), e = p.t === 'line' ? p.w / 2 : 0;
  return [Math.min(...xs) - e, Math.min(...ys) - e, Math.max(...xs) + e, Math.max(...ys) + e];
}
function partsBox(parts) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of parts) { const q = partBox(p); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
  return isFinite(b[0]) ? b : [-20, -12, 20, 12];
}
function artViewBox(a) {
  if (a.kind === 'svg') return a.viewBox.split(' ').map(Number);
  const [x1, y1, x2, y2] = partsBox(a.parts), e = ART_SW;
  return [x1 - e, y1 - e, x2 - x1 + 2 * e, y2 - y1 + 2 * e].map(v => Math.round(v * 100) / 100);
}
function artInner(a, fill, ink) {
  if (a.kind === 'svg') return a.tint ? a.tintMarkup.split('__INK__').join(fill) : a.markup;
  const C = artColors(fill, ink);
  return a.parts.map(p => partSVG(p, C)).join('');
}
const artById = id => id ? (doc.unitArt.find(a => a.id === id) || unitLibrary.find(a => a.id === id)) : null;
// Drawn into the unit's w x h box (aspect kept), used by unitShapeSVG.
function artUnitSVG(a, w, h, fill, ink) {
  return `<svg x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" viewBox="${artViewBox(a).join(' ')}" overflow="visible">${artInner(a, fill, ink)}</svg>`;
}
function artThumb(a, fill, ink) {
  const [x, y, w, h] = artViewBox(a), pw = w * .12, ph = h * .12;
  return `<svg viewBox="${f(x - pw)} ${f(y - ph)} ${f(w + 2 * pw)} ${f(h + 2 * ph)}">${artInner(a, fill, ink)}</svg>`;
}
// Natural size of a drawing on the map (drawn ones are in map pixels).
function artSize(a) {
  const [, , w, h] = artViewBox(a);
  if (a.kind === 'svg') { const k = 60 / Math.max(w, h); return [Math.round(w * k), Math.round(h * k)]; }
  const k = Math.min(1, 240 / Math.max(w, h)); return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
}

/* ---------- validation (project files, clipboard, library imports) ---------- */
const num = v => typeof v === 'number' && isFinite(v);
const okPt = q => Array.isArray(q) && num(q[0]) && num(q[1]);
const okPaint = p => ART_PAINTS.some(([k]) => k === p) || /^#[0-9a-f]{6}$/i.test(p || '');
function cleanPart(p) {
  if (!p || typeof p !== 'object') return null;
  const paint = okPaint(p.paint) ? p.paint : 'body';
  if (p.t === 'ellipse' && [p.cx, p.cy, p.rx, p.ry].every(num)) return { t: 'ellipse', cx: p.cx, cy: p.cy, rx: Math.abs(p.rx), ry: Math.abs(p.ry), paint };
  if (p.t === 'line' && Array.isArray(p.pts) && p.pts.length === 2 && p.pts.every(okPt)) return { t: 'line', pts: p.pts.map(q => [q[0], q[1]]), w: num(p.w) ? clamp(p.w, .5, 40) : 3, paint };
  if (p.t === 'poly' && Array.isArray(p.pts) && p.pts.length >= 3 && p.pts.every(okPt)) return { t: 'poly', pts: p.pts.map(q => [q[0], q[1]]), paint };
  return null;
}
function cleanArt(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { id: String(a.id || '').replace(/[^\w-]/g, '').slice(0, 40) || uid(), name: String(a.name || 'Model').slice(0, 60) };
  if (a.kind === 'svg') {
    try {
      const c = importSvgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(String(a.viewBox || '0 0 24 24'))}">${String(a.markup || '')}</svg>`, out.name);
      return { ...out, kind: 'svg', viewBox: c.viewBox, markup: c.markup, tintMarkup: c.tintMarkup, tint: typeof a.tint === 'boolean' ? a.tint : c.tint };
    } catch (err) { return null; }
  }
  const parts = (Array.isArray(a.parts) ? a.parts : []).map(cleanPart).filter(Boolean);
  if (!parts.length) return null;
  out.parts = parts; if (Array.isArray(a.origin) && okPt(a.origin)) out.origin = [a.origin[0], a.origin[1]];
  return out;
}
function ensureArt(id) {
  if (doc.unitArt.some(a => a.id === id)) return true;
  const a = unitLibrary.find(x => x.id === id); if (!a) return false;
  doc.unitArt.push(JSON.parse(JSON.stringify(a))); return true;
}
function libAddArt(a) { const c = JSON.parse(JSON.stringify(a)), i = unitLibrary.findIndex(x => x.id === a.id); if (i >= 0) unitLibrary[i] = c; else unitLibrary.push(c); return saveLibrary(); }
function libSyncArt(a) { if (a && unitLibrary.some(x => x.id === a.id)) libAddArt(a); }

/* ------------------------------ panel UI ------------------------------------ */
// 'tpl' = the unit tool's template, 'unit' = the selected unit, 'munit' = every selected unit.
const artTargets = t => (t === 'unit' ? [getObj(ui.sel[0])] : t === 'munit' ? selUnits() : [ui.tpl]).filter(Boolean);
const artTarget = t => artTargets(t)[0];
function artPicker(t, cur, faction) {
  const fa = doc.factions.find(x => x.id === faction) || doc.factions[0], libOnly = unitLibrary.filter(a => !doc.unitArt.some(x => x.id === a.id));
  const btn = a => `<button data-act="pickArt" data-t="${t}" data-v="${a.id}" class="${a.id === cur ? 'on' : ''}" title="${esc(a.name)}">${artThumb(a, fa.color, fa.ink)}${esc(a.name)}</button>`;
  let h = `<div class="iconhdr">Model drawings in this report</div>` + (doc.unitArt.length ? `<div class="pal">${doc.unitArt.map(btn).join('')}</div>` : '<p class="hint">None yet. Draw one, trace one on the map (over a reference photo), or upload an SVG. Models face right.</p>');
  if (libOnly.length) h += `<div class="iconhdr">From your library</div><div class="pal">${libOnly.map(btn).join('')}</div>`;
  h += `<div class="btns"><button data-act="artNew" data-t="${t}">Draw new…</button><button data-act="artTrace" data-t="${t}">Trace on map</button><button data-act="artUpload" data-t="${t}">Upload SVG…</button></div>`;
  const a = cur && doc.unitArt.find(x => x.id === cur);
  if (a) {
    const inLib = unitLibrary.some(x => x.id === a.id);
    h += `<div class="fac">${row('Drawing name', I.text('uart', 'name', a.name, `data-i="${a.id}"`))}` +
      (a.kind === 'svg' ? I.check('uart', 'tint', a.tint, 'Recolour with faction colour', `data-i="${a.id}" data-rp`) : '') +
      `<div class="btns">${a.kind === 'svg' ? '' : `<button data-act="artEdit" data-t="${t}" data-v="${a.id}">Edit drawing…</button>`}<button data-act="artFit" data-t="${t}">Restore proportions</button></div>` +
      `<div class="btns">${inLib ? `<button class="danger" data-act="artUnlib" data-v="${a.id}">Remove from library</button>` : `<button data-act="artLib" data-v="${a.id}">Save to library</button>`}<button class="danger" data-act="artDelete" data-v="${a.id}">Remove from report…</button></div></div>`;
  }
  return h;
}
// The "Look" rows of the unit-type and unit panels.
function lookRows(t, o) {
  const look = o.look === 'model' ? 'model' : 'counter';
  let h = row('Look', I.sel(t, 'look', look, LOOKS, 'data-rp'));
  h += look === 'model' ? artPicker(t, o.art, o.faction) : row('Shape', I.sel(t, 'shape', o.shape, SHAPES, 'data-rp')) + iconPicker(t, o.icon);
  return h;
}
function assignArt(t, id) {
  const os = artTargets(t), a = artById(id); if (!os.length || !a) return;
  if (t !== 'tpl') pushHistory();
  ensureArt(id); const [w, h] = artSize(a);
  for (const o of os) Object.assign(o, { look: 'model', art: id, w, h });
  ui.mLookModel = null; renderPanel(); render();
}
Object.assign(ACT, {
  pickArt(b) { assignArt(b.dataset.t, b.dataset.v); },
  artNew(b) { openArtEditor(null, b.dataset.t); },
  artEdit(b) { openArtEditor(b.dataset.v, b.dataset.t); },
  artTrace(b) { ui.artTraceTarget = b.dataset.t; startTrace('unit'); },
  artUpload(b) { ui.artTarget = b.dataset.t; $('#fileArt').click(); },
  artFit(b) { const os = artTargets(b.dataset.t).filter(o => artById(o.art)); if (!os.length) return; if (b.dataset.t !== 'tpl') pushHistory(); for (const o of os) { const [, , vw, vh] = artViewBox(artById(o.art)); o.h = Math.max(4, Math.round(o.w * vh / vw)); } renderPanel(); render(); },
  artLib(b) { const a = doc.unitArt.find(x => x.id === b.dataset.v); if (a && libAddArt(a)) toast(`“${a.name}” saved to your library`); renderPanel(); },
  artUnlib(b) {
    const a = unitLibrary.find(x => x.id === b.dataset.v); if (!a || !confirm(`Remove “${a.name}” from your library? This report keeps its copy.`)) return;
    unitLibrary = unitLibrary.filter(x => x.id !== a.id); saveLibrary(); renderPanel();
  },
  artDelete(b) {
    const id = b.dataset.v, a = doc.unitArt.find(x => x.id === id); if (!a) return;
    const users = doc.units.filter(u => u.art === id);
    if (!confirm(`Remove “${a.name}” from this report?${users.length ? ` ${users.length} unit${users.length === 1 ? '' : 's'} using it go back to counters.` : ''}`)) return;
    pushHistory(); doc.unitArt = doc.unitArt.filter(x => x.id !== id);
    for (const u of users) { u.look = 'counter'; delete u.art; }
    if (ui.tpl.art === id) { ui.tpl.look = 'counter'; delete ui.tpl.art; }
    renderPanel(); render();
  },
});
$('#fileArt').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const c = importSvgIcon(await file.text(), file.name), a = { id: c.id, name: c.name, kind: 'svg', viewBox: c.viewBox, markup: c.markup, tintMarkup: c.tintMarkup, tint: c.tint };
    pushHistory(); doc.unitArt.push(a); assignArt(ui.artTarget || 'tpl', a.id);
    toast(c.tint ? 'Model uploaded – recoloured with the faction colour' : 'Model uploaded with its own colours');
  } catch (err) { toast('Could not use ' + file.name + ': ' + err.message); }
};

/* Tracing a model on the map: the outline becomes the body; the drawing editor
   then opens with the reference photo behind it to add turrets, tracks etc. */
function finishUnitTrace(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, r1 = v => Math.round(v * 10) / 10;
  const n = doc.unitArt.filter(a => a.origin).length + 1;
  const named = ui.artTraceTarget !== 'tpl' && artTarget(ui.artTraceTarget) ? artTarget(ui.artTraceTarget).name : ui.tpl.name;
  const a = { id: uid(), name: (named || 'Model') + ' ' + n, parts: [{ t: 'poly', pts: pts.map(([x, y]) => [r1(x - cx), r1(y - cy)]), paint: 'body' }], origin: [r1(cx), r1(cy)] };
  pushHistory(); doc.unitArt.push(a); libAddArt(a);
  const target = ui.artTraceTarget || 'tpl'; ui.trace = null;
  if ((target === 'unit' || target === 'munit') && artTargets(target).length) {
    const [w, h] = artSize(a); for (const u of artTargets(target)) Object.assign(u, { look: 'model', art: a.id, w, h });
  } else {
    const t = ui.tpl; Object.assign(t, { look: 'model', art: a.id }); [t.w, t.h] = artSize(a);
    const u = { id: uid(), faction: t.faction, name: t.name, label: '', shape: 'rect', icon: t.icon, look: 'model', art: a.id, w: t.w, h: t.h, keys: { [rid(ui.cur)]: { x: r1(cx), y: r1(cy), rot: 0, status: 'active' } } };
    doc.units.push(u); setTool('select', true); ui.sel = [{ k: 'unit', id: u.id }];
  }
  renderPanel(); render();
  openArtEditor(a.id, 'unit', true);
}

/* ============================ drawing editor =============================== */
let AE = null;
const artEditorActive = () => !!AE;
const AE_TOOLS = [['select', 'Select', 'V'], ['poly', 'Polygon', 'P'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['line', 'Line', 'L']];
function openArtEditor(id, target, fresh) {
  const src = id ? doc.unitArt.find(a => a.id === id) : null;
  if (id && (!src || src.kind === 'svg')) return;
  const tgt = artTarget(target), fac = (tgt && tgt.faction) || doc.factions[0].id;
  AE = {
    id, target, fresh, name: src ? src.name : (ui.tpl.name || 'Model'), parts: src ? JSON.parse(JSON.stringify(src.parts)) : [], origin: src && src.origin,
    tool: src ? 'select' : 'rect', sel: -1, drag: null, poly: null, cur: null, faction: fac, snap: true, lineW: 3,
    photo: null, photoScale: 1, photoOp: .5, refOp: .55, see: true, hist: [], fut: [], dirty: false, view: null,
  };
  const el = document.createElement('div'); el.className = 'ae-back'; el.id = 'artEditor';
  el.innerHTML = `<div class="ae" role="dialog" aria-label="Model drawing editor">
    <div class="ae-top"><b>Model drawing</b><input id="aeName" maxlength="60" value="${esc(AE.name)}" aria-label="Drawing name">
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
  if (fresh) toast('Outline traced – add turrets, tracks and details, then Save');
}
function closeArtEditor() { const el = $('#artEditor'); if (el) el.remove(); AE = null; }

function aeSize() { const st = $('#aeSvg'); return [st.clientWidth || 600, st.clientHeight || 400]; }
function aeFit() {
  let [x1, y1, x2, y2] = AE.parts.length ? partsBox(AE.parts) : [-30, -18, 30, 18];
  const [cw, ch] = aeSize(), w = Math.max(x2 - x1, 10), h = Math.max(y2 - y1, 8);
  AE.view = { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, s: Math.min(cw / (w * 1.5), ch / (h * 1.5)) };
}
function aeZoom(k, at) {
  const v = AE.view, ns = clamp(v.s * k, 1, 80); at = at || { x: v.cx, y: v.cy };
  v.cx = at.x - (at.x - v.cx) * v.s / ns; v.cy = at.y - (at.y - v.cy) * v.s / ns; v.s = ns; aeRender();
}
function aePt(e) { const s = $('#aeSvg'), p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(s.getScreenCTM().inverse()); return { x: q.x, y: q.y }; }
const aeSnap = v => AE.snap ? Math.round(v * 2) / 2 : Math.round(v * 100) / 100;
const aeSnapPt = p => ({ x: aeSnap(p.x), y: aeSnap(p.y) });
function aeSave() { AE.hist.push(JSON.stringify(AE.parts)); if (AE.hist.length > 100) AE.hist.shift(); AE.fut = []; AE.dirty = true; }
function aeUndo(redo) {
  const from = redo ? AE.fut : AE.hist, to = redo ? AE.hist : AE.fut; if (!from.length) return;
  to.push(JSON.stringify(AE.parts)); AE.parts = JSON.parse(from.pop()); AE.sel = Math.min(AE.sel, AE.parts.length - 1); aeSide(); aeRender();
}
const aeHasPhoto = () => !!(AE.photo || (AE.origin && doc.ref && doc.ref.src));
function aeColors() { const fa = doc.factions.find(x => x.id === AE.faction) || doc.factions[0]; return artColors(fa.color, fa.ink); }

function aeRender() {
  const s = $('#aeSvg'); if (!s) return;
  const [cw, ch] = aeSize(), v = AE.view, W = cw / v.s, H = ch / v.s, x0 = v.cx - W / 2, y0 = v.cy - H / 2, px = 1 / v.s, C = aeColors();
  s.setAttribute('viewBox', `${f(x0)} ${f(y0)} ${f(W)} ${f(H)}`);
  let o = `<defs><pattern id="aeG1" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#000" stroke-opacity=".07" stroke-width="${f(px)}"/></pattern>` +
    `<pattern id="aeG10" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="${f(px)}"/></pattern></defs>` +
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="#c7e07a"/>`;
  if (AE.origin && doc.ref && doc.ref.src) o += `<image href="${esc(doc.ref.src)}" x="${f(-AE.origin[0])}" y="${f(-AE.origin[1])}" width="${doc.w}" height="${doc.h}" preserveAspectRatio="xMidYMid meet" opacity="${AE.refOp}"/>`;
  if (AE.photo) { const k = AE.photoScale, pw = AE.photo.w * k, ph = AE.photo.h * k; o += `<image href="${AE.photo.src}" x="${f(-pw / 2)}" y="${f(-ph / 2)}" width="${f(pw)}" height="${f(ph)}" opacity="${AE.photoOp}"/>`; }
  if (v.s >= 5) o += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="url(#aeG1)" pointer-events="none"/>`;
  o += `<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="url(#aeG10)" pointer-events="none"/>`;
  o += `<path d="M${f(x0)},0H${f(x0 + W)}M0,${f(y0)}V${f(y0 + H)}" stroke="#0a84ff" stroke-opacity=".45" stroke-width="${f(px)}" stroke-dasharray="${f(6 * px)} ${f(4 * px)}" pointer-events="none"/>`;
  o += `<text x="${f(x0 + W - 12 * px)}" y="${f(-6 * px)}" text-anchor="end" font-family="${FONT}" font-size="${f(12 * px)}" font-weight="bold" fill="#0a5bb5" opacity=".7" pointer-events="none">FRONT ▶</text>`;
  // With a photo behind the drawing, shapes are see-through so the photo stays visible while tracing.
  const see = AE.see && aeHasPhoto() ? ' opacity=".55"' : '';
  AE.parts.forEach((p, i) => { o += partSVG(p, C, ` data-i="${i}"${see} style="cursor:${AE.tool === 'select' ? 'move' : 'crosshair'}"`); });
  // selection handles
  const hd = (x, y, k, cls = '') => `<circle class="ae-h ${cls}" data-h="${k}" cx="${f(x)}" cy="${f(y)}" r="${f(5.5 * px)}" stroke-width="${f(1.5 * px)}"/>`;
  const p = AE.parts[AE.sel];
  if (p) {
    const [bx1, by1, bx2, by2] = partBox(p);
    o += `<rect x="${f(bx1)}" y="${f(by1)}" width="${f(bx2 - bx1)}" height="${f(by2 - by1)}" fill="none" stroke="#0a84ff" stroke-width="${f(px)}" stroke-dasharray="${f(4 * px)} ${f(3 * px)}" pointer-events="none"/>`;
    if (p.t === 'ellipse') o += hd(p.cx + p.rx, p.cy, 'rx') + hd(p.cx, p.cy - p.ry, 'ry');
    else p.pts.forEach((q, j) => { o += hd(q[0], q[1], 'v' + j); });
  }
  // drawing in progress
  const live = AE.drag && AE.drag.preview;
  if (live) o += partSVG(live, C, ' opacity=".75" pointer-events="none"');
  if (AE.poly) {
    const pts = AE.cur ? [...AE.poly, [AE.cur.x, AE.cur.y]] : AE.poly;
    if (pts.length > 1) o += `<polyline points="${pts.map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${C.body}" fill-opacity=".35" stroke="#0a84ff" stroke-width="${f(1.5 * px)}" pointer-events="none"/>`;
    AE.poly.forEach((q, j) => { o += `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f((j ? 3.5 : 5) * px)}" fill="${j ? '#fff' : '#ffd23f'}" stroke="#0a84ff" stroke-width="${f(1.5 * px)}" pointer-events="none"/>`; });
  }
  s.innerHTML = o;
  document.querySelectorAll('#artEditor [data-ae="tool"]').forEach(b => b.classList.toggle('on', b.dataset.v === AE.tool));
  const hints = {
    select: 'Click a shape to select it, drag to move it, drag the white handles to reshape. Drag empty space to pan, scroll to zoom.',
    poly: 'Click each corner. Shift: 15° steps. Finish with the yellow first point, a double-click or Enter. Backspace removes the last point, Esc cancels.',
    rect: 'Drag to draw a rectangle (hull, track, turret block). Its corners can be dragged afterwards.',
    ellipse: 'Drag to draw an ellipse or circle (turret, wheel, dish). Shift: circle.',
    line: 'Drag to draw a barrel or antenna. Set its thickness on the right.',
  };
  $('#aeHint').textContent = hints[AE.tool] + '  Map scale: 1 grid square = 1 px on the map; bold lines every 10 px.';
}
function aeSide() {
  const side = $('#aeSide'); if (!side) return;
  const p = AE.parts[AE.sel], C = aeColors();
  let h = sec('Preview', row('Faction', I.sel('ae', 'faction', AE.faction, doc.factions.map(fa => [fa.id, fa.name]))) + I.check('ae', 'snap', AE.snap, 'Snap to half-pixel grid'));
  if (p) {
    h += sec('Selected shape', `<div class="ae-sw">${ART_PAINTS.map(([k, l]) => `<button data-ae="paint" data-v="${k}" title="${l}" class="${p.paint === k ? 'on' : ''}" style="background:${C[k]}"></button>`).join('')}<label title="Custom colour"><input type="color" data-t="ae" data-k="custom" value="${/^#/.test(p.paint) ? p.paint : C.body}"></label></div>` +
      `<p class="hint">${esc((ART_PAINTS.find(([k]) => k === p.paint) || [0, 'Custom colour (stays fixed for every faction)'])[1])}</p>` +
      (p.t === 'line' ? row('Thickness', I.range('ae', 'w', p.w, .5, 20, .5)) : '') +
      `<div class="btns"><button data-ae="dup" title="⌘/Ctrl+D">Duplicate</button><button data-ae="mirY" title="Mirrored copy across the horizontal centre line">Mirror ↕</button><button data-ae="mirX" title="Mirrored copy across the vertical centre line">Mirror ↔</button></div>` +
      `<div class="btns"><button data-ae="front">To front</button><button data-ae="back">To back</button><button class="danger" data-ae="del" title="Delete">Delete</button></div>`);
  } else if (AE.tool === 'line') h += sec('New lines', row('Thickness', I.range('ae', 'lineW', AE.lineW, .5, 20, .5)));
  h += sec('Tracing photo', `<p class="hint">Load a top-down photo of the model to draw over. It is only a guide and is not saved.</p>` +
    (AE.photo ? row('Size', I.range('ae', 'photoScale', AE.photoScale, .05, 4, .05)) + row('Opacity', I.range('ae', 'photoOp', AE.photoOp, .1, 1, .05)) + `<div class="btns"><button data-ae="photo">Replace…</button><button data-ae="photoClear">Remove</button></div>` : `<div class="btns"><button data-ae="photo">Load photo…</button></div>`) +
    (AE.origin && doc.ref ? row('Map photo', I.range('ae', 'refOp', AE.refOp, 0, 1, .05)) : '') +
    (aeHasPhoto() ? I.check('ae', 'see', AE.see, 'See-through shapes while tracing') : ''));
  h += sec('Tips', `<p class="hint">Build a tank from a hull rectangle, two darker tracks (draw one, then Mirror ↕), a turret ellipse and a barrel line. The front faces right. Colours follow the faction: “Faction colour”, “Darker” and “Lighter” change with each army.</p>`);
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
    case 'photo': aePickPhoto(); return;
    case 'photoClear': AE.photo = null; aeSide(); aeRender(); return;
  }
  if (!p) return;
  aeSave();
  const mirror = (q, ax) => ax === 'y' ? [q[0], -q[1]] : [-q[0], q[1]];
  if (cmd === 'paint') p.paint = b.dataset.v;
  else if (cmd === 'dup') { const c = JSON.parse(JSON.stringify(p)); aeShift(c, 2, 2); AE.parts.push(c); AE.sel = AE.parts.length - 1; }
  else if (cmd === 'mirY' || cmd === 'mirX') {
    const ax = cmd === 'mirY' ? 'y' : 'x', c = JSON.parse(JSON.stringify(p));
    if (c.t === 'ellipse') { if (ax === 'y') c.cy = -c.cy; else c.cx = -c.cx; } else c.pts = c.pts.map(q => mirror(q, ax));
    AE.parts.push(c); AE.sel = AE.parts.length - 1;
  } else if (cmd === 'front') { AE.parts.splice(AE.sel, 1); AE.parts.push(p); AE.sel = AE.parts.length - 1; }
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
  aeRender();
}
function aePickPhoto() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const [x1, y1, x2, y2] = AE.parts.length ? partsBox(AE.parts) : [-30, -18, 30, 18]; AE.photo = { src: r.result, w: img.naturalWidth, h: img.naturalHeight }; AE.photoScale = Math.round(Math.max(x2 - x1, 40) * 1.4 / img.naturalWidth * 100) / 100 || 1; aeSide(); aeRender(); }; img.src = r.result; };
    r.readAsDataURL(file);
  };
  inp.click();
}
function aeSetTool(t) { if (AE.poly && t !== 'poly') AE.poly = null; AE.tool = t; aeSide(); aeRender(); }
function aeShift(p, dx, dy) { if (p.t === 'ellipse') { p.cx += dx; p.cy += dy; } else p.pts = p.pts.map(q => [q[0] + dx, q[1] + dy]); }
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
  if (AE.tool === 'select') {
    const h = e.target.closest('[data-h]'), part = e.target.closest('[data-i]');
    if (h) AE.drag = { type: 'handle', h: h.dataset.h, saved: false };
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
  const p = aeSnapPt(aePt(e)), part = AE.parts[AE.sel];
  if (d.type === 'move' && part) {
    const dx = p.x - d.last.x, dy = p.y - d.last.y; if (!dx && !dy) return;
    if (!d.saved) { aeSave(); d.saved = true; }
    aeShift(part, dx, dy); d.last = p; aeRender(); return;
  }
  if (d.type === 'handle' && part) {
    if (!d.saved) { aeSave(); d.saved = true; }
    if (d.h === 'rx') part.rx = Math.max(.5, Math.abs(p.x - part.cx)); else if (d.h === 'ry') part.ry = Math.max(.5, Math.abs(p.y - part.cy));
    else part.pts[+d.h.slice(1)] = [p.x, p.y];
    aeRender(); return;
  }
  if (d.type === 'new') {
    const a = d.start; let x1 = Math.min(a.x, p.x), y1 = Math.min(a.y, p.y), x2 = Math.max(a.x, p.x), y2 = Math.max(a.y, p.y);
    if (AE.tool === 'rect') d.preview = { t: 'poly', pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], paint: 'body' };
    else if (AE.tool === 'ellipse') {
      let rx = (x2 - x1) / 2, ry = (y2 - y1) / 2; if (e.shiftKey) rx = ry = Math.max(rx, ry);
      d.preview = { t: 'ellipse', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx, ry, paint: 'body' };
    } else d.preview = { t: 'line', pts: [[a.x, a.y], [p.x, p.y]], w: AE.lineW, paint: 'metal' };
    aeRender();
  }
}
function aeUp() {
  const d = AE && AE.drag; if (!d) return; AE.drag = null;
  if (d.type === 'new' && d.preview) {
    const [x1, y1, x2, y2] = partBox(d.preview), big = d.preview.t === 'line' ? Math.hypot(d.preview.pts[1][0] - d.preview.pts[0][0], d.preview.pts[1][1] - d.preview.pts[0][1]) >= 1 : x2 - x1 >= 1 && y2 - y1 >= 1;
    if (big) { aeSave(); if (d.preview.t !== 'line') d.preview.paint = AE.parts.length ? 'dark' : 'body'; AE.parts.push(d.preview); AE.sel = AE.parts.length - 1; aeSide(); }
  }
  aeRender();
}
function aeFinishPoly() {
  const pts = (AE.poly || []).filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > .01);
  AE.poly = null; AE.cur = null;
  if (pts.length < 3) { aeRender(); return toast('A polygon needs at least three points'); }
  aeSave(); AE.parts.push({ t: 'poly', pts, paint: AE.parts.length ? 'dark' : 'body' }); AE.sel = AE.parts.length - 1; aeSide(); aeRender();
}
function aeCommit() {
  if (AE.poly && AE.poly.length >= 3) aeFinishPoly();
  if (!AE.parts.length) return toast('Draw at least one shape first');
  const name = (AE.name || '').trim() || 'Model';
  pushHistory();
  let a = AE.id && doc.unitArt.find(x => x.id === AE.id);
  if (a) { a.parts = JSON.parse(JSON.stringify(AE.parts)); a.name = name; }
  else { a = { id: uid(), name, parts: JSON.parse(JSON.stringify(AE.parts)) }; doc.unitArt.push(a); }
  libAddArt(a);
  const isNew = !AE.id, target = AE.target; closeArtEditor();
  if (isNew) assignArt(target, a.id); else { renderPanel(); render(); }
  toast(`“${name}” saved${isNew ? ' and added to your library' : ''}`);
}
// Keyboard while the editor is open; returns true when the key was handled.
function artEditorKey(e) {
  if (!AE) return false;
  const el = e.target, typing = el.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(el.type);
  if (typing) return true;
  const mod = e.ctrlKey || e.metaKey, k = e.key.length === 1 ? e.key.toLowerCase() : e.key, p = AE.parts[AE.sel];
  if (mod && k === 'z') { e.preventDefault(); aeUndo(e.shiftKey); return true; }
  if (mod && k === 'y') { e.preventDefault(); aeUndo(true); return true; }
  if (mod && k === 'd') { e.preventDefault(); if (p) aeClick({ target: { closest: () => ({ dataset: { ae: 'dup' } }) } }); return true; }
  if (mod) return true;
  if (AE.poly) {
    if (k === 'Enter') { e.preventDefault(); aeFinishPoly(); return true; }
    if (k === 'Escape') { e.preventDefault(); AE.poly = null; aeRender(); return true; }
    if (k === 'Backspace') { e.preventDefault(); AE.poly.pop(); aeRender(); return true; }
  }
  if ((k === 'Delete' || k === 'Backspace') && p) { e.preventDefault(); aeSave(); AE.parts.splice(AE.sel, 1); AE.sel = -1; aeSide(); aeRender(); return true; }
  if (k === 'Escape') { e.preventDefault(); if (AE.sel >= 0) { AE.sel = -1; aeSide(); aeRender(); } return true; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (arrows && p) { e.preventDefault(); aeSave(); const st = e.shiftKey ? 5 : .5; aeShift(p, arrows[0] * st, arrows[1] * st); aeRender(); return true; }
  const tool = { v: 'select', p: 'poly', r: 'rect', o: 'ellipse', l: 'line' }[k];
  if (tool) aeSetTool(tool);
  return true;
}
window.addEventListener('resize', () => { if (AE) aeRender(); });
