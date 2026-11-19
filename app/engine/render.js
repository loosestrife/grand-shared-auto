// /engine/render.js
/* Three.js: static geometry per scene, one mesh per edict that has
   something to show, the follow camera. Reads the state and never changes it,
   apart from the camera-shake timer.

   World coordinates are east, north, up (x, y, z), right-handed. Three.js is y-up,
   so a world point (x, y, z) is drawn at three.js (x, z, -y): east stays +x, up
   becomes +y, north becomes -z (the way a three.js camera looks by default).
   Headings are compass bearings, so a model that faces +z in its own space turns to
   face bearing h with rotation.y = PI - h.

   Edicts that have something to show (actors, items, projectiles, vehicles) own a
   `.mesh`, created here on first sight and freed with release(e). The player's avatar
   is the group `pm`, posed from the player's heading, pitch and zscale. */

let ren, sc, cam, grp, beamM, shock, impacts = [];
const pm = new THREE.Group();
pm.rotation.order = 'YXZ';   /* turn first, then tilt about the avatar's own x axis */

const init = canvas => {
  ren = new THREE.WebGLRenderer({ canvas, antialias: true });
  ren.setSize(W, H, false);
  sc = new THREE.Scene();
  sc.add(new THREE.AmbientLight(0xffffff, .7));
  const dl = new THREE.DirectionalLight(0xffffff, .7);
  dl.position.set(8, 20, -6);
  sc.add(dl);
  cam = new THREE.PerspectiveCamera(50, W / H, .1, 300);
};

/* The CSS colour tokens, read live so a theme change shows up on the next rebuild. */
const tok = () => Object.fromEntries(['bg', 'ground', 'bld', 'fg', 'acc', 'cop', 'bad'].map(n => [n, getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim()]));

/* A mesh at a position in the parent's own (three.js) space. Model builders use this. */
/* Parts [geometry, colour, x, y, z] as one geometry with vertex colours. */
const mergeParts = parts => {
  const pos = [], nor = [], col = [], ind = [], c = new THREE.Color();
  for (const [g, color, ox, oy, oz] of parts) {
    const p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
    c.set(color);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + ox, p.getY(i) + oy, p.getZ(i) + oz); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); }
    if (g.index) for (const k of g.index.array) ind.push(base + k);
    else for (let i = 0; i < p.count; i++) ind.push(base + i);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  m.setIndex(ind);
  return m;
};
const vehicleMat = new THREE.MeshLambertMaterial({ vertexColors: true });

const addMesh = (parent, geo, color, x, y, z) => {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};

/* A mesh at a world position (x east, y north, z up). */
const put = (parent, geo, color, x, y, z) => addMesh(parent, geo, color, x, z, -y);

const lab = (t, col) => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const x = c.getContext('2d');
  x.font = 'bold 24px sans-serif';
  x.fillStyle = col;
  x.textAlign = 'center';
  x.fillText(t, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  s.scale.set(8, 1.5, 1);
  return s;
};

/* Rebuild the avatar for a race. */
const setRace = race => {
  while (pm.children.length) pm.remove(pm.children[0]);
  race.build((g, c, x, y, z) => addMesh(pm, g, c, x, y, z));
};

/* Free an edict's mesh (called when it is removed). */
const release = e => {
  if (!e.mesh) return;
  if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
  e.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  e.mesh = null;
};

/* A short-lived ring where a bolt hit a wall. */
const spawnImpactEffect = (x, y) => {
  const m = put(grp, new THREE.RingGeometry(.2, .3, 16), '#ffd166', x, y, .06);
  m.rotation.x = -Math.PI / 2;
  m.material.transparent = true;
  impacts.push({ m, t: 0 });
};

