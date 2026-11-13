/* render.js — Three.js: static geometry per scene, one mesh per edict that has
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
  cam = new THREE.PerspectiveCamera(50, W / H, .1, 200);
};

/* The CSS colour tokens, read live so a theme change shows up on the next rebuild. */
const tok = () => Object.fromEntries(['bg', 'ground', 'bld', 'fg', 'acc', 'cop', 'bad'].map(n => [n, getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim()]));

/* A mesh at a position in the parent's own (three.js) space. Model builders use this. */
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

/* Static geometry for the scene the player is in: ground, walls, water, bridges,
   stations, labels and portal rings. Edict meshes are dropped and recreated by the
   next draw(). */
function build(s) {
  if (grp) sc.remove(grp);
  grp = new THREE.Group();
  sc.add(grp);
  impacts = [];
  for (const e of s.edicts) e.mesh = null;

  const inI = s.scene == 'int', C = tok(), wh = GSA.physics.WH(s),
    slab = ([x, y, w, d], h, z, color) => put(grp, new THREE.BoxGeometry(w, h, d), color, x + w / 2, y + d / 2, z);
  sc.background = new THREE.Color(C.bg);
  put(grp, new THREE.BoxGeometry(s.size[0], .2, s.size[1]), C.ground, s.size[0] / 2, s.size[1] / 2, -.1);
  s.walls.forEach(r => slab(r, wh, wh / 2, C.bld));

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
      const l = lab(q.name, C.fg);
      l.position.set(q.r[0] + q.r[2] / 2, wh + 1, -(q.r[1] + q.r[3] / 2));
      grp.add(l);
    });
  }
  portalList(s).forEach(({ k, at }) => put(grp, new THREE.CylinderGeometry(.8, .8, .08, 20), !inI && k == 'front' ? C.cop : C.acc, at[0], at[1], .05));

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
    pose: (e, o) => o.position.set(e.x, .6, -e.y)
  },
  item: {
    make: e => put(grp, new THREE.OctahedronGeometry(.4), e.base.color || '#ffd166', e.x, e.y, .7),
    pose: (e, o) => { o.position.set(e.x, .7, -e.y); o.rotation.y += .04; }
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
      const g = new THREE.Group();
      e.base.build((geo, c, x, y, z) => addMesh(g, geo, c, x, y, z));
      grp.add(g);
      return g;
    },
    pose: (e, o) => {
      o.position.set(e.x, e.z, -e.y);
      o.rotation.y = Math.PI - e.heading;
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

  /* camera: behind the player along the view bearing, looking at them */
  const D = 13, cp = Math.cos(Pt);
  cam.position.lerp(new THREE.Vector3(p.x - Math.sin(Y) * cp * D, Math.sin(Pt) * D + p.z * .5, -(p.y - Math.cos(Y) * cp * D)), .2);
  if (s.shk > 0) {
    s.shk -= .016;
    cam.position.x += (Math.random() - .5) * s.shk * 3;
    cam.position.y += (Math.random() - .5) * s.shk * 3;
  }
  cam.lookAt(p.x, p.z * .5 + .5, -p.y);
  ren.render(sc, cam);
}

(window.GSA = window.GSA || {}).render = { init, draw, setRace, release, spawnImpactEffect, tok };
