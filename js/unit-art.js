'use strict';
/* =========================================================================
   Model drawings: a unit can be shown as a drawing (e.g. a top-down tank)
   instead of a counter. Drawings are made in the drawing editor
   (drawing-editor.js), traced on the map / reference photo, or uploaded as SVG.
   Parts and their rendering live in drawing.js. Loaded after drawing.js.

   doc.unitArt: drawn    { id, name, parts: [part], origin?: [x, y] }
                uploaded { id, name, kind: 'svg', viewBox, markup, tintMarkup, tint }
   Coordinates are map pixels centred on 0,0; the front of a model faces right.
   ========================================================================= */
const LOOKS = [['counter', 'Counter (shape + symbol)'], ['model', 'Model drawing']];

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

