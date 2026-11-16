/* scripting.js — QuakeC entities with Papyrus scripts on top.

   QUAKEC  (every world object is an edict: one slot of the pool S.edicts, slot 0 is the player)
     spawn(fields), remove(e)            claim and free a slot
     e.owner  e.enemy  e.health          who made it, who it is after, health
     e.solid  e.movetype                 SOLID_NOT / SOLID_TRIGGER; MOVETYPE_NONE / STEP / FLY / WALK
     e.nextthink                         when to think next (time; 0 = never) -> OnUpdate
     touch                               -> OnTouch(other), every frame two triggers overlap
     T_Damage(targ, inflictor, attacker, damage), Killed(targ, attacker)
     sv_physics                          Quake's SV_Physics: think, move, touch
     (x, y, z) and (vx, vy, vz) are Quake's origin and velocity (east, north, up); radius is its size.
     A WALK edict is moved by its (vx, vy) with collision, like the player: PlayerPreThink sets the
     velocity (data/mario64.js), the engine moves it.

   PAPYRUS  (a script is a class on an edict; Self is `self`; the form is e.base)
     states      GoToState, GetState, OnBeginState, OnEndState; '' is the empty state
     timer       RegisterForSingleUpdate(seconds), UnregisterForUpdate(), OnUpdate()
     events      OnHit(akAggressor, akSource)   OnDeath(akKiller)
                 OnGainLOS / OnLostLOS(akViewer, akTarget)   OnPackageEnd(package)
                 OnActivate(akActionRef)
     functions   PlaceAtMe(form), Delete()
     classes     Form > ObjectReference > Actor

   ONLY INVENTED: OnAlert(x, y, loudness), the sound event; and the loudness model behind it.
   Inside a script an event runs the current state's handler, else the script's own. */

const MAX_EDICTS = 512;

/* ---------- Entities (QuakeC) ---------- */

/* The whole schema, in one place. Scripts may hang extra fields on an edict. */
class Edict {
  constructor(index) {
    this.index = index;
    this.reset();
  }

  reset() {
    this.free = true;
    this.sc = 'city';              /* the scene it lives in; only the player's scene runs */
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.heading = 0;              /* compass bearing in radians: 0 north, pi/2 east */
    this.pitch = 0;                /* nose-down tilt, and a vertical squash, for the renderer to show */
    this.zscale = 1;
    this.wn = null;                /* the last wall it ran into: its normal, and when */
    this.wn_time = -1;
    this.vehicle = null;           /* the vehicle edict it is riding */
    this.radius = .4;              /* touch radius */
    this.movetype = 'MOVETYPE_NONE';
    this.solid = 'SOLID_NOT';
    this.base = null;
    this.owner = null;
    this.health = 0;
    this.dead = false;
    this.faction = 'neutral';
    this.enemy = null;
    this.targetPos = null;
    this.spawnPoint = null;
    this.activePackage = null;
    this.packageState = {};
    this.attack_finished = 0;
    this.slow = 0;                 /* seconds of being slowed */
    this.los = false;              /* could it see the player last frame */
    this.nextthink = 0;
    this.script = null;
    this.activeState = '';
    this.mesh = null;
  }
}

const newPool = () => Array.from({ length: MAX_EDICTS }, (_, i) => new Edict(i));

/* Claim a free slot (not 0, which is the player), set its fields, and attach the
   script class given as `script`. Returns null if the pool is full. */
const spawn = (fields = {}) => {
  const s = GSA.state(), e = s.edicts.find((x, i) => i && x.free);
  if (!e) return null;
  const { script, ...rest } = fields;
  Object.assign(e, { free: false, sc: s.scene }, rest);
  if (script) e.script = new script(e);
  return e;
};

const remove = e => {
  if (!e || e.free) return;
  if (e.mesh) GSA.render.release(e);
  e.reset();
};

/* Subtract health; at zero or less the target is Killed, otherwise it is hit. */
const T_Damage = (targ, inflictor, attacker, damage) => {
  if (targ.free || targ.dead) return;
  targ.health -= damage;
  if (targ.health <= 0) Killed(targ, attacker);
  else if (targ.script) targ.script.dispatch('OnHit', attacker, inflictor);
};

const Killed = (targ, attacker) => {
  if (targ.script) targ.script.dispatch('OnDeath', attacker);
};

/* ---------- Scripts (Papyrus) ---------- */

class Form {
  constructor(self) {
    this.self = self;
    this.states = {};
  }