/* The heightmap as a mesh: one vertex per grid sample, shaded by height so a kerb reads. */
const terrainMesh = (city, C) => {
  const hm = GSA.physics.terrain(city), W = (hm.cols - 1) * hm.res, D = (hm.rows - 1) * hm.res,
    geo = new THREE.PlaneGeometry(W, D, hm.cols - 1, hm.rows - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(W / 2, 0, -D / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), t = new THREE.Color(),
    lo = new THREE.Color(C.ground), hi = lo.clone().lerp(new THREE.Color(C.fg), .14);
  for (let iy = 0; iy < hm.rows; iy++)
    for (let ix = 0; ix < hm.cols; ix++) {
      const i = iy * hm.cols + ix, h = hm.z[(hm.rows - 1 - iy) * hm.cols + ix];   /* plane row 0 is the north edge */
      pos.setY(i, h);
      if (hm.color) {   /* a generated island brings its own colours (sea floor, sand, grass, rock, snow) */
        const k = ((hm.rows - 1 - iy) * hm.cols + ix) * 3;
        col[i * 3] = hm.color[k];
        col[i * 3 + 1] = hm.color[k + 1];
        col[i * 3 + 2] = hm.color[k + 2];
      } else t.copy(lo).lerp(hi, hm.max ? Math.min(1, h / hm.max) : 0).toArray(col, i * 3);
    }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
};

/* The water as one translucent surface over the same grid: a vertex with water is lifted to the water
   level, any other sits just under the ground, so the shore is where the two surfaces cross. Shallow
   water is pale and deep water dark. */
const waterMesh = city => {
  const hm = GSA.physics.terrain(city), W = (hm.cols - 1) * hm.res, D = (hm.rows - 1) * hm.res,
    geo = new THREE.PlaneGeometry(W, D, hm.cols - 1, hm.rows - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(W / 2, 0, -D / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), shallow = new THREE.Color('#8fd0e0'), deep = new THREE.Color('#1d5f93'), t = new THREE.Color();
  for (let iy = 0; iy < hm.rows; iy++)
    for (let ix = 0; ix < hm.cols; ix++) {
      const i = iy * hm.cols + ix, c = (hm.rows - 1 - iy) * hm.cols + ix, L = hm.level[c], depth = L - hm.z[c];
      pos.setY(i, L > -1e8 && depth > .03 ? L : hm.z[c] - .4);
      t.copy(shallow).lerp(deep, smoothstep(0, 5, depth)).toArray(col, i * 3);
    }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .8, depthWrite: false }));
};

/* The mountains outside the map: a coarse mesh (1 tile per cell) starting at the crest of the
   valley wall, plus the wall itself. The triangles over the valley are cut out, so the wall is
   a true vertical step at the map edge and the player can stand against it. Coloured by
   height: valley rock, darker rock, snow. */
const mountainMesh = (city, C) => {
  const m = city.mountains, [MW, MD] = city.size, R = (m.reach ?? 90) + 10, cell = 1,
    nx = Math.ceil((MW + 2 * R) / cell), ny = Math.ceil((MD + 2 * R) / cell),
    geo = new THREE.PlaneGeometry(nx * cell, ny * cell, nx, ny);
  geo.rotateX(-Math.PI / 2);
  geo.translate(-R + nx * cell / 2, 0, R - ny * cell / 2);   /* world x from -R, world y from -R */
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), t = new THREE.Color(),
    low = new THREE.Color(C.ground).lerp(new THREE.Color(C.bld), .8), rock = new THREE.Color(C.bld).multiplyScalar(.6),
    snow = new THREE.Color('#f4f8fb'), peak = m.peak ?? 60, E = 1e-6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = -pos.getZ(i), inside = x >= 0 && y >= 0 && x <= MW && y <= MD,
      /* a vertex on the map edge takes the height just outside it: the top of the wall */
      h = inside ? ((x == 0 || y == 0 || x == MW || y == MD)
        ? mountainHeight(city, x <= 0 ? x - E : x >= MW ? x + E : x, y <= 0 ? y - E : y >= MD ? y + E : y) : 0)
        : mountainHeight(city, x, y), u = h / peak;
    pos.setY(i, h);
    t.copy(low).lerp(rock, smoothstep(0, .3, u)).lerp(snow, smoothstep(.55, .8, u)).toArray(col, i * 3);
  }
  const src = geo.index.array, keep = [];
  for (let k = 0; k < src.length; k += 3) {   /* drop triangles over the valley floor */
    const cx = (pos.getX(src[k]) + pos.getX(src[k + 1]) + pos.getX(src[k + 2])) / 3,
      cy = -(pos.getZ(src[k]) + pos.getZ(src[k + 1]) + pos.getZ(src[k + 2])) / 3;
    if (!(cx > 0 && cx < MW && cy > 0 && cy < MD)) keep.push(src[k], src[k + 1], src[k + 2]);
  }
  geo.setIndex(keep);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  g.add(wallMesh(city, C));
  return g;
};

/* The valley wall: a vertical sheet along each map edge from the floor up to wallCrest, 0.5
   tile columns by 16 rows. Noise pushes patches of it outward (never into the valley) and tints
   it in bands, so it reads as rough stone without ever standing off from the player. */
