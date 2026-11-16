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
  const { RC, hit } = GSA.physics;

  /* A red body with a dark cabin, front towards +z. */
  const carModel = a => {
    a(new THREE.BoxGeometry(1.3, .5, 2.4), '#d1495b', 0, .45, 0);
    a(new THREE.BoxGeometry(1.1, .4, 1.2), '#2a2d34', 0, .9, -.15);
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  class CarScript extends ObjectReference {
    constructor(self) {
      super(self);
      self.speed = 0;
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

      c.speed += ((up ? 14 : 0) - (down ? 18 : 0)) * dt;
      c.speed = clamp(c.speed, -6, 16) * (1 - (up || down ? 0 : 1.5 * dt));
      /* heading is a compass bearing, so turning right adds to it */
      c.heading += ((right ? 1 : 0) - (left ? 1 : 0)) * 2.2 * dt * clamp(c.speed / 4, -1, 1);

      const nx = c.x + Math.sin(c.heading) * c.speed * dt,
        ny = c.y + Math.cos(c.heading) * c.speed * dt;
      if (nx < .9 || nx > s.size[0] - .9 || ny < .9 || ny > s.size[1] - .9 || RC(nx, ny, s.walls.concat(s.city.water || []), .9)) c.speed *= -.3;
      else {
        c.x = nx;
        c.y = ny;
      }

      /* splatter: anything hostile in front of a fast car dies */
      if (Math.abs(c.speed) > 5)
        for (const m of GSA.ai.live(s))
          if (dist([m.x, m.y], [c.x, c.y]) < 1.5 && GSA.ai.hostile(m, s)) T_Damage(m, c, d, Infinity);

      d.x = c.x;
      d.y = c.y;
    }
  }

  GSA.bus.on('start', ({ S }) => {
    const at = S.city.car || [24.5, 13];
    spawn({ base: { type: 'vehicle', key: 'car', build: carModel }, x: at[0], y: at[1], heading: 0, radius: .9, sc: 'city', script: CarScript });
  });
})();