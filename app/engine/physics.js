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
/* buildings stand on the ground: their top is WH above the heightmap where they are, not above 0 */
const hit = (s, x, y, z) => RC(x, y, s.walls) && z - groundZ(s, x, y) < WH(s) - .2 || z < .3 && s.scene == 'city' && RC(x, y, s.city.water || []) || wet(s, x, y, z);

/* Deep water on a heightmap (city.island): the heightmap has a water level per cell, and you can
   wade where it is under 0.7 deep. A thing is blocked where it is deeper and its feet are below
   the surface plus 0.3, so you can still jump across a river. */
function wet(s, x, y, z) {
  if (s.scene != 'city') return false;
  const hm = terrain(s.city);
  if (!hm || !hm.level && !hm.levelAt) return false;
  let L;
  if (hm.levelAt) L = hm.levelAt(x, y);
  else {
    const i = Math.min(hm.cols - 1, Math.max(0, Math.round(x / hm.res))), j = Math.min(hm.rows - 1, Math.max(0, Math.round(y / hm.res)));
    L = hm.level[j * hm.cols + i];
  }
  return L > -1e8 && L - heightAt(hm, x, y) > .7 && z < L + .3;
}

/* Steep ground. Moving from (x0, y0) to (x1, y1) with feet at z: a step up of more than STEP is a
   cliff, and uphill ground steeper than MAXSLOPE is too steep to walk. Either returns the
   downhill unit normal (so a steep face works as a wall for wall jumps), else null. Kerbs are far
   under both limits. */
const STEP = .45, MAXSLOPE = 1.3;
function climb(hm, x0, y0, x1, y1, z) {
  const g1 = heightAt(hm, x1, y1);
  if (g1 <= z + .02) return null;
  const gx = heightAt(hm, x1 + .25, y1) - heightAt(hm, x1 - .25, y1), gy = heightAt(hm, x1, y1 + .25) - heightAt(hm, x1, y1 - .25),
    n = Math.hypot(gx, gy) || 1;
  if (g1 - z <= STEP && !(g1 > heightAt(hm, x0, y0) + 1e-4 && n / .5 > MAXSLOPE)) return null;
  return [-gx / n, -gy / n];
}
const steep = (s, x0, y0, x1, y1, z) => {
  const hm = s.scene == 'city' ? terrain(s.city) : null;
  return hm ? climb(hm, x0, y0, x1, y1, z) : null;
};
/* Is a point (a bolt, say) inside the ground? Only on a generated island: elsewhere z is not a height. */
const inTerrain = (s, x, y, z) => {
  const hm = s.scene == 'city' ? terrain(s.city) : null;
  return !!(hm && hm.island && z < heightAt(hm, x, y) - .05);
};

/* Move e by (dx, dy), each axis separately so it slides along walls. Returns the
   normal of the last wall it ran into, or null. */
const mv = (s, e, dx, dy) => {
  const hm = s.scene == 'city' ? terrain(s.city) : null;
  /* everything but the player rides the ground; the player's z belongs to the movement kit */
  const z = hm && e !== s.p ? (e.z = heightAt(hm, e.x, e.y)) : e.z || 0;
  let wall = null;
  const x = e.x + dx;
  if (x > .35 && x < s.size[0] - .35) {
    const up = hm && climb(hm, e.x, e.y, x, e.y, z);
    if (!hit(s, x, e.y, z) && !up) e.x = x;
    else if (dx) wall = up || [-Math.sign(dx), 0];
  } else if (dx && z < valleyWall(s, x, e.y) - .2) wall = [x <= .35 ? 1 : -1, 0];   /* the valley wall, which you can kick off */
  const y = e.y + dy;
  if (y > .35 && y < s.size[1] - .35) {
    const up = hm && climb(hm, e.x, e.y, e.x, y, z);
    if (!hit(s, e.x, y, z) && !up) e.y = y;
    else if (dy) wall = up || [0, -Math.sign(dy)];
  } else if (dy && z < valleyWall(s, e.x, y) - .2) wall = [0, y <= .35 ? 1 : -1];
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

/* ---------- Terrain: the heightmap ----------
   A city's ground is a grid of heights (x east, y north, z up), one sample every HM_RES
   tiles, read with bilinear interpolation. Everything that rides on the ground (the player,
   the car, the renderer) asks groundZ(s, x, y), so a feature added to the grid shows up in
   all of them at once. Interiors and the sky scene are flat (0).
   A city feeds the grid from:
     curbs: true | { height, width }   a raised sidewalk around every site
     terrain: { height: (x, y) => z,   a base surface (hills, valleys; the overworld goes here)
                rects: [[x, y, w, d, z]] }   plateaus: the ground is at least z inside each rect
     mountains: { seed, peak, ramp, reach, summit: [x, y] }   procedural mountains outside the map
                (see mountainHeight); the valley floor stays at 0 and the wall rises from its edge
   The grid is built once per city; GSA.physics.terrain(city, true) rebuilds it. */
const HM_RES = .1, CURB_H = .15, CURB_W = .6;

function buildHeightmap(city) {
  if (city.island) return generateIsland(city);
  if (city.world) return generateWorld(city);
  const cb = city.curbs && (city.curbs === true ? {} : city.curbs), tr = city.terrain;
  if (!cb && !tr) return null;
  const [W, D] = city.size, cols = Math.ceil(W / HM_RES) + 1, rows = Math.ceil(D / HM_RES) + 1,
    z = new Float32Array(cols * rows), E = 1e-6;
  if (tr && tr.height)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) z[j * cols + i] = tr.height(i * HM_RES, j * HM_RES);
  const raise = ([x, y, w, d], h) => {
    const i0 = Math.max(0, Math.ceil(x / HM_RES - E)), i1 = Math.min(cols - 1, Math.floor((x + w) / HM_RES + E)),
      j0 = Math.max(0, Math.ceil(y / HM_RES - E)), j1 = Math.min(rows - 1, Math.floor((y + d) / HM_RES + E));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) z[j * cols + i] = Math.max(z[j * cols + i], h);
  };
  if (cb) {
    const m = cb.width ?? CURB_W, h = cb.height ?? CURB_H;
    for (const { r: [x, y, w, d] } of city.sites) raise([x - m, y - m, w + 2 * m, d + 2 * m], h);
  }
  for (const [x, y, w, d, h] of (tr && tr.rects) || []) raise([x, y, w, d], h);
  let max = 0;
  for (let i = 0; i < z.length; i++) if (z[i] > max) max = z[i];
  return { cols, rows, res: HM_RES, z, max };
}

/* ---------- Procedural mountains ----------
   Seeded value noise: hash the lattice corners, blend with a smoothstep. fbm sums octaves;
   ridged folds it so the crests are sharp lines instead of round hills. Pure functions of
   (seed, x, y), so any chunk of the overworld can be generated on demand. */
