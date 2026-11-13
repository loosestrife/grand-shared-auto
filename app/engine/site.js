/* Site layout: portal geometry and mission binding. Pure functions over packs. */
/* Where the rings of a site are. x runs east and y north, so the front door
   (and the embassy door) faces south and the back door faces north. */
const portalsOf = s => {
	const [x, y, w, d] = s.r, c = x + w / 2;
	return {
		front: [c, y - .8],
		back: [c, y + d + .8],
		door: [c, y - .8]
	};
};

function bindSite(m, city) {
	const log = [],
		c = {};
	for (const [k, q] of Object.entries(m.roles)) c[k] = city.sites.filter(s => {
		const ok = s.type == q.type && (!q.nation || s.nation == q.nation);
		log.push(`${k}: ${s.name} ${ok ? 'matches' : 'rejected'}`);
		return ok
	});
	for (const a of c.source)
		for (const b of c.dest) {
			const d = dist(portalsOf(a).back, portalsOf(b).door);
			if (d >= m.dist[0] && d <= m.dist[1]) {
				log.push(`bound ${a.name} to ${b.name} (${d | 0} tiles apart)`);
				return {
					ok: 1,
					source: a,
					dest: b,
					log
				}
			}
			log.push(`${a.name} to ${b.name}: ${d | 0} tiles, needs ${m.dist[0]}-${m.dist[1]}`)
		}
	log.push('no valid binding');
	return {
		ok: 0,
		log
	};
}

const conforms = (i, t) => i.implements == t && IFACE[t].portals.every(p => i.portals[p]) && i.ram.length > 0;

/* The portal rings of a scene (default: the one the player is in): [{ k, at }]. */
function portalList(s, scene = s.scene) {
	if (scene == 'int') return Object.entries(s.I.portals).map(([k, at]) => ({ k, at }));
	const a = portalsOf(s.B.source), d = portalsOf(s.B.dest);
	return [{ k: 'front', at: a.front }, { k: 'back', at: a.back }, { k: 'door', at: d.door }];
}
