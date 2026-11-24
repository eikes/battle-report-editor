'use strict';
/* =========================================================================
   Drawing parts shared by model drawings (units) and drawn buildings.
   Loaded after editor.js and uses its helpers (f, esc, rng, clamp, ...).

   part: { t: 'poly', pts: [[x, y], ...], paint, edge? }
       | { t: 'ellipse', cx, cy, rx, ry, rot?, paint, edge? }
       | { t: 'line', pts: [[x, y], [x, y]], w, paint, edge? }
   Coordinates are map pixels. Model paints are relative to the faction's
   colours (ART_PAINTS); building paints are fixed colours (TER_PAINTS).
   `paint` may also be a #rrggbb colour. `edge` is used by buildings only.
   ========================================================================= */
const ART_PAINTS = [['body', 'Faction colour'], ['dark', 'Darker'], ['light', 'Lighter'], ['ink', 'Symbol colour'], ['metal', 'Metal grey'], ['black', 'Black'], ['white', 'White']];
const TER_PAINTS = [['wall', 'Building grey', '#8c9297'], ['roof', 'Dark grey', '#5f666c'], ['floor', 'Light grey', '#b3b8bd'], ['stone', 'Stone', '#c4bba6'], ['tiles', 'Stone tiles', '#c4bba6'],
  ['metal', 'Metal', '#8e959d'], ['hazard', 'Hazard yellow', '#ffd21f'], ['wood', 'Wood', '#8a6a45'], ['grass', 'Grass', '#6aa830'], ['water', 'Water', '#3b8fd6'], ['black', 'Black', '#1a1a1a'], ['white', 'White', '#f2f2f2']];
const TER_COLORS = Object.fromEntries(TER_PAINTS.map(([k, , c]) => [k, c]));
const EDGES = [['solid', 'Solid outline'], ['broken', 'Ruined – broken walls'], ['hazard', 'Hazard stripes'], ['none', 'No outline']];
const ART_SW = 1.2, BLD_SW = 3;
const isHex = v => /^#[0-9a-f]{6}$/i.test(v || '');

function shade(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, '0')).join('');
}
const artColors = (fill, ink) => ({ body: fill, dark: shade(fill, -.38), light: shade(fill, .4), ink, metal: '#8a9097', black: '#1a1a1a', white: '#f2f2f2' });
const paintOf = (p, C) => C[p] || (isHex(p) ? p : C.body);

/* geometry */
function geom(p, attrs) {
  if (p.t === 'ellipse') return `<ellipse cx="${f(p.cx)}" cy="${f(p.cy)}" rx="${f(p.rx)}" ry="${f(p.ry)}"${p.rot ? ` transform="rotate(${f(p.rot)} ${f(p.cx)} ${f(p.cy)})"` : ''} ${attrs}/>`;
  if (p.t === 'line') return `<path d="M${f(p.pts[0][0])},${f(p.pts[0][1])}L${f(p.pts[1][0])},${f(p.pts[1][1])}" fill="none" ${attrs}/>`;
  return `<polygon points="${p.pts.map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" ${attrs}/>`;
}
function partBox(p) {
  if (p.t === 'ellipse') {
    const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), ex = Math.hypot(p.rx * c, p.ry * s), ey = Math.hypot(p.rx * s, p.ry * c);
    return [p.cx - ex, p.cy - ey, p.cx + ex, p.cy + ey];
  }
  const xs = p.pts.map(q => q[0]), ys = p.pts.map(q => q[1]), e = p.t === 'line' ? p.w / 2 : 0;
  return [Math.min(...xs) - e, Math.min(...ys) - e, Math.max(...xs) + e, Math.max(...ys) + e];
}
function partsBox(parts) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of parts) { const q = partBox(p); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }
  return isFinite(b[0]) ? b : [-20, -12, 20, 12];
}
const partCenter = p => { if (p.t === 'ellipse') return [p.cx, p.cy]; const b = partBox(p); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
const r2 = v => Math.round(v * 100) / 100;
function rotatePart(p, deg, cx, cy) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), R = ([x, y]) => [r2(cx + (x - cx) * c - (y - cy) * s), r2(cy + (x - cx) * s + (y - cy) * c)];
  if (p.t === 'ellipse') { [p.cx, p.cy] = R([p.cx, p.cy]); p.rot = r2((((p.rot || 0) + deg) % 360 + 540) % 360 - 180); if (!p.rot) delete p.rot; }
  else p.pts = p.pts.map(R);
}
function mirrorPart(p, axis) {   // copy across the drawing's centre line (axis 'y': top <-> bottom)
  const flip = ([x, y]) => axis === 'y' ? [x, -y] : [-x, y];
  if (p.t === 'ellipse') { [p.cx, p.cy] = flip([p.cx, p.cy]); if (p.rot) p.rot = -p.rot; }
  else p.pts = p.pts.map(flip);
}
function shiftPart(p, dx, dy) { if (p.t === 'ellipse') { p.cx += dx; p.cy += dy; } else p.pts = p.pts.map(q => [q[0] + dx, q[1] + dy]); }

/* model parts: faction-relative colours, thin black outline */
function partSVG(p, C) {
  const fill = paintOf(p.paint, C);
  if (p.t === 'line') return `<g stroke-linecap="square">${geom(p, `stroke="#111111" stroke-width="${f(p.w + ART_SW * 2)}"`)}${geom(p, `stroke="${fill}" stroke-width="${f(p.w)}"`)}</g>`;
  return geom(p, `fill="${fill}" stroke="#111111" stroke-width="${ART_SW}" stroke-linejoin="round"`);
}