const wallMesh = (city, C) => {
  const [MW, MD] = city.size, seed = city.mountains.seed ?? 1, NV = 16,
    dark = new THREE.Color(C.bld).multiplyScalar(.7), lite = new THREE.Color(C.bld).lerp(new THREE.Color('#ffffff'), .15), t = new THREE.Color(),
    edges = [[0, 0, 1, 0, 0, -1, MW], [0, MD, 1, 0, 0, 1, MW], [0, 0, 0, 1, -1, 0, MD], [MW, 0, 0, 1, 1, 0, MD]],   /* start, along, outward, length */
    pos = [], col = [], idx = [];
  for (const [ax, ay, ux, uy, ox, oy, L] of edges) {
    const nu = Math.ceil(L / .5), base = pos.length / 3;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu * L, bx = ax + ux * u, by = ay + uy * u, crest = GSA.physics.wallCrest(city, bx, by);
      for (let j = 0; j <= NV; j++) {
        const z = j / NV * crest,
          fade = smoothstep(0, 2, z) * (1 - smoothstep(crest - 1.5, crest, z)) * smoothstep(0, 2, Math.min(u, L - u)),
          off = fade * .35 * smoothstep(.4, .7, GSA.physics.fbm(u * .5, z * .6, seed + 21));
        pos.push(bx + ox * off, z, -(by + oy * off));
        t.copy(dark).lerp(lite, GSA.physics.fbm(u * .6 + 3, z * 1.4, seed + 33)).toArray(col, col.length);
      }
    }
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
};
const smoothstep = (a, b, x) => { const k = Math.min(Math.max((x - a) / (b - a), 0), 1); return k * k * (3 - 2 * k); };

/* The world as chunks at three levels of detail (see generateWorld): 64-tile chunks round the player (what you
   walk on), 256-tile chunks further out, and 1024-tile chunks for the whole continent, always there. A finer chunk
   is drawn over the coarser one under it (the coarser sits 1 and 4 tiles lower, which hides the seams). A few chunks
   are made per frame, nearest first, and far ones dropped. Near chunks also get water (lakes, rivers, swamp pools)
   and instanced trees, cacti and swamp trees; the sea is one big plane. */
