/* ui.js — HUD text, weapon wheel, inventory modal, item actions, and the keys
   that drive them (Tab, 1-9, I). Owns the 2D canvas wheel and the HTML bag
   overlay. Never touches the Three.js scenegraph. */

const weapons = (s) => {
  const w = [];
  for (const k of s.race.innate_weapons || []) {
    const d = packs.innate_weapons[k];
    if (d) w.push({ id: k, ...d, name: d.name || niceName(k) });
  }
  for (const k in s.inv) {
    const d = packs.items[k];
    if (s.inv[k] > 0 && d && d.type == 'weapon') w.push({ id: k, ...d });
  }
  return w;
};

const curWeapon = (s) => {
  const w = weapons(s);
  return w.find(x => x.id == s.wpn) || w[0];
};

const SLOWMO = .1;

/* Weapon wheel: hold Tab, move the mouse toward a slot, release Tab to equip.
   Time slows while it is open and the camera stays put. Number keys jump to a slot. */
const WR = 150, WRI = 52, WCL = WR * .75;
let wcv = null,
  wg = null,
  wtok = null;
function ensureWheel() {
  if (wcv) return;
  wcv = document.createElement('canvas');
  wcv.width = W;
  wcv.height = H;
  wcv.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:10';
  document.body.appendChild(wcv);
  wg = wcv.getContext('2d');
}
function wheelOpen() {
  if (!S || S.bad || S.step >= 3 || S.wheel || S.bag) return;
  ensureWheel();
  const list = weapons(S);
  if (!list.length) {
    S.msg = 'You have no weapons';
    return;
  }
  const cur = curWeapon(S);
  S.wheel = { list, x: 0, y: 0, sel: Math.max(0, list.findIndex(w => w.id == cur.id)) };
  wtok = tok();
  wcv.style.display = 'block';
}

function wheelMove(dx, dy) {
  const w = S.wheel, n = w.list.length;
  w.x += dx;
  w.y += dy;
  const m = Math.hypot(w.x, w.y);
  if (m > WCL) {
    w.x *= WCL / m;
    w.y *= WCL / m
  }
  if (m > 20 && n > 1) {
    const a = (Math.atan2(w.x, -w.y) + 2 * Math.PI) % (2 * Math.PI);
    w.sel = Math.round(a / (2 * Math.PI / n)) % n;
  }
}

function wheelPick(i) {
  const w = S && S.wheel;
  if (w && i < w.list.length) w.sel = i;
}

/* Mouse wheel: move the selection while the wheel is open, otherwise equip the next weapon. */
function cycleWeapon(d) {
  if (!S || S.bad) return;
  const w = S.wheel, list = w ? w.list : weapons(S), n = list.length;
  if (!n) return;
  if (w) w.sel = (w.sel + d + n) % n;
  else S.wpn = list[(Math.max(0, list.findIndex(x => x.id == curWeapon(S).id)) + d + n) % n].id;
}

function wheelClose(commit) {
  const w = S && S.wheel;
  if (!w) return;
  if (commit) S.wpn = w.list[w.sel].id;
  S.wheel = null;
  wcv.style.display = 'none';
}

