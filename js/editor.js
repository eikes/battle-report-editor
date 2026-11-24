'use strict';
/* ==========================================================================
   Battle Report Map Editor – standalone, no dependencies.
   Model:
     doc.rounds  [{id,name}]
     doc.units   [{id,faction,name,label,shape,icon,w,h,keys:{roundId:{x,y,rot,status,bend,noArrow}}}]
                 A unit's state in a round = its key for that round, or the
                 latest earlier key (inherited). Moves create a key.
     doc.terrain [{id,type,x,y,w,h,rot,seed,...}] or path types with points
     doc.annos   [{id,type:'callout'|'arrow'|'text'|'effect',round:roundId|'*',...}]
   ========================================================================== */

const FONT = 'Arial, Helvetica, sans-serif';
const SERIF = "Georgia, 'Times New Roman', serif";
const STORE = 'battle-report-editor-doc-v1';

const $ = s => document.querySelector(s);
// The map canvas is created here so index.html carries no SVG markup.
const scroller = $('#scroller'), svg = scroller.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')), panel = $('#panel'), roundsEl = $('#rounds');
svg.id = 'svg';
const uid = () => Math.random().toString(36).slice(2, 10);
const f = n => Math.round(n * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = s => String(s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const randSeed = () => Math.floor(Math.random() * 1e9);

/* ----------------------------- Constants -------------------------------- */
/* Unit symbols (symbols/) and terrain artwork (terrain/) are SVG files that
   loadAssets() reads at startup, so the editor has to be served over http. */
const ICONS = { none: {} };   // name -> { title, vb, tpl }; tpl paints with __INK__ / __CUT__
let SYMBOL_GROUPS = [];       // picker groups from symbols/symbols.json
const TERRAIN_ART = {};       // building type -> { viewBox, markup }
const SPRITES = {};           // sprite name -> [{ vb, layers: [[layerName, markup]] }]
const paint = (tpl, ink, cut) => tpl.split('__INK__').join(ink).split('__CUT__').join(cut);
const GHOST_OPTS = [['', 'Editor only (default)'], ['show', 'Always – also in exports'], ['hide', 'Never']];
const SHAPES = [['rect', 'Rectangle'], ['circle', 'Circle'], ['oval', 'Oval'], ['hex', 'Hexagon'], ['diamond', 'Diamond']];
const STATUS = [['active', 'Active'], ['destroyed', 'Destroyed this round'], ['withdrawn', 'Off table / withdrawn']];
const PATH_TYPES = new Set(['river', 'road', 'wall']);
const TER_PALETTE = [['hill', 'Hill'], ['wood', 'Wood'], ['rocks', 'Rocks'], ['lake', 'Lake'], ['marsh', 'Marsh'], ['crater', 'Crater'], ['river', 'River'], ['road', 'Road'], ['wall', 'Wall'], ['building:cross', 'Cross ruin'], ['building:L', 'L building'], ['building:T', 'T building'], ['building:block', 'Block'], ['building:U', 'U building'], ['building:ruin', 'Ruin'], ['building:tri', 'Triangle'], ['building:hex', 'Hex building'], ['building:hex3', 'Hex cluster'], ['cathedral', 'Cathedral ruin'], ['generator', 'Energy generator'], ['landing', 'Landing platform'], ['cacti', 'Red cacti'], ['crystal', 'Blue crystals']];
const BUILDINGS = [['cross', 'Cross'], ['L', 'L-shape'], ['T', 'T-shape'], ['block', 'Block'], ['U', 'U-shape'], ['ruin', 'Ruin'], ['tri', 'Triangle'], ['hex', 'Hexagon'], ['hex3', 'Hex cluster']];
const EFFECTS = [['explosion', 'Explosion'], ['psychic', 'Psychic (pink)'], ['warp', 'Psychic (blue)'], ['fire', 'Fireball'], ['smoke', 'Smoke'], ['objective', 'Objective'], ['skull', 'Skull'], ['magic', 'Magic line']];
const EFFECT_R = { explosion: 26, psychic: 30, warp: 30, fire: 28, smoke: 30, objective: 14, skull: 16 };
const SHOTS = {
  bullets: { name: 'Bullets', color: '#ffd21f' },
  laser: { name: 'Laser', color: '#ff3030' },
  plasma: { name: 'Plasma', color: '#5fd0ff' },
  magic: { name: 'Magic bolt', color: '#c86bff' },
  flamer: { name: 'Flamer', color: '#ff7a1a' },
  missile: { name: 'Missile / shell', color: '#b8bec4' },
};
const MAGIC = {
  psychic: { name: 'Psychic pink', glow: '#ff5fd2', main: '#e33aa6', core: '#ffffff' },
  warp: { name: 'Warp blue', glow: '#5fb8ff', main: '#2f7fe0', core: '#ffffff' },
  lightning: { name: 'Lightning', glow: '#9fdcff', main: '#c9eeff', core: '#ffffff' },
  fire: { name: 'Fire', glow: '#ffb02e', main: '#ff5a1a', core: '#fff6c2' },
  necro: { name: 'Necromantic green', glow: '#7dff6a', main: '#2fbf3a', core: '#eaffde' },
  dark: { name: 'Dark purple', glow: '#a46bff', main: '#5b2a9e', core: '#e9d8ff' },
};
const CALLOUT_STYLES = {
  yellow: { name: 'Yellow', fill: '#fff35c', stroke: '#1a1a1a', text: '#111111' },
  blue: { name: 'Light blue', fill: '#a6def7', stroke: '#1a1a1a', text: '#111111' },
  white: { name: 'White', fill: '#ffffff', stroke: '#1a1a1a', text: '#111111' },
  parchment: { name: 'Parchment', fill: '#f3e3bf', stroke: '#5a4320', text: '#2b1d0a' },
  black: { name: 'Black', fill: '#161616', stroke: '#161616', text: '#ffffff' },
};
const ARROW_COLORS = ['#3d9be9', '#ffe23a', '#e3261b', '#ffffff', '#46b34a', '#9b59d0', '#f28c28', '#222222'];

/* ----------------------------- Document --------------------------------- */
function blankDoc() {
  return {
    version: 1, title: 'Battle Report', logo: null, showTitle: true, showRound: true, showLegend: true,
    w: 1200, h: 760, bg: '#a6d33f', bgShade: true, page: '#ffffff', arrowW: 16,
    view: { arrows: true, trail: false, wrecks: false, labels: true },
    factions: [
      { id: 'f1', name: 'Blue Force', color: '#2f6db5', ink: '#ffffff', arrow: '#3d9be9' },
      { id: 'f2', name: 'Red Horde', color: '#d8271c', ink: '#111111', arrow: '#ffe23a' },
    ],
    rounds: [{ id: uid(), name: 'Deployment' }, { id: uid(), name: 'Turn 1' }],
    terrain: [], units: [], annos: [], ref: null, customIcons: [], customTerrain: [], unitArt: [], groups: [],
  };
}
function normalize(d) {
  const b = blankDoc();
  for (const k of Object.keys(b)) if (d[k] === undefined) d[k] = b[k];
  d.view = Object.assign({}, b.view, d.view || {});
  if (!Array.isArray(d.rounds) || !d.rounds.length) d.rounds = b.rounds;
  if (!Array.isArray(d.factions) || !d.factions.length) d.factions = b.factions;
  for (const k of ['terrain', 'units', 'annos', 'customIcons', 'customTerrain', 'unitArt', 'groups']) if (!Array.isArray(d[k])) d[k] = [];
  // Designs from a file are rebuilt from their points or re-sanitized, never trusted as raw markup.
  d.customTerrain = d.customTerrain.filter(isDesign).flatMap(c => { try { return [cleanDesign(c)]; } catch (err) { return []; } });
  d.unitArt = d.unitArt.map(cleanArt).filter(Boolean);
  for (const u of d.units) { if (u.ghost) { for (const k of Object.values(u.keys || {})) if (!k.ghost) k.ghost = u.ghost; delete u.ghost; } u.keys = u.keys || {}; u.w = u.w || 40; u.h = u.h || u.w; u.shape = u.shape || 'rect'; u.icon = u.icon || 'none'; u.name = u.name || ''; u.label = u.label || ''; }
  return d;
}
function demoDoc() {
  const d = blankDoc();
  d.title = 'The Battle for Hill 47';
  d.rounds = [{ id: 'r0', name: 'Deployment' }, { id: 'r1', name: 'Turn 1' }, { id: 'r2', name: 'Turn 2' }];
  d.factions = [
    { id: 'blue', name: 'Blue Force', color: '#2f6db5', ink: '#ffffff', arrow: '#3d9be9' },
    { id: 'red', name: 'Red Horde', color: '#d8271c', ink: '#111111', arrow: '#ffe23a' },
  ];
  const T = (type, x, y, w, h, seed, extra = {}) => d.terrain.push({ id: uid(), type, x, y, w, h, rot: 0, seed, levels: 2, density: 1, ...extra });
  const P = (type, points, width) => d.terrain.push({ id: uid(), type, points, width, seed: 1 });
  T('hill', 230, 140, 270, 170, 11, { levels: 2 });
  T('hill', 905, 590, 310, 170, 23, { levels: 3 });
  P('river', [[790, -30], [758, 170], [815, 360], [772, 560], [835, 800]], 34);
  T('wood', 520, 110, 250, 130, 5);
  T('wood', 1040, 160, 180, 200, 8);
  T('building', 150, 575, 110, 110, 1, { variant: 'cross' });
  T('building', 305, 650, 100, 80, 2, { variant: 'L' });
  T('building', 1090, 690, 100, 90, 3, { variant: 'T' });
  T('building', 600, 445, 90, 66, 4, { variant: 'ruin', rot: 12 });
  T('rocks', 420, 575, 140, 90, 3);
  T('marsh', 640, 670, 170, 90, 4);
  T('crater', 470, 330, 70, 56, 6);
  const U = (fac, name, shape, icon, w, h, path, extra = {}) => {
    const keys = {};
    path.forEach((p, i) => { if (p) keys['r' + i] = { x: p[0], y: p[1], rot: p[2] || 0, status: p[3] || 'active', bend: p[4] || 0 }; });
    d.units.push({ id: uid(), faction: fac, name, label: '', shape, icon, w, h, keys, ...extra });
  };
  U('blue', 'Battle Tanks', 'rect', 'tank', 58, 32, [[170, 300], [300, 300], [440, 290, 0, 'destroyed']]);
  U('blue', 'Battle Tanks', 'rect', 'tank', 58, 32, [[170, 350], [310, 370, 0, 'active', 30], [455, 385]]);
  U('blue', 'Battle Tanks', 'rect', 'tank', 58, 32, [[170, 400], [290, 440, 15]]);
  U('blue', 'Infantry Squad', 'circle', 'infantry', 28, 28, [[95, 220], [175, 215], [262, 215]]);
  U('blue', 'Infantry Squad', 'circle', 'infantry', 28, 28, [[95, 255], [178, 252], [266, 250]]);
  U('blue', 'Infantry Squad', 'circle', 'infantry', 28, 28, [[125, 238], [208, 234], [296, 232]]);
  U('blue', 'Commander', 'rect', 'star', 34, 34, [[85, 350], [160, 350], [215, 352]], { label: 'HQ' });
  U('blue', 'Walker', 'circle', 'walker', 42, 42, [[250, 180], [370, 170], [500, 205]]);
  U('blue', 'Gunship', 'oval', 'aircraft', 54, 34, [null, null, [610, 575, -30]]);
  U('red', 'Warband', 'rect', 'skull', 58, 32, [[1060, 330], [905, 330], [690, 320]]);
  U('red', 'Warband', 'rect', 'skull', 58, 32, [[1060, 380], [910, 400], [705, 385]]);
  U('red', 'Warband', 'rect', 'skull', 58, 32, [[1060, 430], [920, 470], [725, 455, 0, 'destroyed']]);
  U('red', 'War Buggies', 'oval', 'buggy', 46, 30, [[1110, 270], [880, 220, 0, 'active', -40], [650, 255]]);
  U('red', 'War Buggies', 'oval', 'buggy', 46, 30, [[1140, 300], [900, 262], [668, 292]]);
  U('red', 'Big Gun', 'circle', 'artillery', 36, 36, [[1120, 545]]);
  U('red', 'War Machine', 'hex', 'walker', 56, 56, [[1010, 620], [930, 600]]);
  U('red', 'Warboss', 'circle', 'crown', 36, 36, [[1110, 400], [965, 420], [800, 420]]);
  const G = (name, test) => { const id = uid(); d.groups.push({ id, name, bend: {}, noArrow: {} }); d.units.filter(test).forEach(u => { u.group = id; }); };
  G('Infantry Squad', u => u.name === 'Infantry Squad'); G('War Buggies', u => u.name === 'War Buggies');
  const A = (type, round, props) => d.annos.push({ id: uid(), type, round, ...props });
  A('callout', 'r0', { x: 548, y: 515, w: 205, text: 'Both armies deploy. The *Blue Force* holds the western ridge while the Red Horde masses beyond the river.', style: 'yellow', size: 13, align: 'left', bold: false, shadow: false });
  A('callout', 'r1', { x: 850, y: 24, w: 270, text: 'The Red Horde surges forward, its war buggies racing ahead of the main warband.', style: 'yellow', size: 14, align: 'left', bold: false, shadow: false });
  A('callout', 'r2', { x: 30, y: 30, w: 220, text: 'A long shot from the Big Gun flips over and destroys a Battle Tank.', style: 'yellow', size: 14, align: 'left', bold: false, shadow: false });
  A('arrow', 'r2', { x1: 250, y1: 82, x2: 405, y2: 262, bend: -40, width: 13, color: '#3d9be9', outline: '#13233f', taper: false });
  A('callout', 'r2', { x: 395, y: 668, w: 260, text: 'Psychic effects dominate the centre of the battlefield, blocking movement and killing crew.', style: 'blue', size: 14, align: 'left', bold: false, shadow: false });
  A('effect', 'r2', { variant: 'psychic', x: 590, y: 360, r: 30, seed: 3 });
  A('effect', 'r2', { variant: 'warp', x: 545, y: 470, r: 24, seed: 4 });
  A('effect', 'r2', { variant: 'fire', x: 630, y: 410, r: 18, seed: 5 });
  A('effect', '*', { variant: 'objective', x: 470, y: 330, r: 14, seed: 1 });
  A('text', '*', { x: 905, y: 545, text: 'Hill 47', size: 17, color: '#111111', bold: true, italic: true, serif: true, halo: true, rot: 0 });
  return d;
}

/* ------------------------------- State ---------------------------------- */
let doc;
const ui = {
  tool: 'select', sel: [], cur: 0, zoom: 1, ghosts: true, lockTerrain: false,
  terrainType: 'hill', effectType: 'explosion', magicStyle: 'psychic', shotKind: 'bullets', arrowColor: '#3d9be9', calloutStyle: 'yellow',
  tpl: { faction: 'f1', name: 'Infantry Squad', look: 'counter', shape: 'rect', icon: 'infantry', w: 50, h: 30 },
  drag: null, space: false, L: null,
};
const hist = [], fut = [];
let lastTag = '', lastT = 0;
function pushHistory() { hist.push(JSON.stringify(doc)); if (hist.length > 200) hist.shift(); fut.length = 0; lastTag = ''; updateUndoButtons(); }
function beginEdit(tag) { const now = Date.now(); if (tag !== lastTag || now - lastT > 1200) pushHistory(); lastTag = tag; lastT = now; }
function undo() { if (!hist.length) return; fut.push(JSON.stringify(doc)); doc = JSON.parse(hist.pop()); afterLoad(); }
function redo() { if (!fut.length) return; hist.push(JSON.stringify(doc)); doc = JSON.parse(fut.pop()); afterLoad(); }
function updateUndoButtons() { $('#bUndo').disabled = !hist.length; $('#bRedo').disabled = !fut.length; }
function afterLoad() {
  normalize(doc);
  ui.cur = clamp(ui.cur, 0, doc.rounds.length - 1);
  ui.sel = ui.sel.filter(s => getObj(s));
  if (!doc.factions.some(fa => fa.id === ui.tpl.faction)) ui.tpl.faction = doc.factions[0].id;
  lastTag = '';
  updateTopbar(); updateUndoButtons(); renderPanel(); render();
}

/* ----------------------------- Unit state ------------------------------- */
const rid = i => doc.rounds[i].id;
function stateAt(u, ri) {
  let k = null, kr = -1;
  for (let i = ri; i >= 0; i--) { const kk = u.keys[doc.rounds[i].id]; if (kk) { k = kk; kr = i; break; } }
  if (!k) return null;
  if (kr === ri) return { ...k, rot: k.rot || 0, status: k.status || 'active', own: true };
  if (k.status === 'destroyed' || k.status === 'withdrawn') return { x: k.x, y: k.y, rot: k.rot || 0, status: 'gone', was: k.status, own: false };
  return { x: k.x, y: k.y, rot: k.rot || 0, status: 'active', bend: 0, noArrow: false, own: false };
}
function ensureKey(u, ri) {
  const id = rid(ri);
  if (!u.keys[id]) { const s = stateAt(u, ri); u.keys[id] = { x: s ? s.x : 0, y: s ? s.y : 0, rot: s ? s.rot || 0 : 0, status: 'active' }; }
  return u.keys[id];
}
function firstKeyIdx(u) { return doc.rounds.findIndex(r => u.keys[r.id]); }
function dims(u) { return u.shape === 'circle' && u.look !== 'model' ? [u.w, u.w] : [u.w, u.h]; }
function facOf(u) { return doc.factions.find(fa => fa.id === u.faction) || doc.factions[0] || { color: '#888888', ink: '#111111', arrow: '#3d9be9', name: '?' }; }
/* Groups: units sharing u.group move together and get one arrow. */
const groupOf = u => u && u.group ? doc.groups.find(g => g.id === u.group) || null : null;
const groupMembers = g => doc.units.filter(u => u.group === g.id);
function cleanGroups() {
  doc.groups = doc.groups.filter(g => doc.units.some(u => u.group === g.id));
  for (const u of doc.units) if (u.group && !doc.groups.some(g => g.id === u.group)) delete u.group;
}
// One arrow from the front of the old formation to the rear of the new one.
function groupGeom(g, ri) {
  if (ri < 1 || (g.noArrow || {})[rid(ri)]) return null;
  const pairs = [];
  for (const u of groupMembers(g)) { const a = stateAt(u, ri - 1), b = stateAt(u, ri); if (a && b && a.status === 'active' && (b.status === 'active' || b.status === 'destroyed') && Math.hypot(b.x - a.x, b.y - a.y) > 2) pairs.push([u, a, b]); }
  if (!pairs.length) return null;
  const cen = k => ({ x: pairs.reduce((t, p) => t + p[k].x, 0) / pairs.length, y: pairs.reduce((t, p) => t + p[k].y, 0) / pairs.length });
  const A = cen(1), B = cen(2), dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy); if (d < 4) return null;
  const ux = dx / d, uy = dy / d; let front = 0, rear = 0;
  for (const [u, a, b] of pairs) { const [w, h] = dims(u), r = (w + h) / 4 + 4; front = Math.max(front, (a.x - A.x) * ux + (a.y - A.y) * uy + r); rear = Math.max(rear, -((b.x - B.x) * ux + (b.y - B.y) * uy) + r); }
  const x2 = B.x - ux * rear, y2 = B.y - uy * rear;
  // Short moves: keep the tip at the rear of the new formation and give the arrow a minimum length.
  const len = Math.max((A.x + ux * front - x2) * -ux + (A.y + uy * front - y2) * -uy, groupArrowW() * 2.6);
  const x1 = x2 - ux * len, y1 = y2 - uy * len;
  return { x1, y1, x2, y2, bend: (g.bend || {})[rid(ri)] || 0, wobble: (g.wobble || {})[rid(ri)] ? 60 : 0, color: facOf(pairs[0][0]).arrow };
}
const groupArrowW = () => (doc.arrowW || 16) * 1.35;
// The group whose members make up the whole unit selection, if any.
const presentMembers = g => groupMembers(g).filter(m => { const st = stateAt(m, ui.cur); return st && st.status !== 'gone'; });
// The group if the selection is only members of one group (whole or part of it).
function partGroup() {
  const units = ui.sel.filter(x => x.k === 'unit').map(getObj).filter(Boolean);
  if (!units.length || units.length !== ui.sel.length) return null;
  const g = groupOf(units[0]); return g && units.every(u => u.group === g.id) ? g : null;
}
// The group if the selection is exactly all of its on-table members.
function selGroup() {
  const g = partGroup(); if (!g) return null;
  const ids = new Set(ui.sel.map(x => x.id));
  return presentMembers(g).every(m => ids.has(m.id)) ? g : null;
}
function groupRotStart(g, p) {
  const orig = presentMembers(g).map(u => { const st = stateAt(u, ui.cur); return { u, x: st.x, y: st.y, rot: st.rot || 0 }; });
  const px = orig.reduce((t, o) => t + o.x, 0) / orig.length, py = orig.reduce((t, o) => t + o.y, 0) / orig.length;
  return { orig, px, py, a0: Math.atan2(p.y - py, p.x - px) };
}
// Turns the formation around its centre; each unit's facing turns with it.
function applyGroupRotation(R, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  for (const o of R.orig) {
    const dx = o.x - R.px, dy = o.y - R.py, k = ensureKey(o.u, ui.cur);
    k.x = Math.round(R.px + dx * c - dy * sn); k.y = Math.round(R.py + dx * sn + dy * c);
    k.rot = Math.round(((o.rot + deg + 180) % 360 + 360) % 360 - 180);
  }
}
// Adds every on-table member of any group touched by the list.
function expandGroups(list) {
  const out = [...list];
  for (const x of list) { if (x.k !== 'unit') continue; const g = groupOf(getObj(x)); if (!g) continue; for (const m of groupMembers(g)) { const st = stateAt(m, ui.cur); if (st && st.status !== 'gone' && !out.some(o => o.id === m.id)) out.push({ k: 'unit', id: m.id }); } }
  return out;
}
function moveGeom(u, ri) {
  if (ri < 1 || groupOf(u)) return null;
  const a = stateAt(u, ri - 1), b = stateAt(u, ri);
  if (!a || !b || a.status !== 'active' || !(b.status === 'active' || b.status === 'destroyed') || b.noArrow) return null;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const [w, h] = dims(u); const r = (w + h) / 4 + 3;
  if (d < 3) return null;
  const ux = dx / d, uy = dy / d, x2 = b.x - ux * (r + 2), y2 = b.y - uy * (r + 2), len = Math.max(d - r * 2 - 2, (doc.arrowW || 16) * 2.6);
  return { x1: x2 - ux * len, y1: y2 - uy * len, x2, y2, bend: b.own ? (b.bend || 0) : 0, wobble: b.own && b.wobble ? 60 : 0 };
}
function chordFrame(g) { const dx = g.x2 - g.x1, dy = g.y2 - g.y1, L = Math.hypot(dx, dy) || 1; return { nx: -dy / L, ny: dx / L, mx: (g.x1 + g.x2) / 2, my: (g.y1 + g.y2) / 2 }; }
function arrowMid(g) { const c = chordFrame(g); return { x: c.mx + c.nx * (g.bend || 0) / 2, y: c.my + c.ny * (g.bend || 0) / 2 }; }
function bendFrom(g, p) { const c = chordFrame(g); return 2 * ((p.x - c.mx) * c.nx + (p.y - c.my) * c.ny); }

/* ----------------------------- Geometry --------------------------------- */
function smoothClosed(pts) {
  const n = pts.length; let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}
function smoothOpen(pts) {
  if (pts.length < 2) return '';
  const P = [pts[0], ...pts, pts[pts.length - 1]]; let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
function blobPts(seed, rx, ry, n = 11, jit = 0.22, ox = 0, oy = 0) {
  const R = rng(seed), off = R() * Math.PI * 2, pts = [];
  for (let i = 0; i < n; i++) { const a = off + i / n * Math.PI * 2 + (R() - .5) * .3, k = 1 - jit + R() * jit * 1.15; pts.push([ox + Math.cos(a) * rx * k, oy + Math.sin(a) * ry * k]); }
  return pts;
}
const blob = (seed, rx, ry, n, jit, ox, oy) => smoothClosed(blobPts(seed, rx, ry, n, jit, ox, oy));
function scatter(R, rx, ry, n, minD, margin) {
  const pts = []; let tries = 0;
  while (pts.length < n && tries < n * 50) {
    tries++;
    const x = (R() * 2 - 1) * rx, y = (R() * 2 - 1) * ry;
    const ex = Math.max(1, rx - margin), ey = Math.max(1, ry - margin);
    if ((x * x) / (ex * ex) + (y * y) / (ey * ey) > 1) continue;
    if (pts.some(p => Math.hypot(p[0] - x, p[1] - y) < minD)) continue;
    pts.push([x, y]);
  }
  return pts.sort((a, b) => a[1] - b[1]);
}
/* Area fill: woods, rock fields and cacti can follow an outline drawn on the map.
   t.area holds the outline as fractions of t.w / t.h (so resizing and rotating still work). */
const AREA_TYPES = new Set(['wood', 'rocks', 'cacti', 'crystal', 'marsh', 'hill', 'lake', 'crater']);
const areaPoly = t => t.area.map(([u, v]) => [u * t.w, v * t.h]);
function centroidOf(P) {
  const A = polyArea(P); if (Math.abs(A) < 1e-6) return [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length];
  let cx = 0, cy = 0; P.forEach((p, i) => { const q = P[(i + 1) % P.length], c = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; });
  return [cx / (6 * A), cy / (6 * A)];
}
// Smooth outline of a drawn area, optionally shrunk towards its centre (inner hill levels, lake shallows, ...).
function outlinePath(t, k = 1, ox = 0, oy = 0) {
  const P = areaPoly(t); if (k === 1 && !ox && !oy) return smoothClosed(P);
  const [cx, cy] = centroidOf(P); return smoothClosed(P.map(([x, y]) => [cx + (x - cx) * k + ox, cy + (y - cy) * k + oy]));
}
// Ramer–Douglas–Peucker: turns a freehand stroke into a few control points.
function simplifyPts(P, eps) {
  if (P.length < 3) return P;
  let idx = 0, dmax = 0; const a = P[0], b = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) { const d = segDist(P[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  return dmax > eps ? [...simplifyPts(P.slice(0, idx + 1), eps).slice(0, -1), ...simplifyPts(P.slice(idx), eps)] : [a, b];
}
const polyArea = P => P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function segDist(p, a, b) { const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1, k = clamp(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2, 0, 1); return Math.hypot(p[0] - a[0] - k * (b[0] - a[0]), p[1] - a[1] - k * (b[1] - a[1])); }
function scatterPoly(R, P, n, minD, margin) {
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), W = Math.max(...xs) - x0, H = Math.max(...ys) - y0, pts = [];
  for (let tries = 0; pts.length < n && tries < n * 60; tries++) {
    const q = [x0 + R() * W, y0 + R() * H];
    if (!pip(q, P) || P.some((a, i) => segDist(q, a, P[(i + 1) % P.length]) < margin) || pts.some(p => Math.hypot(p[0] - q[0], p[1] - q[1]) < minD)) continue;
    pts.push(q);
  }
  return pts.sort((a, b) => a[1] - b[1]);
}
// Pieces for an area: `per` = map area per piece at density 1.
function fillPts(t, R, per, minD, margin, minN = 1) {
  const dens = t.density ?? 1;
  if (!t.area) { const rx = t.w / 2, ry = t.h / 2; return scatter(R, rx, ry, Math.max(minN, Math.round(dens * Math.PI * rx * ry / per)), minD, margin); }
  const P = areaPoly(t); return scatterPoly(R, P, Math.max(minN, Math.round(dens * Math.abs(polyArea(P)) / per)), minD, margin);
}
function fatArrowPath(x1, y1, x2, y2, bend, w, taper, wob = 0) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const cx = (x1 + x2) / 2 + nx * bend, cy = (y1 + y2) / 2 + ny * bend;
  const Q = t => { const u = 1 - t; return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]; };
  const Nv = t => { const a = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx), b = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy), l = Math.hypot(a, b) || 1; return [-b / l, a / l]; };
  const N = 48, acc = [0]; let pp = Q(0);
  for (let i = 1; i <= N; i++) { const p = Q(i / N); acc.push(acc[i - 1] + Math.hypot(p[0] - pp[0], p[1] - pp[1])); pp = p; }
  const total = acc[N], hl = Math.min(w * 1.7, total * .6), target = total - hl; let th = 1;
  for (let i = 1; i <= N; i++) if (acc[i] >= target) { const seg = acc[i] - acc[i - 1] || 1; th = (i - 1 + (target - acc[i - 1]) / seg) / N; break; }
  const M = wob > 0 ? 90 : 28, Lp = [], Rp = [];
  // Wobble: the body's centre line snakes from side to side, settling before the head.
  const body = target, amp = wob / 100 * w * 1.3, wl = Math.max(w * 3.2, 26, Math.sqrt(2 * Math.PI * Math.PI * (w / 2 + 1.5) * amp * 2) * 1.1), C = [];
  for (let i = 0; i <= M; i++) {
    const t = th * i / M, p = Q(t), n = Nv(t), sl = body * i / M;
    const o = amp ? Math.sin(sl / wl * Math.PI * 2) * amp * Math.min(1, (body - sl) / (wl * .6)) * Math.min(1, sl / (wl * .25) + .3) : 0;
    C.push([p[0] + n[0] * o, p[1] + n[1] * o]);
  }
  for (let i = 0; i <= M; i++) {
    let n = Nv(th * i / M);
    if (amp) { const a = C[Math.max(0, i - 1)], b = C[Math.min(M, i + 1)], dx2 = b[0] - a[0], dy2 = b[1] - a[1], l = Math.hypot(dx2, dy2) || 1; n = [-dy2 / l, dx2 / l]; }
    const hw = taper ? (w / 2) * (.22 + .78 * Math.min(1, i / M * 1.6)) : w / 2, p = C[i];
    Lp.push([p[0] + n[0] * hw, p[1] + n[1] * hw]); Rp.push([p[0] - n[0] * hw, p[1] - n[1] * hw]);
  }
  const b = Q(th), nb = Nv(th), hw = w * 1.05;
  const pts = [...Lp, [b[0] + nb[0] * hw, b[1] + nb[1] * hw], [x2, y2], [b[0] - nb[0] * hw, b[1] - nb[1] * hw], ...Rp.reverse()];
  return 'M' + pts.map(p => f(p[0]) + ',' + f(p[1])).join('L') + 'Z';
}
function fatArrowSVG(g, w, color, o = {}) {
  return `<path d="${fatArrowPath(g.x1, g.y1, g.x2, g.y2, g.bend || 0, w, o.taper, o.wobble ?? g.wobble ?? 0)}" fill="${color}" stroke="${o.outline || '#13233f'}" stroke-width="${o.sw ?? 2.2}" stroke-linejoin="round"${o.opacity != null ? ` opacity="${o.opacity}"` : ''}/>`;
}