const worldView = (city, C, grp, pl) => {
  const hm = GSA.physics.terrain(city), { CHUNK, NV, hash2 } = GSA.physics, [W, D] = city.size, seed = city.world.seed ?? 1,
    OFF = [0, -1, -4], RAD = [5, 4, 99], NX = CHUNK.map(s => Math.ceil(W / s)), NY = CHUNK.map(s => Math.ceil(D / s)),
    wg = new THREE.Group(), maps = [new Map(), new Map(), new Map()], dummy = new THREE.Object3D(),
    tMat = new THREE.MeshLambertMaterial({ vertexColors: true }), dMat = new THREE.MeshLambertMaterial({ vertexColors: true }),
    wMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .8, depthWrite: false }),
    idx = (() => {
      const a = [];
      for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NV - 1; i++) { const k = j * NV + i; a.push(k, k + 1, k + NV, k + 1, k + NV + 1, k + NV); }
      return new THREE.BufferAttribute(new Uint16Array(a), 1);
    })();
  grp.add(wg);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(W + 24000, D + 24000), new THREE.MeshLambertMaterial({ color: '#2a6a9a', transparent: true, opacity: .9, depthWrite: false }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(W / 2, 0, -D / 2);
  wg.add(sea);

  const merge = parts => {
    const pos = [], nor = [], col = [], ind = [];
    for (const [g, color, ox, oy, oz] of parts) {
      const c = new THREE.Color(color), p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + ox, p.getY(i) + oy, p.getZ(i) + oz); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c.r, c.g, c.b); }
      for (const k of g.index.array) ind.push(base + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind);
    return g;
  };
  const kinds = [
    merge([[new THREE.CylinderGeometry(.18, .24, 1.4, 5), '#5a4030', 0, .7, 0], [new THREE.ConeGeometry(1.1, 3.8, 7), '#2f5f35', 0, 3.2, 0]]),
    merge([[new THREE.CylinderGeometry(.35, .4, 3, 6), '#4f8a3f', 0, 1.5, 0], [new THREE.CylinderGeometry(.2, .2, 1.2, 5), '#4f8a3f', .6, 2, 0], [new THREE.CylinderGeometry(.2, .2, 1, 5), '#4f8a3f', -.55, 1.5, 0]]),
    merge([[new THREE.CylinderGeometry(.22, .3, 2.2, 5), '#4a3a2a', 0, 1.1, 0], [new THREE.SphereGeometry(1.6, 6, 4), '#46603a', 0, 3.1, 0]])
  ];

  const mkTerrain = (c, lod) => {
    const pos = new Float32Array(NV * NV * 3);
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NV; i++) {
        const k = j * NV + i;
        pos[k * 3] = c.qx * c.size + i * c.res;
        pos[k * 3 + 1] = c.z[k] + OFF[lod];
        pos[k * 3 + 2] = -(c.qy * c.size + j * c.res);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c.color, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, tMat);
  };
  const shallow = new THREE.Color('#8fd0e0'), deep = new THREE.Color('#1d5f93'), tc = new THREE.Color();
  const mkWater = c => {   /* lakes, rivers and pools; the sea (level 0) is the plane */
    const pos = new Float32Array(NV * NV * 3), col = new Float32Array(NV * NV * 3);
    let any = false;
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NV; i++) {
        const k = j * NV + i, L = c.level[k], d = L - c.z[k], on = L > .02 && d > .03;
        if (on) any = true;
        pos[k * 3] = c.qx * c.size + i * c.res;
        pos[k * 3 + 1] = on ? L : c.z[k] - .4;
        pos[k * 3 + 2] = -(c.qy * c.size + j * c.res);
        tc.copy(shallow).lerp(deep, smoothstep(0, 5, d)).toArray(col, k * 3);
      }
    if (!any) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, wMat);
  };
  const decorFor = c => {
    const lists = [[], [], []], cell = 8, n = 64 / cell, out = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = i + c.qx * n, b = j + c.qy * n, x = c.qx * 64 + (i + hash2(a, b, seed + 31)) * cell, y = c.qy * 64 + (j + hash2(a, b, seed + 32)) * cell,
          h = hm.at(x, y), lv = hm.levelAt(x, y);
        if (h < 2.5 || lv > -1e8 && lv - h > -.2) continue;
        if (Math.hypot(hm.at(x + 1.5, y) - hm.at(x - 1.5, y), hm.at(x, y + 1.5) - hm.at(x, y - 1.5)) / 3 > .8) continue;
        const [ice, des, swa, fo] = hm.biomeAt(x, y), pPine = (.7 * fo + .08 * ice) * (1 - smoothstep(180, 260, h)), pCac = .05 * des, pSw = .22 * swa, r = hash2(a, b, seed + 33),
          kind = r < pPine ? 0 : r < pPine + pCac ? 1 : r < pPine + pCac + pSw ? 2 : -1;
        if (kind >= 0) lists[kind].push([x, h, y, 1 + hash2(a, b, seed + 34) * .8, hash2(a, b, seed + 35) * 6.28]);
      }
    lists.forEach((l, k) => {
      if (!l.length) return;
      const m = new THREE.InstancedMesh(kinds[k], dMat, l.length);
      l.forEach(([x, h, y, s, ry], q) => { dummy.position.set(x, h, -y); dummy.rotation.y = ry; dummy.scale.setScalar(s * (k == 0 ? 1.3 : 1)); dummy.updateMatrix(); m.setMatrixAt(q, dummy.matrix); });
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      out.push(m);
    });
    return out;
  };

  /* Railroad track on the near chunks: a sleeper every ~2.4 tiles and two rails, as instanced boxes laid along the
     route, each tilted to the ground under it. The roadbed itself (ballast, grading) is in the terrain. */
  const sleeperMat = new THREE.MeshLambertMaterial({ color: '#5b4636' }), railMat = new THREE.MeshLambertMaterial({ color: '#9aa0a6' }),
    sleeperGeo = new THREE.BoxGeometry(3.4, .18, .5), railGeo = new THREE.BoxGeometry(.16, .16, 1);
  const railsFor = c => {
    const x0 = c.qx * 64, y0 = c.qy * 64, pts = [];
    for (const pl of hm.rails)
      for (let i = 0; i < pl.length - 1; i++) {
        const [ax, ay] = pl[i], [bx, by] = pl[i + 1];
        if (Math.max(ax, bx) < x0 - 4 || Math.min(ax, bx) > x0 + 68 || Math.max(ay, by) < y0 - 4 || Math.min(ay, by) > y0 + 68) continue;
        const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / 2.4)), dx = (bx - ax) / len, dy = (by - ay) / len;
        for (let k = 0; k < n; k++) {
          const u = (k + .5) / n, x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
          if (x >= x0 && x < x0 + 64 && y >= y0 && y < y0 + 64) pts.push([x, y, dx, dy, len / n]);
        }
      }
    if (!pts.length) return [];
    const sl = new THREE.InstancedMesh(sleeperGeo, sleeperMat, pts.length), rl = new THREE.InstancedMesh(railGeo, railMat, pts.length * 2);
    pts.forEach(([x, y, dx, dy, step], q) => {
      const h = hm.at(x, y), pitch = Math.atan2(hm.at(x + dx * 1.2, y + dy * 1.2) - hm.at(x - dx * 1.2, y - dy * 1.2), 2.4);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(-pitch, Math.atan2(dx, -dy), 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(x, h + .12, -y);
      dummy.updateMatrix();
      sl.setMatrixAt(q, dummy.matrix);
      for (const side of [-1, 1]) {
        dummy.position.set(x + (-dy) * .75 * side * -1, h + .28, -(y + dx * .75 * side * -1));
        dummy.scale.set(1, 1, step * 1.04);
        dummy.updateMatrix();
        rl.setMatrixAt(q * 2 + (side + 1) / 2, dummy.matrix);
      }
    });
    dummy.rotation.order = 'XYZ';
    for (const m of [sl, rl]) { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; }
    return [sl, rl];
  };


  /* Two trains, one on each railroad, shuttling end to end at 38 tiles a second and waiting 4 s at each terminus.
     They are drawn straight from the route's height profile (not the chunks), so they run along the whole line
     whether or not the ground round them is loaded. A locomotive and six carriages, each a single mesh. */
  const trainMat = new THREE.MeshLambertMaterial({ vertexColors: true }), SP = 12, NCARS = 7, SPEED = 38;
  const trainGeo = (body, roof, nose) => mergeParts([[new THREE.BoxGeometry(3, 2.8, 10.6), body, 0, 1.7, 0], [new THREE.BoxGeometry(2.6, .5, 10), roof, 0, 3.35, 0], [new THREE.BoxGeometry(3.1, .4, 10.8), '#2a2d34', 0, .4, 0]].concat(nose ? [[new THREE.BoxGeometry(2.8, 1.2, 1.4), nose, 0, 2.4, 5.2], [new THREE.BoxGeometry(1.2, 1.4, 1.2), roof, 0, 3.9, 2.2]] : [[new THREE.BoxGeometry(3.04, .5, 6.4), '#9fd3e6', 0, 2.3, 0]]));
  const geos = [trainGeo('#b23a2e', '#3a3d44', '#7d2a22'), trainGeo('#3b6fa0', '#d9d4c7', null), trainGeo('#e8e4d8', '#3b6fa0', null)];
  const trains = hm.net ? hm.net.polylines.filter(pl => pl.kind === 1).map((pl, ti) => {
    const cum = [0];
    for (let i = 1; i < pl.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pl.pts[i][0] - pl.pts[i - 1][0], pl.pts[i][1] - pl.pts[i - 1][1]));
    const L = cum[cum.length - 1], Lt = NCARS * SP, cars = Array.from({ length: NCARS }, (_, i) => { const m = new THREE.Mesh(geos[i ? 1 + i % 2 : 0], trainMat); m.rotation.order = 'YXZ'; m.frustumCulled = false; wg.add(m); return m; });
    return { pl, cum, L, Lt, cars, c: Lt / 2 + (ti + 1) * L / 3, dir: ti % 2 ? -1 : 1, dwell: 0 };
  }) : [];
  const onRoute = (T, s) => {   /* position, tangent and height at arc length s */
    const { cum, pl } = T;
    s = Math.min(T.L, Math.max(0, s));
    let lo = 0, hi = cum.length - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const u = (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1), [ax, ay] = pl.pts[lo], [bx, by] = pl.pts[lo + 1], len = Math.hypot(bx - ax, by - ay) || 1;
    return [ax + (bx - ax) * u, ay + (by - ay) * u, (bx - ax) / len, (by - ay) / len, pl.prof[lo] + (pl.prof[lo + 1] - pl.prof[lo]) * u];
  };
  const moveTrains = dt => {
    for (const T of trains) {
      if (T.dwell > 0) T.dwell -= dt;
      else {
        T.c += T.dir * SPEED * dt;
        if (T.c > T.L - T.Lt / 2) { T.c = T.L - T.Lt / 2; T.dir = -1; T.dwell = 4; }
        else if (T.c < T.Lt / 2) { T.c = T.Lt / 2; T.dir = 1; T.dwell = 4; }
      }
      T.cars.forEach((m, i) => {
        const s = T.c + T.dir * (T.Lt / 2 - (i + .5) * SP), [x, y, dx, dy, h] = onRoute(T, s), pitch = Math.atan2(onRoute(T, s + 3)[4] - onRoute(T, s - 3)[4], 6);
        m.position.set(x, h + .28, -y);
        m.rotation.set(T.dir > 0 ? -pitch : pitch, Math.atan2(dx, -dy) + (T.dir > 0 ? 0 : Math.PI), 0);
      });
    }
  };
  moveTrains(0);

  const make = (lod, qx, qy) => {
    const c = hm.getChunk(lod, qx, qy), g = new THREE.Group();
    g.add(mkTerrain(c, lod));
    if (lod === 0) {
      const w = mkWater(c);
      if (w) g.add(w);
      for (const m of decorFor(c)) g.add(m);
      for (const m of railsFor(c)) g.add(m);
    }
    wg.add(g);
    maps[lod].set(qx * 65536 + qy, { g, qx, qy });
  };
  const drop = e => {
    wg.remove(e.g);
    e.g.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.geometry) o.geometry.dispose(); });
  };
  const update = (px, py, budget, dt = 0) => {
    moveTrains(Math.min(dt, .1));
    const want = [];
    for (let lod = 2; lod >= 0; lod--) {
      const size = CHUNK[lod], pcx = Math.floor(px / size), pcy = Math.floor(py / size), r = RAD[lod], map = maps[lod];
      for (const [key, e] of map) if (Math.abs(e.qx - pcx) > r + 1 || Math.abs(e.qy - pcy) > r + 1) { drop(e); map.delete(key); }
      for (let qy = Math.max(0, pcy - r); qy <= Math.min(NY[lod] - 1, pcy + r); qy++)
        for (let qx = Math.max(0, pcx - r); qx <= Math.min(NX[lod] - 1, pcx + r); qx++)
          if (!map.has(qx * 65536 + qy)) want.push([lod, qx, qy, Math.hypot((qx + .5) * size - px, (qy + .5) * size - py)]);
    }
    want.sort((a, b) => (b[0] == 2) - (a[0] == 2) || a[3] - b[3]);
    for (let k = 0; k < want.length && k < budget; k++) make(want[k][0], want[k][1], want[k][2]);
  };
  update(pl.x, pl.y, 70);
  return { update };
};

