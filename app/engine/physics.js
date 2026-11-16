// /engine/physics.js
/* the engine's collision and movement builtins, like QuakeC's
   walkmove and traceline. Content (data/*.js) calls these; nothing here knows
   about Mario, cars or meshes.

   Coordinates are east, north, up: x east, y north, z up (right-handed). Walls
   are rects [x, y, w, d] from their south-west corner. Walls and bounds come
   from s.walls / s.size, which engine.js refreshes whenever the scene changes. */

/* Does a body of radius r at (x, y) overlap any wall rect? */
const RC = (x, y, ws, r = .35) => ws.some(([a, b, c, d]) => x + r > a && x - r < a + c && y + r > b && y - r < b + d);

/* Wall height: interiors have low ceilings, the city has tall buildings. */
const WH = s => s.scene == 'int' ? 2.2 : 5;

/* Is a body at height z blocked at (x, y)? Walls block anything below their top;
   city water blocks anything walking (below 0.3). */
const hit = (s, x, y, z) => z < WH(s) - .2 && RC(x, y, s.walls) || z < .3 && s.scene == 'city' && RC(x, y, s.city.water || []);

/* Move e by (dx, dy), each axis separately so it slides along walls. Returns the
   normal of the last wall it ran into, or null. */
const mv = (s, e, dx, dy) => {
  const z = e.z || 0;
  let wall = null;
  const x = e.x + dx;
  if (x > .35 && x < s.size[0] - .35) {
    if (!hit(s, x, e.y, z)) e.x = x;
    else if (dx) wall = [-Math.sign(dx), 0];
  }
  const y = e.y + dy;
  if (y > .35 && y < s.size[1] - .35) {
    if (!hit(s, e.x, y, z)) e.y = y;
    else if (dy) wall = [0, -Math.sign(dy)];
  }
  return wall;
};

/* Approach (tx, ty) by at most speed * dt, facing the way it is going. Headings
   are compass bearings in radians: 0 is north, pi/2 is east. */
const steerTowards = (s, e, tx, ty, speed, dt) => {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < .01) return;
  const step = Math.min(speed * dt, d);
  mv(s, e, dx / d * step, dy / d * step);
  e.heading = Math.atan2(dx, dy);
};

/* Knockback in small steps so a shove cannot tunnel through a thin wall. */
const shove = (s, e, dx, dy) => {
  for (let i = 0; i < 6; i++) mv(s, e, dx / 6, dy / 6);
};

(window.GSA = window.GSA || {}).physics = { RC, WH, hit, mv, steerTowards, shove };