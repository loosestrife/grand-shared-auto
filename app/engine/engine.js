/* engine.js — game state, the per-frame update, and the main loop. It knows
   nothing about how the player moves or what a car is: that is data/ (see
   data/mario64.js and data/gtav.js).

   Load order: bus, inputs, conf, packs, site, physics, ai, scripting, data/*,
   render, ui, engine. (render and ui may come before data/ too.) Globals shared
   with other files: $, cv, W, H and S (the current state), plus spawn(), remove()
   and T_Damage() from scripting.js. The rest is reached through GSA.*.

   Coordinates are east, north, up (x, y, z), right-handed. The camera yaw Y is a
   compass bearing: forward is (sin Y, cos Y).

   The world is S.edicts, the flat entity pool (see scripting.js). The player is
   edict 0, also reachable as S.p. Every edict has a scene `sc` ('city' or 'int');
   only the player's scene is simulated.

   Hooks for data files:
     PlayerPreThink(self, dt)   global function; runs first each frame (player movement)
     bus 'start'                emitted after the world is populated (place vehicles, etc.)
     GSA.mode                   { update(s, dt), draw(s, dt), hud(s) }: while set, it runs the frame
                                instead of the city simulation (data/terminal_velocity.js) */

const $ = s => document.querySelector(s),
  cv = $('#c'),
  W = 640,
  H = 400;
let S, opts, Y = 0, Pt = .9, subscribed = [];
GSA.render.init(cv);

cv.onclick = () => cv.requestPointerLock && cv.requestPointerLock();
addEventListener('mousemove', e => {
  if (!S || S.bag) return;
  if (S.wheel) return GSA.ui.wheelMove(e.movementX, e.movementY);
  if (document.pointerLockElement === cv || e.buttons) {
    Y += e.movementX * .003;
    Pt = Math.max(.2, Math.min(1.4, Pt + e.movementY * .003));
  }
});

/* ---------- Events and mission ---------- */

/* The alarm API handed to event subscribers: raise the heat, capped at 3 from sites. */
const heat = d => {
  d *= S.race.alarmMult;
  const c = Math.max(0, Math.min(d, 3 - S.hs));
  S.hs += c;
  S.heat = Math.min(5, S.heat + c);
};

/* Publish an engine event. Mission stepping is engine-internal on purpose. */
function emit(name) {
  const st = mission.steps[S.step];
  if (st && st.ev == name && (!st.ok || st.ok(S))) S.step++;
  GSA.bus.emit(name, { S, heat });
}

/* Switch between the city and the interior; the walls and bounds follow. */
function setScene(s, name) {
  const inI = name == 'int';
  s.scene = name;
  s.p.sc = name;
  s.walls = inI ? s.I.walls : s.city.sites.map(q => q.r);
  s.size = inI ? s.I.size : s.city.size;
  s.dirty = 1;
}

/* A pickup edict. A cooldown (seconds) keeps it from being picked up at once. */
function addItem(key, x, y, sc, cooldown = 0) {
  const def = packs.items[key] || { name: 'RAM stick', color: '#ffd166' },
    e = spawn({ base: { type: 'item', key, name: def.name, color: def.color }, x, y, z: .5, sc, radius: .45, solid: 'SOLID_TRIGGER', script: PickupScript });
  if (e && cooldown) {
    e.script.GoToState('Dropped');
    e.script.RegisterForSingleUpdate(cooldown);
  }
  return e;
}

/* ---------- Start ---------- */

