/* ai.js — what a mob knows and what happens to it: factions, senses, spawning,
   drops, damage. What it does about any of that is its MobScript (scripting.js).

   A mob is an edict with base.type == 'actor'. Its form (stats from packs.mobs)
   is e.base; its faction, hp and state are on the edict. */

/* How a faction treats the player: 'hostile', 'flee' or 'neutral'. A function is
   asked with the state. Any faction not listed here is hostile. */
const ATTITUDE = {
  cops: s => s.heat >= 1 ? 'hostile' : 'neutral',
  'passive-critters': 'flee',
  civilians: 'neutral'
};

const attitude = (m, s) => {
  const a = ATTITUDE[m.faction] || 'hostile';
  return typeof a == 'function' ? a(s) : a;
};
const hostile = (m, s) => attitude(m, s) == 'hostile';

/* Mobs that exist in the scene the player is standing in. */
const live = s => s.edicts.filter(e => !e.free && !e.dead && e.sc == s.scene && e.base.type == 'actor');

/* Do the player's weapons and abilities affect this? Anything that fights or
   flees from the player, plus cops. */
const isTarget = (e, s) => !e.free && !e.dead && e.base.type == 'actor' && (e.faction == 'cops' || attitude(e, s) != 'neutral');
const combatTargets = s => live(s).filter(m => isTarget(m, s));

/* ---------- Senses ---------- */

/* Is there a wall between two points? Sampled every half tile. */
const blocked = (s, x0, y0, x1, y1) => {
  const n = Math.ceil(dist([x0, y0], [x1, y1]) * 2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (RC(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, s.walls)) return true;
  }
  return false;
};

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

/* Can this mob see the player? Invisibility cloaks light, not sound. */
const sees = (m, s) => {
  const p = s.p, dx = p.x - m.x, dy = p.y - m.y;
  return s.invis <= 0
    && Math.hypot(dx, dy) <= m.base.viewDist
    && Math.abs(wrapAngle(Math.atan2(dx, dy) - m.heading)) <= m.base.viewCone / 2
    && !blocked(s, m.x, m.y, p.x, p.y);
};

/* Perceived volume = loudness * (1 - dist/radius), halved behind a wall. A mob that
   hears at least its hearingLevel gets OnAlert(x, y). radius = Infinity is an alarm. */
const emitSound = (x, y, radius, loudness) => {
  const s = GSA.state();
  for (const m of live(s)) {
    const d = dist([m.x, m.y], [x, y]);
    if (d > radius) continue;
    const heard = loudness * (1 - d / radius) * (blocked(s, x, y, m.x, m.y) ? .5 : 1);
    if (heard >= m.base.hearingLevel) m.script.dispatch('OnAlert', x, y, heard);
  }
};

/* ---------- Combat ---------- */

/* The player was hit: they drop a stick of RAM, then are safe for a moment. */
const hurt = s => {
  if (s.cd <= 0 && s.carry > 0) {
    s.carry--;
    s.cd = s.race.hitCd;
    s.msg = 'You dropped a stick of RAM';
  }
};

/* One path for damage and death: the target's script decides what it means. */
const damageMob = (e, amount, src) => {
  if (e.free || e.dead || !e.script) return;
  e.script.dispatch('OnHit', src, amount);
};
const killMob = e => damageMob(e, Infinity, null);

/* ---------- Lifecycle ---------- */

const spawnMob = (key, x, y, o = {}) => {
  const def = packs.mobs[key];
  if (!def) return null;
  return spawn({
    base: { type: 'actor', ...def, key },
    sc: o.sc || GSA.state().scene,
    x, y,
    heading: Math.random() * 2 * Math.PI,
    radius: def.radius || .4,
    hp: def.hp,
    faction: o.faction || def.faction,
    spawnPoint: [x, y],
    movetype: 'MOVETYPE_STEP',
    solid: 'SOLID_TRIGGER',
    script: MobScript
  });
};

const spawnDrops = e => {
  for (const d of e.base.dropTable || []) {
    if (Math.random() >= d.chance) continue;
    for (let k = 0; k < (d.count || 1); k++) GSA.engine.addItem(d.itemKey, e.x, e.y, e.sc);
  }
};

const getMobsInRadius = (x, y, r, f) => live(GSA.state()).filter(m => dist([m.x, m.y], [x, y]) <= r && (!f || f(m)));

const getNearestMob = (x, y, f) => {
  let best = null, bd = Infinity;
  for (const m of live(GSA.state())) {
    const d = dist([m.x, m.y], [x, y]);
    if (d < bd && (!f || f(m))) { bd = d; best = m; }
  }
  return best;
};

(window.GSA = window.GSA || {}).ai = {
  attitude, hostile, live, isTarget, combatTargets, sees, emitSound, hurt,
  damageMob, killMob, spawnMob, spawnDrops, getMobsInRadius, getNearestMob
};