/* Static geometry for the scene the player is in: ground, walls, water, bridges,
   stations, labels and portal rings. Edict meshes are dropped and recreated by the
   next draw(). */
let WV = null;   /* the chunk manager of the world being drawn, if any */

function build(s) {
  if (grp) {
    sc.remove(grp);
    grp.traverse(o => o.geometry && o.geometry.dispose());   /* the terrain meshes are big */
  }
  grp = new THREE.Group();
  sc.add(grp);
  impacts = [];
  for (const e of s.edicts) e.mesh = null;

  const inI = s.scene == 'int', C = tok(), wh = GSA.physics.WH(s),
    slab = ([x, y, w, d], h, z, color) => put(grp, new THREE.BoxGeometry(w, h, d), color, x + w / 2, y + d / 2, z),
    /* a building on a heightmap: from the lowest ground under it (plus a skirt) up to wh above the highest */
    ground = (x, y) => GSA.physics.groundZ(s, x, y),
    span = ([x, y, w, d]) => {
      const g = [[0, 0], [w, 0], [0, d], [w, d], [w / 2, d / 2]].map(([a, b]) => ground(x + a, y + b));
      return [Math.min(...g), Math.max(...g)];
    },
    building = (r, color) => {
      const [lo, hi] = span(r), h = hi - lo + wh + 1.5;
      slab(r, h, lo - 1.5 + h / 2, color);
    };
  sc.background = new THREE.Color(C.bg);
  const big = !inI && !!s.city.world;   /* a continent: fog, a far camera, chunked terrain */
  sc.fog = big ? new THREE.Fog(C.bg, 900, 7000) : null;
  cam.near = big ? .3 : .1;
  cam.far = big ? 9000 : 300;
  cam.updateProjectionMatrix();
  WV = null;
  if (!inI && s.city.mountains) grp.add(mountainMesh(s.city, C));
  if (big) WV = worldView(s.city, C, grp, s.p);
  else if (!inI && GSA.physics.terrain(s.city)) {
    grp.add(terrainMesh(s.city, C));
    if (GSA.physics.terrain(s.city).level) grp.add(waterMesh(s.city));
  }
  else put(grp, new THREE.BoxGeometry(s.size[0], .2, s.size[1]), C.ground, s.size[0] / 2, s.size[1] / 2, -.1);
  s.walls.forEach(r => inI ? slab(r, wh, wh / 2, C.bld) : building(r, C.bld));

  if (!inI) {
    (s.city.water || []).forEach(r => slab(r, .1, .02, '#2f7fd1'));
    (s.city.bridges || []).forEach(r => slab(r, .12, .06, '#9a7b4f'));
    (s.city.stations || []).forEach(q => {
      put(grp, new THREE.CylinderGeometry(.7, .9, 1, 10), '#7c3aed', q.at[0], q.at[1], .5);
      const l = lab(q.name, C.fg);
      l.position.set(q.at[0], 2.2, -q.at[1]);
      grp.add(l);
    });
    s.city.sites.forEach(q => {
      if (!q.name) return;
      const l = lab(q.name, C.fg);
      l.position.set(q.r[0] + q.r[2] / 2, span(q.r)[1] + wh + 1, -(q.r[1] + q.r[3] / 2));
      grp.add(l);
    });
    (s.city.places || []).forEach(q => {   /* a city's name, big enough to read from across the map */
      const l = lab(q.name, C.fg);
      l.scale.set(8 * (q.scale ?? 7), 1.5 * (q.scale ?? 7), 1);
      l.material.fog = false;
      l.position.set(q.at[0], ground(q.at[0], q.at[1]) + (q.height ?? 45), -q.at[1]);
      grp.add(l);
    });
  }
  portalList(s).forEach(({ k, at }) => put(grp, new THREE.CylinderGeometry(.8, .8, .08, 20), !inI && k == 'front' ? C.cop : C.acc, at[0], at[1],
    .05 + Math.max(...[[0, 0], [.8, 0], [-.8, 0], [0, .8], [0, -.8]].map(([a, b]) => GSA.physics.groundZ(s, at[0] + a, at[1] + b)))));

  grp.add(pm);
  beamM = put(grp, new THREE.BoxGeometry(.3, .3, 9), '#7fe3ff', 0, 0, 0);
  shock = put(grp, new THREE.RingGeometry(.88, 1, 48), '#ffd166', 0, 0, .08);
  shock.rotation.x = -Math.PI / 2;
  shock.material.transparent = true;
  beamM.visible = shock.visible = false;
  cam.position.set(s.p.x, 11, 9 - s.p.y);
}