function wheelDraw() {
  const w = S && S.wheel;
  if (!w) return;
  const r = cv.getBoundingClientRect(),
    n = w.list.length,
    cx = W / 2,
    cy = H / 2,
    T = 2 * Math.PI / n;
  Object.assign(wcv.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  wg.clearRect(0, 0, W, H);
  wg.globalAlpha = .4;
  wg.fillStyle = wtok.bg;
  wg.fillRect(0, 0, W, H);
  wg.textAlign = 'center';
  w.list.forEach((it, i) => {
    const on = i == w.sel,
      c = i * T - Math.PI / 2,
      g = n > 1 ? .04 : 0;
    wg.beginPath();
    wg.arc(cx, cy, WR, c - T / 2 + g, c + T / 2 - g);
    wg.arc(cx, cy, WRI, c + T / 2 - g, c - T / 2 + g, true);
    wg.closePath();
    wg.globalAlpha = on ? .95 : .78;
    wg.fillStyle = on ? wtok.acc : wtok.bg;
    wg.fill();
    wg.globalAlpha = on ? 1 : .5;
    wg.strokeStyle = wtok.fg;
    wg.lineWidth = on ? 3 : 1;
    wg.stroke();
    /* name wrapped to short lines, then "slot  type" underneath */
    const lines = [];
    for (const word of it.name.split(' ')) {
      const last = lines.length - 1;
      if (last >= 0 && (lines[last] + ' ' + word).length <= 12) lines[last] += ' ' + word;
      else lines.push(word);
    }
    const rr = (WR + WRI) / 2,
      lx = cx + Math.cos(c) * rr,
      ly = cy + Math.sin(c) * rr - lines.length * 7;
    wg.globalAlpha = 1;
    wg.fillStyle = on ? wtok.bg : wtok.fg;
    wg.font = 'bold 14px sans-serif';
    lines.forEach((t, k) => wg.fillText(t, lx, ly + k * 16));
    wg.font = '11px sans-serif';
    wg.fillText((i + 1) + '  ' + it.weapon_type, lx, ly + lines.length * 16 + 2);
  });
  wg.globalAlpha = 1;
  wg.fillStyle = wtok.fg;
  wg.font = 'bold 18px sans-serif';
  wg.fillText(w.list[w.sel].name, cx, cy + WR + 26);
  wg.beginPath();
  wg.arc(cx + w.x, cy + w.y, 5, 0, 2 * Math.PI);
  wg.fill();
  wg.strokeStyle = wtok.bg;
  wg.lineWidth = 2;
  wg.stroke();
}

/* Items: use and drop. Weapons equip, items with a `use` effect apply it (invis:
   seconds of invisibility) and are consumed unless use.keep. Dropped items become
   pickups in the scene they were dropped in, with a short delay before they can
   be picked up again. */
function useItem(s, k) {
  const d = packs.items[k];
  if (!d || !(s.inv[k] > 0)) return '';
  if (d.type == 'weapon') {
    s.wpn = k;
    return 'Equipped ' + d.name;
  }
  const u = d.use;
  if (!u) return '';
  if (u.invis) s.invis = u.invis;
  if (!u.keep) s.inv[k]--;
  return u.msg || 'Used ' + d.name;
}

function dropItem(s, k) {
  if (!(s.inv[k] > 0)) return false;
  s.inv[k]--;
  const p = s.p;
  let x = p.x, y = p.y;
  if (!p.vehicle) {
    const nx = p.x + Math.sin(p.heading) * 1.6, ny = p.y + Math.cos(p.heading) * 1.6;
    if (nx > .5 && nx < s.size[0] - .5 && ny > .5 && ny < s.size[1] - .5 && !GSA.physics.hit(s, nx, ny, 0)) {
      x = nx;
      y = ny;
    }
  }
  GSA.engine.addItem(k, x, y, s.scene, 1);
  s.msg = 'Dropped ' + packs.items[k].name;
  return true;
}

/* Inventory screen: press I. The game is paused while it is open. Up/Down (or W/S)
   choose, Enter uses, Backspace drops one, I or Esc closes; the buttons and rows
   work with the mouse. */
const mk = (tag, css, txt) => {
  const x = document.createElement(tag);
  if (css) x.style.cssText = css;
  if (txt != null) x.textContent = txt;
  return x;
};
const BTN = 'flex:1;padding:6px 8px;font:inherit;color:var(--fg);background:transparent;border:1px solid var(--fg);cursor:pointer',
  ROW = 'display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer';
const bagEl = mk('div', 'position:fixed;display:none;z-index:11;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:14px/1.4 sans-serif'),
  bagPanel = mk('div', 'width:min(340px,88%);max-height:90%;overflow:auto;box-sizing:border-box;padding:14px 16px;background:var(--bg);color:var(--fg);border:2px solid var(--fg)'),
  bagList = mk('div', 'margin:10px 0'),
  bagMsg = mk('div', 'min-height:1.4em;margin-bottom:8px'),
  bagBtns = mk('div', 'display:flex;gap:8px'),
  bagUseB = mk('button', BTN, 'Use'),
  bagDropB = mk('button', BTN, 'Drop'),
  bagCloseB = mk('button', BTN, 'Close');
[bagUseB, bagDropB, bagCloseB].forEach(b => {
  b.tabIndex = -1;
  b.onmousedown = e => e.preventDefault();
  bagBtns.appendChild(b);
});
[mk('div', 'font-weight:bold;font-size:18px', 'Inventory'), bagList, bagMsg, bagBtns,
  mk('div', 'margin-top:10px;opacity:.7;font-size:12px', 'Up and down to choose, Enter to use, Backspace to drop, I to close')
].forEach(x => bagPanel.appendChild(x));
bagEl.appendChild(bagPanel);
document.body.appendChild(bagEl);
bagUseB.onclick = () => bagUse();
bagDropB.onclick = () => bagDrop();
bagCloseB.onclick = () => bagClose(true);

const bagItems = () => Object.keys(S.inv).filter(k => S.inv[k] > 0 && packs.items[k]);

function bagOpen() {
  if (!S || S.bad || S.bag || S.wheel) return;
  S.bag = { sel: 0, msg: '', lock: document.pointerLockElement === cv };
  if (S.bag.lock && document.exitPointerLock) document.exitPointerLock();
  bagEl.style.display = 'flex';
  bagRender();
}

function bagClose(relock) {
  const b = S && S.bag;
  if (!b) return;
  S.bag = null;
  bagEl.style.display = 'none';
  if (relock && b.lock && cv.requestPointerLock) {
    const r = cv.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  }
}

function bagRender() {
  const b = S.bag, ks = bagItems();
  b.sel = Math.max(0, Math.min(b.sel, ks.length - 1));
  bagList.innerHTML = '';
  if (!ks.length) bagList.appendChild(mk('div', 'opacity:.7', 'Nothing here yet. Pick things up around the map.'));
  const cw = curWeapon(S);
  ks.forEach((k, i) => {
    const d = packs.items[k], n = S.inv[k],
      row = mk('div', ROW + (i == b.sel ? ';background:var(--acc);color:var(--bg)' : '')),
      sw = mk('span', 'width:12px;height:12px;flex:none;border:1px solid currentColor');
    if (d.color) sw.style.background = d.color;
    row.appendChild(sw);
    row.appendChild(mk('span', 'flex:1', d.name + (cw && cw.id == k ? ' (equipped)' : '')));
    if (n > 1) row.appendChild(mk('span', '', '\u00d7' + n));
    row.onclick = () => {
      b.sel = i;
      b.msg = '';
      bagRender();
    };
    bagList.appendChild(row);
  });
  const k = ks[b.sel], d = k && packs.items[k], canUse = !!d && (d.type == 'weapon' || !!d.use);
  bagUseB.textContent = d && d.type == 'weapon' ? 'Equip' : 'Use';
  bagUseB.disabled = !canUse;
  bagUseB.style.opacity = canUse ? 1 : .4;
  bagDropB.disabled = !k;
  bagDropB.style.opacity = k ? 1 : .4;
  bagMsg.textContent = b.msg;
}

function bagStep(d) {
  const b = S.bag, n = bagItems().length;
  if (!n) return;
  b.sel = (b.sel + d + n) % n;
  b.msg = '';
  bagRender();
}

function bagUse() {
  const b = S.bag, k = bagItems()[b.sel];
  if (!k) return;
  const m = useItem(S, k);
  if (m) S.msg = m;
  b.msg = m || packs.items[k].name + " can't be used on its own";
  bagRender();
}

function bagDrop() {
  const b = S.bag, k = bagItems()[b.sel];
  if (!k) return;
  dropItem(S, k);
  b.msg = 'Dropped ' + packs.items[k].name;
  bagRender();
}

/* Returns true if the key was a bag key. */
function bagKey(k) {
  if (k == 'i' || k == 'escape') bagClose(true);
  else if (k == 'arrowup' || k == 'w') bagStep(-1);
  else if (k == 'arrowdown' || k == 's') bagStep(1);
  else if (k == 'enter') bagUse();
  else if (k == 'backspace' || k == 'delete') bagDrop();
  else return false;
  return true;
}

function bagDraw() {
  if (!(S && S.bag)) return;
  const r = cv.getBoundingClientRect();
  Object.assign(bagEl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

/* The text overlay: race, heat, RAM, weapon, items, mission steps and the last message. */
function hud(s) {
  const n = Math.ceil(s.heat),
    stars = '\u2605'.repeat(n) + '\u2606'.repeat(5 - n),
    items = Object.entries(s.inv).filter(e => e[1]).map(e => packs.items[e[0]].name + ' x' + e[1]).join(', ') || 'none',
    steps = mission.steps.map((m, i) => (i < s.step ? '[done] ' : i == s.step ? '[now]  ' : '[next] ') + m.t.replace('{source}', s.B.source.name).replace('{dest}', s.B.dest.name));
  document.querySelector('#hud').textContent =
    `${s.race.name}   Heat ${stars}   RAM carried ${s.carry}/${mission.of}   Interior: ${s.interior}\n` +
    `Weapon: ${(curWeapon(s) || { name: 'none' }).name}   [hold Tab] wheel   [I] bag   Items: ${items}${s.invis > 0 ? '   Invisible ' + Math.ceil(s.invis) + 's' : ''}\n` +
    steps.join('\n') +
    (s.step >= 3 ? `\nMission complete: ${s.carry}/${mission.of} sticks delivered.` : '') +
    (s.msg ? '\n' + s.msg : '');
}

/* Keys for the bag and wheel. (Game keys live in conf.js.) */
addEventListener('keydown', e => {
  if (e.repeat || !S) return;
  const k = e.key.toLowerCase(), plain = !e.altKey && !e.ctrlKey && !e.metaKey;
  if (S.bag) { if (bagKey(k)) e.preventDefault(); }
  else if (k == 'i' && plain) bagOpen();
  if (k == 'tab' && plain) {
    wheelOpen();
    e.preventDefault();
  }
  if (/^[1-9]$/.test(k)) wheelPick(+k - 1);
});
addEventListener('keyup', e => { if (e.key == 'Tab') wheelClose(true); });
addEventListener('blur', () => wheelClose(false));

(window.GSA = window.GSA || {}).ui = {
  weapons,
  curWeapon,
  cycleWeapon,
  useItem,
  dropItem,
  wheelOpen,
  wheelMove,
  wheelPick,
  wheelClose,
  wheelDraw,
  bagOpen,
  bagClose,
  bagStep,
  bagDraw,
  hud,
  slowmo: SLOWMO
};