const hash2 = (i, j, seed) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y, seed) => {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j,
    a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v),
    n = (di, dj) => hash2(i + di, j + dj, seed);
  return (n(0, 0) * (1 - a) + n(1, 0) * a) * (1 - b) + (n(0, 1) * (1 - a) + n(1, 1) * a) * b;
};
const fbm = (x, y, seed, oct = 5) => {
  let s = 0, amp = .5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++, amp /= 2, f *= 2) {
    s += amp * vnoise(x * f, y * f, seed + o * 101);
    norm += amp;
  }
  return s / norm;
};
const ridged = (x, y, seed, oct = 5) => {
  let s = 0, amp = .5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++, amp /= 2, f *= 2) {
    s += amp * (1 - Math.abs(2 * vnoise(x * f, y * f, seed + o * 101) - 1));
    norm += amp;
  }
  return s / norm;
};
const smooth = t => (t = Math.min(Math.max(t, 0), 1)) * t * (3 - 2 * t);

/* The valley wall: a vertical face at the map edge, like the walls round Peach's castle, whose crest height varies along the edge
   (noise sampled at the nearest edge point, from 40% to 100% of `wall`, default 14 tiles), so
   the wall is a ragged procedural cliff line rather than a uniform fence. You can walk right up to it. mv() lets you
   wall-jump off it up to this height; the mountains stand on top of it. */
const wallCrest = (city, x, y) => {
  const m = city.mountains, cx = Math.min(Math.max(x, 0), city.size[0]), cy = Math.min(Math.max(y, 0), city.size[1]);
  return (m.wall ?? 14) * (.4 + .6 * smooth((ridged(cx * .07, cy * .07, (m.seed ?? 1) + 3) - .6) / .3));   /* ridged noise sits in ~.6-.9: stretch it */
};
const valleyWall = (s, x, y) => s.scene == 'city' && s.city.mountains ? wallCrest(s.city, x, y) : 0;

/* Height of the mountains at (x, y): 0 on the valley floor (and anywhere without
   city.mountains), a steep wall rising from the map edge, a ridge line hugging the valley
   that fades into plains `reach` tiles out, and one big summit (default: past the north edge). */
const mountainHeight = (city, x, y) => {
  const m = city.mountains;
  if (!m) return 0;
  const [W, D] = city.size, d = Math.hypot(Math.max(-x, 0, x - W), Math.max(-y, 0, y - D));
  if (d === 0) return 0;
  const peak = m.peak ?? 60, ramp = m.ramp ?? 14, reach = m.reach ?? 90, seed = m.seed ?? 1,
    [sx, sy] = m.summit || [W * .6, D + reach * .55],
    edge = smooth(d / ramp),
    range = edge * (1 - smooth((d - reach * .6) / (reach * .4))),
    bump = Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * (reach * .28) ** 2)),
    r = ridged(x * .035, y * .035, seed);
  /* the wall is the vertical step from the floor (0) up to the crest at the edge; the mountains
     start at crest height and rise from there */
  return wallCrest(city, x, y) + peak * (.28 * range * (.4 + .6 * r) + .72 * edge * bump * (.5 + .5 * r)) + edge * 1.2 * fbm(x * .15, y * .15, seed + 7);
};

/* ---------- Island generator: terrain, water table, streams, lakes, bay ----------
   city.island = { seed, peak, res, ... } makes a whole island from a seed. Pure and
   deterministic; the result is the same heightmap object terrain() hands out, plus
   a water level per cell and a colour per cell:
     1. terrain   an elliptical island of rolling plains round one big ridged mountain,
                  a bay cut into the south coast, a lake basin and a river valley
                  (a meandering polyline) carved from the mountain to the bay
     2. water     priority-flood fills every depression to its spill height (lakes are the
        table     deep, wide ones) and routes rain downhill: D8 flow directions, then flow
                  accumulation. The water table is the terrain's damped copy (a blur of it,
                  relaxed, capped at the surface); where it reaches the surface the ground
                  seeps and adds base flow, so streams start where the table meets the slope
     3. rivers    cells whose accumulated flow passes a threshold get a channel carved,
                  widening and deepening with the flow: stream, then river, then the bay
     4. pads      each site gets a flat pad blended into the slope
   Sea level is 0. Units are tiles. */