/* What each kind of edict looks like: `make` builds its mesh, `pose` places it
   every frame. Kinds not listed (portals, spawners, stations) have no mesh. */
const KIND = {
  actor: {
    make: e => put(grp, new THREE.CylinderGeometry(.35, .35, 1.2, 10), e.base.color || '#c33', e.x, e.y, .6),
    pose: (e, o) => o.position.set(e.x, .6 + GSA.physics.groundZ(GSA.state(), e.x, e.y), -e.y)
  },
  item: {
    make: e => put(grp, new THREE.OctahedronGeometry(.4), e.base.color || '#ffd166', e.x, e.y, .7),
    pose: (e, o) => { o.position.set(e.x, .7 + GSA.physics.groundZ(GSA.state(), e.x, e.y), -e.y); o.rotation.y += .04; }
  },
  projectile: {
    make: e => {
      const o = put(grp, new THREE.SphereGeometry(.15, 8, 6), '#8dff3a', e.x, e.y, e.z);
      o.material.transparent = true;
      return o;
    },
    /* burns out over its lifetime: the time left until its nextthink */
    pose: (e, o, s) => {
      o.position.set(e.x, e.z, -e.y);
      o.material.opacity = Math.max(0, (e.nextthink - s.t) / 1.2);
    }
  },
  /* drawn by its own base.build(a), like a race's avatar; the model faces +z */
  vehicle: {
    make: e => {
      /* base.build hands back each part's mesh (a model may rotate or scale it, or hang a label on it), so build real
         meshes first. Then, unless a part carries a child or is see-through (the ship's floating name), bake their
         transforms into one geometry: one draw call per vehicle, since dozens can be parked. */
      const g = new THREE.Group(), meshes = [];
      e.base.build((geo, c, x, y, z) => {
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c }));
        m.position.set(x, y, z);
        meshes.push(m);
        return m;
      });
      if (meshes.some(m => m.children.length || m.material.transparent)) meshes.forEach(m => g.add(m));
      else g.add(new THREE.Mesh(mergeParts(meshes.map(m => { m.updateMatrix(); return [m.geometry.clone().applyMatrix4(m.matrix), m.material.color, 0, 0, 0]; })), vehicleMat));
      grp.add(g);
      return g;
    },
    pose: (e, o) => {
      o.position.set(e.x, e.z, -e.y);
      o.rotation.order = 'YXZ';   /* yaw, then nose up/down, then lean */
      o.rotation.y = Math.PI - e.heading;
      o.rotation.x = -(e.pitch || 0);
      o.rotation.z = e.roll || 0;
    }
  }
};