function start(o = {}) {
  GSA.ui.wheelClose(false);
  GSA.ui.bagClose(false);
  for (const [k, fn] of subscribed) GSA.bus.off(k, fn);
  subscribed = [];
  opts = { ...opts, ...o };
  const city = packs.city[opts.city],
    I = packs.interiors[opts.interior],
    race = packs.races[opts.race],
    B = bindSite(mission, city);
  GSA.render.setRace(race);

  S = {
    city, I, B, race, interior: opts.interior, log: [...B.log],
    scene: 'city', walls: null, size: null,
    wpn: null, wheel: null, bag: null,
    inv: { ...(race.inventory || {}) }, invis: 0,
    edicts: GSA.scripting.newPool(),
    heat: 0, hs: 0, t: 1, carry: 0, step: 0, armed: 1, cd: 0, msg: '', dirty: 1, alarm: 0, beam: 0, shk: 0
  };

  /* Edict 0 is the player. Its movement fields belong to whatever PlayerPreThink sets up. */
  const P = S.p = S.edicts[0];
  Object.assign(P, {
    free: false, base: { type: 'player', race: race.name }, health: Infinity,
    x: (city.spawn || [22, 13])[0], y: (city.spawn || [22, 13])[1], heading: 0, radius: .35,
    movetype: 'MOVETYPE_WALK', solid: 'SOLID_TRIGGER', v_angle: [Pt, Y, 0]
  });
  P.script = new PlayerScript(P);
  setScene(S, 'city');

  const bad = !B.ok || !conforms(I, 'data_center');
  S.log.push(`interior "${opts.interior}" ${conforms(I, 'data_center') ? 'conforms to' : 'does NOT conform to'} data_center`);
  $('#log').textContent = S.log.join('\n');
  if (bad) {
    S.bad = 1;
    $('#hud').textContent = 'Cannot start: see log below.';
    return;
  }

  /* Populate the world. Both scenes' portals exist from the start; edicts of the
     other scene simply do not run. */
  for (const sc of ['city', 'int'])
    for (const { k, at } of portalList(S, sc))
      spawn({ base: { type: 'portal', key: k }, x: at[0], y: at[1], sc, radius: .55, solid: 'SOLID_TRIGGER', script: PortalScript });
  for (const q of city.stations || [])
    spawn({ base: { type: 'station', key: q.type, name: q.name }, x: q.at[0], y: q.at[1], sc: 'city', radius: .9, script: StationScript });
  for (const i of city.items || []) addItem(i.k, i.at[0], i.at[1], 'city');
  for (const sp of city.spawners || [])
    spawn({ base: { type: 'spawner', ...sp }, x: sp.at[0], y: sp.at[1], sc: 'city', script: SpawnerScript });
  for (const [x, y] of I.ram) addItem('ram', x, y, 'int');
  for (const [x, y] of I.enemies) GSA.ai.spawnMob('zombie', x, y, { sc: 'int' });

  /* The scripter API: missions and city definitions call these on the state. */
  Object.assign(S, {
    emitSound: GSA.ai.emitSound, spawnMob: GSA.ai.spawnMob, T_Damage, Killed,
    getMobsInRadius: GSA.ai.getMobsInRadius, getNearestMob: GSA.ai.getNearestMob, spawn, remove
  });
  for (const k in I.script) subscribed.push([k, GSA.bus.on(k, I.script[k])]);
  emit('start');
}

/* ---------- Per-frame steps ---------- */

/* Fire the equipped weapon (melee, cone or bolt). */
function fire(s, dt) {
  const p = s.p, ai = GSA.ai, inp = GSA.inputs, w = GSA.ui.curWeapon(s),
    ax = Math.sin(Y), ay = Math.cos(Y),
    held = inp.pressed('attack') && !s.wheel,
    tap = inp.tapped('attack') && !s.wheel,
    targets = ai.combatTargets(s),
    rel = m => {
      const vx = m.x - p.x, vy = m.y - p.y, d = Math.hypot(vx, vy) || 1e-9;
      return { m, vx, vy, d, dot: (vx * ax + vy * ay) / d };
    };
  s.beam = 0;
  if (!w) return;

  if (w.weapon_type == 'melee' && tap) {
    const t = targets.map(rel).filter(o => o.d < w.range + .7 && o.dot > 0).sort((a, b) => a.d - b.d)[0];
    if (t) {
      T_Damage(t.m, p, p, w.damage);
      if (w.knockback && !t.m.dead) GSA.physics.shove(s, t.m, t.vx / t.d * w.knockback * 1.5, t.vy / t.d * w.knockback * 1.5);
    }
    ai.emitSound(p.x, p.y, 10, 3);
  } else if (w.weapon_type == 'cone' && held) {
    s.beam = 1;
    for (const o of targets.map(rel)) {
      if (o.d < w.range && o.dot > Math.cos(w.angle)) {
        T_Damage(o.m, p, p, w.dps * dt);
        o.m.slow = w.slow;
      }
    }
  } else if (w.weapon_type == 'bolt' && tap) {
    spawn({
      base: { type: 'projectile', key: 'plasma_bolt', damage: w.damage },
      x: p.x, y: p.y, z: .9, vx: ax * w.speed, vy: ay * w.speed, radius: .2, owner: p,
      movetype: 'MOVETYPE_FLY', solid: 'SOLID_TRIGGER', script: PlasmaBoltScript
    });
    ai.emitSound(p.x, p.y, 10, 3);
  }
}