/* ------------------------------ Text ------------------------------------ */
const mctx = document.createElement('canvas').getContext('2d');
function measure(t, size, bold, italic, family = FONT) { mctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}`; return mctx.measureText(t).width; }
// Wraps text; *word* or *several words* become italic.
function layoutText(text, maxW, size, bold) {
  const lines = []; let ital = false; const sp = measure(' ', size, bold, false);
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = [], lw = 0;
    for (const raw of words) {
      let w = raw;
      if (w.startsWith('*')) { ital = !ital; w = w.slice(1); }
      const it = ital; let close = false;
      if (w.endsWith('*')) { close = true; w = w.slice(0, -1); }
      w = w.replace(/\*/g, '');
      if (w) {
        const ww = measure(w, size, bold, it);
        if (line.length && lw + sp + ww > maxW) { lines.push(line); line = []; lw = 0; }
        lw += (line.length ? sp : 0) + ww; line.push({ t: w, i: it });
      }
      if (close) ital = !ital;
    }
    lines.push(line);
  }
  return lines;
}
function lineSVG(line) {
  let out = '', i = 0;
  while (i < line.length) {
    const it = line[i].i, txt = [];
    while (i < line.length && line[i].i === it) { txt.push(line[i].t); i++; }
    const s = esc(txt.join(' ') + (i < line.length ? ' ' : ''));
    out += it ? `<tspan font-style="italic">${s}</tspan>` : s;
  }
  return out;
}
function calloutBox(c) {
  const pad = 9, size = c.size || 15, lines = layoutText(c.text, c.w - pad * 2, size, c.bold), lh = size * 1.25;
  return { lines, lh, pad, size, h: Math.round(pad * 2 + size + (lines.length - 1) * lh + size * .22) };
}

/* ----------------------------- Rendering -------------------------------- */
function orbGrad(id, c) {
  return `<radialGradient id="${id}" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="${c[0]}"/><stop offset=".25" stop-color="${c[1]}"/><stop offset=".65" stop-color="${c[2]}"/><stop offset="1" stop-color="${c[3]}"/></radialGradient>` +
    `<radialGradient id="${id}-glow"><stop offset=".5" stop-color="${c[2]}" stop-opacity=".6"/><stop offset="1" stop-color="${c[2]}" stop-opacity="0"/></radialGradient>`;
}
function defsSVG(w = doc.w, h = doc.h) {
  return `<clipPath id="br-clip"><rect width="${w}" height="${h}"/></clipPath>` +
    `<radialGradient id="br-shade" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#ffffff" stop-opacity=".28"/><stop offset=".65" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".14"/></radialGradient>` +
    `<pattern id="br-tiles" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#5b5348" stroke-opacity=".28" stroke-width="1"/></pattern>` +
    orbGrad('br-psy', ['#ffffff', '#ffc4ef', '#e33aa6', '#9c0f68']) + orbGrad('br-warp', ['#ffffff', '#c9ecff', '#3a9be6', '#173f8f']) + orbGrad('br-fire', ['#fff7c2', '#ffd21f', '#ff7a1a', '#c0260f']);
}
function bgSVG() { return `<rect width="${doc.w}" height="${doc.h}" fill="${doc.bg}"/>` + (doc.bgShade ? `<rect width="${doc.w}" height="${doc.h}" fill="url(#br-shade)"/>` : ''); }
function refSVG(forExport) {
  if (!doc.ref || !doc.ref.src) return '';
  const src = esc(doc.ref.src);
  return `<image href="${src}"${forExport ? ` xlink:href="${src}"` : ''} width="${doc.w}" height="${doc.h}" preserveAspectRatio="xMidYMid meet" opacity="${doc.ref.opacity ?? .5}"/>`;
}
/* Header row: title, optional report logo (left of the title or in the right corner), round name.
   The logo is shrunk to fit the row: at most LOGO_MAX_H tall and LOGO_MAX_W wide. */
const LOGO_GAP = 14, LOGO_MAX_H = 44, LOGO_MAX_W = 240;
function logoBox() {
  const lg = doc.logo; if (!lg) return null;
  const ar = lg.aw / lg.ah || 1; let h = clamp(lg.size || LOGO_MAX_H, 16, LOGO_MAX_H), w = h * ar;
  if (w > LOGO_MAX_W) { w = LOGO_MAX_W; h = w / ar; }
  return { w, h, pos: lg.pos === 'right' ? 'right' : 'left' };
}
const headerH = () => 62;
function logoSVG(x, y, w, h) {
  const lg = doc.logo;
  if (lg.kind === 'svg') return `<svg x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" viewBox="${esc(lg.viewBox)}" overflow="visible">${lg.markup}</svg>`;
  const src = esc(lg.src);
  return `<image x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" href="${src}" xlink:href="${src}" preserveAspectRatio="xMidYMid meet"/>`;
}
function mainTitleSVG(W, pad = 20) {
  const hh = headerH(), base = pad + hh - 26, line = pad + hh - 12, b = logoBox();
  let s = '', tx = pad;
  if (b) {
    const x = b.pos === 'left' ? pad : W - pad - b.w;
    s += `<g>${logoSVG(x, pad + (hh - 12 - b.h) / 2, b.w, b.h)}</g>`;
    if (b.pos === 'left') tx += b.w + LOGO_GAP;
  }
  return s + `<text x="${f(tx)}" y="${base}" font-family="${SERIF}" font-size="34" font-weight="bold" letter-spacing="1" fill="#111111">${esc(String(doc.title).toUpperCase())}</text><line x1="${pad}" x2="${W - pad}" y1="${line}" y2="${line}" stroke="#111111" stroke-width="2"/>`;
}
function roundTitleSVG(W, name, pad = 20) {
  const b = logoBox(), x = W - pad - (b && b.pos === 'right' ? b.w + LOGO_GAP : 0);
  return name ? `<text x="${f(x)}" y="${pad + headerH() - 26}" text-anchor="end" font-family="${SERIF}" font-size="22" font-style="italic" fill="#333333">${esc(name)}</text>` : '';
}

/* ---------------- Traced buildings and the building library ----------------
   Traced buildings keep their corner points, so their style can be changed later.
   The library lives in this browser (localStorage) and is shared by every battle;
   placing a library design copies it into the project so the file stays complete. */
const TRACE_STYLES = [['building', 'Building (grey)'], ['ruin', 'Ruin (stone, broken walls)'], ['platform', 'Platform (hazard edge)']];
const LIB_KEY = 'battle-report-editor-library-v1';
let library = [], unitLibrary = [];   // building designs, model drawings
const isDesign = c => c && typeof c.id === 'string' && typeof c.viewBox === 'string' && (typeof c.markup === 'string' || c.traced || Array.isArray(c.parts));
// Rebuilds a design's markup from trusted parts: traced points, or the SVG sanitizer.
function cleanDesign(c) {
  const out = { id: String(c.id).replace(/[^\w-]/g, '').slice(0, 40) || uid(), name: String(c.name || 'Building').slice(0, 60), viewBox: String(c.viewBox) };
  // Drawn buildings (and buildings traced with older versions) are rebuilt from their shapes.
  let parts = Array.isArray(c.parts) ? c.parts.map(cleanPart).filter(Boolean) : null;
  const t = c.traced;
  if (!parts && t && Array.isArray(t.pts) && t.pts.length >= 3 && t.pts.every(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]))) {
    const xs = t.pts.map(p => +p[0]), ys = t.pts.map(p => +p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    parts = [{ t: 'poly', pts: t.pts.map(p => [+p[0] - cx, +p[1] - cy]), ...({ ruin: { paint: 'tiles', edge: 'broken' }, platform: { paint: 'metal', edge: 'hazard' } }[t.style] || { paint: 'wall', edge: 'solid' }) }];
  }
  if (parts) {
    if (!parts.length) throw new Error('empty drawing');
    Object.assign(out, { kind: 'drawn', parts, seed: +c.seed || (t && +t.seed) || 1, rev: +c.rev || 0 });
    if (Array.isArray(c.origin) && c.origin.length === 2 && c.origin.every(v => isFinite(v))) out.origin = [+c.origin[0], +c.origin[1]];
    return finalizeBuilding(out);
  } else out.markup = importSvgIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(out.viewBox)}">${c.markup}</svg>`, out.name).markup;
  return out;
}
function loadLibrary() {
  try { const d = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); library = d && Array.isArray(d.designs) ? d.designs.filter(isDesign) : []; unitLibrary = d && Array.isArray(d.units) ? d.units.filter(a => a && a.id) : []; } catch (err) { library = []; unitLibrary = []; }
}
function saveLibrary() {
  try { localStorage.setItem(LIB_KEY, JSON.stringify({ v: 1, designs: library, units: unitLibrary })); return true; } catch (err) { toast('Could not save the library – browser storage is full. Export it, then remove some designs.'); return false; }
}
const inLibrary = id => library.some(c => c.id === id);
const designById = id => doc.customTerrain.find(c => c.id === id) || library.find(c => c.id === id);
function libAdd(c) { const copy = JSON.parse(JSON.stringify(c)), i = library.findIndex(x => x.id === c.id); if (i >= 0) library[i] = copy; else library.push(copy); return saveLibrary(); }
function libSync(c) { if (c && inLibrary(c.id)) libAdd(c); }

/* tracing: ui.trace = { pts: [[x, y]...], cur } in map coordinates */
function traceSnap(p, shift) {
  const t = ui.trace, last = t && t.pts[t.pts.length - 1]; if (!shift || !last) return p;
  const dx = p.x - last[0], dy = p.y - last[1], L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
  return { x: last[0] + Math.cos(a) * L, y: last[1] + Math.sin(a) * L };
}
function startTrace(kind = 'building') {
  if (kind === 'building') { if (ui.tool !== 'terrain') setTool('terrain', true); ui.sel = []; }
  else if (!['unit', 'munit'].includes(ui.artTraceTarget) && ui.tool !== 'unit') setTool('unit', true);
  ui.trace = { kind, pts: [], cur: null }; renderPanel(); render();
}
function cancelTrace() { ui.trace = null; renderPanel(); render(); }
function traceClick(p, shift) {
  const t = ui.trace, q = traceSnap(p, shift), last = t.pts[t.pts.length - 1];
  if (t.pts.length >= 3 && Math.hypot(q.x - t.pts[0][0], q.y - t.pts[0][1]) < 10 / ui.zoom) return finishTrace();
  if (last && Math.hypot(q.x - last[0], q.y - last[1]) < 3 / ui.zoom) return;   // second click of a double-click
  t.pts.push([q.x, q.y]); renderPanel(); render();
}
function finishTrace() {
  const t = ui.trace; if (!t) return;
  const pts = t.pts.filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) >= 1);
  if (pts.length < 3) return toast('Click at least three corners first');
  if (t.kind === 'unit') return finishUnitTrace(pts);
  finishBuildingTrace(pts);
}

