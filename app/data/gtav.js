// /data/gtav.js
/* a drivable car, GTA style.

   The car is an edict like any other (base.type 'vehicle'), placed when the game
   starts. Its script, CarScript, has two states:
     Parked  does nothing; OnActivate gets the player in
     Driven  thinks every frame: reads the buttons, moves the car, splatters anything
             hostile it hits, and carries the driver with it; OnActivate gets them out
   The player edict is marked as riding it (player.vehicle), which tells
   data/mario64.js to stand aside. Activating (the exit key) is the engine's generic
   use action: it sends OnActivate to the vehicle you are in, or the nearest thing
   that handles it.

   The city may give the car's spot as `car: [x, y]`. The car is drawn from
   base.build, the same way a race draws its avatar. Needs data/ loaded after
   physics.js and scripting.js, before engine.js. */
(() => {
  const { RC, hit, groundZ } = GSA.physics;

  /* A red body with a dark cabin, front towards +z. */
  const carModel = a => {
    a(new THREE.BoxGeometry(1.3, .5, 2.4), '#d1495b', 0, .45, 0);
    a(new THREE.BoxGeometry(1.1, .4, 1.2), '#2a2d34', 0, .9, -.15);
  };

  /* The parked kinds (city.parked = [[kind, x, y, heading, colour]]): each has a model (front towards +z), a
     collision radius, and handling: top speed, acceleration, turn rate, and the half-length and half-track the
     ride/tilt code samples the ground at. A convertible has no roof, a snowmobile skis and a track. */
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), wheel = (a, x, y, z, r = .3, w = .22) => a(new THREE.CylinderGeometry(r, r, w, 8).rotateZ(Math.PI / 2), '#17181c', x, y, z);
  const KINDS = {
    car: { radius: .9, max: 16, acc: 14, turn: 2.2, hl: .9, hw: .6, model: (a, c) => { a(B(1.3, .5, 2.4), c, 0, .5, 0); a(B(1.1, .4, 1.2), '#2a2d34', 0, .92, -.15); [[-.65, .85], [.65, .85], [-.65, -.85], [.65, -.85]].forEach(([x, z]) => wheel(a, x, .3, z)); } },
    convertible: { radius: .9, max: 18, acc: 16, turn: 2.4, hl: .9, hw: .6, model: (a, c) => { a(B(1.3, .5, 2.4), c, 0, .5, 0); a(B(1.1, .32, .08), '#9fd3e6', 0, .9, .5); a(B(1.0, .22, .8), '#2a2d34', 0, .8, -.35); [[-.65, .85], [.65, .85], [-.65, -.85], [.65, -.85]].forEach(([x, z]) => wheel(a, x, .3, z)); } },
    van: { radius: 1.1, max: 13, acc: 10, turn: 1.8, hl: 1.4, hw: .8, model: (a, c) => { a(B(1.6, 1.5, 3.0), c, 0, 1.05, 0); a(B(1.4, .5, .08), '#2a2d34', 0, 1.45, 1.52); [[-.8, 1.0], [.8, 1.0], [-.8, -1.0], [.8, -1.0]].forEach(([x, z]) => wheel(a, x, .35, z, .35, .25)); } },
    truck: { radius: 1.3, max: 12, acc: 8, turn: 1.6, hl: 1.7, hw: .9, model: (a, c) => { a(B(1.7, 1.3, 1.2), c, 0, 1.0, 1.35); a(B(1.5, .45, .08), '#2a2d34', 0, 1.35, 1.96); a(B(1.8, .9, 2.8), '#59616b', 0, .85, -.9); [[-.85, 1.35], [.85, 1.35], [-.85, -.2], [.85, -.2], [-.85, -1.6], [.85, -1.6]].forEach(([x, z]) => wheel(a, x, .38, z, .38, .28)); } },
    moto: { radius: .5, max: 20, acc: 18, turn: 3, hl: .7, hw: .3, model: (a, c) => { a(B(.3, .45, 1.1), c, 0, .65, 0); a(B(.26, .12, .5), '#2a2d34', 0, .95, -.2); a(B(.7, .06, .06), '#2a2d34', 0, 1.0, .55); wheel(a, 0, .35, .7, .35, .12); wheel(a, 0, .35, -.7, .35, .12); } },
    snowmobile: { radius: .75, max: 17, acc: 15, turn: 2.6, hl: .9, hw: .45, model: (a, c) => { a(B(.9, .45, 1.8), c, 0, .55, 0); a(B(.7, .3, .08), '#9fd3e6', 0, .95, .5); a(B(.6, .15, .5), '#2a2d34', 0, .85, -.4); [-.42, .42].forEach(x => a(B(.14, .08, 1.5), '#cfd3d6', x, .14, .8)); a(B(.5, .25, 1.4), '#17181c', 0, .2, -.5); } }
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  class CarScript extends ObjectReference {
    constructor(self) {
      super(self);
      self.speed = 0;
      self.pitch = self.roll = 0;
      this.k = KINDS[self.vk || 'car'];
      this.driver = null;
      this.states = {
        Parked: {
          OnActivate: akActionRef => this.getIn(akActionRef)
        },
        Driven: {
          OnBeginState: () => {
            this.last = GSA.state().t;
            this.RegisterForSingleUpdate(0);
          },
          OnEndState: () => this.UnregisterForUpdate(),
          OnActivate: () => this.getOut(),
          OnUpdate: () => {
            this.drive();
            this.RegisterForSingleUpdate(0);
          }
        }
      };
      this.GoToState('Parked');
    }

    getIn(driver) {
      this.driver = driver;
      driver.vehicle = this.self;
      this.GoToState('Driven');
    }

    /* Step out on the right, else the left, else on the spot. */
    getOut() {
      const s = GSA.state(), c = this.self, d = this.driver,
        o = [[Math.cos(c.heading) * 1.8, -Math.sin(c.heading) * 1.8], [-Math.cos(c.heading) * 1.8, Math.sin(c.heading) * 1.8], [0, 0]]
          .find(([a, b]) => !hit(s, c.x + a, c.y + b, 0));
      d.x = c.x + o[0];
      d.y = c.y + o[1];
      d.vehicle = null;
      c.speed = 0;
      this.driver = null;
      this.GoToState('Parked');
    }

    drive() {
      const s = GSA.state(), inp = GSA.inputs, c = this.self, d = this.driver,
        dt = s.t - this.last,
        up = inp.pressed('forward'), down = inp.pressed('backward'),
        left = inp.pressed('move_left'), right = inp.pressed('move_right');
      this.last = s.t;

      const k = this.k;
      c.speed += ((up ? k.acc : 0) - (down ? k.acc * 1.3 : 0)) * dt;
      c.speed = clamp(c.speed, -6, k.max) * (1 - (up || down ? 0 : 1.5 * dt));
      /* heading is a compass bearing, so turning right adds to it */
      c.heading += ((right ? 1 : 0) - (left ? 1 : 0)) * k.turn * dt * clamp(c.speed / 4, -1, 1);

      const nx = c.x + Math.sin(c.heading) * c.speed * dt,
        ny = c.y + Math.cos(c.heading) * c.speed * dt;
      const r = c.radius;
      if (nx < r || nx > s.size[0] - r || ny < r || ny > s.size[1] - r || RC(nx, ny, s.walls.concat(s.city.water || []), r) ||
        GSA.physics.wet(s, nx, ny, c.z || 0) || GSA.physics.steep(s, c.x, c.y, nx, ny, Math.max(c.z || 0, c.gz ?? 0)) ||
        s.edicts.some(e => e !== c && !e.free && e.base && e.base.type == 'vehicle' && e.sc == s.scene && dist([e.x, e.y], [nx, ny]) < r + e.radius)) c.speed *= -.3;   /* walls, water, cliffs and other vehicles */
      else {
        c.x = nx;
        c.y = ny;
      }

      /* splatter: anything hostile in front of a fast car dies */
      if (Math.abs(c.speed) > 5)
        for (const m of GSA.ai.live(s))
          if (dist([m.x, m.y], [c.x, c.y]) < 1.5 && GSA.ai.hostile(m, s)) T_Damage(m, c, d, Infinity);

      this.ride(s, dt);
      d.x = c.x;
      d.y = c.y;
      d.z = c.z;
    }

    /* Ride the heightmap. Each wheel reads the ground under it; the body follows their average on a
       spring, tilts to match, and a step up (a kerb) costs speed and kicks the car into a hop.
       When the ground falls away faster than the spring can follow, gravity takes over. */
    ride(s, dt) {
      const c = this.self, h = c.heading, fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h),
        k = this.k, g = (a, b) => groundZ(s, c.x + rx * a + fx * b, c.y + ry * a + fy * b),
        fl = g(-k.hw, k.hl), fr = g(k.hw, k.hl), rl = g(-k.hw, -k.hl), rr = g(k.hw, -k.hl),
        tgt = (fl + fr + rl + rr) / 4, up = tgt - (c.gz ?? tgt);
      c.gz = tgt;
      if (up > .02) {
        c.vz = (c.vz || 0) + up * Math.abs(c.speed) * 3;
        c.speed *= 1 - clamp(up * 3, 0, .3);
      }
      c.vz = c.vz || 0;
      if (c.z > tgt + .04) c.vz -= 30 * dt;
      else c.vz += (400 * (tgt - c.z) - 24 * c.vz) * dt;
      c.z += c.vz * dt;
      if (c.z < tgt - .12) {
        c.z = tgt - .12;
        c.vz = Math.max(c.vz, 0);
      }
      const kk = Math.min(1, 12 * dt);
      c.pitch += (Math.atan2((fl + fr) / 2 - (rl + rr) / 2, 2 * k.hl) - c.pitch) * kk;
      c.roll += (Math.atan2((fl + rl) / 2 - (fr + rr) / 2, 2 * k.hw) - c.roll) * kk;
    }
  }

  GSA.bus.on('start', ({ S }) => {
    const at = S.city.car || [24.5, 13];
    spawn({ base: { type: 'vehicle', key: 'car', build: carModel }, x: at[0], y: at[1], z: groundZ({ scene: 'city', city: S.city }, at[0], at[1]), heading: 0, radius: .9, sc: 'city', script: CarScript });
    /* the parked ones: all drivable, each handling like its kind */
    for (const [kind, x, y, heading, colour] of S.city.parked || []) {
      const K = KINDS[kind];
      spawn({ base: { type: 'vehicle', key: kind, build: a => K.model(a, colour) }, vk: kind, x, y, z: groundZ({ scene: 'city', city: S.city }, x, y), heading, radius: K.radius, sc: 'city', script: CarScript });
    }
  });
})();