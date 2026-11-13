/* Name a snake_case key as title case ("ice_wraith_teeth" -> "Ice wraith teeth"). */
const niceName = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/* Site interfaces: what a site type is defined by. */
const IFACE = {
	data_center: {
		portals: ['front', 'back'],
		events: ['alarm_raised']
	},
	embassy: {
		portals: ['door']
	}
};

/* Coordinates are east, north, up (x, y, z), right-handed: x runs east, y runs north, z is up.
   A rect is [x, y, w, d] from its south-west corner. A site's front door faces south.

   Packs: cities place sites, interiors are separate (larger) spaces, races are bounded modifiers
   plus an avatar builder. Scripts and races never touch engine state directly. */
const packs = {
	/* §2/§7 Archetypes: appearance and stat balances live here. The runtime owns
	   only the mob lifecycle, so a pack can add any archetype key here and spawnMob(key, x, y) will use it. */
	mobs: {
		zombie: {
			name: 'Zombie',
			faction: 'zombies',
			health: 3,
			speed: 2.4,
			radius: .4,
			viewDist: 8,
			viewCone: 1.4,
			hearingLevel: 1.0,
			attackPower: 1,
			attackInterval: 1,
			reach: .7,
			tetherRadius: null,
			color: '#5a8f3a',
			dropTable: [{ itemKey: 'zombie_gib', chance: .5, count: 1 }],
		},
		cop: {
			name: 'Cop',
			faction: 'cops',
			health: 4,
			speed: 3.6,
			radius: .4,
			viewDist: 15,
			viewCone: 1.8,
			hearingLevel: 2.5,
			attackPower: 1,
			attackInterval: 1,
			reach: .9,
			tetherRadius: null,
			color: '#2f5bd1',
			dropTable: [],
		},
		ice_wraith: {
			name: 'Ice Wraith',
			faction: 'hostile-animals',
			health: 8,
			speed: 3.8,
			radius: .5,
			viewDist: 11,
			viewCone: 1.2,
			hearingLevel: 4.0,
			attackPower: 2,
			attackInterval: 1.2,
			reach: 2.0,
			tetherRadius: 7.5,
			color: '#bfe9ff',
			dropTable: [{ itemKey: 'ice_wraith_teeth', chance: 1, count: 1 }],
		},
		luna_moth: {
			name: 'Luna Moth',
			faction: 'passive-critters',
			health: 1,
			speed: 2.2,
			radius: .3,
			viewDist: 6,
			viewCone: 3.14,
			hearingLevel: 1.5,
			attackPower: 0,
			attackInterval: 1,
			reach: .8,
			tetherRadius: 4,
			color: '#b8f5c4',
			dropTable: [{ itemKey: 'luna_moth_wing', chance: 1, count: 1 }],
		},
	},
	items: {
		luna_moth_wing: {
			name: 'Luna moth wing',
			color: '#b8f5c4'
		},
	ice_wraith_teeth: {
		name: 'Ice wraith teeth',
		color: '#bfe9ff',
	},
	zombie_gib: {
		name: 'Zombie gib',
		color: '#7a9a5a',
	},
		invisibility_potion: {
			name: 'Invisibility potion',
			color: '#c084fc',
			use: { invis: 25, msg: 'You drink the invisibility potion' }
		},
		plasma_gun: {
			name: 'Martian Plasma Gun',
			weight: 1,
      type: 'weapon',
			weapon_type: 'bolt',
			speed: 18,
			damage: 1.5,
		}
	},
	innate_weapons: {
		'fists': {
			name: 'Fists',
			weapon_type: 'melee',
			range: .5,
			damage: 1,
			knockback: 1,
		},
		'frost_beam': {
			name: 'Frost beam',
			range: 9,
			weapon_type: 'cone',
			angle: .3,
			dps: 2.2,
			slow: 1.2,
		},
	},
	recipes: {
		invisibility_potion: {
			station: 'alchemy',
			needs: {
				luna_moth_wing: 1,
				ice_wraith_teeth: 1
			}
		}
	},
	city: {
		river: {
			name: 'River City',
			size: [48, 26],
			spawn: [16, 9],
			car: [18, 9],
			water: [
				[20, 20, 8, 6],
				[20, 9, 8, 7],
				[20, 0, 8, 5]
			],
			bridges: [
				[20, 16, 8, 4],
				[20, 5, 8, 4]
			],
			sites: [{
				id: 'dc_west',
				type: 'data_center',
				name: 'Westbank Data Center',
				r: [5, 12, 8, 5]
			}, {
				id: 'dc_east',
				type: 'data_center',
				name: 'Eastbank Server Farm',
				r: [34, 3, 8, 5]
			}, {
				id: 'emb_cn',
				type: 'embassy',
				nation: 'china',
				name: 'Chinese Embassy',
				r: [35, 11, 6, 5]
			}, {
				id: 'emb_fr',
				type: 'embassy',
				nation: 'france',
				name: 'French Embassy',
				r: [5, 3, 6, 5]
			}]
		},
		sample: {
			name: 'Sample City',
			size: [44, 26],
			/* A spawner keeps one mob alive at its spot and brings a new one `delay`
			   seconds after it dies. The mob's dropTable gives the player its wing / teeth. */
			spawners: [{
				mob: 'luna_moth',
				at: [41.5, 2.5],
				delay: 15
			}, {
				mob: 'ice_wraith',
				at: [2.5, 23.5],
				delay: 15
			}],
			stations: [{
				type: 'alchemy',
				name: 'Alchemy Station',
				at: [38, 2.5]
			}],
			sites: [{
				id: 'dc_far',
				type: 'data_center',
				name: 'Nexus Data Center',
				r: [4, 17, 8, 5]
			}, {
				id: 'dc_near',
				type: 'data_center',
				name: 'Corner Server Farm',
				r: [30, 5, 8, 5]
			}, {
				id: 'emb_cn',
				type: 'embassy',
				nation: 'china',
				name: 'Chinese Embassy',
				r: [30, 16, 6, 5]
			}, {
				id: 'emb_fr',
				type: 'embassy',
				nation: 'france',
				name: 'French Embassy',
				r: [4, 4, 6, 5]
			}]
		}
	},
	interiors: {
		stock: {
			implements: 'data_center',
			size: [30, 9],
			portals: {
				front: [1.5, 4.5],
				back: [28.5, 4.5]
			},
			walls: [
				[7, 3, 1, 6],
				[13, 0, 1, 6],
				[19, 3, 1, 6],
				[24, 0, 1, 6]
			],
			ram: [
				[10, 7],
				[16, 3],
				[21, 7],
				[26, 3],
				[27, 7]
			],
			enemies: [],
			heatPolicy: 'paused',
			script: {
				alarm_raised: a => a.heat(2)
			}
		},
		zombie: {
			implements: 'data_center',
			size: [64, 12],
			portals: {
				front: [1.5, 6],
				back: [62.5, 6]
			},
			walls: [
				[8, 4, 1, 8],
				[16, 0, 1, 8],
				[24, 4, 1, 8],
				[32, 0, 1, 8],
				[40, 4, 1, 8],
				[48, 0, 1, 8],
				[56, 4, 1, 8]
			],
			ram: [
				[12, 10],
				[20, 3],
				[36, 10],
				[44, 3],
				[60, 9]
			],
			enemies: [
				[14, 6],
				[28, 6],
				[38, 6],
				[46, 9],
				[52, 4],
				[58, 6]
			],
			heatPolicy: 'paused',
			script: {
				alarm_raised: a => a.heat(2)
			}
		}
	},
	/* A race: speed, jump (v and gravity), hit cooldown, alarm heat multiplier, and a build(add) avatar. */
	races: {
		nord: {
			name: 'Nord',
			speed: 4.6,
			gravity: 22,
			jumpV: 7,
			hitCd: 2.4,
			alarmMult: 1,
			flags: ['bowser_slam'],
			innate_weapons: ['fists'],
			build: a => {
				a(new THREE.CylinderGeometry(.48, .48, 1.1, 12), '#8a5a2b', 0, .55, 0);
				a(new THREE.SphereGeometry(.3, 12, 8), '#e8c9a6', 0, 1.35, 0);
				a(new THREE.ConeGeometry(.08, .45, 6), '#eeeeee', -.3, 1.65, 0).rotation.z = .6;
				a(new THREE.ConeGeometry(.08, .45, 6), '#eeeeee', .3, 1.65, 0).rotation.z = -.6
			}
		},
		elf: {
			name: 'Elf',
			speed: 5.2,
			gravity: 20,
			jumpV: 8,
			hitCd: 1.2,
			alarmMult: .5,
			flags: [],
			innate_weapons: ['fists', 'frost_beam'],
			build: a => {
				a(new THREE.CylinderGeometry(.26, .32, 1.4, 12), '#2e8b57', 0, .7, 0);
				a(new THREE.SphereGeometry(.24, 12, 8), '#f0dcc0', 0, 1.65, 0);
				a(new THREE.ConeGeometry(.07, .45, 6), '#f0dcc0', -.35, 1.7, 0).rotation.z = Math.PI / 2;
				a(new THREE.ConeGeometry(.07, .45, 6), '#f0dcc0', .35, 1.7, 0).rotation.z = -Math.PI / 2
			}
		},
		martian: {
			name: 'Martian',
			speed: 5.8,
			gravity: 7,
			jumpV: 7,
			hitCd: 1.2,
			alarmMult: 1,
			flags: [],
			inventory: {'plasma_gun': 1},
			build: a => {
				a(new THREE.SphereGeometry(.5, 12, 10), '#c1440e', 0, .6, 0);
				a(new THREE.SphereGeometry(.45, 12, 10), '#7ac74f', 0, 1.45, 0);
				a(new THREE.CylinderGeometry(.03, .03, .5, 6), '#7ac74f', 0, 2.0, 0);
				a(new THREE.SphereGeometry(.08, 8, 6), '#7ac74f', 0, 2.28, 0)
			}
		}
	}
};




/* Mission = roles + constraints + objective steps. It never names a specific map. */
const mission = {
	roles: {
		source: {
			type: 'data_center'
		},
		dest: {
			type: 'embassy',
			nation: 'china'
		}
	},
	dist: [8, 40],
	of: 5,
	thr: .6,
	steps: [{
		t: 'Enter {source} through the front',
		ev: 'in:front'
	}, {
		t: 'Take RAM and leave through the back',
		ev: 'out:back',
		ok: s => s.carry > 0
	}, {
		t: 'Deliver to {dest}, keeping at least 60% of the RAM',
		ev: 'deliver'
	}]
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);