/* terrain */
const terCache = new Map();
function customTerrainSVG(t) {
  const c = designById(t.custom);
  if (!c) return `<rect x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}" fill="none" stroke="#c0392b" stroke-width="2" stroke-dasharray="6 4"/><text text-anchor="middle" y="5" font-family="${FONT}" font-size="13" fill="#c0392b">missing design</text>`;
  return artSVG(c, t);
}
// Artwork is stretched to the piece's size.
const artSVG = (c, t) => `<svg x="${f(-t.w / 2)}" y="${f(-t.h / 2)}" width="${f(t.w)}" height="${f(t.h)}" viewBox="${esc(c.viewBox)}" preserveAspectRatio="none" overflow="visible">${c.markup}</svg>`;
// Scatters sprite pieces: items [{x, y, rot, size} or {x, y, rot, w, h}] in map units.
// Sprites whose file has data-layer groups are drawn layer by layer across all pieces.
function scatterSprites(name, items, R) {
  const vars = SPRITES[name]; if (!vars || !vars.length) return '';
  const placed = items.map(it => [it, vars.length > 1 ? vars[Math.floor(R() * vars.length)] : vars[0]]);
  const order = []; for (const v of vars) for (const [l] of v.layers) if (!order.includes(l)) order.push(l);
  let s = '';
  for (const layer of order) for (const [it, v] of placed) {
    const m = v.layers.filter(l => l[0] === layer).map(l => l[1]).join(''); if (!m) continue;
    const [vx, vy, vw, vh] = v.vb, sx = it.size != null ? it.size / Math.max(vw, vh) : it.w / vw, sy = it.size != null ? sx : it.h / vh;
    s += `<g transform="translate(${f(it.x)},${f(it.y)}) rotate(${f(it.rot || 0)}) scale(${sx.toFixed(4)}${sy !== sx ? ',' + sy.toFixed(4) : ''}) translate(${f(-vx - vw / 2)},${f(-vy - vh / 2)})">${m}</g>`;
  }
  return s;
}
function pip(pt, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
function areaTerrain(t) {
  if (t.type === 'custom') return customTerrainSVG(t);
  if (TERRAIN_ART[t.type]) return artSVG(TERRAIN_ART[t.type], t);
  const key = [t.type, t.variant, t.w, t.h, t.seed, t.levels, t.density, t.thick].join('|') + (t.area ? '|' + JSON.stringify(t.area) : '');
  if (terCache.has(key)) return terCache.get(key);
  if (terCache.size > 400) terCache.clear();
  const rx = t.w / 2, ry = t.h / 2, R = rng(t.seed || 1), dens = t.density ?? 1; let s = '';
  switch (t.type) {
    case 'hill': {
      const L = clamp(t.levels || 2, 1, 4), cols = ['#86bd3a', '#6aa830', '#529427', '#3f7f1f'];
      for (let l = 0; l < L; l++) {
        const k = 1 - l * (.62 / Math.max(L, 2) + .06), ox = l ? (R() - .5) * rx * .12 : 0, oy = l ? (R() - .5) * ry * .12 : 0;
        s += `<path d="${t.area ? outlinePath(t, k, ox, oy) : blob((t.seed || 1) + l * 31, rx * k, ry * k, 11, .2, ox, oy)}" fill="${cols[l]}" stroke="#3a6b1c" stroke-width="${l ? 1.4 : 2.2}"/>`;
      }
      break;
    }
    case 'wood': {
      const tr = 11, pts = fillPts(t, R, tr * tr * 3.2, tr * 1.15, tr * .6);
      s = scatterSprites('tree', pts.map(([x, y]) => ({ x, y, size: 2 * tr * (.8 + R() * .45), rot: R() * 360 })), R);
      break;
    }
    case 'rocks': {
      s = scatterSprites('rock', fillPts(t, R, 420, 13, 8, 3).map(([x, y]) => ({ x, y, size: 2 * (6 + R() * 8), rot: R() * 360 })), R);
      break;
    }
    case 'lake':
      s = `<path d="${t.area ? outlinePath(t) : blob(t.seed, rx, ry, 10, .18)}" fill="#3b8fd6" stroke="#1b4c86" stroke-width="3"/><path d="${t.area ? outlinePath(t, .66, -rx * .06, -ry * .06) : blob(t.seed + 7, rx * .66, ry * .6, 9, .2, -rx * .06, -ry * .06)}" fill="#64b0ea" opacity=".6"/>`;
      break;
    case 'marsh': {
      s = `<path d="${t.area ? outlinePath(t) : blob(t.seed, rx, ry, 12, .25)}" fill="#8cc63f" stroke="#6ea535" stroke-width="1.2" stroke-dasharray="3 3"/>`;
      let pud = '', tufts = '';
      for (const [x, y] of fillPts(t, R, 2800, 26, 14, 2)) pud += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(6 + R() * 6)}" ry="${f(3 + R() * 2)}"/>`;
      for (const [x, y] of fillPts(t, R, 380, 12, 8)) tufts += `M${f(x)},${f(y)}l-4,-9M${f(x)},${f(y)}l0,-11M${f(x)},${f(y)}l4,-9`;
      s += `<g fill="#4f9fd2" stroke="#2a6a98" stroke-width="1">${pud}</g><path d="${tufts}" fill="none" stroke="#2d6f22" stroke-width="1.7" stroke-linecap="round"/>`;
      break;
    }
    case 'crater':
      s = t.area ? `<path d="${outlinePath(t)}" fill="#7c9b34" stroke="#465d1a" stroke-width="2.2"/><path d="${outlinePath(t, .62, rx * .05, ry * .08)}" fill="#5b7522"/><path d="${outlinePath(t, .3, rx * .1, ry * .14)}" fill="#4a601b"/>`
        : `<path d="${blob(t.seed, rx, ry, 10, .15)}" fill="#7c9b34" stroke="#465d1a" stroke-width="2.2"/><path d="${blob(t.seed + 3, rx * .62, ry * .58, 9, .2, rx * .05, ry * .08)}" fill="#5b7522"/><path d="${blob(t.seed + 5, rx * .3, ry * .25, 7, .2, rx * .1, ry * .14)}" fill="#4a601b"/>`;
      break;
    case 'cacti': {
      s = `<path d="${t.area ? smoothClosed(areaPoly(t)) : blob(t.seed, rx, ry, 11, .25)}" fill="#c2a55a" opacity=".35"/>`;
      s += scatterSprites('cactus', fillPts(t, R, 520, 24, 12).map(([x, y]) => ({ x, y, size: 2 * (9 + R() * 7), rot: R() * 360 })), R);
      break;
    }
    case 'crystal': {
      if (t.area) {   // a drawn area fills with small crystal clusters
        s = `<path d="${outlinePath(t)}" fill="#7fd8ff" opacity=".3"/>`;
        const shards = [], cores = [];
        for (const [cx, cy] of fillPts(t, R, 2600, 30, 14)) {
          const m = 4 + Math.floor(R() * 3), sc = .7 + R() * .5, cs = [];
          for (let i = 0; i < m; i++) cs.push({ a: i / m * Math.PI * 2 + (R() - .5) * .8, L: (14 + R() * 12) * sc, w: (8 + R() * 5) * sc, ox: cx, oy: cy });
          shards.push(...cs.sort((p, q) => Math.sin(p.a) - Math.sin(q.a))); cores.push({ x: cx, y: cy, size: 10 * sc });
        }
        s += scatterSprites('crystal-shard', shards.map(sh => ({ x: sh.ox + Math.cos(sh.a) * sh.L / 2, y: sh.oy + Math.sin(sh.a) * sh.L / 2, w: sh.L, h: sh.w, rot: sh.a * 180 / Math.PI })), R) + scatterSprites('crystal-core', cores, R);
        break;
      }
      s = `<path d="${blob(t.seed, rx * .9, ry * .9, 10, .2)}" fill="#7fd8ff" opacity=".3"/>`;
      const n = Math.max(4, Math.round(4 + dens * Math.PI * rx * ry / 1100)), shards = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + (R() - .5) * .8, er = 1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / ry) ** 2);
        shards.push({ a, L: er * (.5 + R() * .5), w: (11 + R() * 10) * Math.min(1.6, Math.max(.7, Math.min(rx, ry) / 50)), ox: (R() - .5) * rx * .2, oy: (R() - .5) * ry * .2 });
      }
      shards.sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
      s += scatterSprites('crystal-shard', shards.map(sh => ({ x: sh.ox + Math.cos(sh.a) * sh.L / 2, y: sh.oy + Math.sin(sh.a) * sh.L / 2, w: sh.L, h: sh.w, rot: sh.a * 180 / Math.PI })), R);
      s += scatterSprites('crystal-core', [{ x: 0, y: 0, size: Math.min(rx, ry) * .44 }], R);
      break;
    }
    case 'building': {
      const hexN = (cx, cy, r) => [0, 1, 2, 3, 4, 5].map(i => [cx + Math.cos(i * Math.PI / 3) * r, cy + Math.sin(i * Math.PI / 3) * r]);
      const k = clamp((t.thick ?? 34) / 100, .05, t.variant === 'U' ? .45 : .98), a = k / 2, V = {
        cross: [[-a, -.5], [a, -.5], [a, -a], [.5, -a], [.5, a], [a, a], [a, .5], [-a, .5], [-a, a], [-.5, a], [-.5, -a], [-a, -a]],
        L: [[-.5, -.5], [-.5 + k, -.5], [-.5 + k, .5 - k], [.5, .5 - k], [.5, .5], [-.5, .5]],
        T: [[-.5, -.5], [.5, -.5], [.5, -.5 + k], [a, -.5 + k], [a, .5], [-a, .5], [-a, -.5 + k], [-.5, -.5 + k]],
        block: [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]],
        U: [[-.5, -.5], [-.5 + k, -.5], [-.5 + k, .5 - k], [.5 - k, .5 - k], [.5 - k, -.5], [.5, -.5], [.5, .5], [-.5, .5]],
        ruin: [[-.5, -.5], [.1, -.5], [.16, -.34], [.3, -.42], [.5, -.28], [.5, .5], [-.18, .5], [-.24, .34], [-.5, .3]],
        tri: [[0, -.5], [.5, .5], [-.5, .5]],
        hex: hexN(0, 0, .5),
        hex3: [hexN(-.24, .21, .25), hexN(.24, .21, .25), hexN(0, -.21, .25)],
      }[t.variant || 'block'] || [];
      const polys = Array.isArray(V[0] && V[0][0]) ? V : [V];
      const pts = (P, sx, k = 1) => { const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length; return P.map(([x, y]) => f((cx + (x - cx) * k) * t.w + sx) + ',' + f((cy + (y - cy) * k) * t.h + sx)).join(' '); };
      s = polys.map(P => `<polygon points="${pts(P, 5)}" fill="#000000" opacity=".22"/>`).join('') + polys.map(P => `<polygon points="${pts(P, 0)}" fill="#8c9297" stroke="#2a2e33" stroke-width="3" stroke-linejoin="miter"/>`).join('');
      if (['tri', 'hex', 'hex3'].includes(t.variant)) s += polys.map(P => `<polygon points="${pts(P, 0, .55)}" fill="#a7adb2" stroke="#2a2e33" stroke-width="1.5"/>`).join('');
      if (t.variant === 'ruin') {
        let rub = '';
        for (let i = 0; i < 7; i++) { const x = (R() - .5) * t.w * .7, y = (R() - .5) * t.h * .7, q = 3 + R() * 4; rub += `<rect x="${f(x)}" y="${f(y)}" width="${f(q)}" height="${f(q * .8)}" transform="rotate(${f(R() * 90)} ${f(x)} ${f(y)})"/>`; }
        s += `<g fill="#5f656a">${rub}</g>`;
      }
      break;
    }
  }
  terCache.set(key, s);
  return s;
}
function pathTerrainSVG(t, ed) {
  const d = smoothOpen(t.points || []), w = t.width || 30; if (!d) return '';
  const P = (stroke, sw, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  let s = '';
  if (t.type === 'river') s = P('#1d4f8a', w + 7) + P('#2f8fdc', w) + P('#7cc4f2', Math.max(2, w * .16), ` opacity=".55" stroke-dasharray="${f(w * 1.2)} ${f(w * .9)}"`);
  else if (t.type === 'road') s = P('#6b5532', w + 5) + P('#d2b47a', w) + P('#b8975c', 2, ' stroke-dasharray="10 8"');
  else s = `<path d="${d}" fill="none" stroke="#24282c" stroke-width="${w + 4}" stroke-linecap="square" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#9aa0a5" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="round"/>`;
  if (ed) s += `<path d="${d}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="${w + 16}"/>`;
  return s;
}
function terrainItemSVG(t, ed) {
  if (PATH_TYPES.has(t.type)) return pathTerrainSVG(t, ed);
  const hit = !ed ? '' : t.area ? `<polygon points="${areaPoly(t).map(p => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="#000" fill-opacity="0"/>` : ['custom', 'generator', 'building', 'cathedral'].includes(t.type) ? `<rect x="${-t.w / 2}" y="${-t.h / 2}" width="${t.w}" height="${t.h}" fill="#000" fill-opacity="0"/>` : `<ellipse rx="${t.w / 2}" ry="${t.h / 2}" fill="#000" fill-opacity="0"/>`;
  return `<g transform="translate(${f(t.x)},${f(t.y)}) rotate(${t.rot || 0})">${hit}${areaTerrain(t)}</g>`;
}
function terrainSVG(ed) { return doc.terrain.map(t => `<g${ed ? ` data-sel="ter:${t.id}"` : ''}>${terrainItemSVG(t, ed)}</g>`).join(''); }

/* units */
const customIcon = name => name && name.startsWith('c:') ? doc.customIcons.find(c => c.id === name.slice(2)) : null;
function iconSVG(name, s, color, bg) {
  if (name && name.startsWith('c:')) {
    const ci = customIcon(name); if (!ci) return '';
    const inner = ci.tint ? `<g fill="${color}">${ci.tintMarkup.split('__INK__').join(color)}</g>` : ci.markup;
    return `<svg x="${f(-s / 2)}" y="${f(-s / 2)}" width="${f(s)}" height="${f(s)}" viewBox="${esc(ci.viewBox)}" overflow="visible">${inner}</svg>`;
  }
  const ic = ICONS[name]; if (!ic || !ic.tpl) return '';
  // "cut" parts of a symbol are painted in the counter colour, everything else in the symbol colour.
  const [vx, vy, vw, vh] = ic.vb, k = s / Math.max(vw, vh);
  return `<g transform="translate(${f(-vw * k / 2 - vx * k)},${f(-vh * k / 2 - vy * k)}) scale(${k.toFixed(4)})">${paint(ic.tpl, color, bg || '#000000')}</g>`;
}
function unitShapeSVG(u, ov) {
  const fa = facOf(u), fill = ov?.fill || fa.color, ink = ov?.ink || fa.ink, [w, h] = dims(u); let sh;
  if (u.look === 'model') { const a = artById(u.art); if (a) return artUnitSVG(a, w, h, fill, ink); }
  switch (u.shape) {
    case 'circle': sh = `<circle r="${w / 2}"/>`; break;
    case 'oval': sh = `<ellipse rx="${w / 2}" ry="${h / 2}"/>`; break;
    case 'hex': { const a = w / 2, b = h / 2; sh = `<polygon points="${-a},0 ${f(-a / 2)},${-b} ${f(a / 2)},${-b} ${a},0 ${f(a / 2)},${b} ${f(-a / 2)},${b}"/>`; break; }
    case 'diamond': sh = `<polygon points="0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0"/>`; break;
    default: sh = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2"/>`;
  }
  const k = { rect: .8, circle: .68, oval: .72, hex: .7, diamond: .48 }[u.shape] || .7;
  return `<g fill="${fill}" stroke="#111111" stroke-width="2">${sh}</g>${iconSVG(u.icon, Math.min(w, h) * k, ink, fill)}`;
}
function unitSVG(u, st, sel, extraAttr = '') {
  const [w, h] = dims(u);
  const hit = sel && u.look === 'model' ? `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" fill="#000" fill-opacity="0"/>` : '';
  let s = `<g transform="translate(${f(st.x)},${f(st.y)}) rotate(${st.rot || 0})">${hit}${unitShapeSVG(u)}</g>`;
  if (doc.view.labels && u.label) s += `<text x="${f(st.x)}" y="${f(st.y + Math.max(w, h) / 2 + 13)}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="bold" fill="#111111" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(u.label)}</text>`;
  return `<g${sel ? ` data-sel="unit:${u.id}"` : ''}${extraAttr}>${s}</g>`;
}
function wreckSVG(u, st) {
  const [w, h] = dims(u), r = Math.min(w, h) * .4;
  return `<g opacity=".7"><g transform="translate(${f(st.x)},${f(st.y)}) rotate(${(st.rot || 0) + 18})">${unitShapeSVG(u, { fill: '#5d5f61', ink: '#2b2c2d' })}</g><path d="M${f(st.x - r)},${f(st.y - r)}L${f(st.x + r)},${f(st.y + r)}M${f(st.x + r)},${f(st.y - r)}L${f(st.x - r)},${f(st.y + r)}" stroke="#111111" stroke-width="3" stroke-linecap="round"/></g>`;
}

/* effects */
function burstSVG(x, y, r, seed) {
  const R = rng(seed), sp = 10 + Math.floor(R() * 4);
  const star = (k, inner) => { const p = []; for (let i = 0; i < sp * 2; i++) { const a = i / (sp * 2) * Math.PI * 2 + (R() - .5) * .2, q = i % 2 ? r * k * (inner + R() * .12) : r * k * (.82 + R() * .3); p.push(f(x + Math.cos(a) * q) + ',' + f(y + Math.sin(a) * q)); } return p.join(' '); };
  return `<polygon points="${star(1, .45)}" fill="#e3261b" stroke="#111111" stroke-width="2" stroke-linejoin="round"/><polygon points="${star(.66, .5)}" fill="#ffd21f"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * .18)}" fill="#fff8d0"/>`;
}
function sparkle(cx, cy, s) { const k = s * .18; return `M${f(cx)},${f(cy - s)}L${f(cx + k)},${f(cy - k)}L${f(cx + s)},${f(cy)}L${f(cx + k)},${f(cy + k)}L${f(cx)},${f(cy + s)}L${f(cx - k)},${f(cy + k)}L${f(cx - s)},${f(cy)}L${f(cx - k)},${f(cy - k)}Z`; }
function orbSVG(x, y, r, id) {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.55)}" fill="url(#${id}-glow)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${id})" stroke="#000000" stroke-opacity=".35" stroke-width="1.2"/><path d="${sparkle(x - r * .25, y - r * .28, r * .42)}" fill="#ffffff" opacity=".9"/>`;
}
function effectSVG(a) {
  const { x, y, r } = a;
  switch (a.variant) {
    case 'psychic': return orbSVG(x, y, r, 'br-psy');
    case 'warp': return orbSVG(x, y, r, 'br-warp');
    case 'fire': {
      const R = rng(a.seed || 2), sp = 9, p = [];
      for (let i = 0; i < sp * 2; i++) { const ang = i / (sp * 2) * Math.PI * 2, q = i % 2 ? r * (.55 + R() * .1) : r * (.95 + R() * .25); p.push(f(x + Math.cos(ang) * q) + ',' + f(y + Math.sin(ang) * q)); }
      return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.6)}" fill="url(#br-fire-glow)"/><polygon points="${p.join(' ')}" fill="url(#br-fire)" stroke="#5a1300" stroke-width="1.5" stroke-linejoin="round"/>`;
    }
    case 'smoke': {
      const R = rng(a.seed || 3); let c = '', hi = '';
      for (let i = 0; i < 7; i++) { const ang = i / 7 * Math.PI * 2 + R(), d = i ? r * .45 : 0, cr = r * (.42 + R() * .18); const cx = x + Math.cos(ang) * d, cy = y + Math.sin(ang) * d; c += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(cr)}"/>`; hi += `<circle cx="${f(cx - cr * .2)}" cy="${f(cy - cr * .25)}" r="${f(cr * .55)}"/>`; }
      return `<g opacity=".88"><g fill="#4a4f54" stroke="#4a4f54" stroke-width="3">${c}</g><g fill="#8a8f94">${c}</g><g fill="#b9bdc1">${hi}</g></g>`;
    }
    case 'skull': {
      const ic = ICONS.skull; if (!ic || !ic.tpl) return '';
      const [vx, vy, vw, vh] = ic.vb, k = r * 2 / Math.max(vw, vh), tr = `translate(${f(x - vw * k / 2 - vx * k)},${f(y - vh * k / 2 - vy * k)}) scale(${k.toFixed(4)})`;
      return `<g opacity=".35" transform="translate(2,2) ${tr}">${paint(ic.tpl, '#000000', '#000000')}</g><g transform="${tr}" stroke="#111111" stroke-width="${f(1.8 / k)}" stroke-linejoin="round">${paint(ic.tpl, '#ffffff', '#111111')}</g>`;
    }
    case 'objective': {
      const q = r * .8;
      return `<g transform="translate(${f(x)},${f(y)})"><circle r="${r}" fill="#ffffff" stroke="#111111" stroke-width="2"/><path d="M0,0L${f(q)},0A${f(q)},${f(q)} 0 0,1 0,${f(q)}ZM0,0L${f(-q)},0A${f(q)},${f(q)} 0 0,1 0,${f(-q)}Z" fill="#111111"/><circle r="${f(q)}" fill="none" stroke="#111111" stroke-width="1"/></g>`;
    }
    default: return burstSVG(x, y, r, a.seed || 1);
  }
}
/* annotations */
function calloutSVG(c) {
  const st = CALLOUT_STYLES[c.style] || CALLOUT_STYLES.yellow, b = calloutBox(c);
  const center = c.align === 'center', tx = center ? c.x + c.w / 2 : c.x + b.pad;
  let s = c.shadow ? `<rect x="${f(c.x + 4)}" y="${f(c.y + 4)}" width="${c.w}" height="${b.h}" fill="#000000" opacity=".35"/>` : '';
  s += `<rect x="${f(c.x)}" y="${f(c.y)}" width="${c.w}" height="${b.h}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.6"/>`;
  s += `<text font-family="${FONT}" font-size="${b.size}" fill="${st.text}" text-anchor="${center ? 'middle' : 'start'}"${c.bold ? ' font-weight="bold"' : ''}>` +
    b.lines.map((ln, i) => `<tspan x="${f(tx)}" y="${f(c.y + b.pad + b.size * .9 + i * b.lh)}">${lineSVG(ln)}</tspan>`).join('') + '</text>';
  return s;
}
function textSVG(a) {
  const lines = String(a.text).split('\n'), size = a.size || 16, lh = size * 1.15, y0 = a.y - (lines.length - 1) * lh / 2 + size * .35;
  const attrs = `font-family="${a.serif ? SERIF : FONT}" font-size="${size}" fill="${a.color || '#111111'}" text-anchor="middle"${a.bold ? ' font-weight="bold"' : ''}${a.italic ? ' font-style="italic"' : ''}` +
    (a.halo ? ` stroke="#ffffff" stroke-width="${f(size * .22)}" stroke-linejoin="round" paint-order="stroke"` : '');
  return `<text ${attrs} transform="rotate(${a.rot || 0} ${f(a.x)} ${f(a.y)})">${lines.map((l, i) => `<tspan x="${f(a.x)}" y="${f(y0 + i * lh)}">${esc(l) || ' '}</tspan>`).join('')}</text>`;
}
// Glowing energy line along the drawn points; "jag" turns it into lightning.
function magicPath(a) {
  const pts = a.points || []; if (pts.length < 2) return '';
  if (!(a.jag > 0)) return smoothOpen(pts);
  const R = rng(a.seed || 1), out = [pts[0]], amp = a.jag / 100 * Math.max(6, (a.width || 8) * 1.6);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1) || 1, n = Math.max(1, Math.round(L / 13)), nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    for (let j = 1; j <= n; j++) { const t = j / n, o = j === n ? 0 : (R() * 2 - 1) * amp; out.push([x1 + (x2 - x1) * t + nx * o, y1 + (y2 - y1) * t + ny * o]); }
  }
  return 'M' + out.map(p => f(p[0]) + ',' + f(p[1])).join('L');
}
function magicSVG(a) {
  const st = MAGIC[a.style] || MAGIC.psychic, w = a.width || 8, d = magicPath(a); if (!d) return '';
  const P = (c, sw, op) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ''}/>`;
  let s = (a.glow !== false ? P(st.glow, w * 4, .16) + P(st.glow, w * 2.4, .32) : '') + P(st.main, w * 1.3, .9) + P(st.core, w * .45, 1);
  if (a.endOrb) { const [ex, ey] = a.points[a.points.length - 1]; s += `<circle cx="${f(ex)}" cy="${f(ey)}" r="${f(w * 2.8)}" fill="${st.glow}" opacity=".35"/><circle cx="${f(ex)}" cy="${f(ey)}" r="${f(w * 1.6)}" fill="${st.main}"/><circle cx="${f(ex)}" cy="${f(ey)}" r="${f(w * .75)}" fill="${st.core}"/>`; }
  return s;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay) || 1; let idx = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; idx = i; } }
  return md > eps ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)] : [pts[0], pts[pts.length - 1]];
}
/* Fire lines: ends can be attached to units (a.from / a.to) and follow them. */
function unitAt(p, exclude) {
  for (let i = doc.units.length - 1; i >= 0; i--) {
    const u = doc.units[i]; if (u.id === exclude) continue;
    const st = stateAt(u, ui.cur); if (!st || st.status === 'gone' || st.status === 'withdrawn') continue;
    const [w, h] = dims(u); if (Math.hypot(p.x - st.x, p.y - st.y) <= Math.max(w, h) / 2 + 3) return u;
  }
  return null;
}
function shotEnd(id, fx, fy, ri) {
  const u = id && doc.units.find(x => x.id === id), st = u && stateAt(u, ri);
  if (st && st.status !== 'gone') { const [w, h] = dims(u); return { x: st.x, y: st.y, r: Math.max(w, h) / 2 + 2 }; }
  return { x: fx, y: fy, r: 0 };
}
function shotGeom(a, ri = ui.cur) {
  const A = shotEnd(a.from, a.x1, a.y1, ri), B = shotEnd(a.to, a.x2, a.y2, ri), dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
  if (L <= A.r + B.r + 6) return { x1: A.x, y1: A.y, x2: B.x, y2: B.y };
  return { x1: A.x + dx / L * A.r, y1: A.y + dy / L * A.r, x2: B.x - dx / L * B.r, y2: B.y - dy / L * B.r };
}
function shotSVG(a, g) {
  const k = SHOTS[a.kind] ? a.kind : 'bullets', c = a.color || SHOTS[k].color, w = a.width || 1, { x1, y1, x2, y2 } = g;
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, ang = f(Math.atan2(dy, dx) * 180 / Math.PI);
  const line = (stroke, sw, extra = '') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${f(sw)}" stroke-linecap="round"${extra}/>`;
  const glowDot = (r1, r2) => `<circle cx="${f(x2)}" cy="${f(y2)}" r="${f(r1)}" fill="${c}" opacity=".45"/><circle cx="${f(x2)}" cy="${f(y2)}" r="${f(r2)}" fill="#ffffff"/>`;
  let s = '';
  switch (k) {
    case 'bullets': { const da = ` stroke-dasharray="${f(9 * w)} ${f(9 * w)}"`; s = line('#3a2600', 4.6 * w, da) + line(c, 2.6 * w, da); if (a.impact) s += burstSVG(x2, y2, 10 * w, a.seed || 1); break; }
    case 'laser': s = line(c, 8 * w, ' opacity=".25"') + line(c, 3.2 * w) + line('#ffffff', 1.2 * w); if (a.impact) s += glowDot(7 * w, 2.6 * w); break;
    case 'plasma': {
      s = line(c, 5 * w, ' opacity=".22"') + line(c, 1.4 * w, ' opacity=".7"');
      const step = 26 * w;
      for (let t = step * .6; t < L - 4; t += step) s += `<g transform="translate(${f(x1 + ux * t)},${f(y1 + uy * t)}) rotate(${ang})"><ellipse rx="${f(9 * w)}" ry="${f(5 * w)}" fill="${c}" opacity=".4"/><ellipse rx="${f(6 * w)}" ry="${f(3 * w)}" fill="${c}" stroke="#0d3a66" stroke-width="${f(.8 * w)}"/><ellipse cx="${f(1.5 * w)}" rx="${f(3 * w)}" ry="${f(1.5 * w)}" fill="#ffffff"/></g>`;
      if (a.impact) s += glowDot(10 * w, 4 * w);
      break;
    }
    case 'magic': {
      const amp = 5 * w, wl = 30 * w, n = Math.max(2, Math.ceil(L / 4)); let d = '';
      for (let i = 0; i <= n; i++) { const t = i / n * L, o = Math.sin(t / wl * 2 * Math.PI) * amp * Math.min(1, t / 20, (L - t) / 20); d += (i ? 'L' : 'M') + f(x1 + ux * t + nx * o) + ',' + f(y1 + uy * t + ny * o); }
      const P = (st, sw, op = 1) => `<path d="${d}" fill="none" stroke="${st}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"${op < 1 ? ` opacity="${op}"` : ''}/>`;
      s = P(c, 6 * w, .3) + P(c, 2.2 * w) + P('#ffffff', .8 * w);
      for (let t = 40 * w, i = 0; t < L - 10; t += 40 * w, i++) { const o = (i % 2 ? 1 : -1) * 9 * w; s += `<path d="${sparkle(x1 + ux * t + nx * o, y1 + uy * t + ny * o, 4.5 * w)}" fill="#ffffff" stroke="${c}" stroke-width="${f(.8 * w)}"/>`; }
      if (a.impact) s += glowDot(9 * w, 3.5 * w);
      break;
    }
    case 'flamer': {
      const W = Math.min(L * .4, 44 * w), cone = (len, wid, w0) => { const ex = x1 + ux * len, ey = y1 + uy * len; return `M${f(x1 + nx * w0)},${f(y1 + ny * w0)}L${f(ex + nx * wid / 2)},${f(ey + ny * wid / 2)}A${f(wid / 2)},${f(wid / 2)} 0 0,0 ${f(ex - nx * wid / 2)},${f(ey - ny * wid / 2)}L${f(x1 - nx * w0)},${f(y1 - ny * w0)}Z`; };
      const len = Math.max(10, L - W / 2);
      s = `<path d="${cone(len, W, 3 * w)}" fill="#d42a10" stroke="#5a1300" stroke-width="${f(1.2 * w)}" stroke-linejoin="round"/><path d="${cone(len * .9, W * .7, 2 * w)}" fill="${c}"/><path d="${cone(len * .72, W * .42, 1.2 * w)}" fill="#ffd21f"/><path d="${cone(len * .45, W * .18, .6 * w)}" fill="#fff6c2"/>`;
      break;
    }
    case 'missile': {
      const back = a.impact ? 26 * w : 10 * w, bx = x2 - ux * back, by = y2 - uy * back;
      s = `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(bx)}" y2="${f(by)}" stroke="#6d7278" stroke-width="${f(3.4 * w)}" stroke-linecap="round" stroke-dasharray="0.1 ${f(7 * w)}"/>` +
        `<g transform="translate(${f(bx)},${f(by)}) rotate(${ang})"><path d="M${f(-11 * w)},${f(-4 * w)}L${f(-7 * w)},0L${f(-11 * w)},${f(4 * w)}Z" fill="#444a50"/><path d="M${f(-9 * w)},${f(-2.3 * w)}L${f(4 * w)},${f(-2.3 * w)}L${f(9 * w)},0L${f(4 * w)},${f(2.3 * w)}L${f(-9 * w)},${f(2.3 * w)}Z" fill="${c}" stroke="#222222" stroke-width="${f(.9 * w)}"/></g>`;
      if (a.impact) s += burstSVG(x2, y2, 13 * w, a.seed || 1);
      break;
    }
  }
  return s;
}
function annoSVG(a, ri) {
  switch (a.type) {
    case 'callout': return calloutSVG(a);
    case 'text': return textSVG(a);
    case 'effect': return effectSVG(a);
    case 'arrow': return fatArrowSVG(a, a.width || 16, a.color || '#3d9be9', { outline: a.outline, taper: a.taper, wobble: a.wobble || 0 });
    case 'magic': return magicSVG(a);
    case 'shot': { const g = shotGeom(a, ri ?? ui.cur); return shotSVG(a, g); }
  }
  return '';
}
const visibleAnnos = ri => doc.annos.filter(a => a.round === '*' || a.round === rid(ri));