/* Cops: keep min(3, ceil(heat)) of them in the city, spawning at the site's front
   door; heat cools off when none are close (or you are invisible), and cops leave
   when it hits zero or they have lost you. */
function stepCops(s, dt) {
  const p = s.p, front = portalsOf(s.B.source).front,
    cops = GSA.ai.live(s).filter(m => m.faction == 'cops'),
    want = Math.min(3, Math.ceil(s.heat));
  while (cops.length < want) {
    const m = GSA.ai.spawnMob('cop', front[0] + cops.length * 1.5, front[1]);
    if (!m) break;
    cops.push(m);
  }
  const near = cops.some(m => m.script.GetState() == 'Chase' || dist([m.x, m.y], [p.x, p.y]) < 9);
  if (s.invis > 0 || !near) s.heat = Math.max(0, s.heat - .12 * dt);
  for (const m of cops) if (s.heat == 0 || (!near && dist([m.x, m.y], [p.x, p.y]) > 40)) remove(m);
}

/* One simulation step. */
function upd(dt) {
  const s = S, p = s.p;
  s.cd -= dt;
  if (s.invis > 0) s.invis -= dt;

  /* Quake: the engine sets the view angles, then the progs think for the player */
  p.v_angle = [Pt, Y, 0];
  if (typeof PlayerPreThink == 'function') PlayerPreThink(p, dt);

  fire(s, dt);

  /* portals re-arm once the player is clear of every ring */
  if (!s.armed && portalList(s).every(q => dist(q.at, [p.x, p.y]) > 1.5)) s.armed = 1;

  /* heat */
  if (s.scene == 'city') stepCops(s, dt);
  else if (s.I.heatPolicy == 'ticks') s.heat = Math.max(0, s.heat - .12 * dt);

  GSA.scripting.sv_physics(s, dt);
}

/* ---------- One-shot commands (bound in conf.js) ---------- */

/* E, the use key: activate the vehicle you are in, else the nearest thing within
   reach that handles OnActivate (a crafting station, a car). */
function interact() {
  if (!S || S.bad || S.bag || S.wheel) return;
  const p = S.p, d = e => dist([e.x, e.y], [p.x, p.y]),
    target = p.vehicle || S.edicts
      .filter(e => !e.free && e.sc == S.scene && e.script && e.script.handles('OnActivate') && d(e) < 3)
      .sort((a, b) => d(a) - d(b))[0];
  if (target) target.script.dispatch('OnActivate', p);
}

Object.assign(GSA.inputs.handlers, {
  exit: interact,
  item_use: () => { const m = S && GSA.ui.useItem(S, 'invisibility_potion'); if (m) S.msg = m; },
  item_prev: () => S && S.bag && GSA.ui.bagStep(-1),
  item_next: () => S && S.bag && GSA.ui.bagStep(1),
  weapon_prev: () => S && GSA.ui.cycleWeapon(-1),
  weapon_next: () => S && GSA.ui.cycleWeapon(1)
});

/* ---------- Main loop ---------- */

let last = performance.now();
(function frame(t) {
  const dt = Math.max(Math.min(.05, (t - last) / 1e3), 0);
  last = t;
  if (S && !S.bad) {
    const m = GSA.mode;   /* a data/ file may own the frame (the spaceship sortie) */
    if (m) {
      m.update(S, dt);
      m.draw(S, dt);
      m.hud(S);
    } else {
      if (S.step < 3 && !S.bag) upd(S.wheel ? dt * GSA.ui.slowmo : dt);
      GSA.render.draw(S, Y, Pt, dt);
      GSA.ui.hud(S);
    }
  }
  GSA.inputs.endFrame();
  GSA.ui.wheelDraw();
  GSA.ui.bagDraw();
  requestAnimationFrame(frame);
})(last);

Object.assign(window.GSA, {
  packs, IFACE, mission, bindSite, conforms,
  engine: { addItem, emit, setScene },
  state: () => S,
  start
});