function generateIsland(city) {
  const o = city.island, [W, D] = city.size, res = o.res ?? .5, seed = o.seed ?? 1, SEA = 0,
    cols = Math.ceil(W / res) + 1, rows = Math.ceil(D / res) + 1, N = cols * rows,
    [cx, cy] = o.center ?? [W * .5, D * .52], peak = o.peak ?? 44, Rm = o.mountainRadius ?? 46,
    [sx, sy] = o.summit ?? [cx, cy + 6],
    bay = o.bay ?? [cx + 4, cy - 52, 11, 14, 10],            /* x, y, sigma x, sigma y, depth */
    lake = o.lake ?? [cx - 3, cy - 20, 7, 5],                /* x, y, radius, depth: a tarn held by a raised rim */
    ctl = o.river ?? [[cx - 4, cy - 2], [cx - 9, cy - 11], [cx - 2, cy - 21], [cx - 6, cy - 29], [cx + 3, cy - 36], [cx + 4, cy - 40]],
    T = new Float32Array(N), V = new Float32Array(N), ix = (i, j) => j * cols + i, rnd = (a, b) => hash2(a, b, seed + 77) - .5;

  /* the river valley as a jittered polyline, with fraction-downstream t along it */
  const pts = [];
  for (let k = 0; k < ctl.length - 1; k++)
    for (let s = 0; s < 6; s++) {
      const u = s / 6, j = (k * 6 + s) / ((ctl.length - 1) * 6);
      pts.push([ctl[k][0] + (ctl[k + 1][0] - ctl[k][0]) * u + rnd(k, s) * 5 * j, ctl[k][1] + (ctl[k + 1][1] - ctl[k][1]) * u + rnd(s, k) * 5 * j]);
    }
  pts.push(ctl[ctl.length - 1]);
  const valley = (x, y) => {
    let best = 1e9, bt = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1], vx = bx - ax, vy = by - ay,
        u = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))),
        d = Math.hypot(x - ax - vx * u, y - ay - vy * u);
      if (d < best) { best = d; bt = (k + u) / (pts.length - 1); }
    }
    return (2 + 5 * bt) * Math.exp(-best * best / (2 * (2.2 + 4.3 * bt) ** 2));
  };

  /* 1. terrain */
  const hgt = (x, y) => {   /* island + mountain + roughness, before anything is carved */
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy / .82) + 18 * (fbm(x * .025, y * .025, seed + 1) - .5),
      base = 11 * (1 - smooth((r - 58) / 22)) - 7, m = Math.max(0, 1 - Math.hypot(x - sx, y - sy) / Rm);
    return base + peak * (.55 * m * m * (3 - 2 * m) + .45 * m ** 1.6) * (.55 + .45 * ridged(x * .045, y * .045, seed + 2)) +   /* smooth foot, steeper middle */
      3.5 * (fbm(x * .09, y * .09, seed + 3) - .5) * 2 * Math.sqrt(m) + 1 * (fbm(x * .2, y * .2, seed + 4) - .5) * smooth((base + 2) / 4);
  };
  /* the tarn: its level sits a little under the ground at its centre; inside the radius the ground is
     replaced by a bowl, just outside it the ground is raised into a rim that fades back over 5 tiles */
  const lakeL = hgt(lake[0], lake[1]) - .8;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i * res, y = j * res;
      let h = hgt(x, y);
      const dl = Math.hypot(x - lake[0], y - lake[1]) + 3 * (fbm(x * .18, y * .18, seed + 9) - .5) * 2;   /* ragged shore */
      if (dl < lake[2]) h = lakeL - lake[3] * (1 - (dl / lake[2]) ** 2);
      else if (dl < lake[2] + 5) h = Math.max(h, lakeL + 1 - smooth((dl - lake[2]) / 5));
      if (h > SEA - 1) h -= V[ix(i, j)] = valley(x, y);
      h -= bay[4] * Math.exp(-((x - bay[0]) ** 2 / (2 * bay[2] ** 2) + (y - bay[1]) ** 2 / (2 * bay[3] ** 2)));
      T[ix(i, j)] = h;
    }
  const T0 = Float32Array.from(T), nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  /* 2a. priority-flood: F is the surface water would settle to (depressions filled to their spill) */
  const F = new Float32Array(N).fill(Infinity), seen = new Uint8Array(N), heap = new Int32Array(N + 2), EPS = 2e-4;
  let hs = 0;
  const push = c => {
    heap[++hs] = c;
    for (let k = hs; k > 1 && F[heap[k]] < F[heap[k >> 1]]; k >>= 1) { const a = heap[k]; heap[k] = heap[k >> 1]; heap[k >> 1] = a; }
  }, pop = () => {
    const top = heap[1];
    heap[1] = heap[hs--];
    for (let k = 1; ;) {
      const l = k * 2, r = l + 1;
      let m = k;
      if (l <= hs && F[heap[l]] < F[heap[m]]) m = l;
      if (r <= hs && F[heap[r]] < F[heap[m]]) m = r;
      if (m === k) break;
      const a = heap[k]; heap[k] = heap[m]; heap[m] = a;
      k = m;
    }
    return top;
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = ix(i, j);
      if (i == 0 || j == 0 || i == cols - 1 || j == rows - 1 || T[c] <= SEA) { F[c] = T[c]; seen[c] = 1; push(c); }
    }
  while (hs) {
    const c = pop(), ci = c % cols, cj = (c / cols) | 0;
    for (const [a, b] of nb) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const n = ix(i, j);
      if (seen[n]) continue;
      seen[n] = 1;
      F[n] = Math.max(T[n], F[c] + EPS);
      push(n);
    }
  }

  /* 2b. the water table: a damped copy of the terrain (blur of land-or-sea-level, capped at the
     surface), relaxed with the sea as its fixed boundary. Where it meets the surface the ground seeps. */
  const box = (src, r) => {   /* separable box blur, radius r cells */
    const tmp = new Float32Array(N), out = new Float32Array(N);
    for (let j = 0; j < rows; j++) {
      let acc = 0, n = 0;
      for (let i = -r; i < cols + r; i++) {
        const a = i + r, b = i - r - 1;
        if (a < cols) { acc += src[ix(a, j)]; n++; }
        if (b >= 0) { acc -= src[ix(b, j)]; n--; }
        if (i >= 0 && i < cols) tmp[ix(i, j)] = acc / n;
      }
    }
    for (let i = 0; i < cols; i++) {
      let acc = 0, n = 0;
      for (let j = -r; j < rows + r; j++) {
        const a = j + r, b = j - r - 1;
        if (a < rows) { acc += tmp[ix(i, a)]; n++; }
        if (b >= 0) { acc -= tmp[ix(i, b)]; n--; }
        if (j >= 0 && j < rows) out[ix(i, j)] = acc / n;
      }
    }
    return out;
  };
  const above = Float32Array.from(T0, v => Math.max(v, SEA)), wt = box(box(above, 10), 10), land = c => T0[c] > SEA;
  for (let c = 0; c < N; c++) wt[c] = land(c) ? Math.min(T0[c], wt[c]) : SEA;
  for (let it = 0; it < 24; it++)
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const c = ix(i, j);
        if (land(c)) wt[c] = Math.min(T0[c], (wt[c - 1] + wt[c + 1] + wt[c - cols] + wt[c + cols]) / 4);
      }
  const seep = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (land(c) && T0[c] > SEA + .4 && T0[c] - wt[c] < .05) seep[c] = 1;

  /* 2c. rain, base flow, flow directions, accumulation */
  const down = new Int32Array(N).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = ix(i, j);
      if (!land(c)) continue;
      let best = 0;
      for (const [a, b] of nb) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = ix(ni, nj), s = (F[c] - F[n]) / (a && b ? 1.4142 : 1);
        if (s > best) { best = s; down[c] = n; }
      }
    }
  const acc = new Float32Array(N), order = new Uint32Array(N);
  for (let c = 0; c < N; c++) { order[c] = c; acc[c] = land(c) ? .5 + 1.2 * smooth(T0[c] / (peak * .6)) + (seep[c] ? 4 : 0) + V[c] * 1.5 : 0; }   /* the valley gathers extra: it is the island's main drainage */
  order.sort((a, b) => F[b] - F[a]);
  for (let k = 0; k < N; k++) { const c = order[k]; if (down[c] >= 0) acc[down[c]] += acc[c]; }

  /* lakes: connected runs of filled depression, kept only if wide and deep enough to matter */
  const level = new Float32Array(N).fill(-1e9), lab = new Int32Array(N);
  for (let c = 0; c < N; c++) {
    if (lab[c] || !(F[c] - T0[c] > .12 && land(c) && F[c] > SEA + .2)) continue;
    const stack = [c], cells = [];
    let deep = 0;
    lab[c] = 1;
    while (stack.length) {
      const q = stack.pop();
      cells.push(q);
      deep = Math.max(deep, F[q] - T0[q]);
      const qi = q % cols, qj = (q / cols) | 0;
      for (const [a, b] of nb) {
        const i = qi + a, j = qj + b;
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const n = ix(i, j);
        if (!lab[n] && F[n] - T0[n] > .12 && land(n) && F[n] > SEA + .2) { lab[n] = 1; stack.push(n); }
      }
    }
    if (deep > .8 && cells.length > 30) for (const q of cells) level[q] = F[q];
  }

  /* 3. rivers: carve a channel along every cell with enough flow, widening downstream */
  const thr = o.streamFlow ?? 400;
  for (let c = 0; c < N; c++) {
    /* up the mountain a smaller flow already makes a stream: the threshold falls from thr at the shore to 45% of it above 24 tiles */
    /* ...and the river valley always carries its stream from a spring near the top (any flow at all in its bed) */
    if (!land(c) || acc[c] < (V[c] > 1.2 ? 20 : thr * (.45 + .55 * smooth((24 - T0[c]) / 24))) || level[c] > -1e8 || F[c] < SEA + .05) continue;
    const i = c % cols, j = (c / cols) | 0, ratio = Math.max(1, acc[c] / thr),
      w = .4 + .55 * Math.sqrt(ratio), wd = .3 * ratio ** .6, rad = Math.ceil(w * 1.8 / res);
    for (let b = -rad; b <= rad; b++)
      for (let a = -rad; a <= rad; a++) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = ix(ni, nj), u = Math.hypot(a, b) * res / (w * 1.8);
        if (u >= 1 || level[n] > -1e8 && lab[n]) continue;
        /* the bed is a bowl cut into the local ground and the water sits in it, a third of its depth under the
           old surface, so on a steep slope the stream follows the ground down instead of stepping */
        const k = 1 - u * u, bed = T0[n] - 1.33 * wd * k;
        if (bed < T[n]) {
          T[n] = bed;
          level[n] = bed + wd * k;
        }
      }
  }
  for (let c = 0; c < N; c++) {
    if (T[c] < SEA) level[c] = Math.max(level[c], SEA);
    else if (level[c] > -1e8 && level[c] - T[c] < .03) level[c] = -1e9;   /* a dry bank the stamp only grazed */
  }

  /* 4. flat pads for the sites, blended into the slope */
  for (const { r: [x, y, w, d] } of city.sites) {
    const pad = Math.max(SEA + 1.2, T[ix(Math.round((x + w / 2) / res), Math.round((y + d / 2) / res))]), m = 2, blend = 5;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const px = i * res, py = j * res, e = Math.hypot(Math.max(x - m - px, 0, px - (x + w + m)), Math.max(y - m - py, 0, py - (y + d + m)));
        if (e >= blend) continue;
        const k = smooth(1 - e / blend), c = ix(i, j);
        T[c] = T[c] + (pad - T[c]) * k;
        if (k > .3) level[c] = -1e9;
      }
  }

  /* colours: sea floor, sand, grass, forest, marsh, bare rock, snow */
  const hex = s => [1, 3, 5].map(a => parseInt(s.slice(a, a + 2), 16) / 255),
    P = { deep: hex('#2e5f80'), sand: hex('#d9c99a'), grass: hex('#78a35c'), forest: hex('#4b7a46'), marsh: hex('#5f8a5a'), alpine: hex('#9aa070'), rock: hex('#8d8c86'), snow: hex('#f3f7fa'), bed: hex('#7d8a74') },
    color = new Float32Array(N * 3), mix = (a, b, k) => a.map((v, n) => v + (b[n] - v) * k), sm = (a, b, v) => smooth((v - a) / (b - a));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = ix(i, j), h = T[c], x = i * res, y = j * res,
        gx = (T[ix(Math.min(i + 1, cols - 1), j)] - T[ix(Math.max(i - 1, 0), j)]) / (2 * res),
        gy = (T[ix(i, Math.min(j + 1, rows - 1))] - T[ix(i, Math.max(j - 1, 0))]) / (2 * res), sl = Math.hypot(gx, gy),
        g = fbm(x * .15, y * .15, seed + 5), snowline = peak * .72;
      let col;
      if (h < SEA) col = mix(P.sand, P.deep, sm(0, 7, SEA - h));
      else {
        col = mix(P.grass, P.forest, sm(.35, .65, g) * sm(3, 9, h));
        col = mix(col, P.alpine, sm(22, 32, h + 3 * (g - .5)));
        if (seep[c] && h < 10 && sl < .45) col = mix(col, P.marsh, .7);
        col = mix(col, P.rock, Math.max(sm(.7, 1.05, sl), sm(34, 44, h)));
        col = mix(col, P.snow, sm(snowline - 3, snowline + 3, h + 4 * (g - .5)) * (1 - sm(1.1, 1.6, sl)));
        col = mix(col, P.sand, sm(1.7, .6, h) * (1 - sm(.4, .9, sl)));
        if (level[c] > -1e8) col = mix(col, P.bed, .8);
      }
      color.set(col, c * 3);
    }
  let max = 0;
  for (let c = 0; c < N; c++) if (T[c] > max) max = T[c];
  return { cols, rows, res, z: T, max, level, color, island: true, sea: SEA, stats: { acc, seep, F, T0, wt } };
}