  GoToState(next) {
    if (this.self.activeState === next) return;
    this.dispatch('OnEndState');
    this.self.activeState = next;
    this.dispatch('OnBeginState');
  }

  GetState() { return this.self.activeState; }

  /* Does the current state or the script handle this event? */
  handles(event) {
    const st = this.states[this.self.activeState];
    return !!((st && st[event]) || this[event]);
  }

  dispatch(event, ...args) {
    const st = this.states[this.self.activeState],
      fn = (st && st[event]) || this[event];
    return fn && fn.apply(this, args);
  }

  /* Papyrus has one update timer per script; Quake has one nextthink per edict. */
  RegisterForSingleUpdate(seconds) { this.self.nextthink = GSA.state().t + seconds; }
  UnregisterForUpdate() { this.self.nextthink = 0; }
}

class ObjectReference extends Form {
  /* Make a new mob or item (a key of packs.mobs or packs.items) where this is. */
  PlaceAtMe(key) {
    const s = this.self;
    return packs.mobs[key] ? GSA.ai.spawnMob(key, s.x, s.y, { sc: s.sc }) : GSA.engine.addItem(key, s.x, s.y, s.sc);
  }

  Delete() { remove(this.self); }
}

class Actor extends ObjectReference {}

/* The player edict: being hit costs a stick of RAM. (The player's health is
   Infinity, so T_Damage never kills them.) */
class PlayerScript extends Actor {
  OnHit() { GSA.ai.hurt(GSA.state()); }
}

/* A zombie, cop, wraith or moth. Idle wanders; Investigate walks to a point and
   looks around; Chase and Flee react to the player. Each state turns on one of the
   native Packages below, which does the walking (and the biting). */
class MobScript extends Actor {
  constructor(self) {
    super(self);
    const ai = GSA.ai,
      /* Walk to a point and look around. */
      lookAt = (x, y) => {
        self.targetPos = [x, y];
        self.activePackage = 'Investigate';
        this.UnregisterForUpdate();
        this.GoToState('Investigate');
      },
      /* Noticed the player: fight or run, depending on the faction. */
      react = (akViewer, akTarget) => {
        const a = ai.attitude(self, GSA.state());
        if (a == 'hostile') { self.enemy = akTarget; this.GoToState('Chase'); }
        else if (a == 'flee') { self.enemy = akTarget; this.GoToState('Flee'); }
      };

    this.OnHit = akAggressor => {
      const st = this.GetState();
      if (akAggressor && st != 'Chase' && st != 'Flee') lookAt(akAggressor.x, akAggressor.y);
    };
    this.OnDeath = () => this.GoToState('Dead');

    this.states = {
      Idle: {
        OnBeginState: () => { self.enemy = null; self.activePackage = 'Wander'; },
        OnGainLOS: react,
        OnAlert: lookAt
      },

      Investigate: {
        OnBeginState: () => { self.activePackage = 'Investigate'; },
        OnEndState: () => this.UnregisterForUpdate(),
        OnGainLOS: react,
        OnAlert: lookAt,
        OnPackageEnd: () => { self.activePackage = null; this.RegisterForSingleUpdate(3); },
        OnUpdate: () => this.GoToState('Idle')   /* looked around long enough */
      },

      Chase: {
        OnBeginState: () => { self.activePackage = 'Pursue'; },
        OnAlert: () => {},   /* too busy */
        OnLostLOS: () => lookAt((self.enemy || self).x, (self.enemy || self).y),
        OnPackageEnd: () => this.GoToState('Idle')   /* the enemy is gone, or no longer an enemy */
      },

      Flee: {
        OnBeginState: () => {
          self.activePackage = 'Flee';
          this.UnregisterForUpdate();
          if (!self.los) this.RegisterForSingleUpdate(3);
        },
        OnEndState: () => this.UnregisterForUpdate(),
        OnAlert: () => {},
        OnGainLOS: () => this.UnregisterForUpdate(),
        OnLostLOS: () => this.RegisterForSingleUpdate(3),
        OnPackageEnd: () => this.GoToState('Idle'),
        OnUpdate: () => this.GoToState('Idle')   /* out of sight long enough */
      },

      Dead: {
        OnBeginState: () => {
          self.dead = true;
          self.solid = 'SOLID_NOT';
          self.activePackage = null;
          self.enemy = null;
          ai.spawnDrops(self);
          this.RegisterForSingleUpdate(15);
        },
        OnUpdate: () => this.Delete()   /* the corpse goes away */
      }
    };
    this.GoToState('Idle');
  }
}

/* Keeps one mob of base.mob alive at its position. It checks on the mob once a
   second and, once it is dead or gone, places a new one base.delay seconds later. */