function draw(s, Y, Pt, dt) {
  const p = s.p;
  if (s.dirty) {
    build(s);
    s.dirty = 0;
  }

  /* avatar */
  pm.position.set(p.x, p.z, -p.y);
  pm.visible = !p.vehicle;
  pm.rotation.y = Math.PI - p.heading;
  pm.rotation.x = p.pitch;
  pm.scale.y = p.zscale;
  pm.traverse(o => {
    if (o.material) {
      o.material.transparent = true;
      o.material.opacity = s.invis > 0 ? .25 : 1;
    }
  });

  /* edicts, and the newest shockwave */
  let wv = null;
  for (const e of s.edicts) {
    if (e.free) continue;
    if (e.base.type == 'wave') wv = e;
    const kind = KIND[e.base.type];
    if (!kind) continue;
    const vis = e.sc == s.scene && !e.dead;
    if (!e.mesh && vis) {
      e.mesh = kind.make(e);
      if (!e.mesh.parent) grp.add(e.mesh);
    }
    if (!e.mesh) continue;
    e.mesh.visible = vis;
    kind.pose(e, e.mesh, s);
  }

  /* frost beam, shockwave, impact rings */
  const ax = Math.sin(Y), ay = Math.cos(Y);
  beamM.visible = !!s.beam;
  if (s.beam) {
    beamM.position.set(p.x + ax * 4.5, p.z + .9, -(p.y + ay * 4.5));
    beamM.rotation.y = Math.PI - Y;
  }
  shock.visible = !!wv;
  if (wv) {
    shock.scale.set(wv.radius, wv.radius, 1);
    shock.position.set(wv.x, .08, -wv.y);
    shock.material.opacity = 1 - wv.radius / wv.base.max * .8;
  }
  for (let i = impacts.length - 1; i >= 0; i--) {
    const it = impacts[i];
    it.t += dt;
    if (it.t >= .3) {
      grp.remove(it.m);
      it.m.geometry.dispose();
      impacts.splice(i, 1);
    } else {
      const k = 1 - it.t / .3;
      it.m.scale.setScalar(k * 4);
      it.m.material.opacity = k;
    }
  }

  if (WV) WV.update(p.x, p.y, 3, dt);

  /* camera: behind the player along the view bearing, looking at them */
  const D = 13, cp = Math.cos(Pt),
    gz = s.scene == 'city' ? GSA.physics.groundZ(s, p.x, p.y) : 0, cz = gz + (p.z - gz) * .5;   /* follow the ground fully, a jump by half */
  const cx = p.x - Math.sin(Y) * cp * D, cyy = p.y - Math.cos(Y) * cp * D,
    camY = Math.max(Math.sin(Pt) * D + cz, (s.scene == 'city' ? GSA.physics.groundZ(s, cx, cyy) : 0) + 1);   /* never under the ground */
  cam.position.lerp(new THREE.Vector3(cx, camY, -cyy), .2);
  if (s.scene == 'city' && s.city.mountains) {   /* the camera stays in the valley, not inside the wall */
    cam.position.x = Math.min(Math.max(cam.position.x, .4), s.size[0] - .4);
    cam.position.z = Math.min(Math.max(cam.position.z, .4 - s.size[1]), -.4);
  }
  if (s.shk > 0) {
    s.shk -= .016;
    cam.position.x += (Math.random() - .5) * s.shk * 3;
    cam.position.y += (Math.random() - .5) * s.shk * 3;
  }
  cam.lookAt(p.x, cz + .5 + Math.max(0, .2 - Pt) * 30, -p.y);   /* pitching below the horizon aims past the player, at the sky */
  ren.render(sc, cam);
}

(window.GSA = window.GSA || {}).render = { init, draw, setRace, release, spawnImpactEffect, tok, get renderer() { return ren; } };