/* ---------- World generator: a continent from a seed ----------
   city.world = { seed, ... } makes a map too big for one grid (6000 x 6000 tiles is about a
   Skyrim). Two layers:
     macro   a coarse grid (12 tiles per cell) holding elevation, drainage and the water table. Elevation is
             analytic: ocean round the north, south and east coasts, an ice sheet in the north, desert in the
             south, forest in the west backed by a mountain range along the west edge, swamp in the east and
             one huge mountain in the middle. Priority-flood and flow accumulation (as in generateIsland) give
             lakes and rivers; the water table (a damped copy of the terrain) makes the swamp wet
     fine    ground(x, y) is the macro surface plus detail noise and a carved bowl along every macro river
             segment (the query point is domain-warped so rivers meander), swamp pools where the water table
             reaches the surface, and flat pads under the sites
   Detail comes in chunks of 33 x 33 vertices at three resolutions (64 tiles at 2 per cell: what you walk on;
   256 at 8; 1024 at 32: the whole map, always loaded), generated on demand and cached. Chunk edges share
   vertices, so they never tear. Sea level is 0. */
function boxBlur(src, cols, rows, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < rows; j++) {
    let acc = 0, n = 0;
    for (let i = -r; i < cols + r; i++) {
      const a = i + r, b = i - r - 1;
      if (a < cols) { acc += src[j * cols + a]; n++; }
      if (b >= 0) { acc -= src[j * cols + b]; n--; }
      if (i >= 0 && i < cols) tmp[j * cols + i] = acc / n;
    }
  }
  for (let i = 0; i < cols; i++) {
    let acc = 0, n = 0;
    for (let j = -r; j < rows + r; j++) {
      const a = j + r, b = j - r - 1;
      if (a < rows) { acc += tmp[a * cols + i]; n++; }
      if (b >= 0) { acc -= tmp[b * cols + i]; n--; }
      if (j >= 0 && j < rows) out[j * cols + i] = acc / n;
    }
  }
  return out;
}

/* Priority-flood drainage: F is the surface water settles to (depressions filled to their spill), down[c] the
   steepest-descent neighbour on it (-1 in the sea), acc[c] the flow through c given each cell's own source. */