function roundSVG(ri, ed) {
  let s = '';
  const aw = doc.arrowW || 16;
  if (doc.view.arrows && doc.view.trail) for (let k = 1; k < ri; k++) {
    for (const u of doc.units) { const g = moveGeom(u, k); if (g) s += fatArrowSVG(g, aw, facOf(u).arrow, { opacity: .35 }); }
    for (const gr of doc.groups) { const g = groupGeom(gr, k); if (g) s += fatArrowSVG(g, groupArrowW(), g.color, { opacity: .35 }); }
  }
  // Ghost = faint copy at the previous-round position. Per unit and round: '' editor only (top-bar toggle), 'show' always (also exported), 'hide' never.
  if (ri > 0) for (const u of doc.units) {
    const a = stateAt(u, ri - 1), b = stateAt(u, ri), gh = b && b.own ? b.ghost || '' : '';   // set per round on the unit's key
    if (!(gh === 'show' || (ed && ui.ghosts && gh !== 'hide'))) continue;
    if (a && b && a.status === 'active' && b.status !== 'gone' && (a.x !== b.x || a.y !== b.y)) s += `<g opacity=".28" pointer-events="none">${unitSVG(u, a, false)}</g>`;
  }
  if (doc.view.arrows) {
    for (const u of doc.units) { const g = moveGeom(u, ri); if (g) s += fatArrowSVG(g, aw, facOf(u).arrow); }
    for (const gr of doc.groups) { const g = groupGeom(gr, ri); if (g) s += fatArrowSVG(g, groupArrowW(), g.color); }
  }
  const live = [], items = [];
  for (const u of doc.units) {
    const st = stateAt(u, ri); if (!st) continue;
    if (st.status === 'gone') { if (doc.view.wrecks && st.was === 'destroyed') s += wreckSVG(u, st); continue; }
    if (st.status === 'withdrawn') { if (ed) s += unitSVG(u, st, true, ' opacity=".3"'); continue; }
    live.push([u, st]);
  }
  // Units and annotations share one stacking order (see zOf), so an effect can sit behind a vehicle.
  for (const [u, st] of live) {
    let svgU = unitSVG(u, st, ed);
    if (st.status === 'destroyed') { const [w, h] = dims(u); svgU += `<g${ed ? ` data-sel="unit:${u.id}"` : ''}>${burstSVG(st.x, st.y, Math.max(w, h) * .55 + 8, hashStr(u.id) + ri)}</g>`; }
    items.push([zOf('unit', u), svgU]);
  }
  for (const a of visibleAnnos(ri)) {
    let hit = '';
    if (ed && a.type === 'shot') { const g = shotGeom(a, ri); hit = `<line x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}" stroke="#000" stroke-opacity="0" stroke-width="16"/>`; }
    items.push([zOf('anno', a), `<g${ed ? ` data-sel="anno:${a.id}"` : ''}>${hit}${annoSVG(a, ri)}</g>`]);
  }
  items.sort((p, q) => p[0] - q[0]);
  return s + items.map(x => x[1]).join('');
}

/* Stacking: explicit item.z wins; otherwise a default layer per kind, then creation order. */
const ZBASE = { magic: 100, shot: 200, unit: 300, effect: 400, arrow: 500, text: 600, callout: 700 };
function zOf(k, o) {
  if (o.z != null) return o.z;
  const arr = k === 'unit' ? doc.units : doc.annos, i = arr.indexOf(o);
  return (ZBASE[k === 'unit' ? 'unit' : o.type] ?? 400) + Math.max(0, i) * .001;
}
function itemBox(k, o) {
  const box = pts => ({ x1: Math.min(...pts.map(q => q[0])), y1: Math.min(...pts.map(q => q[1])), x2: Math.max(...pts.map(q => q[0])), y2: Math.max(...pts.map(q => q[1])) });
  if (k === 'unit') {
    const st = stateAt(o, ui.cur) || { x: 0, y: 0, rot: 0 }, [w, h] = dims(o), a = (st.rot || 0) * Math.PI / 180;
    const hx = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2, hy = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2;
    return { x1: st.x - hx, y1: st.y - hy, x2: st.x + hx, y2: st.y + hy };
  }
  if (o.type === 'callout') return { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + calloutBox(o).h };
  if (o.type === 'arrow') return box([[o.x1, o.y1], [o.x2, o.y2], [arrowMid(o).x, arrowMid(o).y]]);
  if (o.type === 'shot') { const g = shotGeom(o); return box([[g.x1, g.y1], [g.x2, g.y2]]); }
  if (o.points) return box(o.points);
  const r = o.r || (o.size || 16); return { x1: o.x - r, y1: o.y - r, x2: o.x + r, y2: o.y + r };
}
function zItems() {
  const list = [];
  for (const u of doc.units) { const st = stateAt(u, ui.cur); if (st && st.status !== 'gone') list.push({ k: 'unit', o: u, z: zOf('unit', u) }); }
  for (const a of visibleAnnos(ui.cur)) list.push({ k: 'anno', o: a, z: zOf('anno', a) });
  return list.sort((p, q) => p.z - q.z);
}
// dir: 'front' | 'back' | 'fwd' | 'bwd'
function restack(dir) {
  const sel = ui.sel.filter(x => x.k !== 'ter'); if (!sel.length) return;
  const list = zItems(), ids = new Set(sel.map(x => x.id)), mine = list.filter(x => ids.has(x.o.id));
  let rest = list.filter(x => !ids.has(x.o.id));
  if (dir === 'fwd' || dir === 'bwd') {
    // Step past things that actually overlap the selection (e.g. the vehicle under an explosion).
    const bs = mine.map(x => itemBox(x.k, x.o)), B = { x1: Math.min(...bs.map(b => b.x1)), y1: Math.min(...bs.map(b => b.y1)), x2: Math.max(...bs.map(b => b.x2)), y2: Math.max(...bs.map(b => b.y2)) };
    const near = rest.filter(x => { const b = itemBox(x.k, x.o); return b.x1 < B.x2 && b.x2 > B.x1 && b.y1 < B.y2 && b.y2 > B.y1; });
    if (near.length) rest = [...near, ...rest.filter(x => !near.includes(x))].sort((p, q) => p.z - q.z), rest._near = near;
  }
  if (!mine.length) return;
  pushHistory();
  if (dir === 'front' || dir === 'back') {
    const edge = rest.length ? (dir === 'front' ? rest[rest.length - 1].z + 1 : rest[0].z - 1) : 0;
    mine.forEach((x, i) => { x.o.z = dir === 'front' ? edge + i * .01 : edge - (mine.length - i) * .01; });
  } else {
    // Hop over the nearest other item above (or below) the selection.
    const top = mine[mine.length - 1].z, bot = mine[0].z;
    const pool = rest._near || rest;
    if (dir === 'fwd') { const nx0 = pool.filter(x => x.z > bot); if (!nx0.length) return render(); const nx = rest.filter(x => x.z >= nx0[0].z); if (!nx.length) return render(); const a = nx[0].z, b = nx[1] ? nx[1].z : a + 1; mine.forEach((x, i) => { x.o.z = a + (b - a) * (i + 1) / (mine.length + 1); }); }
    else { const pv0 = pool.filter(x => x.z < top); if (!pv0.length) return render(); const pv = rest.filter(x => x.z <= pv0[pv0.length - 1].z); if (!pv.length) return render(); const a = pv[pv.length - 1].z, b = pv[pv.length - 2] ? pv[pv.length - 2].z : a - 1; mine.forEach((x, i) => { x.o.z = b + (a - b) * (i + 1) / (mine.length + 1); }); }
  }
  render();
}

/* legend */
function legendTypes() {
  const m = new Map();
  for (const u of doc.units) { const n = (u.name || '').trim(); if (!n) continue; const k = u.faction + '|' + n.toLowerCase(); if (!m.has(k)) m.set(k, u); }
  return [...m.values()];
}
function legendSVG(width) {
  const types = legendTypes(); if (!types.length) return { svg: '', h: 0 };
  const facs = doc.factions.filter(fa => types.some(t => t.faction === fa.id)), n = facs.length, gap = 28;
  const bw = (width - gap * (n - 1)) / n, cols = Math.max(1, Math.floor(bw / 190)), cw = bw / cols, rowH = 38;
  let s = '', maxH = 0;
  facs.forEach((fa, fi) => {
    const x0 = fi * (bw + gap), list = types.filter(t => t.faction === fa.id);
    s += `<text x="${f(x0)}" y="18" font-family="${SERIF}" font-size="17" font-weight="bold" fill="#111111">${esc(String(fa.name).toUpperCase())}</text><line x1="${f(x0)}" x2="${f(x0 + bw)}" y1="27" y2="27" stroke="#111111" stroke-width="1.5"/>`;
    list.forEach((u, i) => {
      const c = i % cols, r = Math.floor(i / cols), cx = x0 + c * cw + 26, cy = 50 + r * rowH, [w, h] = dims(u), k = Math.min(46 / w, 30 / h, 1.3);
      s += `<g transform="translate(${f(cx)},${f(cy)}) scale(${f(k)})">${unitShapeSVG(u)}</g><text x="${f(cx + 32)}" y="${f(cy + 4.5)}" font-family="${FONT}" font-size="13" fill="#111111">${esc(u.name)}</text>`;
    });
    maxH = Math.max(maxH, 50 + (Math.ceil(list.length / cols) - 1) * rowH + 22);
  });
  return { svg: s, h: maxH };
}

/* page layout */
// o: optional export overrides { title, legend, pad }.
function layout(o = {}) {
  const title = o.title ?? doc.showTitle, legend = o.legend ?? doc.showLegend, pad = o.pad ?? 20;
  const titleH = title ? headerH() : 0, W = doc.w + pad * 2, mapX = pad, mapY = pad + titleH;
  const lg = legend ? legendSVG(doc.w) : { svg: '', h: 0 };
  const H = mapY + doc.h + (lg.h ? 26 + lg.h : 0) + pad;
  return { pad, W, H, mapX, mapY, lg, title };
}
function exportOpts() { return { title: $('#exTitle').checked, legend: $('#exLegend').checked, pad: $('#exMargin').checked ? 20 : 0 }; }

/* ------------------------- Editor rendering ----------------------------- */
let skel = null;
function buildSkeleton() {
  svg.innerHTML = `<defs id="defsG"></defs><rect id="pageBg"/><g id="titleG"></g><g id="mapG"><g clip-path="url(#br-clip)"><g id="bgG"></g><g id="terG"></g><g id="refG"></g><g id="rndG"></g></g><rect id="frame" fill="none" stroke="#111111" stroke-width="2" pointer-events="none"/><g id="ovG"></g></g><g id="legG"></g>`;
  skel = {}; for (const id of ['defsG', 'pageBg', 'titleG', 'mapG', 'bgG', 'terG', 'refG', 'rndG', 'frame', 'ovG', 'legG']) skel[id] = svg.querySelector('#' + id);
}
function setIf(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } }
let terKey = '';
function render() {
  if (!skel) buildSkeleton();
  const L = ui.L = layout();
  svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);
  svg.style.width = Math.round(L.W * ui.zoom) + 'px'; svg.style.height = Math.round(L.H * ui.zoom) + 'px';
  svg.setAttribute('class', 'tool-' + ui.tool);
  setIf(skel.defsG, defsSVG());
  skel.pageBg.setAttribute('width', L.W); skel.pageBg.setAttribute('height', L.H); skel.pageBg.setAttribute('fill', doc.page);
  setIf(skel.titleG, doc.showTitle ? mainTitleSVG(L.W) + (doc.showRound ? roundTitleSVG(L.W, doc.rounds[ui.cur].name) : '') : '');
  skel.mapG.setAttribute('transform', `translate(${L.mapX},${L.mapY})`);
  skel.frame.setAttribute('width', doc.w); skel.frame.setAttribute('height', doc.h);
  setIf(skel.bgG, bgSVG());
  const tk = JSON.stringify(doc.terrain) + doc.customTerrain.map(c => c.id + ':' + (c.rev || 0) + ':' + c.markup.length).join();
  if (tk !== terKey) { skel.terG.innerHTML = terrainSVG(true); terKey = tk; }
  skel.terG.classList.toggle('locked', !!ui.lockTerrain);
  setIf(skel.refG, refSVG(false));
  skel.rndG.innerHTML = roundSVG(ui.cur, true);
  skel.ovG.innerHTML = overlaySVG();
  skel.legG.setAttribute('transform', `translate(${L.pad},${L.mapY + doc.h + 26})`);
  setIf(skel.legG, L.lg.svg);
  renderRounds();
  scheduleSave();
}
function getObj(s) {
  if (!s) return null;
  const arr = s.k === 'unit' ? doc.units : s.k === 'ter' ? doc.terrain : doc.annos;
  return arr.find(o => o.id === s.id) || null;
}
const isSel = (k, id) => ui.sel.some(s => s.k === k && s.id === id);
function annoCenter(a) {
  if (a.type === 'callout') return { x: a.x + a.w / 2, y: a.y + calloutBox(a).h / 2 };
  if (a.type === 'arrow') return arrowMid(a);
  if (a.type === 'magic') { const p = a.points[Math.floor(a.points.length / 2)]; return { x: p[0], y: p[1] }; }
  if (a.type === 'shot') { const g = shotGeom(a); return { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 }; }
  return { x: a.x, y: a.y };
}
function overlaySVG() {
  const z = ui.zoom, hr = 6 / z, sw = 1.5 / z, da = `stroke-dasharray="${f(5 / z)} ${f(4 / z)}" stroke-width="${f(sw)}"`;
  const hd = (x, y, h, cls = '') => `<circle class="hdl ${cls}" data-handle="${h}" cx="${f(x)}" cy="${f(y)}" r="${f(hr)}" stroke-width="${f(sw)}"/>`;
  const single = ui.sel.length === 1; let o = '';
  const sg = selGroup(), pg = sg || partGroup();
  if (pg) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const u of groupMembers(pg)) { const st = stateAt(u, ui.cur); if (!st || st.status === 'gone') continue; const [w, h] = dims(u), r = Math.max(w, h) / 2 + 10; x1 = Math.min(x1, st.x - r); y1 = Math.min(y1, st.y - r); x2 = Math.max(x2, st.x + r); y2 = Math.max(y2, st.y + r); }
    if (x1 < Infinity) {
      o += `<g${sg ? '' : ' opacity=".45"'}><rect class="selbox" x="${f(x1)}" y="${f(y1)}" width="${f(x2 - x1)}" height="${f(y2 - y1)}" rx="${f(8 / z)}" style="stroke:#ff9f1a" ${da}/><text x="${f(x1)}" y="${f(y2 + 14 / z)}" font-family="${FONT}" font-size="${f(12 / z)}" font-weight="bold" fill="#ff9f1a" stroke="#ffffff" stroke-width="${f(3 / z)}" paint-order="stroke" pointer-events="none">${esc(pg.name)}${sg ? '' : ' (editing members)'}</text></g>`;
      if (sg) { const cx = (x1 + x2) / 2; o += `<line x1="${f(cx)}" y1="${f(y1)}" x2="${f(cx)}" y2="${f(y1 - 24 / z)}" stroke="#ff9f1a" stroke-width="${f(sw)}"/>` + hd(cx, y1 - 24 / z, 'grot', 'grot'); }
    }
    const g = sg && groupGeom(sg, ui.cur); if (g) { const m = arrowMid(g); o += hd(m.x, m.y, 'gbend', 'bend'); }
  }
  for (const s of ui.sel) {
    const it = getObj(s); if (!it) continue;
    if (s.k === 'unit') {
      const st = stateAt(it, ui.cur); if (!st || st.status === 'gone') continue;
      const [w, h] = dims(it), p = 5;
      o += `<g transform="translate(${f(st.x)},${f(st.y)}) rotate(${st.rot || 0})"><rect class="selbox" x="${-w / 2 - p}" y="${-h / 2 - p}" width="${w + p * 2}" height="${h + p * 2}" ${da}/>`;
      if (single) o += `<line x1="0" y1="${-h / 2 - p}" x2="0" y2="${f(-h / 2 - p - 18 / z)}" stroke="#0a84ff" stroke-width="${f(sw)}"/>` + hd(0, -h / 2 - p - 18 / z, 'urot') + hd(w / 2 + p, h / 2 + p, 'usize');
      o += '</g>';
      const g = single && moveGeom(it, ui.cur);
      if (g) { const m = arrowMid(g); o += hd(m.x, m.y, 'ubend', 'bend'); }
    } else if (s.k === 'ter') {
      if (PATH_TYPES.has(it.type)) {
        o += `<polyline class="selbox" points="${it.points.map(p => p.join(',')).join(' ')}" ${da}/>`;
        if (single) it.points.forEach((p, i) => o += hd(p[0], p[1], 'pt:' + i));
      } else {
        o += `<g transform="translate(${f(it.x)},${f(it.y)}) rotate(${it.rot || 0})"><rect class="selbox" x="${-it.w / 2}" y="${-it.h / 2}" width="${it.w}" height="${it.h}" ${da}/>`;
        if (single) o += `<line x1="0" y1="${-it.h / 2}" x2="0" y2="${f(-it.h / 2 - 22 / z)}" stroke="#0a84ff" stroke-width="${f(sw)}"/>` + hd(0, -it.h / 2 - 22 / z, 'trot') + hd(it.w / 2, it.h / 2, 'tsize');
        o += '</g>';
      }
    } else {
      if (it.type === 'callout') { const h = calloutBox(it).h; o += `<rect class="selbox" x="${it.x - 4}" y="${it.y - 4}" width="${it.w + 8}" height="${h + 8}" ${da}/>`; if (single) o += hd(it.x + it.w + 4, it.y + h / 2, 'cw'); }
      else if (it.type === 'effect') { o += `<circle class="selbox" cx="${it.x}" cy="${it.y}" r="${it.r + 4}" ${da}/>`; if (single) o += hd(it.x + it.r + 4, it.y, 'er'); }
      else if (it.type === 'text') {
        const lines = String(it.text).split('\n'), size = it.size || 16, w = Math.max(...lines.map(l => measure(l, size, it.bold, it.italic, it.serif ? SERIF : FONT))) + 10, h = lines.length * size * 1.15 + 6;
        o += `<rect class="selbox" x="${f(it.x - w / 2)}" y="${f(it.y - h / 2)}" width="${f(w)}" height="${f(h)}" transform="rotate(${it.rot || 0} ${it.x} ${it.y})" ${da}/>`;
      } else if (it.type === 'arrow') {
        const m = arrowMid(it);
        o += `<line class="selbox" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" ${da}/>`;
        if (single) o += hd(it.x1, it.y1, 'a1') + hd(it.x2, it.y2, 'a2') + hd(m.x, m.y, 'abend', 'bend');
      } else if (it.type === 'shot') {
        const g = shotGeom(it);
        o += `<line class="selbox" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}" ${da}/>`;
        if (single) o += hd(g.x1, g.y1, 's1', it.from ? 'att' : '') + hd(g.x2, g.y2, 's2', it.to ? 'att' : '');
      } else if (it.type === 'magic') {
        o += `<polyline class="selbox" points="${it.points.map(p => p.join(',')).join(' ')}" ${da}/>`;
        if (single) it.points.forEach((p, i) => o += hd(p[0], p[1], 'pt:' + i));
      }
    }
  }
  const d = ui.drag;
  if (d && d.type === 'rubber') o += `<rect class="rubber" x="${f(Math.min(d.start.x, d.cur.x))}" y="${f(Math.min(d.start.y, d.cur.y))}" width="${f(Math.abs(d.cur.x - d.start.x))}" height="${f(Math.abs(d.cur.y - d.start.y))}" stroke-width="${f(sw)}"/>`;
  if (d && d.type === 'newshot' && Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y) > 8) {
    const tu = unitAt(d.cur, d.from), tmp = { kind: ui.shotKind, from: d.from, x1: d.start.x, y1: d.start.y, to: tu ? tu.id : null, x2: d.cur.x, y2: d.cur.y, width: 1, impact: true, seed: 3 };
    o += `<g opacity=".8">${shotSVG(tmp, shotGeom(tmp))}</g>`;
  }
  if (d && d.type === 'stroke' && d.pts.length > 1) o += `<path d="M${d.pts.map(q => f(q[0]) + ',' + f(q[1])).join('L')}" fill="none" stroke="#0a84ff" stroke-width="${f(sw * 2)}" stroke-dasharray="${f(6 / z)} ${f(4 / z)}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
  if (d && d.type === 'box') { const b = boxOf(d); if (b.w > 2 || b.h > 2) o += `<rect x="${f(b.x - b.w / 2)}" y="${f(b.y - b.h / 2)}" width="${f(b.w)}" height="${f(b.h)}" fill="#0a84ff" fill-opacity=".12" stroke="#0a84ff" stroke-width="${f(sw * 1.4)}" stroke-dasharray="${f(6 / z)} ${f(4 / z)}" pointer-events="none"/>`; }
  if (d && d.type === 'lasso' && d.pts.length > 1) o += `<path d="M${d.pts.map(q => f(q[0]) + ',' + f(q[1])).join('L')}Z" fill="#0a84ff" fill-opacity=".14" stroke="#0a84ff" stroke-width="${f(sw * 1.4)}" stroke-dasharray="${f(6 / z)} ${f(4 / z)}" stroke-linejoin="round" pointer-events="none"/>`;
  if (d && d.type === 'draw' && d.pts.length > 1) o += `<g opacity=".8">${magicSVG({ points: d.pts, style: ui.magicStyle, width: 8, jag: 0 })}</g>`;
  if (d && d.type === 'newarrow' && Math.hypot(d.cur.x - d.start.x, d.cur.y - d.start.y) > 8) o += `<g opacity=".7">${fatArrowSVG({ x1: d.start.x, y1: d.start.y, x2: d.cur.x, y2: d.cur.y, bend: 0 }, 18, ui.arrowColor, { wobble: ui.arrowWobble || 0 })}</g>`;
  if (ui.trace) {
    const t = ui.trace, pts = t.cur ? [...t.pts, [t.cur.x, t.cur.y]] : t.pts;
    if (pts.length >= 2) o += `<polygon points="${pts.map(p => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="#0a84ff" fill-opacity=".14" stroke="#0a84ff" stroke-width="${f(sw * 1.4)}" stroke-linejoin="round" pointer-events="none"/>`;
    t.pts.forEach((q, i) => { o += `<circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f(i ? hr * .7 : hr * 1.1)}" fill="${i ? '#ffffff' : '#ffd23f'}" stroke="#0a84ff" stroke-width="${f(sw)}" pointer-events="none"/>`; });
  }
  return o;
}

/* ------------------------------ Rounds bar ------------------------------ */
let roundsKey = '';
function renderRounds() {
  const key = JSON.stringify([doc.rounds, ui.cur]); if (key === roundsKey) return; roundsKey = key;
  roundsEl.innerHTML = `<span class="lbl">Rounds</span><button data-ra="prev" title="Previous round ( [ )">◀</button>` +
    doc.rounds.map((r, i) => `<button class="tab ${i === ui.cur ? 'on' : ''}" data-ri="${i}" title="Double-click to rename">${esc(r.name)}</button>`).join('') +
    `<button data-ra="next" title="Next round ( ] )">▶</button><button data-ra="add" title="Insert a round after the current one">+ Round</button><span class="grow"></span><button data-ra="left" title="Move round earlier">⇠</button><button data-ra="right" title="Move round later">⇢</button><button class="danger" data-ra="del">Delete round</button>`;
}
function gotoRound(i) {
  if (i < 0 || i >= doc.rounds.length || i === ui.cur) return;
  ui.cur = i;
  ui.sel = ui.sel.filter(s => s.k !== 'anno' || visibleAnnos(i).some(a => a.id === s.id));
  renderPanel(); render();
}
roundsEl.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ri) return gotoRound(+b.dataset.ri);
  const a = b.dataset.ra;
  if (a === 'prev') gotoRound(ui.cur - 1);
  else if (a === 'next') gotoRound(ui.cur + 1);
  else if (a === 'add') {
    pushHistory();
    const base = doc.rounds[0] && /deploy/i.test(doc.rounds[0].name) ? ui.cur + 1 : ui.cur + 2;
    doc.rounds.splice(ui.cur + 1, 0, { id: uid(), name: 'Turn ' + base });
    ui.cur++; ui.sel = ui.sel.filter(s => s.k !== 'anno'); renderPanel(); render();
    toast('New round added – units start where they ended the previous round');
  } else if (a === 'del') deleteRound(ui.cur);
  else if (a === 'left' || a === 'right') {
    const j = ui.cur + (a === 'left' ? -1 : 1); if (j < 0 || j >= doc.rounds.length) return;
    pushHistory(); const [r] = doc.rounds.splice(ui.cur, 1); doc.rounds.splice(j, 0, r); ui.cur = j; renderPanel(); render();
  }
});
roundsEl.addEventListener('dblclick', e => {
  const b = e.target.closest('[data-ri]'); if (!b) return;
  const i = +b.dataset.ri, inp = document.createElement('input');
  inp.value = doc.rounds[i].name; b.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const fin = ok => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value !== doc.rounds[i].name) { pushHistory(); doc.rounds[i].name = inp.value.trim(); } roundsKey = ''; renderPanel(); render(); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); ev.stopPropagation(); });
  inp.addEventListener('blur', () => fin(true));
});
function deleteRound(i) {
  if (doc.rounds.length < 2) return toast('A report needs at least one round');
  if (!confirm(`Delete round “${doc.rounds[i].name}”? Its moves and annotations are removed.`)) return;
  pushHistory();
  const id = doc.rounds[i].id, next = doc.rounds[i + 1]?.id;
  for (const u of doc.units) { const k = u.keys[id]; if (!k) continue; delete u.keys[id]; if (next && !u.keys[next]) u.keys[next] = k; }
  doc.units = doc.units.filter(u => Object.keys(u.keys).length); cleanGroups();
  doc.annos = doc.annos.filter(a => a.round !== id);
  doc.rounds.splice(i, 1); ui.cur = Math.min(i, doc.rounds.length - 1);
  ui.sel = ui.sel.filter(s => getObj(s)); renderPanel(); render();
}

