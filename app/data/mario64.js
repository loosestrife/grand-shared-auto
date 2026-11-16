// /data/mario64.js
/*  Super Mario 64 movement for the player.
 
   This is a QuakeC PlayerPreThink: the engine calls it every frame, before anything
   moves, with the player edict. It reads the buttons and the camera (self.v_angle),
   works out the player's velocity (vx, vy) and vertical motion (z, vz), and returns.
   The engine then moves the player with collision (MOVETYPE_WALK) and runs touches.
   It uses only edict fields and the engine builtins in physics.js (RC, WH), so a
   different file can replace it with different movement.
 
   Moves: jump chain (single, double, triple by jumping again as you land while moving),
   long jump (crouch + jump while moving), backflip (crouch + jump standing), side flip
   (jump while reversing), wall kick, ground pound (crouch in the air), dive (X), slide.
   Buildings and walls can be stood on. Also here, because they belong to these moves:
   the ground-pound shockwave, the dive attack, and footsteps.
 
   It leaves two fields for the renderer: self.pitch (nose-down tilt) and self.zscale.
   Races (packs.races) supply speed, gravity and jumpV. Needs data/ loaded after
   physics.js and scripting.js, before engine.js. */
(() => {
  const { RC, WH } = GSA.physics;
 
  const appr = (p, tx, ty, d) => {
    const dx = tx - p.vx, dy = ty - p.vy, m = Math.hypot(dx, dy);
    if (m <= d) {
      p.vx = tx;
      p.vy = ty
    } else {
      p.vx += dx / m * d;
      p.vy += dy / m * d
    }
  };
 
  /* Movement kit. `inp` is { mx, my, jump, jumpHeld, crouch, crouchTap, dive }: the wanted
     velocity plus this frame's button taps. It sets p.vx, p.vy, p.z, p.vz and the state
     machine p.st (ground, air, hang, slam, dive, slide), and returns true on the frame
     the player lands. The engine moves p.x and p.y. */
  function kit(s, dt, inp) {
    const { mx, my, jump: jd, crouch: cr, crouchTap: cpp, dive: dvp } = inp, ws = s.walls,
      p = s.p, r = s.race, sp = r.speed, top = WH(s),
      wl = Math.hypot(mx, my),
      u = Math.hypot(p.vx, p.vy),
      flr = () => p.z >= top - .2 && RC(p.x, p.y, ws) ? top : 0,
      launch = (vy, spin, ctl, cut) => {
        p.vz = vy;
        p.st = 'air';
        p.ctl = ctl;
        p.cut = cut;
        p.flip = 0;
        p.spin = spin * 2 * Math.PI / (2 * vy / r.gravity)
      };
    if (wl && (p.st == 'ground' || p.st == 'air')) p.heading = Math.atan2(mx, my);
    const fx = Math.sin(p.heading), fy = Math.cos(p.heading),
      f0 = flr(),
      gnd = p.z <= f0 && p.vz <= 0;
    let landed = false;
    if (gnd) {
      p.land += dt;
      if (p.st == 'slide') {
        appr(p, 0, 0, 14 * dt);
        if (u < 1.5) p.st = 'ground'
      } else {
        const k = cr ? .35 : 1,
          skid = cr && wl && u > sp * k;   /* running into a crouch: shed speed slowly, so there is time to long jump */
        appr(p, mx * k, my * k, (skid ? 6 : wl ? 45 : 32) * dt)
      }
      if (jd) {
        const mov = u > sp * .55,
          rev = wl && u > 1 && (p.vx * mx + p.vy * my) / (u * wl) < -.3;
        if (cr && mov) {
          const v = Math.max(u, sp) * 1.8;
          p.vx = fx * v;
          p.vy = fy * v;
          p.chain = 0;
          launch(r.jumpV * .8, 0, .15, 0)
        } else if (cr) {
          p.vx = -fx * sp * .5;
          p.vy = -fy * sp * .5;
          p.chain = 0;
          launch(r.jumpV * 1.45, -1, .35, 0)
        } else if (rev && mov) {
          p.vx = mx / wl * sp * .9;
          p.vy = my / wl * sp * .9;
          p.heading = Math.atan2(mx, my);
          p.chain = 0;
          launch(r.jumpV * 1.3, 1, .3, 0)
        } else {
          const n = p.land < .25 && mov ? p.chain : 0,
            b = [1, 1.05, 1.25][n];
          p.vx *= b;
          p.vy *= b;
          p.chain = n < 2 ? n + 1 : 0;
          launch(r.jumpV * [1, 1.2, 1.55][n], n == 2 ? 1 : 0, .6, n < 2 ? 1 : 0)
        }
      } else {
        p.vz = 0;
        p.z = f0
      }
    } else {
      if (p.st == 'ground' || p.st == 'slide') {
        p.st = 'air';
        p.ctl = .6;
        p.cut = 0;
        p.chain = 0
      }
      if (p.st == 'air') {
        if (jd && s.t - p.wn_time < .2 && p.wn) {
          const v = Math.max(6, sp * 1.3);
          p.vx = p.wn[0] * v;
          p.vy = p.wn[1] * v;
          p.heading = Math.atan2(p.wn[0], p.wn[1]);
          p.wn_time = -1;
          p.chain = 0;
          launch(r.jumpV * 1.15, 0, .5, 0)
        } else if (cpp && p.z > f0 + .4) {
          p.st = 'hang';
          p.tm = .25;
          p.vz = 0;
          p.vx = p.vy = 0;
          p.pound = 1;
          p.flip = 0;
          p.spin = 2 * Math.PI / .25
        } else if (dvp) {
          const v = Math.max(u, sp) * 1.7;
          p.vx = fx * v;
          p.vy = fy * v;
          p.vz = Math.min(p.vz, 1.5);
          p.st = 'dive';
          p.dh = 0;
          p.spin = 0;
          p.flip = 0
        }
      }
      if (p.st == 'air') {
        if (p.cut && !inp.jumpHeld && p.vz > 0) {
          p.vz *= .5;
          p.cut = 0
        }
        if (wl) {
          const m0 = Math.hypot(p.vx, p.vy);
          p.vx += mx / wl * 20 * p.ctl * dt;
          p.vy += my / wl * 20 * p.ctl * dt;
          const m = Math.hypot(p.vx, p.vy), cap = Math.max(m0, sp);
          if (m > cap) {
            p.vx *= cap / m;
            p.vy *= cap / m
          }
        } else {
          p.vx *= 1 - .15 * dt;
          p.vy *= 1 - .15 * dt
        }
      } else if (p.st == 'hang') p.vx = p.vy = 0
    }
    if (!gnd || p.vz > 0) {
      const h0 = p.z,
        fl = h0 >= top - .2 && RC(p.x, p.y, ws) ? top : 0;
      if (p.st == 'hang') {
        p.tm -= dt;
        p.vz = 0;
        if (p.tm <= 0) {
          p.st = 'slam';
          p.vz = -20;
          p.spin = 0;
          p.flip = 0
        }
      } else if (p.st == 'slam') p.vz = -20;
      else p.vz -= r.gravity * dt;
      if (p.st == 'air' && s.t - p.wn_time < .2 && p.vz < -3) p.vz = -3;
      p.z += p.vz * dt;
      p.flip += p.spin * dt;
      if (!gnd && p.z <= fl) {
        const was = p.st;
        p.z = fl;
        p.vz = 0;
        landed = true;
        p.flip = 0;
        p.spin = 0;
        p.land = 0;
        p.cut = 0;
        if (was == 'dive') p.st = 'slide';
        else {
          p.st = 'ground';
          if (was == 'slam') {
            p.vx = p.vy = 0;
            p.chain = 0
          }
        }
      }
    }
    p.pitch = p.st == 'dive' || p.st == 'slide' ? 1.3 : p.flip;
    p.zscale = gnd && cr && p.st == 'ground' ? .6 : 1;
    return landed
  }
 
  /* A ground-pound shockwave: a trigger whose radius grows every frame. Each target
     is hurt once, as the edge reaches it. */
  class WaveScript extends ObjectReference {
    constructor(self) {
      super(self);
      this.hit = new Set();
      this.born = GSA.state().t;
      this.r0 = self.radius;
      this.RegisterForSingleUpdate(0);
    }
 
    OnUpdate() {
      const w = this.self, s = GSA.state();
      w.radius = this.r0 + w.base.sp * (s.t - this.born);
      if (w.radius >= w.base.max) this.Delete();
      else this.RegisterForSingleUpdate(0);
    }
 
    OnTouch(other) {
      const w = this.self, b = w.base, s = GSA.state();
      if (this.hit.has(other) || !GSA.ai.isTarget(other, s)) return;
      this.hit.add(other);
      T_Damage(other, w, w.owner, b.dmg);
      if (other.dead) return;
      if (b.kb) {
        const d = dist([other.x, other.y], [w.x, w.y]) || 1;
        GSA.physics.shove(s, other, (other.x - w.x) / d * b.kb, (other.y - w.y) / d * b.kb);
      }
      if (b.stun) other.slow = b.stun;
    }
  }
 
  /* Ground pound landing: a growing ring that hurts, and for the Nord (bowser_slam)
     knocks back and slows. */
  function slamWave(s, p) {
    const big = (s.race.flags || []).includes('bowser_slam');
    spawn({
      base: { type: 'wave', max: big ? 7.5 : 1.6, sp: big ? 14 : 8, dmg: big ? 2 : 1, kb: big ? 2.5 : 0, stun: big ? 2 : 0 },
      x: p.x, y: p.y, radius: .3, owner: p, solid: 'SOLID_TRIGGER', script: WaveScript
    });
    if (big) s.shk = .3;
    GSA.ai.emitSound(p.x, p.y, 16, 6);
  }
 
  /* The engine calls this every frame for the player. */
  function PlayerPreThink(self, dt) {
    const s = GSA.state(), inp = GSA.inputs;
    if (self.st === undefined) Object.assign(self, { st: 'ground', tm: 0, chain: 0, land: 1, ctl: .6, cut: 0, spin: 0, flip: 0, dh: 0, pound: 0, stepT: 0 });
    if (self.vehicle) {   /* the vehicle is moving us */
      self.vx = self.vy = 0;
      return;
    }
 
    /* WASD relative to the camera: forward is (sin yaw, cos yaw), right is (cos yaw, -sin yaw) */
    const yaw = self.v_angle[1],
      axis = (pos, neg) => (inp.pressed(pos) ? 1 : 0) - (inp.pressed(neg) ? 1 : 0),
      ix = axis('move_right', 'move_left'), iy = axis('forward', 'backward'), il = Math.hypot(ix, iy),
      mx = il ? (ix * Math.cos(yaw) + iy * Math.sin(yaw)) / il * s.race.speed : 0,
      my = il ? (-ix * Math.sin(yaw) + iy * Math.cos(yaw)) / il * s.race.speed : 0,
      crouch = inp.pressed('crouch');
 
    const landed = kit(s, dt, {
      mx, my, crouch,
      jump: inp.tapped('jump'), jumpHeld: inp.pressed('jump'),
      crouchTap: inp.tapped('crouch'), dive: inp.tapped('dive')
    });
 
    if (landed && self.pound) slamWave(s, self);
    if (landed) self.pound = 0;
 
    if ((self.st == 'dive' || self.st == 'slide') && !self.dh) {
      const t = GSA.ai.combatTargets(s).find(m => dist([m.x, m.y], [self.x, self.y]) < 1);
      if (t) {
        T_Damage(t, self, self, 1);
        self.dh = 1;
      }
    }
 
    /* footsteps make noise; crouching is quieter */
    if (self.st == 'ground' && Math.hypot(self.vx, self.vy) > .5 && (self.stepT -= dt) <= 0) {
      self.stepT = crouch ? .6 : .35;
      GSA.ai.emitSound(self.x, self.y, 4, 1);
    }
  }
 
  window.PlayerPreThink = PlayerPreThink;
})();