function drainage(T, cols, rows, SEA, src) {
  const N = T.length, F = new Float32Array(N).fill(Infinity), seen = new Uint8Array(N), heap = new Int32Array(N + 2), EPS = 1e-3,
    nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let hs = 0;
  const push = c => {
    heap[++hs] = c;
    for (let k = hs; k > 1 && F[heap[k]] < F[heap[k >> 1]]; k >>= 1) { const a = heap[k]; heap[k] = heap[k >> 1]; heap[k >> 1] = a; }
  }, pop = () => {
    const top = heap[1];
    heap[1] = heap[hs--];
    for (let k = 1; ;) {
      const l = k * 2, r = l + 1;
      let m = k;
      if (l <= hs && F[heap[l]] < F[heap[m]]) m = l;
      if (r <= hs && F[heap[r]] < F[heap[m]]) m = r;
      if (m === k) break;
      const a = heap[k]; heap[k] = heap[m]; heap[m] = a;
      k = m;
    }
    return top;
  };
  for (let c = 0; c < N; c++) if (T[c] <= SEA) { F[c] = T[c]; seen[c] = 1; push(c); }
  while (hs) {
    const c = pop(), ci = c % cols, cj = (c / cols) | 0;
    for (const [a, b] of nb) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const n = j * cols + i;
      if (seen[n]) continue;
      seen[n] = 1;
      F[n] = Math.max(T[n], F[c] + EPS);
      push(n);
    }
  }
  const down = new Int32Array(N).fill(-1), acc = Float32Array.from(src), order = new Uint32Array(N);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      order[c] = c;
      if (T[c] <= SEA) continue;
      let best = 0;
      for (const [a, b] of nb) {
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni, s = (F[c] - F[n]) / (a && b ? 1.4142 : 1);
        if (s > best) { best = s; down[c] = n; }
      }
    }
  order.sort((a, b) => F[b] - F[a]);
  for (let k = 0; k < N; k++) { const c = order[k]; if (down[c] >= 0) acc[down[c]] += acc[c]; }
  return { F, down, acc };
}

const CHUNK = [64, 256, 1024], NV = 33;