/* ------------------------------ Panel UI -------------------------------- */
const row = (label, inner) => `<label class="row"><span>${label}</span>${inner}</label>`;
const I = {
  text: (t, k, v, ex = '') => `<input type="text" data-t="${t}" data-k="${k}" value="${esc(v)}" ${ex}>`,
  num: (t, k, v, min, max, step = 1) => `<input type="number" data-t="${t}" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}">`,
  range: (t, k, v, min, max, step = 1) => `<span class="rng"><input type="range" data-t="${t}" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}"><output>${v}</output></span>`,
  color: (t, k, v, ex = '') => `<input type="color" data-t="${t}" data-k="${k}" value="${esc(v)}" ${ex}>`,
  sel: (t, k, v, opts, ex = '') => `<select data-t="${t}" data-k="${k}" ${ex}>${opts.map(([a, b]) => `<option value="${esc(a)}"${String(a) === String(v) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`,
  check: (t, k, v, label, ex = '') => `<label class="chk"><input type="checkbox" data-t="${t}" data-k="${k}"${v ? ' checked' : ''} ${ex}> ${label}</label>`,
  area: (t, k, v, ex = '') => `<textarea data-t="${t}" data-k="${k}" ${ex}>${esc(v)}</textarea>`,
};
const sec = (title, body) => `<div class="sec"><h3>${title}</h3>${body}</div>`;
function iconPicker(t, cur) {
  const btn = (k, title, inner, vb = '0 0 24 24') => `<button class="ic${k === cur ? ' on' : ''}" data-act="icon" data-t="${t}" data-v="${esc(k)}" title="${esc(title)}"><svg viewBox="${vb}">${inner}</svg></button>`;
  const none = btn('none', 'No symbol', '<path d="M5 5L19 19M19 5L5 19" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".5"/>');
  const sym = k => btn(k, ICONS[k].title, paint(ICONS[k].tpl.replace(/(fill|stroke)="__CUT__"/g, 'class="cut"'), 'currentColor', '#2c323a'), ICONS[k].vb.join(' '));
  const custom = doc.customIcons.map(c => btn('c:' + c.id, c.name, `<g transform="translate(12,12)">${iconSVG('c:' + c.id, 22, cur === 'c:' + c.id ? '#141414' : '#e6e8eb')}</g>`)).join('');
  let h = SYMBOL_GROUPS.filter(g => g.title).map((g, i) => `<div class="iconhdr">${esc(g.title)}</div><div class="icons">${i ? '' : none}${(g.symbols || []).filter(k => ICONS[k] && ICONS[k].tpl).map(sym).join('')}</div>`).join('') +
    `<div class="iconhdr">Your symbols <button data-act="importIcon" data-t="${t}" title="Import one or more .svg files as counter symbols">Import SVG…</button></div>` +
    (custom ? `<div class="icons">${custom}</div>` : '<p class="hint">Import your own logos or silhouettes as .svg files.</p>');
  const ci = customIcon(cur);
  if (ci) h += `<div class="fac">${row('Symbol name', I.text('cicon', 'name', ci.name, `data-i="${ci.id}"`))}${I.check('cicon', 'tint', ci.tint, 'Recolour with faction symbol colour', `data-i="${ci.id}" data-rp`)}<div class="btns"><button class="danger" data-act="delIcon" data-v="${ci.id}">Delete symbol</button></div></div>`;
  return h;
}
function miniUnit(u) { const [w, h] = dims(u), k = Math.min(52 / w, 34 / h, 1.4); return `<svg viewBox="-30 -20 60 40"><g transform="scale(${f(k)})">${unitShapeSVG(u)}</g></svg>`; }
const facOpts = () => doc.factions.map(fa => [fa.id, fa.name]);
const scopeRow = a => row('Shown in', I.sel('obj', 'round', a.round === '*' ? '*' : a.round, [[rid(ui.cur), 'This round only'], ['*', 'All rounds']]));
// order: 'z' = stack among units/annotations, 'ter' = among terrain, '' = none
const commonBtns = (order = 'z') => `<div class="btns">${order ? `<button data-act="front" title="Above everything (units and effects)">To front</button><button data-act="fwd" title="Up one step – e.g. above the vehicle it overlaps">Forward</button><button data-act="bwd" title="Down one step – e.g. behind a vehicle">Backward</button><button data-act="back" title="Below all units and effects">To back</button>` : ''}</div><div class="btns"><button data-act="dup" title="⌘/Ctrl+D">Duplicate</button><button class="danger" data-act="del" title="Delete">Delete</button></div>`;

function renderPanel() {
  if (ui.trace) { panel.innerHTML = traceHTML(); return; }
  let h = '';
  if (ui.tool !== 'select') h += toolOptionsHTML();
  if (ui.sel.length === 1) h += selHTML(ui.sel[0]);
  else if (ui.sel.length > 1) h += multiHTML();
  else if (ui.tool === 'select') h += mapHTML();
  panel.innerHTML = h;
}
function traceHTML() {
  const unit = ui.trace.kind === 'unit';
  return sec(unit ? 'Trace a model' : 'Trace a building', `<p class="hint">Click each corner of the ${unit ? 'model' : 'building'}'s outline. Hold <kbd>Shift</kbd> to keep walls at 15° steps. Finish by clicking the yellow first corner, double-clicking, or pressing <kbd>Enter</kbd>. <kbd>Backspace</kbd> removes the last corner, <kbd>Esc</kbd> cancels.</p>` +
        (unit ? '' : row('Style', I.sel('ui', 'traceStyle', ui.traceStyle || 'building', TRACE_STYLES))) + `<p class="hint">${ui.trace.pts.length} corner${ui.trace.pts.length === 1 ? '' : 's'} so far.${doc.ref ? '' : ' Tip: load a photo of your table under Reference image (click empty map with the Select tool) and trace over it.'}</p>` +
        `<div class="btns"><button data-act="traceFinish"${ui.trace.pts.length < 3 ? ' disabled' : ''}>Finish</button><button data-act="traceCancel">Cancel</button></div>`) +
    sec('', `<p class="hint">${unit ? 'The outline becomes the model’s body' : 'The outline becomes the floor plan'}; the drawing editor then opens with your photo behind it so you can add ${unit ? 'turrets, tracks and details' : 'rooms, walls, roofs and details'}.</p>`);
}
function toolOptionsHTML() {
  switch (ui.tool) {
    case 'unit': {
      const types = legendTypes(); const t = ui.tpl;
      const pal = types.length ? `<p class="hint">Pick an existing type, or define a new one below.</p><div class="pal">${types.map(u => `<button data-act="tplFrom" data-v="${u.id}" class="${u.name === t.name && u.faction === t.faction ? 'on' : ''}">${miniUnit(u)}${esc(u.name)}</button>`).join('')}</div>` : '';
      return sec('Place units', `<p class="hint">Click the map to place a counter. It joins the battle in the current round.</p>${pal}`) +
        sec('New unit type', row('Type name', I.text('tpl', 'name', t.name)) + row('Faction', I.sel('tpl', 'faction', t.faction, facOpts())) + lookRows('tpl', t) + row('Width', I.range('tpl', 'w', t.w, 8, 240)) + (t.shape !== 'circle' || t.look === 'model' ? row('Height', I.range('tpl', 'h', t.h, 8, 240)) : '') + `<div style="display:flex;justify-content:center;margin-top:6px">${miniUnit(t).replace('<svg ', '<svg style="width:90px;height:60px" ')}</div>`);
    }
    case 'terrain': {
      const pick = c => `<button data-act="terType" data-v="custom:${c.id}" class="${'custom:' + c.id === ui.terrainType ? 'on' : ''}">${terrainPreview('custom:' + c.id)}${esc(c.name)}</button>`;
      const libSel = ui.terrainType.startsWith('custom:') ? library.find(c => 'custom:' + c.id === ui.terrainType) : null;
      return sec('Place terrain', `<p class="hint">Choose a feature, then click the map – the tool stays on, so you can place many in a row. <b>Drag</b> to draw: around an area for woods, rocks, cacti, crystals, marshes, hills, lakes and craters; a box for buildings (Shift keeps proportions); along the route for rivers, roads and walls. Terrain is shared by every round.</p><div class="pal">${TER_PALETTE.map(([k, l]) => `<button data-act="terType" data-v="${k}" class="${k === ui.terrainType ? 'on' : ''}">${terrainPreview(k)}${l}</button>`).join('')}</div>`) +
        sec('Buildings in this report', `<p class="hint">Trace a building's outline on the map and add details in the drawing editor, draw one from scratch, or import a top-down plan as .svg. Saved in the project file.</p>` +
          (doc.customTerrain.length ? `<div class="pal">${doc.customTerrain.map(pick).join('')}</div>` : '') +
          `<div class="btns"><button data-act="traceStart">Trace building</button><button data-act="bldNew">Draw building…</button><button data-act="importTer">Import SVG…</button></div>`) +
        sec('Your library', `<p class="hint">Kept in this browser and available in every battle. Traced buildings are added automatically; select any other building and choose “Save to library”. Export and import also include your model drawings${unitLibrary.length ? ` (${unitLibrary.length})` : ''}.</p>` +
          (library.length ? `<div class="pal">${library.map(pick).join('')}</div>` : '<p class="hint">Empty so far.</p>') +
          (libSel ? `<div class="btns"><button class="danger" data-act="libRemove" data-v="${libSel.id}">Remove “${esc(libSel.name)}” from library</button></div>` : '') +
          `<div class="btns"><button data-act="libExport"${library.length ? '' : ' disabled'}>Export library…</button><button data-act="libImport">Import library…</button></div>`);
    }
    case 'effect':
      return sec('Place effects', `<p class="hint">Click to place. Units marked “Destroyed” get an explosion automatically. <b>Magic line:</b> drag across the map to draw it.</p><div class="pal">${EFFECTS.map(([k, l]) => `<button data-act="effType" data-v="${k}" class="${k === ui.effectType ? 'on' : ''}"><svg viewBox="-34 -34 68 68">${k === 'magic' ? magicSVG({ points: [[-26, 14], [-8, -10], [8, 8], [26, -14]], style: ui.magicStyle, width: 5, jag: ui.magicStyle === 'lightning' ? 70 : 0, endOrb: true, seed: 3 }) : effectSVG({ variant: k, x: 0, y: 0, r: k === 'objective' ? 16 : 22, seed: 7 })}</svg>${l}</button>`).join('')}</div>` +
        (ui.effectType === 'magic' ? row('Magic style', I.sel('ui', 'magicStyle', ui.magicStyle, Object.entries(MAGIC).map(([k, v]) => [k, v.name]), 'data-rp')) : ''));
    case 'arrow':
      return sec('Draw arrows', `<p class="hint">Drag on the map from tail to tip. Bend it afterwards with the yellow handle.</p><div class="sw">${ARROW_COLORS.map(c => `<button data-act="defArrow" data-v="${c}" class="${c === ui.arrowColor ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>` +
        `<div class="pal" style="grid-template-columns:repeat(2,1fr);margin-top:8px">${[[0, 'Straight'], [60, 'Wobbly – out of control']].map(([v, l]) => `<button data-act="defWobble" data-v="${v}" class="${(ui.arrowWobble || 0) === v ? 'on' : ''}"><svg viewBox="-40 -14 80 28">${fatArrowSVG({ x1: -34, y1: 4, x2: 34, y2: -2, bend: 0 }, 9, ui.arrowColor, { wobble: v, sw: 1.4 })}</svg>${l}</button>`).join('')}</div>`);
    case 'callout':
      return sec('Callouts', `<p class="hint">Click to place a text box. Wrap words in *asterisks* for italics.</p>` + row('Style', I.sel('ui', 'calloutStyle', ui.calloutStyle, Object.entries(CALLOUT_STYLES).map(([k, v]) => [k, v.name]))));
    case 'fire':
      return sec('Fire lines', `<p class="hint">Drag from the shooter to the target. Ends dropped on a unit snap to it and follow it when it moves.</p><div class="pal">${Object.entries(SHOTS).map(([k, v]) => `<button data-act="shotKind" data-v="${k}" class="${k === ui.shotKind ? 'on' : ''}"><svg viewBox="-36 -20 72 40"><rect x="-36" y="-20" width="72" height="40" fill="#a6d33f"/>${shotSVG({ kind: k, width: .8, impact: true, seed: 4 }, { x1: -30, y1: 10, x2: 26, y2: -8 })}</svg>${v.name}</button>`).join('')}</div>`);
    case 'text':
      return sec('Labels', '<p class="hint">Click to place a free text label, e.g. a detachment or place name.</p>');
  }
  return '';
}
function terrainPreview(key) {
  const [type, variant] = key.split(':');
  if (type === 'custom') {
    const c = designById(variant), [, , vw, vh] = c ? c.viewBox.split(' ').map(Number) : [0, 0, 1, 1], k = Math.min(72 / vw, 46 / vh);
    return `<svg viewBox="-40 -26 80 52"><rect x="-40" y="-26" width="80" height="52" fill="#a6d33f"/>${terrainItemSVG({ type, custom: variant, x: 0, y: 0, w: vw * k, h: vh * k, rot: 0 }, false)}</svg>`;
  }
  const t = PATH_TYPES.has(type) ? { type, points: [[-36, 12], [-6, -8], [36, 8]], width: { river: 11, road: 8, wall: 4 }[type] } : { type, variant, x: 0, y: 0, w: type === 'crater' ? 46 : 70, h: type === 'crater' ? 38 : 44, rot: 0, seed: 9, levels: 2, density: 1 };
  return `<svg viewBox="-40 -26 80 52"><rect x="-40" y="-26" width="80" height="52" fill="#a6d33f"/>${terrainItemSVG(t, false)}</svg>`;
}
function selHTML(s) { const o = getObj(s); if (!o) return ''; if (s.k === 'unit') return unitPanel(o); if (s.k === 'ter') return terrainPanel(o); return annoPanel(o); }
function unitPanel(u) {
  const ri = ui.cur, st = stateAt(u, ri), first = firstKeyIdx(u), rn = esc(doc.rounds[ri].name);
  let h = sec('Unit',
    row('Type name', I.text('unit', 'name', u.name, 'placeholder="Shown in the legend"')) +
    row('Counter label', I.text('unit', 'label', u.label, 'placeholder="optional, e.g. HQ"')) +
    row('Faction', I.sel('unit', 'faction', u.faction, facOpts())) +
    lookRows('unit', u) +
    row('Width', I.range('unit', 'w', u.w, 8, 240)) + (u.shape !== 'circle' || u.look === 'model' ? row('Height', I.range('unit', 'h', u.h, 8, 240)) : '') +

    `<div class="btns"><button data-act="unitSvg" title="Download this unit as it looks now (counter or model) as an .svg file">Download SVG</button></div>` +
    (u.name ? `<div class="btns"><button data-act="applyType" title="Copy shape, icon and size to every unit with this type name and faction">Apply look to all “${esc(u.name)}”</button></div>` : ''));
  let r = '';
  if (!st) r += `<p class="hint">Not on the table yet – enters in “${esc(doc.rounds[first]?.name)}”.</p>`;
  else if (st.status === 'gone') r += `<p class="hint">${st.was === 'destroyed' ? 'Destroyed' : 'Withdrawn'} in an earlier round.</p>`;
  else {
    r += row('Status', I.sel('key', 'status', st.status, STATUS)) + row('Facing', I.range('key', 'rot', st.rot || 0, -180, 180));
    if (ri > 0) r += row('Ghost', I.sel('key', 'ghost', st.own ? st.ghost || '' : '', GHOST_OPTS));
    const gr = groupOf(u);
    if (gr) r += `<p class="hint">Member of group “${esc(gr.name)}”. Drag it to move just this unit within the group; the group keeps one shared arrow. Press Esc to go back to the whole group.</p><div class="btns"><button data-act="selectGroup">Select group</button><button data-act="leaveGroup">Remove from group</button></div>`;
    else if (ri > 0) r += I.check('key', 'noArrow', !!st.noArrow, 'Hide movement arrow') + I.check('key', 'wobble', !!(st.own && st.wobble), 'Out of control (wobbly arrow)') + row('Arrow bend', I.range('key', 'bend', st.own ? st.bend || 0 : 0, -300, 300));
    if (st.own && ri !== first) r += `<div class="btns"><button data-act="resetMove" title="Remove this round's move – the unit stays where it was">Undo move this round</button></div>`;
    if (!st.own && ri > 0) r += `<p class="hint">Hasn't moved this round. Drag it to record a move.</p>`;
  }
  r += row('Enters in', I.sel('special', 'enter', String(first), doc.rounds.map((x, i) => [String(i), x.name])));
  return h + sec(`In “${rn}”`, r) + sec('', commonBtns());
}
function terrainPanel(t) {
  const design = t.type === 'custom' ? doc.customTerrain.find(c => c.id === t.custom) : null;
  const label = design ? design.name : (TER_PALETTE.find(([k]) => k === t.type || k === t.type + ':' + t.variant) || [0, t.type])[1];
  let h = '';
  if (PATH_TYPES.has(t.type)) {
    h = row('Width', I.range('obj', 'width', t.width || 30, 2, 120)) + `<p class="hint">Drag the white handles to shape it. Double-click the line to add a point; double-click a handle to remove it.</p>`;
  } else {
    h = row('Width', I.range('obj', 'w', t.w, 10, 1200)) + row('Height', I.range('obj', 'h', t.h, 10, 1200)) + row('Rotation', I.range('obj', 'rot', t.rot || 0, -180, 180));
    if (t.type === 'hill') h += row('Levels', I.range('obj', 'levels', t.levels || 2, 1, 4));
    if (['wood', 'rocks', 'marsh', 'cacti', 'crystal'].includes(t.type)) h += row('Density', I.range('obj', 'density', t.density ?? 1, .2, 2, .1));
    if (t.type === 'building') h += row('Shape', I.sel('obj', 'variant', t.variant || 'block', BUILDINGS));
    if (t.type === 'building' && ['L', 'T', 'cross', 'U'].includes(t.variant)) h += row('Wall width', I.range('obj', 'thick', t.thick ?? 34, 5, t.variant === 'U' ? 45 : 98)) + '<p class="hint">Low = thin wall, high = almost a solid block.</p>';
    if (design) h += row('Design name', I.text('cter', 'name', design.name, `data-i="${design.id}"`)) +
      `<div class="btns">${design.parts ? `<button data-act="bldEdit" data-v="${design.id}">Edit drawing…</button>` : ''}<button data-act="bldSvg" data-v="${design.id}">Download SVG</button></div>` +
      (inLibrary(design.id) ? `<p class="hint">✓ In your library – available in every battle.</p>` : `<div class="btns"><button data-act="libSave" data-v="${design.id}">Save to library</button></div>`) +
      `<div class="btns"><button data-act="terAspect">Restore proportions</button><button class="danger" data-act="delTerDesign" data-v="${design.id}">Remove from report…</button></div>`;
    else if (!['building', 'generator', 'landing', 'cathedral'].includes(t.type)) h += `<div class="btns"><button data-act="regen">New random shape</button></div>`;
  }
  return sec('Terrain – ' + esc(label), h) + sec('', commonBtns('ter'));
}
function annoPanel(a) {
  let h = '';
  if (a.type === 'callout') {
    h = sec('Callout', I.area('obj', 'text', a.text, 'id="f-text"') + '<p class="hint">Use *asterisks* for italics, Enter for a new paragraph.</p>' +
      row('Style', I.sel('obj', 'style', a.style, Object.entries(CALLOUT_STYLES).map(([k, v]) => [k, v.name]))) +
      row('Font size', I.range('obj', 'size', a.size || 15, 9, 32)) + row('Box width', I.range('obj', 'w', a.w, 60, 700)) +
      row('Align', I.sel('obj', 'align', a.align || 'left', [['left', 'Left'], ['center', 'Centered']])) +
      I.check('obj', 'bold', a.bold, 'Bold text') + I.check('obj', 'shadow', a.shadow, 'Drop shadow') + scopeRow(a));
  } else if (a.type === 'text') {
    h = sec('Label', I.area('obj', 'text', a.text, 'id="f-text" style="min-height:50px"') +
      row('Size', I.range('obj', 'size', a.size || 16, 8, 96)) + row('Colour', I.color('obj', 'color', a.color || '#111111')) +
      row('Rotation', I.range('obj', 'rot', a.rot || 0, -180, 180)) +
      I.check('obj', 'bold', a.bold, 'Bold') + I.check('obj', 'italic', a.italic, 'Italic') + I.check('obj', 'serif', a.serif, 'Serif font') + I.check('obj', 'halo', a.halo, 'White halo') + scopeRow(a));
  } else if (a.type === 'effect') {
    h = sec('Effect', row('Kind', I.sel('obj', 'variant', a.variant, EFFECTS.filter(([k]) => k !== 'magic'))) + row('Size', I.range('obj', 'r', a.r, 4, 150)) + (a.variant === 'explosion' || a.variant === 'smoke' ? '<div class="btns"><button data-act="regen">Reshape</button></div>' : '') + scopeRow(a));
  } else if (a.type === 'shot') {
    const nm = id => { const u = id && doc.units.find(x => x.id === id); return u ? esc(u.name || 'unit') : 'free point'; };
    h = sec('Fire line', row('Weapon', I.sel('obj', 'kind', a.kind, Object.entries(SHOTS).map(([k, v]) => [k, v.name]), 'data-rp')) +
      row('Colour', I.color('obj', 'color', a.color || SHOTS[a.kind]?.color || '#ffd21f')) + row('Thickness', I.range('obj', 'width', a.width || 1, .4, 3, .1)) +
      (a.kind !== 'flamer' ? I.check('obj', 'impact', a.impact, 'Impact at target') : '') +
      `<p class="hint">From <b>${nm(a.from)}</b> to <b>${nm(a.to)}</b>. Drag an end handle onto a unit to attach it (green = attached); attached ends follow the unit.</p>` +
      `<div class="btns"><button data-act="shotReverse">Reverse</button>${a.from || a.to ? '<button data-act="shotDetach">Detach from units</button>' : ''}${a.color ? '<button data-act="shotColor">Default colour</button>' : ''}</div>` + scopeRow(a));
  } else if (a.type === 'magic') {
    h = sec('Magic line', row('Style', I.sel('obj', 'style', a.style, Object.entries(MAGIC).map(([k, v]) => [k, v.name]))) +
      row('Width', I.range('obj', 'width', a.width || 8, 2, 40)) + row('Lightning', I.range('obj', 'jag', a.jag || 0, 0, 100)) +
      I.check('obj', 'glow', a.glow !== false, 'Glow') + I.check('obj', 'endOrb', a.endOrb, 'Energy burst at the end') +
      `<p class="hint">Drag the white handles to reshape. Double-click the line to add a point; double-click a handle to remove it.</p><div class="btns"><button data-act="regen">New lightning pattern</button></div>` + scopeRow(a));
  } else if (a.type === 'arrow') {
    h = sec('Arrow', `<div class="sw">${ARROW_COLORS.map(c => `<button data-act="arrowColor" data-v="${c}" class="${c === a.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>` +
      row('Fill', I.color('obj', 'color', a.color || '#3d9be9')) + row('Outline', I.color('obj', 'outline', a.outline || '#13233f')) +
      row('Width', I.range('obj', 'width', a.width || 16, 3, 60)) + row('Bend', I.range('obj', 'bend', Math.round(a.bend || 0), -500, 500)) +
      row('Wobble', I.range('obj', 'wobble', a.wobble || 0, 0, 100)) + I.check('obj', 'taper', a.taper, 'Tapered tail') + `<div class="btns"><button data-act="reverse">Reverse direction</button></div>` + scopeRow(a));
  }
  return h + sec('', commonBtns());
}
function multiHTML() {
  const units = ui.sel.filter(s => s.k === 'unit').length, g = selGroup(), r = rid(ui.cur);
  let gh = '';
  if (g) gh = sec('Group', row('Name', I.text('grp', 'name', g.name, `data-i="${g.id}"`)) +
    (ui.cur > 0 ? I.check('gkey', 'noArrow', !!(g.noArrow || {})[r], 'Hide group arrow this round', `data-i="${g.id}"`) + I.check('gkey', 'wobble', !!(g.wobble || {})[r], 'Out of control (wobbly arrow)', `data-i="${g.id}"`) + row('Arrow bend', I.range('gkey', 'bend', (g.bend || {})[r] || 0, -300, 300).replace('<input ', `<input data-i="${g.id}" `)) : '') +
    row('Rotate', `<span class="btns" style="margin:0">${[-90, -15, 15, 90].map(v => `<button data-act="grot" data-v="${v}" title="Turn the formation ${Math.abs(v)}° ${v < 0 ? 'anti-clockwise' : 'clockwise'}">${v < 0 ? '↺' : '↻'} ${Math.abs(v)}°</button>`).join('')}</span>`) +
    `<p class="hint">${groupMembers(g).length} units. Drag the orange handle to rotate (Shift snaps to 15°). Click a member again to move it on its own.</p><div class="btns"><button data-act="ungroup" title="Ctrl+Shift+G">Ungroup</button></div>`);
  else if (units >= 2) gh = sec('Group', `<p class="hint">Group these units to move them together with a single arrow.</p><div class="btns"><button data-act="group" title="Ctrl+G">Group ${units} units</button></div>`);
  return gh + multiUnitsHTML() + multiBody(units);
}
/* Editing every selected unit at once (a group or any multi-selection).
   Fields where the units differ show "mixed" until a value is chosen. */