/* building parts: fixed colours, edge styles, drop shadow */
const TILES_DEF = pid => `<pattern id="${pid}-tiles" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#5b5348" stroke-opacity=".28" stroke-width="1"/></pattern>`;
function bldPartSVG(p, i, seed, pid) {
  const fill = TER_COLORS[p.paint] || (isHex(p.paint) ? p.paint : TER_COLORS.wall), edge = p.edge || 'solid', J = 'stroke-linejoin="round"';
  let dash = '';
  if (edge === 'broken') { const R = rng((seed || 1) + i * 7919), d = []; for (let k = 0; k < 10; k++) d.push(f(25 + R() * 70), f(6 + R() * 16)); dash = ` stroke-dasharray="${d.join(' ')}"`; }
  if (p.t === 'line') {
    const cap = 'stroke-linecap="butt"';
    let s = edge === 'solid' ? geom(p, `stroke="#2a2e33" stroke-width="${f(p.w + BLD_SW * 2)}" ${cap}`)
      : edge === 'hazard' ? geom(p, `stroke="#111111" stroke-width="${f(p.w + 2)}" ${cap}`)
      : edge === 'broken' ? geom(p, `stroke="#2a2622" stroke-width="${f(p.w + 3.5)}" ${cap}${dash}`) : '';
    return s + geom(p, `stroke="${edge === 'hazard' ? '#ffd21f' : fill}" stroke-width="${f(p.w)}" ${cap}${edge === 'hazard' ? ' stroke-dasharray="9 9"' : dash}`);
  }
  let s = geom(p, `fill="${fill}"`) + (p.paint === 'tiles' ? geom(p, `fill="url(#${pid}-tiles)"`) : '');
  if (edge === 'solid') s += geom(p, `fill="none" stroke="#2a2e33" stroke-width="${BLD_SW}" ${J}`);
  else if (edge === 'broken') s += geom(p, `fill="none" stroke="#2a2622" stroke-width="8" ${J}${dash}`) + geom(p, `fill="none" stroke="#8d867b" stroke-width="4.5" ${J}${dash}`);
  else if (edge === 'hazard') s += geom(p, `fill="none" stroke="#111111" stroke-width="7" ${J}`) + geom(p, `fill="none" stroke="#ffd21f" stroke-width="7" stroke-dasharray="9 9" ${J}`) + geom(p, `fill="none" stroke="#1d2025" stroke-width="1.5" ${J}`);
  return s;
}
const bldShadow = parts => `<g transform="translate(5,5)" opacity=".22">${parts.map(p => p.t === 'line' ? geom(p, `stroke="#000000" stroke-width="${f(p.w + BLD_SW * 2)}"`) : geom(p, 'fill="#000000"')).join('')}</g>`;
function buildingMarkup(c) {
  const pid = 'bt' + c.id;
  return (c.parts.some(p => p.paint === 'tiles') ? `<defs>${TILES_DEF(pid)}</defs>` : '') + bldShadow(c.parts) + c.parts.map((p, i) => bldPartSVG(p, i, c.seed, pid)).join('');
}
// A building's viewBox is its exact outline, so placed pieces stretch to it.
const bldViewBox = parts => { const [x1, y1, x2, y2] = partsBox(parts); return [x1, y1, x2 - x1, y2 - y1].map(v => Math.round(v * 10) / 10); };
// Recomputes viewBox + markup after the parts changed.
function finalizeBuilding(c) { c.viewBox = bldViewBox(c.parts).join(' '); c.markup = buildingMarkup(c); c.rev = (c.rev || 0) + 1; return c; }

/* validation (project files, clipboard, library imports) */
const num = v => typeof v === 'number' && isFinite(v);
const okPt = q => Array.isArray(q) && num(q[0]) && num(q[1]);
const okPaint = p => ART_PAINTS.some(([k]) => k === p) || TER_PAINTS.some(([k]) => k === p) || isHex(p);
function cleanPart(p) {
  if (!p || typeof p !== 'object') return null;
  const base = { paint: okPaint(p.paint) ? p.paint : 'body' };
  if (EDGES.some(([k]) => k === p.edge)) base.edge = p.edge;
  if (p.t === 'ellipse' && [p.cx, p.cy, p.rx, p.ry].every(num)) return { t: 'ellipse', cx: p.cx, cy: p.cy, rx: Math.abs(p.rx), ry: Math.abs(p.ry), ...(num(p.rot) && p.rot ? { rot: p.rot } : {}), ...base };
  if (p.t === 'line' && Array.isArray(p.pts) && p.pts.length === 2 && p.pts.every(okPt)) return { t: 'line', pts: p.pts.map(q => [q[0], q[1]]), w: num(p.w) ? clamp(p.w, .5, 60) : 3, ...base };
  if (p.t === 'poly' && Array.isArray(p.pts) && p.pts.length >= 3 && p.pts.every(okPt)) return { t: 'poly', pts: p.pts.map(q => [q[0], q[1]]), ...base };
  return null;
}

function downloadSVGFile(name, vb, inner) {
  const s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(vb[2])}" height="${f(vb[3])}" viewBox="${vb.map(v => f(v)).join(' ')}">\n<title>${esc(name)}</title>\n${inner}\n</svg>\n`;
  downloadBlob(new Blob([s], { type: 'image/svg+xml' }), slug(name || 'drawing') + '.svg');
}