function generateWorld(city) {
  const o = city.world, [W, D] = city.size, seed = o.seed ?? 1, MR = o.macro ?? 12, SEA = 0,
    mc = Math.ceil(W / MR) + 1, mr = Math.ceil(D / MR) + 1, N = mc * mr, cx = W * .5, cy = D * .5,
    Rm = o.mountainRadius ?? 1500, mountPeak = o.peak ?? 700, rangePeak = o.rangePeak ?? 560, thr = o.streamFlow ?? 650;
  const bw = new Float64Array(4);   /* ice, desert, swamp, forest: north, south, east, west */
  const biome = (x, y) => {
    const u = x / W, v = y / D, ice = smooth((v - .72) / .12), des = smooth((.3 - v) / .1), mid = (1 - ice) * (1 - des);
    bw[0] = ice; bw[1] = des; bw[2] = smooth((u - .66) / .1) * mid; bw[3] = smooth((.4 - u) / .1) * mid;
  };
  const baseElev = (x, y) => {
    const dn = Math.min(y, D - y, W - x) + 520 * (fbm(x * .0007, y * .0007, seed + 1) - .5),   /* distance to the open coasts */
      land = smooth((dn - 380) / 520);
    biome(x, y);
    let L = 16 + 16 * fbm(x * .0011, y * .0011, seed + 2) + bw[0] * 22 + bw[1] * 14 + bw[3] * 10;
    L += (2.2 - L) * bw[2] * .93;
    const rg = smooth((1100 - x) / 1100) ** 1.15 * (.4 + .6 * ridged(x * .0016, y * .0016, seed + 3)) * rangePeak,
      m = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / Rm),
      mount = mountPeak * (.55 * m * m * (3 - 2 * m) + .45 * m ** 1.6) * (.5 + .5 * ridged(x * .002, y * .002, seed + 4));
    return -45 + (L + rg + mount + 45) * land;
  };

  /* macro grid */
  const E = new Float32Array(N), rain = new Float32Array(N);
  for (let j = 0; j < mr; j++)
    for (let i = 0; i < mc; i++) {
      const x = i * MR, y = j * MR, c = j * mc + i, e = baseElev(x, y);
      E[c] = e;
      rain[c] = ((.35 + 1.1 * bw[3] + 1.4 * bw[2] + .5 * bw[0]) * (1 - .85 * bw[1]) + 1.2 * smooth(e / 500)) * (e > SEA ? 1 : 0);
    }
  const { F, down, acc } = drainage(E, mc, mr, SEA, rain);

  /* the water table: the terrain's blurred copy capped at the surface; where they meet the ground is wet */
  const wt = boxBlur(Float32Array.from(E, v => Math.max(v, SEA)), mc, mr, 6), wet = new Float32Array(N);
  for (let c = 0; c < N; c++) wet[c] = E[c] > SEA ? 1 - smooth((E[c] - Math.min(E[c], wt[c])) / 2.5) : 0;

  /* lakes: connected filled depressions at least 2 deep and 8 cells big */
  const lakeL = new Float32Array(N).fill(-1e9), lab = new Uint8Array(N), nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let c = 0; c < N; c++) {
    if (lab[c] || !(F[c] - E[c] > 2 && E[c] > SEA + 1)) continue;
    const stack = [c], cells = [];
    lab[c] = 1;
    while (stack.length) {
      const q = stack.pop();
      cells.push(q);
      for (const [a, b] of nb) {
        const i = (q % mc) + a, j = ((q / mc) | 0) + b;
        if (i < 0 || j < 0 || i >= mc || j >= mr) continue;
        const n = j * mc + i;
        if (!lab[n] && F[n] - E[n] > 2 && E[n] > SEA + 1) { lab[n] = 1; stack.push(n); }
      }
    }
    if (cells.length >= 8) for (const q of cells) lakeL[q] = F[q];
  }
  const rivR = new Float32Array(N);   /* river strength: flow over the stream threshold, 0 where there is no river */
  let rivers = 0;
  for (let c = 0; c < N; c++) if (E[c] > SEA && lakeL[c] < -1e8 && acc[c] >= thr && down[c] >= 0) { rivR[c] = acc[c] / thr; rivers++; }

  /* ---- fine ground ---- */
  const bil = (A, x, y) => {
    const fx = Math.min(Math.max(x / MR, 0), mc - 1.0001), fy = Math.min(Math.max(y / MR, 0), mr - 1.0001),
      i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * mc + i;
    return (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + mc] * (1 - u) + A[k + mc + 1] * u) * v;
  };
  /* flat pads: one per city.pads rect (a whole city), else one per site */
  const G = { level: -1e9 }, sites = (city.pads || city.sites.map(q => q.r)).map(r => ({ r, pad: 0 })), roads = city.roads || [];
  let net = null;   /* highways and railroads, built once ground() exists (see below) */
  const R = { kind: -1, d: 1e9, h: 0, s: 0 };
  const ground = (x, y, noPad, noRoad) => {
    let h = bil(E, x, y);
    G.level = -1e9;
    G.rd = 1e9; G.rk = -1; G.rs = 0;
    biome(x, y);
    const des = bw[1], swa = bw[2], mtn = smooth((h - 60) / 400), amp = (1.8 + 11 * mtn) * (1 - .75 * swa);
    h += (fbm(x * .021, y * .021, seed + 11, 4) - .5) * 2 * amp + (ridged(x * .006, y * .006, seed + 12, 3) - .6) * 14 * mtn +
      des * 5 * (ridged(x * .01, y * .014, seed + 13, 2) - .6) + (fbm(x * .17, y * .17, seed + 14, 2) - .5) * (1 - mtn * .5);
    /* lakes: the filled level of the nearest macro cells, wherever the ground is below it */
    const i0 = Math.min(mc - 2, Math.max(0, Math.floor(x / MR))), j0 = Math.min(mr - 2, Math.max(0, Math.floor(y / MR))), k0 = j0 * mc + i0,
      ll = Math.max(lakeL[k0], lakeL[k0 + 1], lakeL[k0 + mc], lakeL[k0 + mc + 1]);
    if (ll > -1e8 && h < ll) G.level = ll;
    if (h < SEA) G.level = Math.max(G.level, SEA);
    /* swamp pools: where the water table is at the surface the ground is a mosaic of shallow ponds */
    if (swa > .05 && h > SEA + .3) {
      const th = .08 + .2 * swa + .12 * bil(wet, x, y), pn = fbm(x * .03, y * .03, seed + 8, 3);
      if (pn < th) {
        const lv = h - .1;
        h -= 1.3 * smooth((th - pn) / .12);
        if (lv - h > .03) G.level = Math.max(G.level, lv);
      }
    }
    /* rivers: bowls along the macro flow segments, meandering because the query is warped */
    if (h > SEA - 1) {
      const wx = x + 22 * (fbm(x * .011, y * .011, seed + 21, 2) - .5) * 2, wy = y + 22 * (fbm(x * .011, y * .011, seed + 22, 2) - .5) * 2,
        ci = Math.floor(x / MR), cj = Math.floor(y / MR);
      let best = h, lvl = -1e9;
      for (let j = cj - 1; j <= cj + 2; j++)
        for (let i = ci - 1; i <= ci + 2; i++) {
          if (i < 0 || j < 0 || i >= mc || j >= mr) continue;
          const c = j * mc + i, r = rivR[c];
          if (r === 0) continue;
          const d = down[c], ax = i * MR, ay = j * MR, vx = (d % mc) * MR - ax, vy = ((d / mc) | 0) * MR - ay,
            t = Math.min(1, Math.max(0, ((wx - ax) * vx + (wy - ay) * vy) / (vx * vx + vy * vy))),
            rr = rivR[d] > 0 ? r + (rivR[d] - r) * t : r, w = 1.2 + .7 * Math.sqrt(rr), rad = w * 1.8,
            dist = Math.hypot(wx - ax - vx * t, wy - ay - vy * t);
          if (dist >= rad) continue;
          const wd = .3 * Math.sqrt(rr), k = 1 - (dist / rad) ** 2, bed = h - 1.33 * wd * k;
          if (bed < best) { best = bed; lvl = bed + wd * k; }
        }
      if (lvl > -1e8) { h = best; if (lvl > G.level) G.level = lvl; }
    }
    /* highways and railroads: the ground follows the route's own smoothed profile inside its core and blends back
       to the land beside it; water under the road is cleared (a causeway where it crosses a river) */
    if (net && !noRoad) {
      roadQuery(x, y);
      if (R.kind >= 0) {
        const hw = ROAD_HW[R.kind], bwid = ROAD_BW[R.kind];
        if (R.d < hw + bwid) {
          const k = R.d <= hw ? 1 : smooth(1 - (R.d - hw) / bwid);
          h += (R.h - h) * k;
          if (k > .45) G.level = -1e9;
        }
        G.rd = R.d; G.rk = R.kind; G.rs = R.s;
      }
    }
    if (!noPad)
      for (const q of sites) {
        const [rx, ry, rw, rd] = q.r, e = Math.hypot(Math.max(rx - 3 - x, 0, x - (rx + rw + 3)), Math.max(ry - 3 - y, 0, y - (ry + rd + 3)));
        if (e >= 14) continue;
        if (!q.pad) {   /* the pad is the average ground under its rect */
          let sum = 0, n = 0;
          for (let b = 0; b <= 6; b++) for (let a = 0; a <= 8; a++) { sum += ground(rx + rw * a / 8, ry + rd * b / 6, true, true); n++; }
          q.pad = Math.max(SEA + 1.5, sum / n);
        }
        const k = smooth(1 - e / 14);
        h += (q.pad - h) * k;
        if (k > .3) G.level = -1e9;
      }
    return h;
  };


  /* ---- highways and railroads ----
     city.routes = [{ kind: 'highway' | 'rail', from: 'City', to: 'City' }]. Each is an A* path over the macro grid
     that keeps off the sea, lakes, steep ground and mountains and pays extra to cross a river (rails also pay to
     run beside a highway), from one city's pad edge to another's. The path is smoothed, its height profile is the
     terrain's height averaged over +-80 tiles (so grades stay gentle) pinned to the two pad heights at the ends, and
     it goes into a grid of segments that ground() asks about. */
  const ROAD_HW = [6, 3.5], ROAD_BW = [10, 6];
  const roadQuery = (x, y) => {
    R.kind = -1; R.d = 1e9;
    if (!net) return;
    const list = net.grid.get(Math.floor(y / 64) * 1024 + Math.floor(x / 64));
    if (!list) return;
    let bestM = 1e9;
    for (const i of list) {
      const o = i * 9, ax = net.seg[o], ay = net.seg[o + 1], vx = net.seg[o + 2] - ax, vy = net.seg[o + 3] - ay,
        t = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy))), d = Math.hypot(x - ax - vx * t, y - ay - vy * t), kind = net.seg[o + 6], m = d - ROAD_HW[kind];
      if (m < bestM) { bestM = m; R.kind = kind; R.d = d; R.h = net.seg[o + 4] + (net.seg[o + 5] - net.seg[o + 4]) * t; R.s = net.seg[o + 7] + net.seg[o + 8] * t; }
    }
  };
  const buildNet = () => {
    const routes = city.routes || [];
    if (!routes.length) return null;
    const places = Object.fromEntries((city.places || []).map(q => [q.name, q.at])), padOf = at => (city.pads || []).find(([px, py, pw, pd]) => at[0] >= px && at[0] <= px + pw && at[1] >= py && at[1] <= py + pd),
      padHeight = r => {
        const q = sites.find(s => s.r === r);
        if (!q.pad) ground(r[0] + 1, r[1] + 1, false);   /* computes and caches it */
        return q.pad;
      };
    const slope = new Float32Array(N), hwNear = new Uint8Array(N), kinds = { highway: 0, rail: 1 };
    for (let j = 1; j < mr - 1; j++) for (let i = 1; i < mc - 1; i++) { const c = j * mc + i; slope[c] = Math.hypot(E[c + 1] - E[c - 1], E[c + mc] - E[c - mc]) / (2 * MR); }
    const exit = (name, other, kind) => {   /* where a route leaves a city's pad: the end of an avenue (highway) or side street (rail) */
      const a = places[name], b = places[other], [px, py, pw, pd] = padOf(a), dx = b[0] - a[0], dy = b[1] - a[1], ew = Math.abs(dx) * pd > Math.abs(dy) * pw, hi = kind === 'highway';
      return ew ? [dx > 0 ? px + pw : px, py + (hi ? 66 : 28)] : [px + (hi ? 86 : 36), dy > 0 ? py + pd : py];
    };
    const astar = (s, g, rail) => {
      const idx = p => Math.min(mr - 1, Math.max(0, Math.round(p[1] / MR))) * mc + Math.min(mc - 1, Math.max(0, Math.round(p[0] / MR))), s0 = idx(s), g0 = idx(g),
        gs = new Float32Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N), fs = new Float32Array(N), heap = new Int32Array(N + 2),
        gx = g0 % mc, gy = (g0 / mc) | 0;
      let hs = 0;
      const push = c => { heap[++hs] = c; for (let k = hs; k > 1 && fs[heap[k]] < fs[heap[k >> 1]]; k >>= 1) { const a = heap[k]; heap[k] = heap[k >> 1]; heap[k >> 1] = a; } },
        pop = () => { const top = heap[1]; heap[1] = heap[hs--]; for (let k = 1; ;) { const l = k * 2, r = l + 1; let m = k; if (l <= hs && fs[heap[l]] < fs[heap[m]]) m = l; if (r <= hs && fs[heap[r]] < fs[heap[m]]) m = r; if (m === k) break; const a = heap[k]; heap[k] = heap[m]; heap[m] = a; k = m; } return top; };
      gs[s0] = 0; fs[s0] = 0; push(s0);
      while (hs) {
        const c = pop();
        if (closed[c]) continue;
        closed[c] = 1;
        if (c === g0) break;
        const ci = c % mc, cj = (c / mc) | 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          if (!a && !b) continue;
          const i = ci + a, j = cj + b;
          if (i < 1 || j < 1 || i >= mc - 1 || j >= mr - 1) continue;
          const n = j * mc + i;
          if (closed[n]) continue;
          const nearEnd = Math.hypot(i - gx, j - gy) < 20 || Math.hypot(i - (s0 % mc), j - ((s0 / mc) | 0)) < 20;
          if (!nearEnd && (E[n] <= 1.2 || lakeL[n] > -1e8 || E[n] > 220)) continue;   /* the swamp is only ~2 above the sea */
          const sl = slope[n] * 9, pen = sl * sl + (rivR[n] > 0 ? 25 : 0) + (rail && hwNear[n] && !nearEnd ? 4 : 0), step = (a && b ? 1.4142 : 1) * (1 + pen), ng = gs[c] + step;
          if (ng < gs[n]) { gs[n] = ng; par[n] = c; fs[n] = ng + Math.hypot(i - gx, j - gy); push(n); }
        }
      }
      if (par[g0] < 0 && g0 !== s0) return null;
      const path = [];
      for (let c = g0; c >= 0; c = par[c]) path.push([(c % mc) * MR, ((c / mc) | 0) * MR]);
      return path.reverse();
    };
    const smoothPath = (path, s, g) => {
      let q = [s, ...path.slice(1, -1), g];
      for (let it = 0; it < 3; it++) q = q.map((p, i) => i === 0 || i === q.length - 1 ? p : [(q[i - 1][0] + p[0] * 2 + q[i + 1][0]) / 4, (q[i - 1][1] + p[1] * 2 + q[i + 1][1]) / 4]);
      for (let it = 0; it < 2; it++) {   /* Chaikin corner cutting */
        const o = [q[0]];
        for (let i = 0; i < q.length - 1; i++) o.push([q[i][0] * .75 + q[i + 1][0] * .25, q[i][1] * .75 + q[i + 1][1] * .25], [q[i][0] * .25 + q[i + 1][0] * .75, q[i][1] * .25 + q[i + 1][1] * .75]);
        o.push(q[q.length - 1]);
        q = o;
      }
      const out = [q[0]];   /* resample every ~10 tiles */
      let acc = 0;
      for (let i = 1; i < q.length; i++) {
        acc += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
        if (acc >= 10 || i === q.length - 1) { out.push(q[i]); acc = 0; }
      }
      return out;
    };
    const segs = [], rails = [], polylines = [];
    for (const kindName of ['highway', 'rail'])
      for (const rt of routes.filter(r => r.kind === kindName)) {
        const s = exit(rt.from, rt.to, kindName), g = exit(rt.to, rt.from, kindName), raw = astar(s, g, kindName === 'rail');
        if (!raw) continue;
        const pts = smoothPath(raw, s, g), n = pts.length, h0 = pts.map(p => ground(p[0], p[1], true, true)), hs = h0.map((_, i) => { let sum = 0, c = 0; for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) { sum += h0[k]; c++; } return sum / c; }),
          pa = padHeight(padOf(places[rt.from])), pb = padHeight(padOf(places[rt.to]));
        const prof = hs.map((v, i) => { const w0 = smooth(1 - i / 12), w1 = smooth(1 - (n - 1 - i) / 12); return Math.max(SEA + 1.5, v + (pa - v) * w0 + (pb - v) * w1); });
        polylines.push({ kind: kinds[kindName], pts, prof, from: rt.from, to: rt.to });
        if (kindName === 'highway') for (const p of pts) for (let j = Math.max(0, Math.round(p[1] / MR) - 3); j <= Math.min(mr - 1, Math.round(p[1] / MR) + 3); j++) for (let i = Math.max(0, Math.round(p[0] / MR) - 3); i <= Math.min(mc - 1, Math.round(p[0] / MR) + 3); i++) hwNear[j * mc + i] = 1;
        else rails.push(pts);
      }
    const seg = new Float64Array(polylines.reduce((a, pl) => a + pl.pts.length - 1, 0) * 9), grid = new Map();
    let si = 0, total = 0;
    for (const pl of polylines) {
      let s = 0;
      for (let i = 0; i < pl.pts.length - 1; i++) {
        const [ax, ay] = pl.pts[i], [bx, by] = pl.pts[i + 1], len = Math.hypot(bx - ax, by - ay), o = si * 9;
        seg.set([ax, ay, bx, by, pl.prof[i], pl.prof[i + 1], pl.kind, s, len], o);
        s += len;
        const pad = ROAD_HW[pl.kind] + ROAD_BW[pl.kind] + 2;
        for (let cj = Math.floor((Math.min(ay, by) - pad) / 64); cj <= Math.floor((Math.max(ay, by) + pad) / 64); cj++)
          for (let ci = Math.floor((Math.min(ax, bx) - pad) / 64); ci <= Math.floor((Math.max(ax, bx) + pad) / 64); ci++) {
            const key = cj * 1024 + ci;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(si);
          }
        si++;
      }
      total += s;
    }
    return { seg, grid, rails, polylines, length: total };
  };
  net = buildNet();

  /* ---- colours ---- */
  const hex = s => [1, 3, 5].map(a => parseInt(s.slice(a, a + 2), 16) / 255),
    P = { grass: hex('#6f9a52'), forest: hex('#3f6f3c'), swamp: hex('#556b44'), sand: hex('#d9bf86'), snow: hex('#eef4f8'), ice: hex('#bcd8e8'), rock: hex('#8a8984'),
      mud: hex('#6a6a48'), road: hex('#5d6067'), asphalt: hex('#4b4e54'), line: hex('#e3c64a'), shoulder: hex('#8b8a84'), ballast: hex('#857c6b'), deep: hex('#2e5f80'), bed: hex('#7d8a74'), water: hex('#4f93bd') },
    mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k], sm = (a, b, v) => smooth((v - a) / (b - a));
  const paint = (x, y, h, sl, lv, lod, out, k, rd, rk, rs) => {
    biome(x, y);
    const ice = bw[0], des = bw[1], swa = bw[2], fo = bw[3], g = fbm(x * .05, y * .05, seed + 5, 2), snowline = 420 - 400 * ice;
    let col = mix(P.grass, P.forest, fo * (.5 + .5 * g));
    col = mix(col, P.swamp, swa);
    col = mix(col, P.sand, des);
    col = mix(col, ice > .5 && g > .55 ? P.ice : P.snow, ice * (.8 + .2 * g));
    col = mix(col, P.rock, Math.max(sm(.75, 1.1, sl), sm(220, 420, h)) * (1 - ice * .5));
    col = mix(col, P.snow, sm(snowline - 30, snowline + 30, h + 20 * (g - .5)) * (1 - sm(1.2, 1.7, sl)));
    col = mix(col, mix(P.sand, mix(P.snow, P.mud, swa), Math.max(ice, swa)), sm(2.2, .6, h));
    if (h >= SEA && !(lv > -1e8 && lv - h > .03)) for (const [rx, ry, rw, rd] of roads) if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rd) { col = P.road; break; }
    if (rk >= 0 && h >= SEA && !(lv > -1e8 && lv - h > .03)) {   /* highway: asphalt, shoulders, a dashed centre line; rail: ballast */
      if (rk === 0) { if (rd < 5.6) col = rd < 1.3 && rs % 16 < 8 ? P.line : P.asphalt; else if (rd < 7.4) col = P.shoulder; }
      else if (rd < 3.4) col = P.ballast;
    }
    if (h < SEA) col = mix(P.sand, P.deep, sm(0, 40, SEA - h));
    else if (lv > -1e8 && lv - h > .03) col = lod ? mix(col, P.water, .85) : mix(col, P.bed, .8);
    out[k] = col[0]; out[k + 1] = col[1]; out[k + 2] = col[2];
  };

  /* ---- chunks ---- */
  const chunks = [new Map(), new Map(), new Map()], tmp = [0, 0, 0];
  const chunkGen = (lod, qx, qy) => {
    const size = CHUNK[lod], res = size / (NV - 1), z = new Float32Array(NV * NV), level = new Float32Array(NV * NV), color = new Float32Array(NV * NV * 3),
      rd = new Float32Array(NV * NV), rk = new Int8Array(NV * NV), rs = new Float32Array(NV * NV);
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NV; i++) { const k = j * NV + i; z[k] = ground(qx * size + i * res, qy * size + j * res); level[k] = G.level; rd[k] = G.rd; rk[k] = G.rk; rs[k] = G.rs; }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NV; i++) {
        const k = j * NV + i, gx = (z[j * NV + Math.min(i + 1, NV - 1)] - z[j * NV + Math.max(i - 1, 0)]) / (2 * res),
          gy = (z[Math.min(j + 1, NV - 1) * NV + i] - z[Math.max(j - 1, 0) * NV + i]) / (2 * res);
        paint(qx * size + i * res, qy * size + j * res, z[k], Math.hypot(gx, gy), level[k], lod, color, k * 3, rd[k], rk[k], rs[k]);
      }
    return { z, level, color, size, res, qx, qy };
  };
  const getChunk = (lod, qx, qy) => {
    const m = chunks[lod], key = qx * 65536 + qy;
    let c = m.get(key);
    if (!c) {
      c = chunkGen(lod, qx, qy);
      m.set(key, c);
      if (lod === 0 && m.size > 1500) { let n = 0; for (const k of m.keys()) { m.delete(k); if (++n > 300) break; } }
    }
    return c;
  };
  const at = (x, y) => {
    x = Math.min(Math.max(x, 0), W); y = Math.min(Math.max(y, 0), D);
    const qx = Math.floor(x / 64), qy = Math.floor(y / 64), c = getChunk(0, qx, qy), fx = (x - qx * 64) / 2, fy = (y - qy * 64) / 2,
      i = Math.min(NV - 2, fx | 0), j = Math.min(NV - 2, fy | 0), u = fx - i, v = fy - j, z = c.z, k = j * NV + i;
    return (z[k] * (1 - u) + z[k + 1] * u) * (1 - v) + (z[k + NV] * (1 - u) + z[k + NV + 1] * u) * v;
  };
  const levelAt = (x, y) => {
    x = Math.min(Math.max(x, 0), W); y = Math.min(Math.max(y, 0), D);
    const qx = Math.floor(x / 64), qy = Math.floor(y / 64), c = getChunk(0, qx, qy);
    return c.level[Math.min(NV - 1, Math.round((y - qy * 64) / 2)) * NV + Math.min(NV - 1, Math.round((x - qx * 64) / 2))];
  };
  return { world: true, island: true, sea: SEA, at, levelAt, getChunk, W, D, max: mountPeak, rails: net ? net.rails : [], net, biomeAt: (x, y) => (biome(x, y), Array.from(bw)),
    stats: { E, F, down, acc, rivR, lakeL, wet, mc, mr, MR, rivers, ground, G } };
}