const selUnits = () => ui.sel.filter(s => s.k === 'unit').map(getObj).filter(Boolean);
const selKey = () => ui.sel.map(s => s.id).join(',');
const MIXED = '\u0000mixed';
function commonOf(units, k, def = '') { const v0 = units[0][k] ?? def; return units.every(u => (u[k] ?? def) === v0) ? v0 : MIXED; }
function multiUnitsHTML() {
  const us = selUnits(); if (us.length < 2) return '';
  const c = k => commonOf(us, k), mixOpt = (v, opts) => v === MIXED ? [[MIXED, '— mixed —'], ...opts] : opts;
  const txt = (k, ph) => { const v = c(k); return I.text('munit', k, v === MIXED ? '' : v, `placeholder="${v === MIXED ? 'Mixed – type to set all' : ph}"`); };
  const sel = (k, opts, ex = '') => { const v = c(k); return I.sel('munit', k, v, mixOpt(v, opts), ex); };
  const look = ui.mLookModel === selKey() ? 'model' : commonOf(us, 'look', 'counter'), w = c('w'), h = c('h');
  let b = row('Type name', txt('name', 'Shown in the legend')) + row('Counter label', txt('label', 'optional, e.g. HQ')) + row('Faction', sel('faction', facOpts()));
  b += row('Look', I.sel('munit', 'look', look, mixOpt(look, LOOKS), 'data-rp'));
  if (look === 'counter') b += row('Shape', sel('shape', SHAPES, 'data-rp')) + iconPicker('munit', c('icon') === MIXED ? null : c('icon'));
  else if (look === 'model') { const art = c('art'), fac = c('faction'); b += artPicker('munit', art === MIXED ? null : art, fac === MIXED ? us[0].faction : fac); }
  else b += '<p class="hint">These units use different looks. Choose one above to set it for all of them.</p>';
  b += row('Width' + (w === MIXED ? ' <small>(mixed)</small>' : ''), I.range('munit', 'w', w === MIXED ? us[0].w : w, 8, 240));
  if (us.some(u => u.shape !== 'circle' || u.look === 'model')) b += row('Height' + (h === MIXED ? ' <small>(mixed)</small>' : ''), I.range('munit', 'h', h === MIXED ? us[0].h : h, 8, 240));
  return sec(`Edit all ${us.length} units`, `<p class="hint">Changes here apply to every selected unit.</p>` + b);
}
function setUnitsField(k, v) {
  for (const u of selUnits()) {
    if (k === 'look' && v === 'model' && !u.art) continue;   // keep counters until a drawing is picked
    u[k] = v;
    if (u.look !== 'model' && u.shape === 'circle' && (k === 'w' || k === 'shape')) u.h = u.w;
  }
}
function multiBody(units) {
  let h = `<p class="hint">${ui.sel.length} items selected${units ? ` (${units} units)` : ''}. Drag any of them to move the group. Shift-click to add or remove.</p>`;
  if (units) h += `<div class="btns"><button data-act="mStatus" data-v="active">Active</button><button data-act="mStatus" data-v="destroyed">Destroyed</button><button data-act="mStatus" data-v="withdrawn">Withdrawn</button></div><div class="btns"><button data-act="mArrow" data-v="1">Hide move arrows</button><button data-act="mArrow" data-v="0">Show move arrows</button></div><div class="btns" title="Faint copy at the previous-round position – applies to this round"><span class="hint" style="align-self:center;margin:0">Ghosts this round:</span><button data-act="mGhost" data-v="">Editor only</button><button data-act="mGhost" data-v="show">Always</button><button data-act="mGhost" data-v="hide">Never</button></div>`;
  return sec('Selection', h + commonBtns(ui.sel.some(x => x.k === 'ter') ? '' : 'z'));
}
function mapHTML() {
  let h = sec('Current round', row('Name', I.text('round', 'name', doc.rounds[ui.cur].name)) + `<p class="hint">Units keep their position from the previous round until you move them. Moves are drawn as arrows.</p>`);
  h += sec('Page', row('Title', I.text('doc', 'title', doc.title)) + I.check('doc', 'showTitle', doc.showTitle, 'Show title') + I.check('doc', 'showRound', doc.showRound, 'Show round name') + I.check('doc', 'showLegend', doc.showLegend, 'Show legend') + I.check('view', 'labels', doc.view.labels, 'Show counter labels') + row('Page colour', I.color('doc', 'page', doc.page)));
  h += sec('Report logo', doc.logo
    ? row('Position', I.sel('logo', 'pos', doc.logo.pos, [['left', 'Left of the title'], ['right', 'Right corner']])) + row('Height', I.range('logo', 'size', Math.min(doc.logo.size || 44, 44), 16, 44)) + (doc.showTitle ? '' : '<p class="hint">Turn on “Show title” to see the logo.</p>') + `<div class="btns"><button data-act="logoLoad">Replace…</button><button class="danger" data-act="logoClear">Remove</button></div>`
    : `<p class="hint">Your own logo for this report, shown small in the header row next to the title. SVG stays editable as vectors; PNG, JPG or WebP also work.</p><div class="btns"><button data-act="logoLoad">Upload logo…</button></div>`);
  h += sec('Map', row('Width', I.num('doc', 'w', doc.w, 200, 4000, 10)) + row('Height', I.num('doc', 'h', doc.h, 200, 4000, 10)) + row('Ground', I.color('doc', 'bg', doc.bg)) + I.check('doc', 'bgShade', doc.bgShade, 'Soft lighting') + row('Move arrows', I.range('doc', 'arrowW', doc.arrowW, 4, 40)));
  h += sec('Factions', doc.factions.map((fa, i) => `<div class="fac">${I.text('fac', 'name', fa.name, `data-i="${i}"`)}<div class="facgrid"><label>Counter${I.color('fac', 'color', fa.color, `data-i="${i}"`)}</label><label>Symbol${I.color('fac', 'ink', fa.ink, `data-i="${i}"`)}</label><label>Arrows${I.color('fac', 'arrow', fa.arrow, `data-i="${i}"`)}</label></div>${doc.factions.length > 1 ? `<div class="btns"><button class="danger" data-act="delFaction" data-i="${i}">Remove faction</button></div>` : ''}</div>`).join('') + `<div class="btns"><button data-act="addFaction">+ Add faction</button></div>`);
  h += sec('Reference image', doc.ref ? row('Opacity', I.range('ref', 'opacity', doc.ref.opacity, .05, 1, .05)) + I.check('ref', 'export', doc.ref.export, 'Include (hidden layer) in SVG export') + `<div class="btns"><button data-act="refLoad">Replace…</button><button class="danger" data-act="refClear">Remove</button></div>` : `<p class="hint">Trace over a photo of your table or a scanned map. It sits above terrain, below units.</p><div class="btns"><button data-act="refLoad">Load image…</button></div>`);
  h += sec('Shortcuts', `<div class="keys"><kbd>V U T A C X F E</kbd><span>Tools</span><kbd>Shift</kbd><span>click: multi-select · drag empty map: box-select</span><kbd>[ ]</kbd><span>Previous / next round</span><kbd>Del</kbd><span>Delete selection</span><kbd>⌘/Ctrl C X V</kbd><span>Copy, cut, paste (into the current round)</span><kbd>⌘/Ctrl D</kbd><span>Duplicate</span><kbd>Ctrl G</kbd><span>Group units (Shift: ungroup) · click a selected group again to edit one member · Esc: back to group</span><kbd>Ctrl Z</kbd><span>Undo (Shift: redo)</span><kbd>Arrows</kbd><span>Nudge (Shift ×10)</span><kbd>Space</kbd><span>Drag to pan · Ctrl+wheel zoom</span><kbd>Esc</kbd><span>Back to select</span></div>`);
  h += sec('Examples', `<div class="btns"><button data-act="demo">Load example battle</button></div>`);
  return h;
}

function resolveTarget(el) {
  const s = ui.sel[0];
  switch (el.dataset.t) {
    case 'doc': return doc; case 'view': return doc.view; case 'ui': return ui; case 'tpl': return ui.tpl;
    case 'round': return doc.rounds[ui.cur]; case 'fac': return doc.factions[+el.dataset.i]; case 'ref': return doc.ref; case 'logo': return doc.logo; case 'uart': return doc.unitArt.find(a => a.id === el.dataset.i);
    case 'cicon': return doc.customIcons.find(c => c.id === el.dataset.i);
    case 'cter': return doc.customTerrain.find(c => c.id === el.dataset.i);
    case 'obj': case 'unit': return getObj(s);
    case 'grp': return doc.groups.find(g => g.id === el.dataset.i);
    case 'gkey': { const g = doc.groups.find(x => x.id === el.dataset.i); return g ? (g[el.dataset.k] = g[el.dataset.k] || {}) : null; }
    case 'key': { const u = getObj(s); return u && stateAt(u, ui.cur) ? ensureKey(u, ui.cur) : null; }
  }
  return null;
}
function onFieldInput(e) {
  const el = e.target, t = el.dataset.t, k = el.dataset.k; if (!t || !k) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.type === 'range') { v = parseFloat(el.value); if (!isFinite(v)) return; }
  else v = el.value;
  const out = el.parentElement && el.parentElement.querySelector('output'); if (out) out.textContent = v;
  if (t === 'special') return special(k, v);
  if (t === 'munit') {
    if (v === MIXED) return;
    const us = selUnits(), arts = [...new Set(us.map(u => u.art).filter(Boolean))];
    const pendingModel = k === 'look' && v === 'model' && arts.length !== 1 && us.every(u => !u.art || u.look === 'model');
    if (!pendingModel) {   // choosing "Model drawing" before a drawing is picked changes nothing yet
      beginEdit('munit:' + k + ':' + selKey());
      if (k === 'look' && v === 'model' && arts.length === 1) for (const u of us) u.art = arts[0];
      setUnitsField(k, v);
    }
    ui.mLookModel = k === 'look' && v === 'model' && selUnits().some(u => u.look !== 'model') ? selKey() : null;   // show the drawing picker until one is chosen
    if ('rp' in el.dataset || k === 'faction') renderPanel();
    render(); return;
  }
  if (t !== 'ui' && t !== 'tpl') beginEdit(t + ':' + k + ':' + (ui.sel[0]?.id || '') + ':' + (el.dataset.i || ''));
  const obj = resolveTarget(el); if (!obj) return;
  if (t === 'doc' && (k === 'w' || k === 'h')) v = clamp(Math.round(v), 200, 4000);
  if (t === 'gkey') { obj[rid(ui.cur)] = v; render(); return; }
  obj[k] = v;
  if (t === 'cter') libSync(obj);
  if (t === 'uart') libSyncArt(obj);
  if (obj.look !== 'model' && ((k === 'shape' && v === 'circle') || (k === 'w' && obj.shape === 'circle'))) obj.h = obj.w;
  if (t === 'round') roundsKey = '';
  if ('rp' in el.dataset || (t === 'obj' && k === 'variant')) renderPanel();
  render();
}
function special(k, v) {
  const u = getObj(ui.sel[0]); if (!u || k !== 'enter') return;
  const ri = +v, first = firstKeyIdx(u); if (ri === first || first < 0) return;
  pushHistory();
  if (ri < first) { const kk = u.keys[rid(first)]; delete u.keys[rid(first)]; u.keys[rid(ri)] = kk; }
  else {
    const st = stateAt(u, ri);
    for (let i = 0; i < ri; i++) delete u.keys[rid(i)];
    if (!u.keys[rid(ri)]) u.keys[rid(ri)] = { x: st.x, y: st.y, rot: st.rot || 0, status: 'active' };
  }
  renderPanel(); render();
}
panel.addEventListener('input', onFieldInput);
document.querySelector('.toggles').addEventListener('input', e => { onFieldInput(e); if (e.target.dataset.t === 'ui') { savePrefs(); render(); } });
// Editor preferences (top-bar switches that aren't part of the project) survive reloads.
const PREFS_KEY = 'battle-report-editor-prefs-v1', PREF_KEYS = ['ghosts', 'lockTerrain'];
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(PREF_KEYS.map(k => [k, !!ui[k]])))); } catch (err) { /* storage unavailable */ } }
function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); for (const k of PREF_KEYS) if (typeof p[k] === 'boolean') ui[k] = p[k]; } catch (err) { /* ignore */ } }
function updateTopbar() { document.querySelectorAll('.toggles input').forEach(el => { el.checked = !!resolveTarget(el)[el.dataset.k]; }); }

const ACT = {
  icon(b) { if (b.dataset.t === 'unit') { pushHistory(); getObj(ui.sel[0]).icon = b.dataset.v; } else if (b.dataset.t === 'munit') { pushHistory(); for (const u of selUnits()) { u.icon = b.dataset.v; u.look = 'counter'; } } else ui.tpl.icon = b.dataset.v; renderPanel(); render(); },
  tplFrom(b) { const u = doc.units.find(x => x.id === b.dataset.v); if (u) Object.assign(ui.tpl, { faction: u.faction, name: u.name, look: u.look || 'counter', art: u.art, shape: u.shape, icon: u.icon, w: u.w, h: u.h }); renderPanel(); },
  terType(b) { ui.terrainType = b.dataset.v; renderPanel(); },
  effType(b) { ui.effectType = b.dataset.v; renderPanel(); },
  defArrow(b) { ui.arrowColor = b.dataset.v; renderPanel(); },
  defWobble(b) { ui.arrowWobble = +b.dataset.v; renderPanel(); },
  del: () => deleteSel(), dup: () => duplicateSel(),
  front: () => reorder(1), back: () => reorder(-1), fwd: () => restack('fwd'), bwd: () => restack('bwd'),
  regen() { pushHistory(); getObj(ui.sel[0]).seed = randSeed(); render(); },
  resetMove() { const u = getObj(ui.sel[0]); pushHistory(); delete u.keys[rid(ui.cur)]; renderPanel(); render(); },
  applyType() { const u = getObj(ui.sel[0]); pushHistory(); let n = 0; doc.units.forEach(x => { if (x !== u && x.faction === u.faction && x.name.trim().toLowerCase() === u.name.trim().toLowerCase()) { Object.assign(x, { look: u.look || 'counter', art: u.art, shape: u.shape, icon: u.icon, w: u.w, h: u.h }); n++; } }); render(); toast(`Updated ${n} other unit${n === 1 ? '' : 's'}`); },
  addFaction() { pushHistory(); doc.factions.push({ id: uid(), name: 'New Faction', color: '#f28c28', ink: '#111111', arrow: '#ffffff' }); renderPanel(); render(); },
  delFaction(b) {
    const i = +b.dataset.i, fa = doc.factions[i]; const used = doc.units.filter(u => u.faction === fa.id).length;
    if (used && !confirm(`${used} unit(s) belong to “${fa.name}”. Delete them too?`)) return;
    pushHistory(); doc.units = doc.units.filter(u => u.faction !== fa.id); doc.factions.splice(i, 1); cleanGroups();
    if (!doc.factions.some(x => x.id === ui.tpl.faction)) ui.tpl.faction = doc.factions[0].id; renderPanel(); render();
  },
  arrowColor(b) { pushHistory(); getObj(ui.sel[0]).color = b.dataset.v; renderPanel(); render(); },
  reverse() { const a = getObj(ui.sel[0]); pushHistory(); [a.x1, a.y1, a.x2, a.y2] = [a.x2, a.y2, a.x1, a.y1]; a.bend = -(a.bend || 0); renderPanel(); render(); },
  mStatus(b) { pushHistory(); for (const s of ui.sel) if (s.k === 'unit') { const u = getObj(s); if (stateAt(u, ui.cur)) ensureKey(u, ui.cur).status = b.dataset.v; } render(); },
  mGhost(b) { if (!ui.cur) return toast('Ghosts start from the second round'); pushHistory(); for (const s of ui.sel) if (s.k === 'unit') { const u = getObj(s); if (!stateAt(u, ui.cur)) continue; const k = ensureKey(u, ui.cur); if (b.dataset.v) k.ghost = b.dataset.v; else delete k.ghost; } renderPanel(); render(); toast(`Ghost setting updated for “${doc.rounds[ui.cur].name}”`); },
  mArrow(b) { pushHistory(); const hide = b.dataset.v === '1'; for (const s of ui.sel) if (s.k === 'unit') { const u = getObj(s), g = groupOf(u); if (g) (g.noArrow = g.noArrow || {})[rid(ui.cur)] = hide; else if (stateAt(u, ui.cur)) ensureKey(u, ui.cur).noArrow = hide; } renderPanel(); render(); },
  group: () => groupSel(), ungroup: () => ungroupSel(),
  shotKind(b) { ui.shotKind = b.dataset.v; renderPanel(); },
  shotReverse() { const a = getObj(ui.sel[0]); pushHistory(); [a.from, a.to, a.x1, a.y1, a.x2, a.y2] = [a.to, a.from, a.x2, a.y2, a.x1, a.y1]; renderPanel(); render(); },
  shotDetach() { const a = getObj(ui.sel[0]); pushHistory(); const A = shotEnd(a.from, a.x1, a.y1, ui.cur), B = shotEnd(a.to, a.x2, a.y2, ui.cur); Object.assign(a, { x1: A.x, y1: A.y, x2: B.x, y2: B.y, from: null, to: null }); renderPanel(); render(); },
  shotColor() { const a = getObj(ui.sel[0]); pushHistory(); delete a.color; renderPanel(); render(); },
  grot(b) { const g = selGroup(); if (!g) return; pushHistory(); applyGroupRotation(groupRotStart(g, { x: 0, y: 0 }), +b.dataset.v); render(); },
  selectGroup() { const g = partGroup(); if (g) ui.sel = presentMembers(g).map(u => ({ k: 'unit', id: u.id })); renderPanel(); render(); },
  leaveGroup() { const u = getObj(ui.sel[0]); pushHistory(); delete u.group; cleanGroups(); renderPanel(); render(); },
  refLoad() { $('#fileRef').click(); },
  logoLoad() { $('#fileLogo').click(); },
  logoClear() { pushHistory(); doc.logo = null; renderPanel(); render(); },
  importTer() { $('#fileTer').click(); },
  traceStart() { startTrace(); },
  unitSvg() { const u = getObj(ui.sel[0]); if (!u) return; const [w, h] = dims(u), pad = 3; downloadSVGFile(u.name || 'Unit', [-w / 2 - pad, -h / 2 - pad, w + 2 * pad, h + 2 * pad], unitShapeSVG(u)); },
  traceFinish() { finishTrace(); },
  traceCancel() { cancelTrace(); },
  libSave(b) { const c = doc.customTerrain.find(x => x.id === b.dataset.v); if (c && libAdd(c)) toast(`“${c.name}” saved to your library`); renderPanel(); },
  libRemove(b) {
    const c = library.find(x => x.id === b.dataset.v); if (!c || !confirm(`Remove “${c.name}” from your library? Reports that already use it keep their copy.`)) return;
    library = library.filter(x => x.id !== c.id); saveLibrary();
    if (ui.terrainType === 'custom:' + c.id && !doc.customTerrain.some(x => x.id === c.id)) ui.terrainType = 'hill';
    renderPanel(); render();
  },
  libExport() { downloadBlob(new Blob([JSON.stringify({ type: 'battle-report-library', v: 1, designs: library, units: unitLibrary }, null, 1)], { type: 'application/json' }), 'battle-report-library.json'); },
  libImport() { $('#fileLib').click(); },
  terAspect() { const t = getObj(ui.sel[0]), c = doc.customTerrain.find(x => x.id === t.custom); if (!c) return; const [, , vw, vh] = c.viewBox.split(' ').map(Number); pushHistory(); t.h = Math.round(t.w * vh / vw); renderPanel(); render(); },
  delTerDesign(b) {
    const id = b.dataset.v, used = doc.terrain.filter(t => t.type === 'custom' && t.custom === id).length;
    if (!confirm(`Remove this building design${used ? ` and its ${used} placed cop${used === 1 ? 'y' : 'ies'}` : ''}?`)) return;
    pushHistory(); doc.customTerrain = doc.customTerrain.filter(c => c.id !== id); doc.terrain = doc.terrain.filter(t => !(t.type === 'custom' && t.custom === id));
    if (ui.terrainType === 'custom:' + id) ui.terrainType = 'hill'; ui.sel = ui.sel.filter(s => getObj(s)); renderPanel(); render();
  },
  importIcon(b) { ui.iconTarget = b.dataset.t; $('#fileIcon').click(); },
  delIcon(b) {
    const id = b.dataset.v, name = 'c:' + id, used = doc.units.filter(u => u.icon === name).length;
    if (used && !confirm(`${used} unit(s) use this symbol. Delete it anyway? They will show no symbol.`)) return;
    pushHistory(); doc.customIcons = doc.customIcons.filter(c => c.id !== id); doc.units.forEach(u => { if (u.icon === name) u.icon = 'none'; }); if (ui.tpl.icon === name) ui.tpl.icon = 'none'; renderPanel(); render();
  },
  refClear() { pushHistory(); doc.ref = null; renderPanel(); render(); },
  demo() { if (!confirm('Replace the current map with the example battle?')) return; pushHistory(); doc = demoDoc(); ui.cur = 0; ui.sel = []; afterLoad(); fitZoom(); },
};
panel.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) { e.preventDefault(); ACT[b.dataset.act](b); } });