class SpawnerScript extends ObjectReference {
  constructor(self) {
    super(self);
    this.mob = null;
    this.states = {
      Watching: {
        OnBeginState: () => {
          this.mob = this.PlaceAtMe(self.base.mob);
          if (this.mob) this.mob.owner = self;
          this.RegisterForSingleUpdate(1);
        },
        OnUpdate: () => {
          const m = this.mob;
          if (!m || m.free || m.dead || m.owner !== self) this.GoToState('Waiting');
          else this.RegisterForSingleUpdate(1);
        }
      },
      Waiting: {
        OnBeginState: () => { this.mob = null; this.RegisterForSingleUpdate(self.base.delay); },
        OnUpdate: () => this.GoToState('Watching')
      }
    };
    this.GoToState('Watching');
  }
}

/* A pickup. RAM is counted (and trips the alarm inside the interior); anything
   else goes into the inventory. An item the player just dropped sits in the
   Dropped state for a moment so it is not picked straight back up. */
class PickupScript extends ObjectReference {
  constructor(self) {
    super(self);
    this.states.Dropped = {
      OnTouch: () => {},
      OnUpdate: () => this.GoToState('')
    };
  }

  OnTouch(other) {
    if (other.base.type != 'player') return;
    const s = GSA.state(), e = this.self, key = e.base.key;
    if (key == 'ram') {
      s.carry++;
      if (s.scene == 'int' && !s.alarm) {
        s.alarm = 1;
        s.msg = 'Alarm raised';
        GSA.engine.emit('alarm_raised');
        GSA.ai.emitSound(s.p.x, s.p.y, Infinity, 100);
      }
    } else {
      s.inv[key] = (s.inv[key] || 0) + 1;
      s.msg = 'Picked up ' + e.base.name;
    }
    this.Delete();
  }
}

/* A portal ring. Touching one moves the player between city and interior and
   advances the mission. It stays disarmed until the player has walked clear of
   every ring (engine.js), so arriving on one does not bounce straight back. */
class PortalScript extends ObjectReference {
  OnTouch(other) {
    const s = GSA.state(), p = s.p, k = this.self.base.key;
    if (other !== p || !s.armed || (p.vehicle && k != 'door')) return;
    s.armed = 0;
    if (s.scene == 'int') {
      const o = portalsOf(s.B.source)[k];
      GSA.engine.setScene(s, 'city');
      p.x = o[0];
      p.y = o[1];
      GSA.engine.emit('out:' + k);
    } else if (k == 'door') {
      if (s.step != 2) return;
      if (s.carry / mission.of >= mission.thr) GSA.engine.emit('deliver');
      else s.msg = `Need ${Math.ceil(mission.thr * mission.of)} sticks, carrying ${s.carry}`;
    } else {
      const v = s.I.portals[k];
      GSA.engine.setScene(s, 'int');
      p.x = v[0];
      p.y = v[1];
      GSA.engine.emit('in:' + k);
    }
  }
}

/* A plasma bolt (MOVETYPE_FLY). Like Quake's spike: it removes itself when its
   think time comes, and OnTouch(null) means it hit the world. */
class PlasmaBoltScript extends ObjectReference {
  constructor(self) {
    super(self);
    this.RegisterForSingleUpdate(1.2);
  }

  OnUpdate() { this.Delete(); }

  OnTouch(other) {
    const e = this.self;
    if (!other) {
      GSA.render.spawnImpactEffect(e.x, e.y);
      this.Delete();
    } else if (other !== e.owner && other.base.type == 'actor') {
      T_Damage(other, e, e.owner, e.base.damage);
      this.Delete();
    }
  }
}

/* A crafting station. Activating it brews the first recipe for this kind of station
   that the player has the ingredients for. */
class StationScript extends ObjectReference {
  OnActivate() {
    const s = GSA.state(), type = this.self.base.key,
      found = Object.entries(packs.recipes).find(([, r]) => r.station == type && Object.entries(r.needs).every(([k, n]) => (s.inv[k] || 0) >= n));
    if (!found) { s.msg = 'You are missing ingredients'; return; }
    const [name, r] = found;
    for (const k in r.needs) s.inv[k] -= r.needs[k];
    s.inv[name] = (s.inv[name] || 0) + 1;
    s.msg = 'Brewed ' + packs.items[name].name;
  }
}

/* ---------- Native AI packages (Skyrim) ---------- */

/* A script picks the package (what to do); the package does the walking. A package
   that finishes or cannot continue sends OnPackageEnd. */