/* The city's grid, or null if its ground is flat. */
const terrain = (city, rebuild) => {
  if (rebuild || city._hm === undefined) {
    /* an island takes ~0.5 s to generate, so a restart reuses it while its config and sites are unchanged */
    const key = city.island || city.world ? JSON.stringify([city.island, city.world, city.size, city.sites.map(q => q.r), city.pads, city.roads, city.routes]) : null;
    if (!(key && city._hm && city._hmKey === key)) {
      city._hm = buildHeightmap(city);
      city._hmKey = key;
    }
  }
  return city._hm;
};

const heightAt = (hm, x, y) => {
  if (hm.at) return hm.at(x, y);
  const fx = Math.min(Math.max(x / hm.res, 0), hm.cols - 1), fy = Math.min(Math.max(y / hm.res, 0), hm.rows - 1),
    i = Math.min(Math.floor(fx), hm.cols - 2), j = Math.min(Math.floor(fy), hm.rows - 2),
    u = fx - i, v = fy - j, z = hm.z, c = hm.cols, k = j * c + i;
  return (z[k] * (1 - u) + z[k + 1] * u) * (1 - v) + (z[k + c] * (1 - u) + z[k + c + 1] * u) * v;
};

/* Height of the ground at (x, y) in the scene the state is in. */
const groundZ = (s, x, y) => {
  if (s.scene != 'city') return 0;
  if (s.city.mountains && (x < 0 || y < 0 || x > s.city.size[0] || y > s.city.size[1])) return mountainHeight(s.city, x, y);
  const hm = terrain(s.city);
  return hm ? heightAt(hm, x, y) : 0;
};

(window.GSA = window.GSA || {}).physics = { RC, WH, hit, mv, steerTowards, shove, terrain, groundZ, mountainHeight, valleyWall, wallCrest, fbm, wet, steep, inTerrain, CHUNK, NV, hash2 };