/* --------------------------- Selection ops ------------------------------ */
function deleteSel() {
  if (!ui.sel.length) return; pushHistory();
  const ids = new Set(ui.sel.map(s => s.id));
  doc.units = doc.units.filter(o => !ids.has(o.id)); doc.terrain = doc.terrain.filter(o => !ids.has(o.id)); doc.annos = doc.annos.filter(o => !ids.has(o.id));
  cleanGroups(); ui.sel = []; renderPanel(); render();
}
function groupSel() {
  const units = ui.sel.filter(s => s.k === 'unit').map(getObj).filter(Boolean);
  if (units.length < 2) return toast('Select at least two units to group');
  pushHistory();
  const names = [...new Set(units.map(u => u.name.trim()).filter(Boolean))];
  const g = { id: uid(), name: names.length === 1 ? names[0] : 'Group ' + (doc.groups.length + 1), bend: {}, noArrow: {} };
  doc.groups.push(g); units.forEach(u => { u.group = g.id; }); cleanGroups();
  ui.sel = units.map(u => ({ k: 'unit', id: u.id })); renderPanel(); render(); toast(`Grouped ${units.length} units`);
}
function ungroupSel() {
  const units = ui.sel.filter(s => s.k === 'unit').map(getObj).filter(u => u && u.group); if (!units.length) return;
  pushHistory(); units.forEach(u => delete u.group); cleanGroups(); renderPanel(); render(); toast('Ungrouped');
}
function duplicateSel() {
  if (!ui.sel.length) return; pushHistory();
  const d = 24, out = [], gmap = {};
  for (const s of ui.sel) {
    const o = getObj(s); if (!o) continue; const c = JSON.parse(JSON.stringify(o)); c.id = uid();
    if (s.k === 'unit') {
      for (const k of Object.values(c.keys)) { k.x += d; k.y += d; }
      const g = groupOf(o);
      if (g && groupMembers(g).every(m => isSel('unit', m.id))) { if (!gmap[g.id]) { gmap[g.id] = { ...JSON.parse(JSON.stringify(g)), id: uid(), name: g.name + ' copy' }; doc.groups.push(gmap[g.id]); } c.group = gmap[g.id].id; }
      else delete c.group;
      doc.units.push(c);
    }
    else if (s.k === 'ter') { if (c.points) c.points = c.points.map(p => [p[0] + d, p[1] + d]); else { c.x += d; c.y += d; } doc.terrain.push(c); }
    else { if (c.type === 'arrow' || c.type === 'shot') { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; } else if (c.points) c.points = c.points.map(q => [q[0] + d, q[1] + d]); else { c.x += d; c.y += d; } if (c.type === 'effect') c.seed = randSeed(); doc.annos.push(c); }
    out.push({ k: s.k, id: c.id });
  }
  ui.sel = out; renderPanel(); render();
}
/* Clipboard: internal, mirrored to localStorage so it also works between tabs. */
const CLIP_KEY = 'battle-report-editor-clip-v1';
function copySel(cut) {
  if (!ui.sel.length) return false;
  const items = [], used = new Set(), icons = new Set(), arts = new Set();
  for (const s of ui.sel) {
    const o = getObj(s); if (!o) continue;
    const c = JSON.parse(JSON.stringify(o));
    if (s.k === 'unit') { const st = stateAt(o, ui.cur); if (!st || st.status === 'gone') continue; c._st = { x: st.x, y: st.y, rot: st.rot || 0 }; if (c.icon && c.icon.startsWith('c:')) icons.add(c.icon.slice(2)); if (c.art) arts.add(c.art); }
    if (s.k === 'ter' && c.type === 'custom') used.add(c.custom);
    items.push({ k: s.k, o: c });
  }
  if (!items.length) return false;
  const ids = new Set(items.map(x => x.o.id));
  const groups = doc.groups.filter(g => presentMembers(g).length && presentMembers(g).every(m => ids.has(m.id))).map(g => JSON.parse(JSON.stringify(g)));
  ui.clip = { v: 1, items, groups, designs: doc.customTerrain.filter(c => used.has(c.id)), icons: doc.customIcons.filter(c => icons.has(c.id)), arts: doc.unitArt.filter(a => arts.has(a.id)) }; ui.pasteN = 0;
  try { localStorage.setItem(CLIP_KEY, JSON.stringify(ui.clip)); } catch (err) { /* clipboard stays in memory */ }
  if (cut) { deleteSel(); toast(`Cut ${items.length} item${items.length === 1 ? '' : 's'}`); }
  else toast(`Copied ${items.length} item${items.length === 1 ? '' : 's'}`);
  return true;
}
function pasteClip() {
  let clip = ui.clip;
  if (!clip) { try { clip = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); } catch (err) { clip = null; } if (clip) { ui.clip = clip; ui.pasteN = 0; } }
  if (!clip || !clip.items || !clip.items.length) return toast('Nothing to paste – select something and press ⌘/Ctrl+C first');
  ui.pasteN = (ui.pasteN || 0) + 1;
  const d = 24 * ui.pasteN, r = rid(ui.cur), idMap = {}, gMap = {}, out = [];
  pushHistory();
  for (const c of clip.designs || []) if (!doc.customTerrain.some(x => x.id === c.id)) doc.customTerrain.push(c);
  for (const c of clip.icons || []) if (!doc.customIcons.some(x => x.id === c.id)) doc.customIcons.push(c);
  for (const a of clip.arts || []) if (!doc.unitArt.some(x => x.id === a.id)) { const c = cleanArt(a); if (c) doc.unitArt.push(c); }
  for (const g of clip.groups || []) { const ng = { ...JSON.parse(JSON.stringify(g)), id: uid(), name: g.name + ' copy' }; gMap[g.id] = ng.id; doc.groups.push(ng); }
  for (const { k, o } of clip.items) {
    const c = JSON.parse(JSON.stringify(o)); idMap[c.id] = c.id = uid(); delete c.z;
    if (k === 'unit') {
      const st = c._st; delete c._st;
      c.keys = { [r]: { x: st.x + d, y: st.y + d, rot: st.rot, status: 'active' } };   // joins the battle in the current round
      if (c.group && gMap[c.group]) c.group = gMap[c.group]; else delete c.group;
      if (!doc.factions.some(fa => fa.id === c.faction)) c.faction = doc.factions[0].id;
      doc.units.push(c);
    } else if (k === 'ter') {
      if (c.points) c.points = c.points.map(q => [q[0] + d, q[1] + d]); else { c.x += d; c.y += d; }
      doc.terrain.push(c);
    } else {
      if (c.round !== '*') c.round = r;
      if (c.type === 'arrow' || c.type === 'shot') { c.x1 += d; c.y1 += d; c.x2 += d; c.y2 += d; } else if (c.points) c.points = c.points.map(q => [q[0] + d, q[1] + d]); else { c.x += d; c.y += d; }
      if (c.seed != null) c.seed = randSeed();
      doc.annos.push(c);
    }
    out.push({ k, id: c.id });
  }
  for (const s of out) { const a = s.k === 'anno' && getObj(s); if (a && a.type === 'shot') { if (a.from && idMap[a.from]) a.from = idMap[a.from]; if (a.to && idMap[a.to]) a.to = idMap[a.to]; } }
  cleanGroups(); ui.sel = out; renderPanel(); render();
  toast(`Pasted ${out.length} item${out.length === 1 ? '' : 's'} into “${doc.rounds[ui.cur].name}”`);
}
function reorder(dir) {
  const s = ui.sel[0]; if (!s) return;
  if (s.k !== 'ter') return restack(dir > 0 ? 'front' : 'back');
  const arr = s.k === 'ter' ? doc.terrain : doc.annos, i = arr.findIndex(o => o.id === s.id); if (i < 0) return;
  pushHistory(); const [o] = arr.splice(i, 1); dir > 0 ? arr.push(o) : arr.unshift(o); render();
}
function origOf(s) { const o = getObj(s); if (s.k === 'unit') { const st = stateAt(o, ui.cur); return st ? { x: st.x, y: st.y } : null; } return JSON.parse(JSON.stringify(o)); }
function applyMove(s, orig, dx, dy) {
  const o = getObj(s); if (!o || !orig) return;
  dx = Math.round(dx); dy = Math.round(dy);
  if (s.k === 'unit') { const st = stateAt(o, ui.cur); if (!st || st.status === 'gone') return; const k = ensureKey(o, ui.cur); k.x = orig.x + dx; k.y = orig.y + dy; }
  else if (o.points) o.points = orig.points.map(p => [p[0] + dx, p[1] + dy]);
  else if (o.type === 'shot') { if (!o.from) { o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; } if (!o.to) { o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; } }
  else if (o.type === 'arrow') { o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; }
  else { o.x = orig.x + dx; o.y = orig.y + dy; }
}
function nudge(dx, dy) {
  if (!ui.sel.length) return; beginEdit('nudge');
  for (const s of ui.sel) applyMove(s, origOf(s), dx, dy);
  render();
}

/* ---------------------------- Placement --------------------------------- */
const boxOf = d => ({ x: (d.start.x + d.cur.x) / 2, y: (d.start.y + d.cur.y) / 2, w: Math.abs(d.cur.x - d.start.x), h: Math.abs(d.cur.y - d.start.y) });
// Buildings and other fixed pieces fill a box dragged on the map (Shift keeps their own proportions).
function placeBox(b, keep) {
  place('terrain', { x: b.x, y: b.y });
  const t = getObj(ui.sel[0]); if (!t || t.points) return;
  if (keep) { const k = Math.min(b.w / t.w, b.h / t.h); t.w = Math.max(10, Math.round(t.w * k)); t.h = Math.max(10, Math.round(t.h * k)); }
  else { t.w = Math.max(10, Math.round(b.w)); t.h = Math.max(10, Math.round(b.h)); }
  t.x = Math.round(b.x); t.y = Math.round(b.y); renderPanel(); render();
}
// Fills an outline drawn on the map with the chosen terrain (woods, rocks, crystals, hills, lakes ...).
function placeArea(raw) {
  const pts = raw.filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) >= 6);
  if (pts.length < 3) return;
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const r3 = v => Math.round(v * 1000) / 1000, t = { id: uid(), type: ui.terrainType, x: Math.round(x0 + w / 2), y: Math.round(y0 + h / 2), w: Math.round(w), h: Math.round(h), rot: 0, seed: randSeed(), levels: 2, density: 1 };
  t.area = pts.map(([x, y]) => [r3((x - t.x) / t.w), r3((y - t.y) / t.h)]);
  pushHistory(); doc.terrain.push(t); ui.sel = [{ k: 'ter', id: t.id }]; renderPanel(); render();
}
function place(tool, p) {
  const r = rid(ui.cur), x = Math.round(p.x), y = Math.round(p.y); let s;
  pushHistory();
  if (tool === 'unit') {
    if (ui.tpl.look === 'model' && ui.tpl.art) ensureArt(ui.tpl.art);
    const t = ui.tpl, model = t.look === 'model' && artById(t.art), u = { id: uid(), faction: t.faction, name: t.name, label: '', shape: t.shape, icon: t.icon, ...(model ? { look: 'model', art: t.art } : {}), w: t.w, h: t.shape === 'circle' && !model ? t.w : t.h, keys: { [r]: { x, y, rot: 0, status: 'active' } } };
    doc.units.push(u); s = { k: 'unit', id: u.id };
  } else if (tool === 'terrain') {
    const [type, variant] = ui.terrainType.split(':'); let t;
    if (type === 'custom') {
      const c = designById(variant); if (!c) return;
      if (!doc.customTerrain.some(x => x.id === c.id)) doc.customTerrain.push(JSON.parse(JSON.stringify(c)));
      const [, , vw, vh] = c.viewBox.split(' ').map(Number), k = c.parts ? 1 : 180 / Math.max(vw, vh);   // drawn buildings are in map pixels
      t = { id: uid(), type, custom: c.id, x, y, w: Math.round(vw * k), h: Math.round(vh * k), rot: 0, seed: 1 };
    } else if (PATH_TYPES.has(type)) t = { id: uid(), type, points: [[x - 130, y - 20], [x, y + 12], [x + 130, y - 8]], width: { river: 32, road: 24, wall: 9 }[type], seed: 1 };
    else { const S = { hill: [240, 160], wood: [200, 140], rocks: [130, 80], lake: [180, 110], marsh: [160, 100], crater: [70, 56], generator: [340, 220], landing: [220, 220], cacti: [170, 120], crystal: [120, 100], cathedral: [280, 150], building: { block: [110, 70], tri: [100, 90], hex: [90, 80], hex3: [140, 130] }[variant] || [100, 100] }[type]; t = { id: uid(), type, variant, x, y, w: S[0], h: S[1], rot: 0, seed: randSeed(), levels: 2, density: 1 }; }
    doc.terrain.push(t); s = { k: 'ter', id: t.id };
  } else if (tool === 'effect') {
    const a = { id: uid(), type: 'effect', round: r, variant: ui.effectType, x, y, r: EFFECT_R[ui.effectType], seed: randSeed() };
    if (ui.effectType === 'objective') a.round = '*';
    doc.annos.push(a); s = { k: 'anno', id: a.id };
  } else if (tool === 'callout') {
    const a = { id: uid(), type: 'callout', round: r, x, y, w: 230, text: 'Describe what happens here – who moved, who fired and who fell.', style: ui.calloutStyle, size: 14, align: 'left', bold: false, shadow: false };
    doc.annos.push(a); s = { k: 'anno', id: a.id };
  } else if (tool === 'text') {
    const a = { id: uid(), type: 'text', round: r, x, y, text: 'Label', size: 18, color: '#111111', bold: true, italic: false, serif: false, halo: true, rot: 0 };
    doc.annos.push(a); s = { k: 'anno', id: a.id };
  }
  ui.sel = s ? [s] : [];
  if (tool === 'callout' || tool === 'text') setTool('select', true);   // terrain stays active to place many pieces in a row
  renderPanel(); render();
  if (tool === 'callout' || tool === 'text') { const ta = $('#f-text'); if (ta) { ta.focus(); ta.select(); } }
}

/* ----------------------------- Pointer ---------------------------------- */
function toMap(e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x - ui.L.mapX, y: q.y - ui.L.mapY };
}
svg.addEventListener('pointerdown', e => {
  if (e.button === 1 || (e.button === 0 && ui.space)) {
    e.preventDefault();
    ui.drag = { type: 'pan', cx: e.clientX, cy: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop };
    svg.setPointerCapture(e.pointerId); return;
  }
  if (e.button !== 0) return;
  const p = toMap(e);
  if (ui.trace) { traceClick(p, e.shiftKey); return; }
  const h = e.target.closest('[data-handle]');
  if (h) {
    ui.drag = { type: 'handle', h: h.dataset.handle, pushed: false };
    if (h.dataset.handle === 'grot') { const g = selGroup(); if (!g) { ui.drag = null; return; } ui.drag.rot = groupRotStart(g, p); }
    svg.setPointerCapture(e.pointerId); return;
  }
  if (ui.tool === 'select') {
    const el = e.target.closest('[data-sel]');
    if (el) {
      const [k, id] = el.dataset.sel.split(':'), s = { k, id };
      // Groups: first click selects the whole group; clicking a member of the
      // selected group (without dragging) picks that unit so it can be moved alone.
      const gr = k === 'unit' ? groupOf(getObj(s)) : null, whole = gr && selGroup() === gr;
      const inside = gr && !whole && partGroup() === gr, individual = e.altKey || inside;
      const grp = gr && !individual ? expandGroups([s]) : [s];
      if (e.shiftKey) { ui.sel = isSel(k, id) ? ui.sel.filter(x => !grp.some(g => g.id === x.id)) : [...ui.sel, ...grp.filter(g => !isSel(g.k, g.id))]; renderPanel(); render(); return; }
      let drillTo = null;
      if (whole && !e.altKey) drillTo = s;
      else if (e.altKey) ui.sel = [s];
      else if (inside) { if (!isSel(k, id)) ui.sel = [s]; }
      else if (!isSel(k, id)) ui.sel = grp;
      renderPanel();
      ui.drag = { type: 'move', start: p, orig: ui.sel.map(x => [x, origOf(x)]), pushed: false, drillTo };
    } else {
      if (!e.shiftKey && ui.sel.length) { ui.sel = []; renderPanel(); }
      ui.drag = { type: 'rubber', start: p, cur: p, base: [...ui.sel] };
    }
    render();
  } else if (ui.tool === 'arrow') ui.drag = { type: 'newarrow', start: p, cur: p };
  else if (ui.tool === 'fire') { const u = unitAt(p), st = u && stateAt(u, ui.cur); ui.drag = { type: 'newshot', start: st ? { x: st.x, y: st.y } : p, from: u ? u.id : null, cur: p }; }
  else if (ui.tool === 'terrain' && AREA_TYPES.has(ui.terrainType)) ui.drag = { type: 'lasso', pts: [[p.x, p.y]] };
  else if (ui.tool === 'terrain' && PATH_TYPES.has(ui.terrainType)) ui.drag = { type: 'stroke', pts: [[p.x, p.y]] };
  else if (ui.tool === 'terrain') ui.drag = { type: 'box', start: p, cur: p };
  else if (ui.tool === 'effect' && ui.effectType === 'magic') ui.drag = { type: 'draw', pts: [[p.x, p.y]] };
  else { place(ui.tool, p); return; }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  const d = ui.drag;
  if (!d) { if (ui.trace) { ui.trace.cur = traceSnap(toMap(e), e.shiftKey); skel.ovG.innerHTML = overlaySVG(); } return; }
  if (d.type === 'pan') { scroller.scrollLeft = d.sl - (e.clientX - d.cx); scroller.scrollTop = d.st - (e.clientY - d.cy); return; }
  const p = toMap(e);
  if (d.type === 'move') {
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (!d.pushed) { if (Math.hypot(dx, dy) * ui.zoom < 3) return; pushHistory(); d.pushed = true; }
    for (const [s, o] of d.orig) applyMove(s, o, dx, dy);
    render();
  } else if (d.type === 'handle') {
    if (!d.pushed) { pushHistory(); d.pushed = true; }
    applyHandle(d.h, p, e); render();
  } else if (d.type === 'rubber' || d.type === 'newarrow' || d.type === 'newshot') { d.cur = p; render(); }
  else if (d.type === 'box') { d.cur = p; d.keep = e.shiftKey; skel.ovG.innerHTML = overlaySVG(); }
  else if (d.type === 'lasso' || d.type === 'stroke') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * ui.zoom > 5) { d.pts.push([p.x, p.y]); skel.ovG.innerHTML = overlaySVG(); } }
  else if (d.type === 'draw') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * ui.zoom > 4) { d.pts.push([p.x, p.y]); render(); } }
});
function endDrag(e) {
  const d = ui.drag; if (!d) return; ui.drag = null;
  if (d.type === 'rubber') {
    const x1 = Math.min(d.start.x, d.cur.x), x2 = Math.max(d.start.x, d.cur.x), y1 = Math.min(d.start.y, d.cur.y), y2 = Math.max(d.start.y, d.cur.y);
    if (x2 - x1 > 3 || y2 - y1 > 3) {
      const inR = (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2, found = [...d.base];
      for (const u of doc.units) { const st = stateAt(u, ui.cur); if (st && st.status !== 'gone' && inR(st.x, st.y) && !found.some(s => s.id === u.id)) found.push({ k: 'unit', id: u.id }); }
      for (const a of visibleAnnos(ui.cur)) { const c = annoCenter(a); if (inR(c.x, c.y) && !found.some(s => s.id === a.id)) found.push({ k: 'anno', id: a.id }); }
      ui.sel = e.altKey ? found : expandGroups(found); renderPanel();
    }
  } else if (d.type === 'newshot') {
    const tu = unitAt(d.cur, d.from), tst = tu && stateAt(tu, ui.cur);
    let x2 = tst ? tst.x : d.cur.x, y2 = tst ? tst.y : d.cur.y;
    if (!tu && Math.hypot(x2 - d.start.x, y2 - d.start.y) < 16) { x2 = d.start.x + 140; y2 = d.start.y; }
    pushHistory();
    const a = { id: uid(), type: 'shot', round: rid(ui.cur), kind: ui.shotKind, x1: Math.round(d.start.x), y1: Math.round(d.start.y), x2: Math.round(x2), y2: Math.round(y2), from: d.from, to: tu ? tu.id : null, width: 1, impact: true, seed: randSeed() };
    doc.annos.push(a); ui.sel = [{ k: 'anno', id: a.id }]; renderPanel();
  } else if (d.type === 'box') {
    const b = boxOf(d);
    if (b.w < 12 && b.h < 12) place('terrain', d.start); else placeBox(b, d.keep);
    return;
  } else if (d.type === 'stroke') {
    const len = d.pts.reduce((a, q, i) => i ? a + Math.hypot(q[0] - d.pts[i - 1][0], q[1] - d.pts[i - 1][1]) : 0, 0);
    if (len < 30) { place('terrain', { x: d.pts[0][0], y: d.pts[0][1] }); return; }
    place('terrain', { x: d.pts[0][0], y: d.pts[0][1] });
    const t = getObj(ui.sel[0]); if (t && t.points) { t.points = simplifyPts(d.pts, 4).map(q => [Math.round(q[0]), Math.round(q[1])]); render(); }
    return;
  } else if (d.type === 'lasso') {
    const xs = d.pts.map(q => q[0]), ys = d.pts.map(q => q[1]);
    if (Math.max(...xs) - Math.min(...xs) < 20 && Math.max(...ys) - Math.min(...ys) < 20) place('terrain', { x: d.pts[0][0], y: d.pts[0][1] });   // a click: default patch
    else placeArea(d.pts);
    return;
  } else if (d.type === 'draw') {
    let pts = rdp(d.pts, 2.5).map(q => [Math.round(q[0]), Math.round(q[1])]);
    const len = pts.reduce((t, q, i) => i ? t + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0, 0);
    if (pts.length < 2 || len < 12) { const [x, y] = pts[0]; pts = [[x - 90, y + 20], [x, y - 10], [x + 90, y + 15]]; }
    pushHistory();
    const a = { id: uid(), type: 'magic', round: rid(ui.cur), points: pts, style: ui.magicStyle, width: 8, jag: ui.magicStyle === 'lightning' ? 60 : 0, glow: true, endOrb: false, seed: randSeed() };
    doc.annos.push(a); ui.sel = [{ k: 'anno', id: a.id }]; renderPanel();
  } else if (d.type === 'newarrow') {
    let { x: x1, y: y1 } = d.start, { x: x2, y: y2 } = d.cur;
    if (Math.hypot(x2 - x1, y2 - y1) < 16) { x1 -= 70; x2 = x1 + 140; y2 = y1; }
    pushHistory();
    const a = { id: uid(), type: 'arrow', round: rid(ui.cur), x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), bend: 0, width: 18, color: ui.arrowColor, outline: '#13233f', taper: false, wobble: ui.arrowWobble || 0 };
    doc.annos.push(a); ui.sel = [{ k: 'anno', id: a.id }]; setTool('select', true); renderPanel();
  } else if (d.type === 'move' && !d.pushed && d.drillTo) { ui.sel = [d.drillTo]; renderPanel(); }
  else if ((d.type === 'move' || d.type === 'handle') && d.pushed) renderPanel();
  render();
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
function applyHandle(h, p, e) {
  const s = ui.sel[0], o = getObj(s); if (!o) return;
  const center = () => s.k === 'unit' ? stateAt(o, ui.cur) : o;
  if (h === 'urot' || h === 'trot') {
    const c = center(); let a = Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI + 90; if (a > 180) a -= 360;
    a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
    if (s.k === 'unit') ensureKey(o, ui.cur).rot = a; else o.rot = a;
  } else if (h === 'usize' || h === 'tsize') {
    const c = center(), r = (c.rot || 0) * Math.PI / 180, dx = p.x - c.x, dy = p.y - c.y, pad = h === 'usize' ? 5 : 0;
    const lx = Math.abs(dx * Math.cos(r) + dy * Math.sin(r)), ly = Math.abs(-dx * Math.sin(r) + dy * Math.cos(r));
    o.w = Math.max(8, Math.round(2 * (lx - pad))); o.h = Math.max(8, Math.round(2 * (ly - pad)));
    if (o.shape === 'circle') o.w = o.h = Math.max(o.w, o.h);
  } else if (h === 'ubend') { const g = moveGeom(o, ui.cur); if (g) ensureKey(o, ui.cur).bend = Math.round(bendFrom(g, p)); }
  else if (h === 'abend') o.bend = Math.round(bendFrom(o, p));
  else if (h === 's1' || h === 's2') {
    const one = h === 's1', u = unitAt(p, one ? o.to : o.from);
    if (u) { const st = stateAt(u, ui.cur); o[one ? 'from' : 'to'] = u.id; o[one ? 'x1' : 'x2'] = st.x; o[one ? 'y1' : 'y2'] = st.y; }
    else { o[one ? 'from' : 'to'] = null; o[one ? 'x1' : 'x2'] = Math.round(p.x); o[one ? 'y1' : 'y2'] = Math.round(p.y); }
  }
  else if (h === 'grot') { const R = ui.drag && ui.drag.rot; if (R) { let a = (Math.atan2(p.y - R.py, p.x - R.px) - R.a0) * 180 / Math.PI; a = e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a); applyGroupRotation(R, a); } }
  else if (h === 'gbend') { const gr = selGroup(), g = gr && groupGeom(gr, ui.cur); if (g) (gr.bend = gr.bend || {})[rid(ui.cur)] = Math.round(bendFrom(g, p)); }
  else if (h === 'a1') { o.x1 = Math.round(p.x); o.y1 = Math.round(p.y); }
  else if (h === 'a2') { o.x2 = Math.round(p.x); o.y2 = Math.round(p.y); }
  else if (h === 'cw') o.w = Math.max(60, Math.round(p.x - o.x - 4));
  else if (h === 'er') o.r = Math.max(4, Math.round(Math.hypot(p.x - o.x, p.y - o.y) - 4));
  else if (h.startsWith('pt:')) o.points[+h.slice(3)] = [Math.round(p.x), Math.round(p.y)];
}
svg.addEventListener('dblclick', e => {
  if (ui.trace) { finishTrace(); return; }
  const h = e.target.closest('[data-handle]');
  if (h && h.dataset.handle.startsWith('pt:')) {
    const o = getObj(ui.sel[0]); if (o.points.length <= 2) return toast('A path needs at least two points');
    pushHistory(); o.points.splice(+h.dataset.handle.slice(3), 1); render(); return;
  }
  const el = e.target.closest('[data-sel]'); if (!el) return;
  const [k, id] = el.dataset.sel.split(':'), o = getObj({ k, id });
  if (o.points) {
    const p = toMap(e); let best = 0, bd = Infinity;
    for (let i = 0; i < o.points.length - 1; i++) { const [ax, ay] = o.points[i], [bx, by] = o.points[i + 1], L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = clamp(((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / L2, 0, 1), dd = Math.hypot(p.x - ax - t * (bx - ax), p.y - ay - t * (by - ay)); if (dd < bd) { bd = dd; best = i; } }
    pushHistory(); o.points.splice(best + 1, 0, [Math.round(p.x), Math.round(p.y)]); ui.sel = [{ k, id }]; renderPanel(); render();
  } else if (k === 'anno' && (o.type === 'callout' || o.type === 'text')) { const ta = $('#f-text'); if (ta) { ta.focus(); ta.select(); } }
});

/* ------------------------------ Tools ----------------------------------- */
function setTool(t, quiet) {
  if (t !== ui.tool) ui.trace = null; ui.tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (!quiet) { renderPanel(); render(); }
}
$('#tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });

/* ------------------------------ Keyboard -------------------------------- */
document.addEventListener('keydown', e => {
  if (artEditorActive()) { artEditorKey(e); return; }
  const el = e.target, tag = el.tagName;
  const typing = (tag === 'INPUT' && !['checkbox', 'color', 'button'].includes(el.type)) || tag === 'TEXTAREA' || tag === 'SELECT';
  const mod = e.ctrlKey || e.metaKey;
  // Prefer the typed letter (works on QWERTZ etc.); fall back to the physical key when ⌥ changes the character.
  let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && !/^[a-z]$/.test(key) && e.code && e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  if (mod && key === 's') { e.preventDefault(); saveJSON(); return; }
  if (typing) return;
  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); redo(); return; }
  if (mod && key === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && key === 'c') { if (copySel(false)) e.preventDefault(); return; }
  if (mod && key === 'x') { if (copySel(true)) e.preventDefault(); return; }
  if (mod && key === 'v') { e.preventDefault(); pasteClip(); return; }
  if (mod && key === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && key === 'a') { e.preventDefault(); ui.sel = doc.units.filter(u => { const s = stateAt(u, ui.cur); return s && s.status !== 'gone'; }).map(u => ({ k: 'unit', id: u.id })); renderPanel(); render(); return; }
  if (mod) return;
  if (ui.trace) {
    if (e.key === 'Enter') { e.preventDefault(); finishTrace(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cancelTrace(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); ui.trace.pts.pop(); renderPanel(); render(); return; }
  }
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSel(); return;
    case 'Escape':
      if (ui.tool !== 'select') setTool('select');
      else { const pg = partGroup(); ui.sel = pg && !selGroup() ? presentMembers(pg).map(u => ({ k: 'unit', id: u.id })) : []; renderPanel(); render(); }
      return;
    case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); return;
    case 'ArrowRight': e.preventDefault(); nudge(step, 0); return;
    case 'ArrowUp': e.preventDefault(); nudge(0, -step); return;
    case 'ArrowDown': e.preventDefault(); nudge(0, step); return;
    case '[': case 'PageUp': e.preventDefault(); gotoRound(ui.cur - 1); return;
    case ']': case 'PageDown': e.preventDefault(); gotoRound(ui.cur + 1); return;
    case ' ': e.preventDefault(); ui.space = true; scroller.classList.add('panning'); return;
  }
  const t = { v: 'select', u: 'unit', t: 'terrain', a: 'arrow', c: 'callout', x: 'text', e: 'effect', f: 'fire' }[key];
  if (t) setTool(t);
});
document.addEventListener('keyup', e => { if (e.key === ' ') { ui.space = false; scroller.classList.remove('panning'); } });