const steer = (e, s, tx, ty, k, dt) =>
  GSA.physics.steerTowards(s, e, tx, ty, e.base.speed * (e.slow > 0 ? .4 : 1) * k, dt);

const Packages = {
  Wander(e, s, dt) {
    const st = e.packageState;
    if (!st.goal || (st.dwell = (st.dwell || 0) - dt) <= 0) {
      const a = Math.random() * 2 * Math.PI, r = Math.random() * (e.base.tetherRadius || 4);
      st.goal = [e.spawnPoint[0] + Math.sin(a) * r, e.spawnPoint[1] + Math.cos(a) * r];
      st.dwell = 2 + Math.random() * 3;
    }
    steer(e, s, st.goal[0], st.goal[1], .4, dt);
  },

  Investigate(e, s, dt) {
    if (!e.targetPos || dist([e.x, e.y], e.targetPos) < .6) {
      e.targetPos = null;
      return e.script.dispatch('OnPackageEnd', 'Investigate');
    }
    steer(e, s, e.targetPos[0], e.targetPos[1], .7, dt);
  },

  /* Run at the enemy and bite it, once per attackInterval (attack_finished, as in Quake). */
  Pursue(e, s, dt) {
    const t = e.enemy;
    if (!t || t.dead || !GSA.ai.hostile(e, s)) return e.script.dispatch('OnPackageEnd', 'Pursue');
    steer(e, s, t.x, t.y, 1, dt);
    if (s.t >= e.attack_finished && dist([e.x, e.y], [t.x, t.y]) <= e.base.reach) {
      e.attack_finished = s.t + e.base.attackInterval;
      T_Damage(t, e, e, e.base.attackPower);
    }
  },

  Flee(e, s, dt) {
    const t = e.enemy;
    if (!t || t.dead) return e.script.dispatch('OnPackageEnd', 'Flee');
    const dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx, dy) || 1;
    steer(e, s, e.x + dx / d * 5, e.y + dy / d * 5, 1.25, dt);
  }
};

/* ---------- The frame ---------- */

/* Quake's SV_Physics, over the edicts in the player's scene: first think (the
   nextthink timers) and see, then move, then touch. A spawner's thinking therefore
   waits while the player is inside the interior. */
function sv_physics(s, dt) {
  s.t += dt;
  const here = s.edicts.filter(e => !e.free && e.sc == s.scene);

  /* think: OnUpdate when nextthink comes due, and the sight events */
  for (const e of here) {
    if (e.nextthink && s.t >= e.nextthink) {
      e.nextthink = 0;
      e.script.dispatch('OnUpdate');
    }
    if (e.free || e.dead || e.base.type != 'actor') continue;
    if (e.slow > 0) e.slow -= dt;
    const was = e.los;
    e.los = GSA.ai.sees(e, s);
    if (e.los && !was) e.script.dispatch('OnGainLOS', e, s.p);
    else if (!e.los && was) e.script.dispatch('OnLostLOS', e, s.p);
  }

  /* move: the active package, then the movetype */
  for (const e of here) {
    if (e.free) continue;
    if (e.activePackage) Packages[e.activePackage](e, s, dt);
    if (e.movetype == 'MOVETYPE_FLY') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      if (!e.free && GSA.physics.hit(s, e.x, e.y, e.z)) e.script.dispatch('OnTouch', null);
    } else if (e.movetype == 'MOVETYPE_WALK') {
      const wall = GSA.physics.mv(s, e, e.vx * dt, e.vy * dt);
      if (wall) {
        e.wn = wall;
        e.wn_time = s.t;
        if (wall[0]) e.vx = 0;
        if (wall[1]) e.vy = 0;
      }
    }
  }

  /* touch: every pair of overlapping triggers touches */
  const solid = here.filter(e => !e.free && e.solid != 'SOLID_NOT');
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (a.free || b.free || a.sc != b.sc || a.solid == 'SOLID_NOT' || b.solid == 'SOLID_NOT') continue;
      if (dist([a.x, a.y], [b.x, b.y]) > a.radius + b.radius) continue;
      if (a.script) a.script.dispatch('OnTouch', b);
      if (!b.free && b.script) b.script.dispatch('OnTouch', a);
    }
  }
}

(window.GSA = window.GSA || {}).scripting = {
  MAX_EDICTS, Edict, newPool, spawn, remove, T_Damage, Killed, Form, ObjectReference, Actor, Packages, sv_physics,
  PlayerScript, MobScript, SpawnerScript, PickupScript, PortalScript, StationScript, PlasmaBoltScript
};