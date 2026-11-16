// /data/terminal-velocity.js
/*  a spaceship you board with E, and a Terminal Velocity style sortie.

   The ship is built like the car (data/gtav.js): a vehicle edict placed when the game
   starts (the city may give its spot as `ship: [x, y]`), with a script that is Parked until
   it is activated and then Flying. While it flies, GSA.mode (see the frame loop in
   engine.js) owns the frame: it steps the world, draws its own three.js scene and writes
   the HUD.

   The sortie is a third scene, 'sky': a canyon heightfield with raiders, flak turrets and a
   Dreadnought at the far end. The player edict is the fighter (MOVETYPE_FLY), so
   sv_physics integrates it like anything else. Raiders, turrets and the Dreadnought are
   ordinary 'actor' edicts and sense the way every mob does: GSA.ai.sees (the invisibility
   potion cloaks light) and OnAlert (a shot is a sound, through GSA.ai.emitSound). Each one
   keeps a single belief, e.lastShot, the place it last heard a shot from, and aims at the
   player if it sees them and at that spot if it does not. Raiders forget the spot after
   base.memory seconds; the Dreadnought never does. So an invisible player is only ever
   shot at where they last fired from, and every shot gives the new spot away.

   Keys: mouse or A/D steer, Space/Shift climb and dive, W boost, S brake, click or F lasers,
   R missile, Q potion, E twice abandons. Needs data/ loaded after scripting.js and render.js,
   before the initial start(). */
(() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    wrap = a => Math.atan2(Math.sin(a), Math.cos(a)),
    smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
    rnd = (a, b) => a + Math.random() * (b - a),
    len3 = (x, y, z) => Math.hypot(x, y, z),
    P = GSA.scripting.Packages;

  /* The sky: a canyon SY long running north, opening into a basin at the far end. */
  const SX = 900, SY = 2200, CEIL = 230, HULL = 25,
    cx = y => SX / 2 + 90 * Math.sin(y / 330) + 40 * Math.sin(y / 121),
    height = (x, y) => {
      const arena = smooth(1500, 1700, y),
        off = Math.abs(x - (cx(y) * (1 - arena) + SX / 2 * arena)),
        wall = smooth(70 + 230 * arena, 300 + 300 * arena, off) * (240 + 60 * Math.sin(y * .006 + x * .01)),
        floor = 8 + 6 * Math.sin(x * .045 + y * .02) + 4 * Math.sin(y * .031 - x * .027) + 3 * Math.sin(x * .12 + y * .09);
      return Math.max(0, floor) + wall;
    };

  /* ---------- Models: build(a), a(geometry, colour, x, y, z) returns the mesh; they face +z ---------- */

  const label = (text, col) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const g = c.getContext('2d');
    g.font = 'bold 24px sans-serif';
    g.fillStyle = col;
    g.textAlign = 'center';
    g.fillText(text, 128, 32);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.scale.set(8, 1.5, 1);
    return sp;
  };

  const sprite = (size, draw, scale) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, fog: false }));
    sp.scale.set(scale, scale, 1);
    sp.renderOrder = 10;
    return sp;
  };

  const group = build => {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';   /* turn, then tilt about its own x axis, as the avatar does */
    build((geo, c, x, y, z) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    });
    return g;
  };

  const shipModel = a => {
    a(new THREE.CylinderGeometry(.32, .55, 2.6, 10), '#dfe9ee', 0, .55, -.1).rotation.x = Math.PI / 2;
    a(new THREE.ConeGeometry(.32, 1.1, 10), '#0e7c86', 0, .55, 1.75).rotation.x = Math.PI / 2;
    a(new THREE.BoxGeometry(1.9, .08, 1.1), '#8fa1ab', 1.05, .45, -.5).rotation.y = .4;
    a(new THREE.BoxGeometry(1.9, .08, 1.1), '#8fa1ab', -1.05, .45, -.5).rotation.y = -.4;
    a(new THREE.BoxGeometry(.08, .8, .8), '#0e7c86', .55, .95, -1.1);
    a(new THREE.BoxGeometry(.08, .8, .8), '#0e7c86', -.55, .95, -1.1);
    a(new THREE.SphereGeometry(.34, 10, 8), '#7fe3ff', 0, .88, .4).scale.set(.9, .7, 1.5);
    a(new THREE.CylinderGeometry(.3, .36, .5, 10), '#34505f', 0, .55, -1.5).rotation.x = Math.PI / 2;
  };

  /* The parked ship carries a floating name, like the alchemy station. */
  const parkedModel = a => {
    shipModel(a);
    const m = a(new THREE.BoxGeometry(.01, .01, .01), '#000000', 0, 2.8, 0);
    m.material.transparent = true;
    m.material.opacity = 0;
    m.add(label('Starfighter', GSA.render.tok().fg));
  };

  const raiderModel = a => {
    a(new THREE.ConeGeometry(.55, 3, 8), '#c2255c', 0, 0, 0).rotation.x = Math.PI / 2;
    a(new THREE.BoxGeometry(4.2, .12, 1.8), '#7a1f45', 0, 0, -.7);
    a(new THREE.BoxGeometry(.12, 1, 1), '#7a1f45', 0, .55, -1);
    a(new THREE.SphereGeometry(.3, 8, 6), '#ffd166', 0, .1, -1.55);
  };

  const turretModel = a => {
    a(new THREE.CylinderGeometry(1.8, 2.4, 1.2, 10), '#6b5a4a', 0, .6, 0);
    a(new THREE.SphereGeometry(1.2, 10, 8), '#8a7a66', 0, 1.5, 0);
    a(new THREE.BoxGeometry(.45, .45, 3.4), '#2a2d34', 0, 1.7, 1.8);
  };

  const dreadModel = a => {
    a(new THREE.BoxGeometry(26, 6, 58), '#5b6275', 0, 0, 0);
    a(new THREE.BoxGeometry(14, 5, 22), '#6c7488', 0, 5, -12);
    a(new THREE.BoxGeometry(6, 6, 8), '#3a3f4c', 0, 10, -14);
    a(new THREE.SphereGeometry(4, 12, 10), '#ff3b6b', 0, 4, 12);
    for (const sd of [-1, 1]) {
      a(new THREE.CylinderGeometry(1.4, 1.8, 24, 8), '#2a2d34', sd * 9, 1, 36).rotation.x = Math.PI / 2;
      a(new THREE.BoxGeometry(12, 1.2, 28), '#3b3f4a', sd * 19, -1, -6).rotation.y = sd * .25;
      a(new THREE.SphereGeometry(2.4, 8, 6), '#ff6b9a', sd * 8, 0, -30);
    }
  };

  /* ---------- Content: archetypes, like packs.mobs.zombie. `memory` is how long (s) a mob
     remembers where it last heard a shot; `range` is how far it shoots. ---------- */

  Object.assign(packs.mobs, {
    raider: {
      name: 'Raider', faction: 'raiders', health: 4, speed: 70, turn: 1.9, radius: 3.2,
      viewDist: 420, viewCone: 2.6, hearingLevel: 2.5, memory: 5, range: 300, attackInterval: .7,
      color: '#c2255c', dropTable: [], build: raiderModel
    },
    flak_turret: {
      name: 'Flak turret', faction: 'raiders', health: 5, speed: 0, turn: 1.6, radius: 3,
      viewDist: 380, viewCone: 6.3, hearingLevel: 1.5, memory: 4, range: 380, attackInterval: 1.1,
      color: '#8a7a66', dropTable: [], build: turretModel
    },
    dreadnought: {
      name: 'Dreadnought', faction: 'raiders', health: 200, speed: 0, turn: .6, radius: 34, scale: 1.4,
      viewDist: 900, viewCone: 6.3, hearingLevel: 1, memory: Infinity, range: 900, attackInterval: 1.5,
      big: true, color: '#3b3f4a', dropTable: [], build: dreadModel
    }
  });

  /* ---------- The sortie's state ---------- */

  let fl = null;   /* the sortie in progress (GSA.sortie.state()) */

  const note = (text, secs = 3) => {
    if (!fl) return;
    fl.note = text;
    fl.noteUntil = GSA.state().t + secs;
  };

  /* An explosion: a ball that swells and fades. `delay` staggers a chain of them. */
  function boom(x, y, z, r, delay = 0, color = '#ffb347') {
    if (!fl) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, fog: false }));
    m.position.set(x, z, -y);
    m.visible = false;
    fl.scene.add(m);
    fl.fx.push({ m, t: -delay, life: .35 + r * .04, r });
  }
  const puff = (x, y, z, r) => boom(x, y, z, r, 0, '#ffe9a8');

  function hurt(dmg) {
    if (!fl || fl.phase == 'lost') return;
    fl.hull = Math.max(0, fl.hull - dmg);
    fl.shake = Math.min(.6, fl.shake + .12 * dmg);
    if (fl.hull > 0) return;
    const p = GSA.state().p;
    fl.phase = 'lost';
    fl.endAt = GSA.state().t + 2.8;
    fl.mesh.visible = false;
    boom(p.x, p.y, p.z, 14);
    boom(p.x, p.y, p.z, 8, .25);
  }

  /* ---------- Shots: sky_shot edicts, MOVETYPE_FLY. Hits are swept in stepShots. ---------- */

  class SkyShotScript extends ObjectReference {
    constructor(self) {
      super(self);
      this.RegisterForSingleUpdate(self.base.ttl);
    }

    OnUpdate() { this.Delete(); }
  }

  const fire = f => spawn({ ...f, px: f.x, py: f.y, pz: f.z, movetype: 'MOVETYPE_FLY', script: SkyShotScript });

  /* Shoot at a point. A mob that can see the player leads its shot; one aiming at a
     remembered spot just fires at the spot. */
  function shoot(e, s, a, speed, dmg, spread, life) {
    let [tx, ty, tz] = a;
    if (e.los) {
      const t = len3(tx - e.x, ty - e.y, tz - e.z) / speed * .8;
      tx += s.p.vx * t;
      ty += s.p.vy * t;
      tz += s.p.vz * t;
    }
    let dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
    const l = len3(dx, dy, dz) || 1;
    dx = dx / l + rnd(-spread, spread);
    dy = dy / l + rnd(-spread, spread);
    dz = dz / l + rnd(-spread, spread);
    const m = len3(dx, dy, dz) || 1, r = e.base.radius + 1.5;
    dx /= m;
    dy /= m;
    dz /= m;
    const big = dmg > 2;
    fire({
      base: { type: 'sky_shot', key: 'bolt', team: 'enemy', damage: dmg, ttl: life, color: '#ff6b9a', size: big ? 1.1 : .5, len: big ? 9 : 5 },
      x: e.x + dx * r, y: e.y + dy * r, z: e.z + dz * r, vx: dx * speed, vy: dy * speed, vz: dz * speed, owner: e
    });
  }

  const segDist2 = (x0, y0, z0, x1, y1, z1, px, py, pz) => {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l2 = dx * dx + dy * dy + dz * dz,
      t = l2 ? clamp(((px - x0) * dx + (py - y0) * dy + (pz - z0) * dz) / l2, 0, 1) : 0,
      qx = x0 + dx * t - px, qy = y0 + dy * t - py, qz = z0 + dz * t - pz;
    return qx * qx + qy * qy + qz * qz;
  };

  /* After sv_physics has moved the shots: steer missiles, then test each shot's path this
     frame (previous position to current) against the terrain and its targets. */
  function stepShots(s, dt) {
    const p = s.p, foes = GSA.ai.live(s);
    for (const e of s.edicts) {
      if (e.free || e.sc != 'sky' || e.base.type != 'sky_shot') continue;
      const t = e.target;
      if (t) {
        if (t.free || t.dead) e.target = null;
        else {
          const sp = len3(e.vx, e.vy, e.vz) || 1, dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z,
            l = len3(dx, dy, dz) || 1, k = Math.min(1, 3.2 * dt),
            nx = e.vx / sp + (dx / l - e.vx / sp) * k, ny = e.vy / sp + (dy / l - e.vy / sp) * k, nz = e.vz / sp + (dz / l - e.vz / sp) * k,
            m = len3(nx, ny, nz) || 1;
          e.vx = nx / m * sp;
          e.vy = ny / m * sp;
          e.vz = nz / m * sp;
        }
      }
      if (e.z < height(e.x, e.y)) {
        puff(e.x, e.y, e.z, 2);
        remove(e);
        continue;
      }
      let hit = null;
      if (e.base.team == 'player') {
        for (const m of foes)
          if (!m.dead && segDist2(e.px, e.py, e.pz, e.x, e.y, e.z, m.x, m.y, m.z) < (m.base.radius + 1) ** 2) { hit = m; break; }
        if (hit) {
          puff(e.x, e.y, e.z, e.base.key == 'missile' ? 7 : 1.6);
          T_Damage(hit, e, p, e.base.damage);
          remove(e);
          continue;
        }
      } else if (fl.phase != 'lost' && segDist2(e.px, e.py, e.pz, e.x, e.y, e.z, p.x, p.y, p.z) < (2.4 + e.base.size) ** 2) {
        puff(e.x, e.y, e.z, 3);
        hurt(e.base.damage);
        remove(e);
        continue;
      }
      e.px = e.x;
      e.py = e.y;
      e.pz = e.z;
    }
  }

  /* ---------- Enemy senses and packages ---------- */

  /* Heard a shot from (x, y): the player's altitude then is where they were. */
  const hear = (e, x, y) => {
    e.lastShot = [x, y, GSA.state().p.z];
    e.lastShotT = GSA.state().t;
  };

  /* Where does this mob think the player is: the player if it sees them, else the place it
     last heard a shot from, until it forgets. */
  const aim = (e, s) => {
    if (e.los) return [s.p.x, s.p.y, s.p.z];
    if (e.lastShot && s.t - e.lastShotT > e.base.memory) e.lastShot = null;
    return e.lastShot;
  };

  const fwd = e => {
    const pu = -e.pitch, c = Math.cos(pu);   /* edict pitch is nose-down */
    return [Math.sin(e.heading) * c, Math.cos(e.heading) * c, Math.sin(pu)];
  };

  /* Turn towards a point at the mob's turn rate and fly on at base.speed * k. */
  function flyToward(e, tx, ty, tz, dt, k) {
    const dx = tx - e.x, dy = ty - e.y, dz = tz - e.z, dh = Math.hypot(dx, dy), turn = e.base.turn * dt,
      pu0 = -e.pitch;
    e.heading += clamp(wrap(Math.atan2(dx, dy) - e.heading), -turn, turn);
    const pu = clamp(pu0 + clamp(Math.atan2(dz, dh) - pu0, -turn * .6, turn * .6), -.8, .8),
      sp = e.base.speed * k;
    e.pitch = -pu;
    e.vx = Math.sin(e.heading) * Math.cos(pu) * sp;
    e.vy = Math.cos(e.heading) * Math.cos(pu) * sp;
    e.vz = Math.sin(pu) * sp;
  }

  /* Fire when the nose is on the aim point and it is in range. */
  function tryFire(e, s, a, d, speed, dmg, spread) {
    if (s.t < e.attack_finished || d > e.base.range) return;
    const f = fwd(e);
    if (f[0] * (a[0] - e.x) / d + f[1] * (a[1] - e.y) / d + f[2] * (a[2] - e.z) / d < .985) return;
    e.attack_finished = s.t + e.base.attackInterval;
    shoot(e, s, a, speed, dmg, spread, 3.5);
  }

  /* Fly slow circles round the spawn point. */
  P.Loiter = (e, s, dt) => {
    const [sx, sy, sz] = e.spawnPoint, a = s.t * .5 + e.index;
    flyToward(e, sx + Math.sin(a) * 90, sy + Math.cos(a) * 90, sz, dt, .6);
  };

  /* Chase the aim point and shoot at it. A mob that gets there without seeing anyone gives up. */
  P.Dogfight = (e, s, dt) => {
    const a = aim(e, s);
    if (!a) return e.script.dispatch('OnPackageEnd', 'Dogfight');
    const d = len3(a[0] - e.x, a[1] - e.y, a[2] - e.z);
    if (!e.los && d < 30) {
      e.lastShot = null;
      return e.script.dispatch('OnPackageEnd', 'Dogfight');
    }
    flyToward(e, a[0], a[1], a[2], dt, 1);
    tryFire(e, s, a, d, 130, 1, .06);
  };

  /* A turret: swing the barrel to the aim point and shoot at it. */
  P.Sentry = (e, s, dt) => {
    const a = aim(e, s);
    if (!a) {
      if (e.activeState == 'Engage') e.script.dispatch('OnPackageEnd', 'Sentry');
      return;
    }
    const dx = a[0] - e.x, dy = a[1] - e.y, dz = a[2] - e.z, d = len3(dx, dy, dz), turn = e.base.turn * dt;
    e.heading += clamp(wrap(Math.atan2(dx, dy) - e.heading), -turn, turn);
    e.pitch += clamp(-Math.atan2(dz, Math.hypot(dx, dy)) - e.pitch, -turn, turn);
    tryFire(e, s, a, d, 110, 1, .04);
  };

  /* The Dreadnought drifts about its station, facing what it is aiming at. */
  P.Hover = (e, s, dt) => {
    const [sx, sy, sz] = e.spawnPoint, t = s.t - e.born;
    e.x = sx + Math.sin(t * .12) * 140;
    e.y = sy + Math.sin(t * .17) * 60;
    e.z = sz + Math.sin(t * .3) * 6;
    const a = aim(e, s), want = a ? Math.atan2(a[0] - e.x, a[1] - e.y) : Math.PI;
    e.heading += clamp(wrap(want - e.heading), -e.base.turn * dt, e.base.turn * dt);
  };

  /* ---------- Scripts (Papyrus) ---------- */

  /* A raider or a flak turret. Idle loiters (or sits); a sight or a shot sends it to Engage. */
  class RaiderScript extends Actor {
    constructor(self) {
      super(self);
      const mobile = self.base.speed > 0, engage = () => this.GoToState('Engage');
      this.OnDeath = () => this.GoToState('Dead');
      this.states = {
        Idle: {
          OnBeginState: () => { self.activePackage = mobile ? 'Loiter' : 'Sentry'; },
          OnGainLOS: engage,
          OnAlert: (x, y) => { hear(self, x, y); engage(); }
        },
        Engage: {
          OnBeginState: () => { self.activePackage = mobile ? 'Dogfight' : 'Sentry'; },
          OnAlert: (x, y) => hear(self, x, y),
          OnPackageEnd: () => this.GoToState('Idle')
        },
        Dead: {
          OnBeginState: () => {
            self.dead = true;
            self.activePackage = null;
            boom(self.x, self.y, self.z, 6);
            if (fl) fl.kills++;
            this.RegisterForSingleUpdate(.05);
          },
          OnUpdate: () => this.Delete()
        }
      };
      this.GoToState('Idle');
    }
  }

  /* The Dreadnought. Idle until it sees the player or hears a shot. Engaged, it fires a
     fan of bolts every second or so at its aim point: the player, if it can see them
     (leading the shot), else the last place it heard a shot from. It never forgets that
     spot, and it does not look for the player anywhere else. */
  class DreadnoughtScript extends Actor {
    constructor(self) {
      super(self);
      const volley = () => {
        const s = GSA.state(), a = aim(self, s), hot = self.health < self.base.health / 2;
        if (a) for (let i = 0; i < (hot ? 5 : 3); i++) shoot(self, s, a, 95, 3, .05, 6.5);
        this.RegisterForSingleUpdate(hot ? 1 : 1.5);
      };
      this.OnDeath = () => this.GoToState('Dead');
      this.states = {
        Idle: {
          OnBeginState: () => { self.activePackage = 'Hover'; },
          OnGainLOS: () => this.GoToState('Engage'),
          OnAlert: (x, y) => { hear(self, x, y); this.GoToState('Engage'); }
        },
        Engage: {
          OnBeginState: () => { self.activePackage = 'Hover'; this.RegisterForSingleUpdate(.8); },
          OnEndState: () => this.UnregisterForUpdate(),
          OnAlert: (x, y) => hear(self, x, y),
          OnUpdate: volley
        },
        Dead: {
          OnBeginState: () => {
            const s = GSA.state();
            self.dead = true;
            self.activePackage = null;
            for (let i = 0; i < 14; i++) boom(self.x + rnd(-18, 18), self.y + rnd(-26, 26), self.z + rnd(-4, 8), rnd(8, 16), i * .18);
            boom(self.x, self.y, self.z, 40, 2.6);
            if (fl && fl.phase != 'lost') {
              fl.phase = 'won';
              fl.endAt = s.t + 6;
              fl.step = 2;
              note('Dreadnought destroyed!', 6);
            }
            this.RegisterForSingleUpdate(3.2);
          },
          OnUpdate: () => this.Delete()
        }
      };
      this.GoToState('Idle');
    }
  }

  function spawnSky(key, x, y, z) {
    const def = packs.mobs[key];
    return spawn({
      base: { type: 'actor', ...def, key }, x, y, z, heading: key == 'dreadnought' ? Math.PI : rnd(0, 2 * Math.PI),
      radius: def.radius, health: def.health, faction: def.faction, spawnPoint: [x, y, z], born: GSA.state().t,
      movetype: def.speed ? 'MOVETYPE_FLY' : 'MOVETYPE_NONE',
      script: key == 'dreadnought' ? DreadnoughtScript : RaiderScript
    });
  }

  function populate() {
    const at = (key, x, y, dz) => spawnSky(key, x, y, height(x, y) + dz);
    for (const [y, n] of [[380, 3], [700, 3], [1000, 4], [1300, 4]])
      for (let i = 0; i < n; i++) {
        const yy = y + rnd(-50, 50);
        at('raider', cx(yy) + rnd(-70, 70), yy, rnd(45, 90));
      }
    [260, 470, 640, 830, 1040, 1180, 1360, 1500].forEach((y, i) => at('flak_turret', cx(y) + (i % 2 ? 1 : -1) * rnd(35, 60), y, 1.5));
    at('raider', 340, 1850, 70);
    at('raider', 560, 1850, 70);
    at('flak_turret', 330, 1760, 1.5);
    at('flak_turret', 570, 1760, 1.5);
    at('flak_turret', 450, 2080, 1.5);
    fl.boss = spawnSky('dreadnought', 450, 1950, 130);
  }

  /* ---------- The sky scene ---------- */

  function terrainMesh() {
    const nx = 90, ny = 220, pos = new Float32Array((nx + 1) * (ny + 1) * 3), col = new Float32Array(pos.length),
      idx = new Uint32Array(nx * ny * 6), c1 = new THREE.Color('#5f8f6a'), c2 = new THREE.Color('#8c6f57'),
      c3 = new THREE.Color('#d9cbb2'), c = new THREE.Color();
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const x = i / nx * SX, y = j / ny * SY, h = height(x, y), k = (j * (nx + 1) + i) * 3, t = clamp(h / 280, 0, 1);
        pos[k] = x;
        pos[k + 1] = h;
        pos[k + 2] = -y;
        if (t < .5) c.lerpColors(c1, c2, t * 2);
        else c.lerpColors(c2, c3, (t - .5) * 2);
        c.multiplyScalar(.9 + .1 * Math.sin(x * .37) * Math.sin(y * .41));
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    let n = 0;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
        idx.set([a, b, d, b, e, d], n);
        n += 6;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }

  function disposeScene(sc) {
    sc.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (m) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
  }

  /* Start the sortie: the player becomes the fighter, in a fresh sky. */
  function begin(ship) {
    const s = GSA.state(), p = s.p, sky = '#a9d4ef';
    GSA.ui.wheelClose(false);
    GSA.ui.bagClose(false);
    const scene = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, .8);
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, 250, 1400);
    scene.add(new THREE.AmbientLight(0xffffff, .75));
    sun.position.set(300, 600, -200);
    scene.add(sun);
    scene.add(terrainMesh());
    const mesh = group(shipModel),
      flame = new THREE.Mesh(new THREE.ConeGeometry(.28, 1.4, 8), new THREE.MeshBasicMaterial({ color: '#ffb347' })),
      ret = sprite(64, g => {
        g.strokeStyle = '#3dd6c6';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(32, 32, 18, 0, 6.283);
        g.moveTo(32, 4); g.lineTo(32, 14);
        g.moveTo(32, 50); g.lineTo(32, 60);
        g.moveTo(4, 32); g.lineTo(14, 32);
        g.moveTo(50, 32); g.lineTo(60, 32);
        g.stroke();
      }, 9),
      mark = sprite(128, g => {
        g.strokeStyle = '#ff6b9a';
        g.lineWidth = 7;
        g.beginPath();
        g.arc(64, 64, 46, 0, 6.283);
        g.moveTo(38, 38); g.lineTo(90, 90);
        g.moveTo(90, 38); g.lineTo(38, 90);
        g.stroke();
      }, 30);
    flame.position.set(0, .55, -2.3);
    flame.rotation.x = -Math.PI / 2;
    mesh.add(flame);
    mark.visible = false;
    scene.add(mesh, ret, mark);

    fl = {
      s, ship, scene, mesh, flame, ret, mark, cam: new THREE.PerspectiveCamera(62, W / H, 1, 3000), fx: [],
      t: 0, phase: 'fly', step: 0, endAt: 0, hull: HULL, speed: 62, yaw: 0, pitch: .04, bank: 0, mx: 0, my: 0,
      missiles: 6, lock: null, kills: 0, nextLaser: 0, nextNoise: 0, scrapeT: 0, shake: 0, note: '', noteUntil: 0, boss: null
    };

    GSA.engine.setScene(s, 'sky');
    s.walls = [];
    s.size = [SX, SY];
    s.beam = 0;
    Object.assign(p, { x: cx(0), y: 12, z: 70, vx: 0, vy: 0, vz: 0, heading: 0, pitch: -.04, zscale: 1, radius: 2.2, movetype: 'MOVETYPE_FLY' });
    populate();
    fl.cam.position.set(p.x, p.z + 4.5, -(p.y - 15));
    note('Fly north up the canyon. The Dreadnought waits at the far end.', 6);
    GSA.mode = mode;
  }

  /* Remove the sky: its edicts, its three.js objects, the mode. `s` is null when the
     state it belonged to is gone already. */
  function teardown(s) {
    if (s) for (const e of s.edicts) if (!e.free && e.sc == 'sky' && e != s.p) remove(e);
    if (fl) disposeScene(fl.scene);
    fl = null;
    if (GSA.mode == mode) GSA.mode = null;
  }

  /* The player back on foot in the city. */
  function restore(s) {
    GSA.engine.setScene(s, 'city');
    Object.assign(s.p, { vehicle: null, movetype: 'MOVETYPE_WALK', radius: .35, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, zscale: 1, st: 'ground' });
  }

  /* Something went wrong under the sortie (the game was restarted, or a script threw):
     drop it without ceremony. */
  function abandon(why) {
    const s = GSA.state(), same = fl && s && fl.s === s && s.scene == 'sky', ship = same && fl.ship;
    teardown(same ? s : null);
    if (!same) return;
    restore(s);
    s.p.x = ship.self.x + 3;
    s.p.y = ship.self.y;
    s.msg = why || '';
    ship.driver = null;
    ship.GoToState('Parked');
  }

  /* ---------- The frame ---------- */

  function bestTarget(s, fx, fy, fz) {
    const p = s.p;
    let best = null, bs = Math.cos(.4);
    for (const m of GSA.ai.live(s)) {
      const dx = m.x - p.x, dy = m.y - p.y, dz = m.z - p.z, d = len3(dx, dy, dz);
      if (d < 20 || d > 700) continue;
      const dot = (dx * fx + dy * fy + dz * fz) / d;
      if (dot > bs) { bs = dot; best = m; }
    }
    return best;
  }

  function update(s, dt) {
    const f = fl, p = s.p, inp = GSA.inputs;
    if (s.bag) GSA.ui.bagClose(false);
    if (s.wheel) GSA.ui.wheelClose(false);
    if (s.invis > 0) s.invis -= dt;
    f.t += dt;
    const alive = f.phase != 'lost', ax = (a, b) => (inp.pressed(a) ? 1 : 0) - (inp.pressed(b) ? 1 : 0);

    /* steer: the mouse turns the nose, A/D yaw, Space/Shift climb and dive; W boosts, S brakes,
       and a dive is faster than a climb */
    let yaw = 0, pit = -.45 * dt;
    if (alive) {
      yaw = ax('move_right', 'move_left') * 1.4 * dt + f.mx * .0025;
      pit = ax('jump', 'crouch') * 1.1 * dt - f.my * .0025;
    }
    f.mx = f.my = 0;
    f.yaw += yaw;
    f.pitch = clamp(f.pitch + pit, -1.2, 1.2);
    f.bank += (clamp(yaw / Math.max(dt, .001) * .45, -.9, .9) - f.bank) * Math.min(1, dt * 6);
    const want = (alive && inp.pressed('forward') ? 108 : alive && inp.pressed('backward') ? 36 : 62) - f.pitch * 30;
    f.speed = clamp(f.speed + (want - f.speed) * Math.min(1, dt * 1.5), 24, 140);
    const cp = Math.cos(f.pitch), fx = Math.sin(f.yaw) * cp, fy = Math.cos(f.yaw) * cp, fz = Math.sin(f.pitch);
    p.heading = f.yaw;
    p.pitch = -f.pitch;   /* edict pitch is nose-down */
    p.vx = fx * f.speed;
    p.vy = fy * f.speed;
    p.vz = fz * f.speed;

    /* weapons: every shot is a sound, which is how the raiders find an invisible player */
    f.lock = alive ? bestTarget(s, fx, fy, fz) : null;
    if (alive && inp.pressed('attack') && s.t >= f.nextLaser) {
      f.nextLaser = s.t + .11;
      const rx = Math.cos(f.yaw), ry = -Math.sin(f.yaw), v = f.speed + 260;
      for (const sd of [-1, 1])
        fire({
          base: { type: 'sky_shot', key: 'laser', team: 'player', damage: 1.2, ttl: 1.5, color: '#7fe3ff', size: .3, len: 5 },
          x: p.x + rx * sd * 1.2 + fx * 2, y: p.y + ry * sd * 1.2 + fy * 2, z: p.z + fz * 2 + .5,
          vx: fx * v, vy: fy * v, vz: fz * v, owner: p
        });
      if (s.t >= f.nextNoise) {
        f.nextNoise = s.t + .25;
        GSA.ai.emitSound(p.x, p.y, 900, 6);
      }
    }
    if (alive && inp.tapped('missile') && f.missiles > 0) {
      f.missiles--;
      const v = f.speed + 90;
      fire({
        base: { type: 'sky_shot', key: 'missile', team: 'player', damage: 10, ttl: 4.5, color: '#ffd166', size: .7, len: 3.5 },
        x: p.x + fx * 2, y: p.y + fy * 2, z: p.z + fz * 2 + .2, vx: fx * v, vy: fy * v, vz: fz * v, target: f.lock, owner: p
      });
      GSA.ai.emitSound(p.x, p.y, 900, 8);
    }

    GSA.scripting.sv_physics(s, dt);
    stepShots(s, dt);

    /* terrain, ceiling, the edge of the map */
    p.x = clamp(p.x, 15, SX - 15);
    p.y = clamp(p.y, 5, SY - 15);
    if (p.z > CEIL) {
      p.z = CEIL;
      f.pitch = Math.min(f.pitch, 0);
    }
    const ground = height(p.x, p.y) + 3;
    if (p.z < ground) {
      p.z = ground;
      f.speed *= 1 - dt * 1.5;
      f.pitch = Math.max(f.pitch, .08);
      if (alive && s.t >= f.scrapeT) {
        f.scrapeT = s.t + .6;
        hurt(2);
        note('Scraping the terrain!', 1.5);
      }
    }
    for (const e of GSA.ai.live(s))
      if (e.base.speed) {
        e.x = clamp(e.x, 10, SX - 10);
        e.y = clamp(e.y, 10, SY - 10);
        e.z = clamp(e.z, height(e.x, e.y) + 12, CEIL + 60);
      }

    /* the mission */
    if (f.step == 0 && p.y > 1560) {
      f.step = 1;
      note('The Dreadnought is dead ahead. Take it down.', 5);
    }
    if ((f.phase == 'won' || f.phase == 'lost') && s.t >= f.endAt)
      f.ship.land(f.phase == 'won' ? 'Dreadnought destroyed. The valley is safe.' : 'You were shot down. Press E at the Starfighter to try again.');
  }

  /* What each kind of sky edict looks like. */
  const KIND = {
    actor: {
      make: e => {
        const g = group(e.base.build);
        g.scale.setScalar(e.base.scale || 1);
        return g;
      },
      pose: (e, o) => {
        o.position.set(e.x, e.z, -e.y);
        o.rotation.set(e.pitch, Math.PI - e.heading, 0);
        o.visible = !e.dead || !!e.base.big;   /* the Dreadnought stays up while it blows apart */
      }
    },
    sky_shot: {
      make: e => new THREE.Mesh(new THREE.BoxGeometry(e.base.size, e.base.size, e.base.len), new THREE.MeshBasicMaterial({ color: e.base.color, fog: false })),
      pose: (e, o) => {
        o.position.set(e.x, e.z, -e.y);
        o.lookAt(o.position.x + e.vx, o.position.y + e.vz, o.position.z - e.vy);
      }
    }
  };

  function draw(s, dt) {
    const f = fl, p = s.p, cam = f.cam, boss = f.boss && !f.boss.free && !f.boss.dead ? f.boss : null,
      cp = Math.cos(f.pitch), fx = Math.sin(f.yaw) * cp, fy = Math.cos(f.yaw) * cp, fz = Math.sin(f.pitch);

    for (const e of s.edicts) {
      if (e.free || e.sc != 'sky' || e == p) continue;
      const k = KIND[e.base.type];
      if (!k) continue;
      if (!e.mesh) {
        e.mesh = k.make(e);
        f.scene.add(e.mesh);
      }
      k.pose(e, e.mesh);
    }

    /* the fighter: nose up is negative x rotation, a right turn banks right */
    f.mesh.position.set(p.x, p.z, -p.y);
    f.mesh.rotation.set(-f.pitch, Math.PI - f.yaw, f.bank);
    f.flame.visible = f.phase != 'lost';
    f.flame.scale.y = .5 + (f.speed - 24) / 116 * 2;
    f.mesh.traverse(o => {
      if (o.material) {
        o.material.transparent = true;
        o.material.opacity = s.invis > 0 ? .25 : 1;
      }
    });
    f.ret.visible = f.phase != 'lost';
    f.ret.position.set(p.x + fx * 150, p.z + fz * 150 + .5, -(p.y + fy * 150));

    /* where the Dreadnought thinks you are, when it cannot see you */
    const ls = boss && !boss.los && boss.lastShot;
    f.mark.visible = !!ls;
    if (ls) {
      f.mark.position.set(ls[0], ls[2], -ls[1]);
      f.mark.scale.setScalar(30 + Math.sin(f.t * 6) * 3);
    }

    for (let i = f.fx.length - 1; i >= 0; i--) {
      const x = f.fx[i];
      x.t += dt;
      if (x.t < 0) continue;
      if (x.t >= x.life) {
        f.scene.remove(x.m);
        x.m.geometry.dispose();
        x.m.material.dispose();
        f.fx.splice(i, 1);
      } else {
        const k = x.t / x.life;
        x.m.visible = true;
        x.m.scale.setScalar(x.r * (.3 + .7 * k));
        x.m.material.opacity = 1 - k;
      }
    }

    /* chase camera */
    cam.position.lerp(new THREE.Vector3(p.x - fx * 15, p.z - fz * 15 + 4.5, -(p.y - fy * 15)), 1 - Math.exp(-dt * 7));
    cam.position.y = Math.max(cam.position.y, height(cam.position.x, -cam.position.z) + 2);
    if (f.shake > 0) {
      f.shake = Math.max(0, f.shake - dt);
      cam.position.x += (Math.random() - .5) * f.shake * 3;
      cam.position.y += (Math.random() - .5) * f.shake * 3;
    }
    cam.lookAt(p.x + fx * 25, p.z + fz * 25 + 1, -(p.y + fy * 25));
    cam.fov += ((f.speed > 95 ? 74 : 62) - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    GSA.render.renderer.render(f.scene, cam);
  }

  function hud(s) {
    const f = fl, p = s.p, boss = f.boss && !f.boss.free && !f.boss.dead ? f.boss : null,
      bar = (v, max, w = 12) => {
        const n = Math.round(clamp(v / max, 0, 1) * w);
        return '\u2588'.repeat(n) + '\u2591'.repeat(w - n);
      },
      steps = ['Fly the canyon north to the Dreadnought', 'Destroy the Dreadnought' + (boss ? '  ' + bar(boss.health, boss.base.health, 16) : ''), 'Return to the valley'],
      L = [
        `Starfighter   Hull ${bar(f.hull, HULL)} ${Math.ceil(f.hull)}   Speed ${Math.round(f.speed)}   Above ground ${Math.round(p.z - height(p.x, p.y))}   Missiles ${f.missiles}${f.lock ? '   LOCK ' + f.lock.base.name : ''}   Down ${f.kills}`,
        `Invisibility potion x${s.inv.invisibility_potion || 0} [Q]${s.invis > 0 ? '   Invisible ' + Math.ceil(s.invis) + 's' : ''}`
      ];
    steps.forEach((t, i) => L.push((i < f.step ? '[done] ' : i == f.step ? '[now]  ' : '[next] ') + t));
    if (s.invis > 0 && boss && f.step >= 1)
      L.push(boss.lastShot ? 'The Dreadnought cannot see you. It fires at the red marker, the last place it saw you shoot from.' : 'The Dreadnought cannot see you. It has nothing to shoot at until you fire.');
    if (s.t < f.noteUntil) L.push(f.note);
    if (f.t < 15) L.push('Mouse or A/D steer, Space/Shift climb and dive, W boost, S brake, click or F lasers, R missile, Q potion, E twice to leave');
    document.querySelector('#hud').textContent = L.join('\n');
  }

  /* If anything in the sortie throws, land the player rather than freeze the frame loop. */
  const guard = fn => (...a) => {
    try {
      return fn(...a);
    } catch (err) {
      console.error('sortie failed', err);
      abandon('The sortie failed: ' + err.message);
    }
  };

  const mode = {
    update: guard((s, dt) => {
      if (!fl || fl.s !== s) return abandon();   /* the game was restarted under us */
      update(s, dt);
    }),
    draw: guard((s, dt) => { if (fl) draw(s, dt); }),
    hud: guard(s => { if (fl) hud(s); })
  };

  addEventListener('mousemove', e => {
    if (GSA.mode != mode || !fl) return;
    if (document.pointerLockElement === cv || e.buttons) {
      fl.mx += e.movementX;
      fl.my += e.movementY;
    }
  });

  /* ---------- The ship in the city ---------- */

  class ShipScript extends ObjectReference {
    constructor(self) {
      super(self);
      this.driver = null;
      this.abortBy = 0;
      this.states = {
        Parked: {
          OnActivate: akActionRef => {
            this.driver = akActionRef;
            akActionRef.vehicle = self;
            this.GoToState('Flying');
          }
        },
        Flying: {
          OnBeginState: () => begin(this),
          OnActivate: () => {
            const s = GSA.state();
            if (s.t < this.abortBy) this.land('You abandoned the sortie.');
            else {
              this.abortBy = s.t + 2;
              note('Press E again to abandon the sortie.', 2);
            }
          }
        }
      };
      this.GoToState('Parked');
    }

    /* Back to the valley: stand beside the ship, on the right if there is room. */
    land(msg) {
      const s = GSA.state(), c = this.self, d = this.driver;
      teardown(s);
      restore(s);
      const o = [[Math.cos(c.heading) * 3, -Math.sin(c.heading) * 3], [-Math.cos(c.heading) * 3, Math.sin(c.heading) * 3], [0, 3], [0, 0]]
        .find(([a, b]) => !GSA.physics.hit(s, c.x + a, c.y + b, 0));
      d.x = c.x + o[0];
      d.y = c.y + o[1];
      s.msg = msg;
      this.driver = null;
      this.GoToState('Parked');
    }
  }

  GSA.bus.on('start', ({ S: s }) => {
    abandon();   /* a restart while flying */
    const at = s.city.ship || [22, 20];
    spawn({ base: { type: 'vehicle', key: 'ship', build: parkedModel }, x: at[0], y: at[1], heading: 0, radius: 1.8, sc: 'city', script: ShipScript });
  });
  GSA.sortie = { state: () => fl };
})();