/* -------------------------------- Zoom ---------------------------------- */
function setZoom(z, cx, cy) {
  const old = ui.zoom; z = clamp(z, .15, 5); if (z === old) return;
  const r = scroller.getBoundingClientRect();
  cx = cx ?? r.left + r.width / 2; cy = cy ?? r.top + r.height / 2;
  const sr = svg.getBoundingClientRect(), fx = (cx - sr.left) / sr.width, fy = (cy - sr.top) / sr.height;
  ui.zoom = z; render(); $('#zLbl').textContent = Math.round(z * 100) + '%';
  const nr = svg.getBoundingClientRect();
  scroller.scrollLeft += (nr.left + fx * nr.width) - cx; scroller.scrollTop += (nr.top + fy * nr.height) - cy;
}
function fitZoom() { const L = layout(), r = scroller.getBoundingClientRect(); ui.zoom = 1; setZoom(Math.min((r.width - 40) / L.W, (r.height - 40) / L.H)); if (ui.zoom === 1) render(); $('#zLbl').textContent = Math.round(ui.zoom * 100) + '%'; }
$('#zIn').onclick = () => setZoom(ui.zoom * 1.2);
$('#zOut').onclick = () => setZoom(ui.zoom / 1.2);
$('#zFit').onclick = fitZoom;
scroller.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(ui.zoom * Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });

/* ---------------------------- File / export ----------------------------- */
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function saveJSON() { downloadBlob(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), slug(doc.title) + '.battle.json'); toast('Project saved'); }
const svgHead = (W, H) => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n<title>${esc(doc.title)}</title>\n`;
let layerN = 0;
const layer = (label, content, hidden) => `<g inkscape:groupmode="layer" inkscape:label="${esc(label)}" id="layer${++layerN}"${hidden ? ' style="display:none"' : ''}>${content}</g>\n`;
function buildPage(ri, allRounds, o = {}) {
  layerN = 0;
  const L = layout(o), { W, H, mapX, mapY, pad } = L, T = `transform="translate(${mapX},${mapY})"`, clip = 'clip-path="url(#br-clip)"';
  let s = svgHead(W, H) + `<defs>${defsSVG()}</defs>\n`;
  s += layer('Background', `<rect width="${W}" height="${H}" fill="${doc.page}"/>` + (L.title ? mainTitleSVG(W, pad) : '') + `<g ${T}><g ${clip}>${bgSVG()}</g></g>` + (L.lg.h ? `<g transform="translate(${pad},${mapY + doc.h + 26})">${L.lg.svg}</g>` : ''));
  s += layer('Terrain', `<g ${T}><g ${clip}>${terrainSVG(false)}</g></g>`);
  if (doc.ref && doc.ref.export) s += layer('Reference image', `<g ${T}>${refSVG(true)}</g>`, true);
  const list = allRounds ? doc.rounds.map((_, i) => i) : [ri];
  for (const i of list) s += layer(doc.rounds[i].name, (L.title && doc.showRound ? roundTitleSVG(W, doc.rounds[i].name, pad) : '') + `<g ${T}><g ${clip}>${roundSVG(i, false)}</g></g>`, i !== ri);
  s += layer('Frame', `<rect x="${mapX}" y="${mapY}" width="${doc.w}" height="${doc.h}" fill="none" stroke="#111111" stroke-width="2"/>`);
  return { s: s + '</svg>\n', W, H };
}
function buildSheet(o = {}) {
  layerN = 0;
  const title = o.title ?? doc.showTitle, legend = o.legend ?? doc.showLegend;
  const n = doc.rounds.length, cols = n >= 2 ? 2 : 1, rows = Math.ceil(n / cols), gap = 30, pad = o.pad ?? 20, lab = 34;
  const titleH = title ? headerH() : 0, W = pad * 2 + cols * doc.w + (cols - 1) * gap;
  const lg = legend ? legendSVG(W - pad * 2) : { svg: '', h: 0 }, gridY = pad + titleH;
  const gridH = rows * (doc.h + lab) + (rows - 1) * gap, H = gridY + gridH + (lg.h ? 26 + lg.h : 0) + pad;
  const ter = terrainSVG(false), bg = bgSVG();
  let body = `<rect width="${W}" height="${H}" fill="${doc.page}"/>` + (title ? mainTitleSVG(W, pad) : '');
  doc.rounds.forEach((r, i) => {
    const cx = pad + (i % cols) * (doc.w + gap), cy = gridY + Math.floor(i / cols) * (doc.h + lab + gap);
    body += layer(r.name, `<g transform="translate(${cx},${cy})"><text x="0" y="24" font-family="${SERIF}" font-size="22" font-weight="bold" fill="#111111">${esc(r.name)}</text><g transform="translate(0,${lab})"><g clip-path="url(#br-clip)">${bg}${ter}${roundSVG(i, false)}</g><rect width="${doc.w}" height="${doc.h}" fill="none" stroke="#111111" stroke-width="2"/></g></g>`);
  });
  if (lg.h) body += `<g transform="translate(${pad},${gridY + gridH + 26})">${lg.svg}</g>`;
  return { s: svgHead(W, H) + `<defs>${defsSVG()}</defs>\n` + body + '</svg>\n', W, H };
}
function toPNG(built, name) {
  const url = URL.createObjectURL(new Blob([built.s], { type: 'image/svg+xml' })), img = new Image();
  img.onload = () => {
    const k = Math.min(2, 8000 / Math.max(built.W, built.H)), c = document.createElement('canvas');
    c.width = Math.round(built.W * k); c.height = Math.round(built.H * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); c.toBlob(b => downloadBlob(b, name), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('PNG export failed'); };
  img.src = url;
}
document.querySelector('#exportMenu .items').addEventListener('click', e => {
  const b = e.target.closest('[data-export]'); if (!b) return;
  $('#exportMenu').open = false;
  const eo = exportOpts(), base = slug(doc.title), rn = slug(doc.rounds[ui.cur].name), svgBlob = s => new Blob([s], { type: 'image/svg+xml' });
  switch (b.dataset.export) {
    case 'svg-round': downloadBlob(svgBlob(buildPage(ui.cur, false, eo).s), `${base}-${rn}.svg`); break;
    case 'svg-layers': downloadBlob(svgBlob(buildPage(ui.cur, true, eo).s), `${base}-all-rounds.svg`); break;
    case 'svg-sheet': downloadBlob(svgBlob(buildSheet(eo).s), `${base}-overview.svg`); break;
    case 'png-round': toPNG(buildPage(ui.cur, false, eo), `${base}-${rn}.png`); break;
    case 'png-sheet': toPNG(buildSheet(eo), `${base}-overview.png`); break;
  }
});
$('#exportMenu').addEventListener('toggle', () => { if ($('#exportMenu').open) { $('#exTitle').checked = !!doc.showTitle; $('#exLegend').checked = !!doc.showLegend; } });
document.addEventListener('pointerdown', e => { const m = $('#exportMenu'); if (m.open && !m.contains(e.target)) m.open = false; });
$('#bSave').onclick = saveJSON;
$('#bOpen').onclick = () => $('#fileOpen').click();
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#bNew').onclick = () => { if (!confirm('Start a new, empty map? (You can undo this.)')) return; pushHistory(); doc = blankDoc(); ui.cur = 0; ui.sel = []; afterLoad(); fitZoom(); };
$('#fileOpen').onchange = e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  file.text().then(txt => {
    const d = JSON.parse(txt); if (!d || !Array.isArray(d.rounds)) throw new Error('not a battle report file');
    pushHistory(); doc = normalize(d); ui.cur = 0; ui.sel = []; afterLoad(); fitZoom(); toast('Opened ' + file.name);
  }).catch(err => toast('Could not open file: ' + err.message));
};
// Report logo: SVG is sanitized and kept as vectors; raster images are stored at most 256 px (sharp in 2x PNG exports).
$('#fileLogo').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const keep = doc.logo ? { pos: doc.logo.pos, size: doc.logo.size } : { pos: 'left', size: 44 };
  try {
    let logo;
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      const c = importSvgIcon(await file.text(), file.name), [, , vw, vh] = c.viewBox.split(' ').map(Number);
      logo = { kind: 'svg', viewBox: c.viewBox, markup: c.markup, aw: vw, ah: vh };
    } else {
      if (!file.type.startsWith('image/')) throw new Error('not an image');
      const url = URL.createObjectURL(file), img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('not a readable image')); img.src = url; });
      const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      logo = { kind: 'img', src: cv.toDataURL('image/png'), aw: cv.width, ah: cv.height };
    }
    pushHistory(); doc.logo = { ...logo, ...keep }; renderPanel(); render(); toast('Logo added to the header');
  } catch (err) { toast('Could not use ' + file.name + ': ' + err.message); }
};
$('#fileRef').onchange = e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const r = new FileReader(); r.onload = () => { pushHistory(); doc.ref = { src: r.result, opacity: .5, export: false }; renderPanel(); render(); }; r.readAsDataURL(file);
};

/* --------------------------- Custom SVG icons --------------------------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const BAD_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'metadata', 'title', 'desc', 'animate', 'set', 'animatemotion', 'animatetransform', 'style']);
// Turns an uploaded SVG into safe, self-contained markup: no scripts, event
// handlers, external links or global <style> rules; ids are made unique.
const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
function parseSvgAsset(text, prefix) {
  const d = new DOMParser().parseFromString(text, 'image/svg+xml'), root = d.documentElement;
  if (d.querySelector('parsererror') || !root || root.localName !== 'svg') throw new Error('not a valid SVG file');
  const title = (root.querySelector(':scope > title')?.textContent || '').trim();
  // Inkscape layers named e.g. "cut" or "outline" act like data-layer="cut".
  root.querySelectorAll('g').forEach(g => { if (g.getAttributeNS(INKSCAPE_NS, 'groupmode') === 'layer' && !g.hasAttribute('data-layer')) g.setAttribute('data-layer', (g.getAttributeNS(INKSCAPE_NS, 'label') || '').trim().toLowerCase()); });
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(n => !isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) { const w = parseFloat(root.getAttribute('width')) || 24, h = parseFloat(root.getAttribute('height')) || 24; vb = [0, 0, w, h]; }
  // Inline simple class/element rules from <style> blocks, then drop them.
  root.querySelectorAll('style').forEach(st => {
    const css = st.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const decl = m[2].trim().replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none'); if (!decl) continue;
      for (const sel of m[1].split(',')) { const q = sel.trim(); if (!q) continue; try { root.querySelectorAll(q).forEach(el => el.setAttribute('style', decl + ';' + (el.getAttribute('style') || ''))); } catch (e) { /* unsupported selector */ } }
    }
  });
  const clean = el => {
    for (const c of [...el.children]) {
      if (c.namespaceURI !== SVGNS || BAD_TAGS.has(c.localName.toLowerCase())) { c.remove(); continue; }
      for (const a of [...c.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim();
        if (n.startsWith('on') || n === 'class') c.removeAttribute(a.name);
        else if (n === 'href' || n === 'xlink:href') { c.removeAttribute(a.name); if (v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);/i.test(v)) c.setAttribute('href', v); }
        else if (a.prefix) c.removeAttribute(a.name);
        else if (/url\(\s*['"]?(?!#)/i.test(v) || /javascript:/i.test(v)) c.removeAttribute(a.name);
      }
      clean(c);
    }
  };
  clean(root);
  // Prefix ids so several icons can live in one document.
  const ids = new Map();
  root.querySelectorAll('[id]').forEach(el => { const nid = prefix + el.id.replace(/[^\w-]/g, ''); ids.set(el.id, nid); el.setAttribute('id', nid); });
  if (ids.size) root.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      let v = a.value.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (m, k) => ids.has(k) ? `url(#${ids.get(k)})` : m);
      if (a.name === 'href' && v.startsWith('#') && ids.has(v.slice(1))) v = '#' + ids.get(v.slice(1));
      if (v !== a.value) el.setAttribute(a.name, v);
    }
  });
  return { root, vb, title };
}
const WRAP_ATTRS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'style', 'transform'];
// Serializes some of root's children, keeping paint set on the <svg> element itself.
function assetMarkup(root, kids = [...root.children]) {
  const ser = new XMLSerializer(), inner = kids.map(n => ser.serializeToString(n)).join('').replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  const wrap = WRAP_ATTRS.filter(k => root.hasAttribute(k)).map(k => `${k}="${esc(root.getAttribute(k))}"`).join(' ');
  return wrap ? `<g ${wrap}>${inner}</g>` : inner;
}
// Unit symbol: every colour becomes the symbol colour, except inside data-layer="cut" (counter colour).
function symbolAsset(text, name) {
  const { root, vb, title } = parseSvgAsset(text, 'sy-' + name + '-');
  const cut = new Set(root.querySelectorAll('[data-layer="cut"], [data-layer="cut"] *'));
  [root, ...root.querySelectorAll('*')].forEach(el => {
    const P = cut.has(el) ? '__CUT__' : '__INK__';
    for (const k of ['fill', 'stroke']) { const v = (el.getAttribute(k) || '').trim(); if (v && v !== 'none' && v !== 'transparent' && !v.startsWith('url(')) el.setAttribute(k, P); }
    const st = el.getAttribute('style'); if (st) el.setAttribute('style', st.replace(/(^|;)\s*(fill|stroke)\s*:\s*(?!\s*(none|transparent|url))[^;]+/gi, '$1$2:' + P));
    el.removeAttribute('data-layer');
  });
  return { title: title || name, vb, tpl: `<g fill="__INK__">${assetMarkup(root)}</g>` };
}
// Sprite: consecutive top-level elements with the same data-layer form one layer.
function spriteAsset(text, prefix) {
  const { root, vb } = parseSvgAsset(text, prefix), groups = [];
  for (const el of [...root.children]) {
    const name = el.getAttribute('data-layer') || ''; el.removeAttribute('data-layer');
    const last = groups[groups.length - 1];
    if (last && last[0] === name) last[1].push(el); else groups.push([name, [el]]);
  }
  return { vb, layers: groups.map(([n, els]) => [n, assetMarkup(root, els)]) };
}
async function loadAssets() {
  const get = async (url, json) => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url} (${r.status})`); return json ? r.json() : r.text(); };
  const [sym, ter] = await Promise.all([get('symbols/symbols.json', true), get('terrain/terrain.json', true)]);
  SYMBOL_GROUPS = sym.groups || [];
  const jobs = [];
  for (const g of SYMBOL_GROUPS) for (const n of g.symbols || []) jobs.push(get(`symbols/${n}.svg`).then(t => { ICONS[n] = symbolAsset(t, n); }));
  for (const n of ter.buildings || []) jobs.push(get(`terrain/buildings/${n}.svg`).then(t => { const a = parseSvgAsset(t, 'tb-' + n + '-'); TERRAIN_ART[n] = { viewBox: a.vb.join(' '), markup: assetMarkup(a.root) }; }));
  for (const [name, files] of Object.entries(ter.sprites || {})) {
    const list = SPRITES[name] = [];
    files.forEach((n, i) => jobs.push(get(`terrain/sprites/${n}.svg`).then(t => { list[i] = spriteAsset(t, 'ts-' + n + '-'); })));
  }
  const failed = (await Promise.allSettled(jobs)).filter(r => r.status === 'rejected').map(r => r.reason.message);
  for (const k in SPRITES) SPRITES[k] = SPRITES[k].filter(Boolean);
  return failed;
}
function showFatal(err) {
  const el = document.createElement('div'); el.className = 'fatal';
  el.innerHTML = location.protocol.startsWith('http')
    ? `<h2>Could not load the editor's artwork</h2><p>${esc(err.message)}</p>`
    : `<h2>Open the editor through a local web server</h2><p>Unit symbols and terrain are separate SVG files, and browsers don't let a page opened by double-click read them.</p><p>In a terminal, in the <b>battle-report-editor</b> folder, run:</p><pre>python3 -m http.server 8000</pre><p>then open <b>http://localhost:8000/</b> in your browser.</p>`;
  document.body.appendChild(el);
}
function importSvgIcon(text, fileName) {
  const id = uid(), { root, vb } = parseSvgAsset(text, 'ci' + id + '-');
  const ser = new XMLSerializer(), wrapAttrs = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'style', 'transform'].filter(k => root.hasAttribute(k) && !/url\(\s*['"]?(?!#)/i.test(root.getAttribute(k))).map(k => `${k}="${esc(root.getAttribute(k))}"`).join(' ');
  const out = r => { const inner = [...r.children].map(n => ser.serializeToString(n)).join('').replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''); return wrapAttrs ? `<g ${wrapAttrs.replace(/(fill|stroke)="(?!none)[^"]*"/g, r === root ? '$&' : '$1="__INK__"')}>${inner}</g>` : inner; };
  // Count distinct paint colours to decide whether tinting is a sensible default.
  const colours = new Set();
  root.querySelectorAll('*').forEach(el => {
    for (const k of ['fill', 'stroke']) { const v = el.getAttribute(k); if (v && v !== 'none') colours.add(v.toLowerCase()); }
    for (const m of (el.getAttribute('style') || '').matchAll(/(?:fill|stroke)\s*:\s*([^;]+)/gi)) if (m[1].trim() !== 'none') colours.add(m[1].trim().toLowerCase());
  });
  const markup = out(root);
  const tr = root.cloneNode(true);
  [tr, ...tr.querySelectorAll('*')].forEach(el => {
    for (const k of ['fill', 'stroke']) { const v = el.getAttribute(k); if (v && v !== 'none' && v !== 'transparent') el.setAttribute(k, '__INK__'); }
    const st = el.getAttribute('style'); if (st) el.setAttribute('style', st.replace(/(^|;)\s*(fill|stroke)\s*:\s*(?!\s*none)[^;]+/gi, '$1$2:__INK__'));
  });
  const tintMarkup = out(tr);
  if (markup.length > 400000) throw new Error('file is too large (max ~400 KB)');
  if (!markup.trim()) throw new Error('no drawable content found');
  return { id, name: String(fileName || 'Custom').replace(/\.svg$/i, '').slice(0, 40), viewBox: vb.join(' '), markup, tintMarkup, tint: colours.size <= 1 };
}
$('#fileIcon').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  const added = [], errors = [];
  for (const file of files) { try { added.push(importSvgIcon(await file.text(), file.name)); } catch (err) { errors.push(file.name + ': ' + err.message); } }
  if (added.length) {
    pushHistory(); doc.customIcons.push(...added);
    const name = 'c:' + added[added.length - 1].id;
    if (ui.iconTarget === 'unit' && getObj(ui.sel[0])) getObj(ui.sel[0]).icon = name; else ui.tpl.icon = name;
    renderPanel(); render();
  }
  toast(errors.length ? 'Could not import ' + errors.join('; ') : `Imported ${added.length} symbol${added.length === 1 ? '' : 's'}`);
};

$('#fileLib').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const d = JSON.parse(await file.text()), list = Array.isArray(d) ? d : d && d.designs, units = d && Array.isArray(d.units) ? d.units : [];
    if (!Array.isArray(list) && !units.length) throw new Error('not a library file');
    let added = 0, updated = 0;
    for (const raw of (list || []).filter(isDesign)) { const c = cleanDesign(raw), i = library.findIndex(x => x.id === c.id); if (i >= 0) { library[i] = c; updated++; } else { library.push(c); added++; } }
    for (const raw of units) { const a = cleanArt(raw); if (!a) continue; const i = unitLibrary.findIndex(x => x.id === a.id); if (i >= 0) { unitLibrary[i] = a; updated++; } else { unitLibrary.push(a); added++; } }
    saveLibrary(); renderPanel(); toast(`Library: ${added} added${updated ? `, ${updated} updated` : ''}`);
  } catch (err) { toast('Could not import library: ' + err.message); }
};
$('#fileTer').onchange = async e => {
  const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
  const added = [], errors = [];
  for (const file of files) { try { const c = importSvgIcon(await file.text(), file.name); added.push({ id: c.id, name: c.name, viewBox: c.viewBox, markup: c.markup }); } catch (err) { errors.push(file.name + ': ' + err.message); } }
  if (added.length) { pushHistory(); doc.customTerrain.push(...added); ui.terrainType = 'custom:' + added[added.length - 1].id; if (ui.tool !== 'terrain') setTool('terrain', true); renderPanel(); render(); }
  toast(errors.length ? 'Could not import ' + errors.join('; ') : `Imported ${added.length} building${added.length === 1 ? '' : 's'} – click the map to place`);
};

/* ------------------------------ Storage --------------------------------- */
let saveTimer = 0, warnedQuota = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch (err) { if (!warnedQuota) { warnedQuota = true; toast('Autosave unavailable – use Save to keep your work'); } } }, 500);
}
let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }

/* -------------------------------- Init ---------------------------------- */
(async function init() {
  let failed;
  try { failed = await loadAssets(); } catch (err) { showFatal(err); return; }
  loadPrefs(); loadLibrary();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (err) { saved = null; }
  doc = saved && Array.isArray(saved.rounds) ? normalize(saved) : demoDoc();
  ui.tpl.faction = doc.factions[0].id;
  setTool('select', true); updateTopbar(); updateUndoButtons(); renderPanel(); render(); fitZoom();
  if (failed.length) toast('Missing artwork: ' + failed.join(', '));
})();
