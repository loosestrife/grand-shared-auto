// /data/packs.js
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
			ship: [14, 21],
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
			curbs: true,
			mountains: { seed: 7, peak: 60 },
			ship: [18, 21],
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
		},
		/* A continent the size of Skyrim from a seed (see generateWorld): ice in the north, desert in the south, forest in the
		   west backed by a mountain range along the west edge, swamp in the east, one huge mountain in the middle, ocean
		   round the other coasts. A city in each biome (Lothlorien in the forest, Saint Denis in the swamp, Winterhold on
		   the ice, Sandy Shores in the desert), each on a flat pad with a road grid painted on it, a data center and an
		   embassy to run missions between, and a block of buildings round them. */
		medici: {
			name: 'San Medici di Skyrim',
			size: [6000, 6000],
			world: { seed: 1521 },
			spawn: [1244, 2916],
			car: [1252, 2914],
			ship: [1220, 2916],
			routes: [
				{ kind: 'highway', from: 'Lothlorien', to: 'Sandy Shores' }, { kind: 'highway', from: 'Sandy Shores', to: 'Saint Denis' },
				{ kind: 'highway', from: 'Saint Denis', to: 'Winterhold' }, { kind: 'highway', from: 'Winterhold', to: 'Lothlorien' },
				{ kind: 'rail', from: 'Lothlorien', to: 'Saint Denis' }, { kind: 'rail', from: 'Sandy Shores', to: 'Winterhold' }
			],
			pads: [[1200, 2850, 170, 130], [4825, 3550, 170, 130], [3375, 4975, 170, 130], [3225, 1150, 170, 130]],
			parked: [
				['truck', 1319.7, 2911.8, 1.53, '#d68910'],
				['van', 1290.2, 2896.4, 0.04, '#cfd3d6'],
				['car', 1302.3, 2920.2, -1.53, '#4a9d6f'],
				['truck', 1281.8, 2962.0, 3.19, '#d68910'],
				['car', 1359.7, 2920.2, -1.57, '#4a9d6f'],
				['truck', 1281.8, 2969.9, 3.16, '#2c3e50'],
				['car', 1281.8, 2906.7, 3.18, '#e0b83a'],
				['car', 1290.2, 2970.6, -0.02, '#e0b83a'],
				['car', 1316.2, 2920.2, -1.59, '#3b6fa0'],
				['car', 1213.0, 2911.8, 1.63, '#8a8d93'],
				['car', 1361.0, 2911.8, 1.54, '#4a9d6f'],
				['van', 1270.3, 2920.2, -1.53, '#d9a441'],
				['car', 1304.8, 2911.8, 1.58, '#8a8d93'],
				['moto', 1281.8, 2861.3, 3.12, '#c1121f'],
				['van', 1345.9, 2911.8, 1.59, '#4b6a88'],
				['van', 1281.8, 2899.0, 3.14, '#d9a441'],
				['car', 4906.8, 3594.0, 3.09, '#2f2f35'],
				['car', 4921.5, 3620.2, -1.58, '#8a8d93'],
				['van', 4935.5, 3620.2, -1.52, '#d9a441'],
				['moto', 4837.3, 3620.2, -1.52, '#c1121f'],
				['moto', 4915.2, 3632.5, -0.06, '#c1121f'],
				['van', 4915.2, 3565.2, -0.05, '#cfd3d6'],
				['car', 4915.2, 3640.3, -0.04, '#3b6fa0'],
				['car', 4974.8, 3620.2, -1.59, '#3b6fa0'],
				['car', 4892.8, 3611.8, 1.53, '#e0b83a'],
				['car', 4932.1, 3611.8, 1.63, '#3b6fa0'],
				['moto', 4882.2, 3620.2, -1.59, '#222222'],
				['truck', 4988.9, 3611.8, 1.54, '#d68910'],
				['truck', 4980.9, 3611.8, 1.52, '#d68910'],
				['car', 4906.8, 3633.9, 3.11, '#f2f2f2'],
				['car', 4906.8, 3641.5, 3.13, '#8a8d93'],
				['car', 4837.9, 3611.8, 1.57, '#3b6fa0'],
				['snowmobile', 3456.8, 5051.6, 3.18, '#2a9d8f'],
				['snowmobile', 3526.7, 5036.8, 1.61, '#e63946'],
				['truck', 3465.2, 4992.9, 0.03, '#7f8c8d'],
				['snowmobile', 3495.5, 5036.8, 1.63, '#2a9d8f'],
				['snowmobile', 3381.1, 5036.8, 1.52, '#f1faee'],
				['snowmobile', 3465.2, 5059.1, -0.05, '#e63946'],
				['snowmobile', 3465.2, 5030.9, 0.06, '#f1faee'],
				['van', 3456.8, 5016.6, 3.14, '#4b6a88'],
				['snowmobile', 3456.8, 4992.8, 3.09, '#1d6fb8'],
				['snowmobile', 3465.2, 5066.7, 0.02, '#1d6fb8'],
				['truck', 3443.1, 5036.8, 1.56, '#c0392b'],
				['snowmobile', 3456.8, 5097.1, 3.17, '#e63946'],
				['truck', 3470.9, 5036.8, 1.62, '#c0392b'],
				['snowmobile', 3465.2, 5019.7, 0.01, '#2a9d8f'],
				['truck', 3451.4, 5045.2, -1.58, '#c0392b'],
				['truck', 3456.8, 5066.5, 3.17, '#7f8c8d'],
				['convertible', 3315.2, 1227.2, 0.02, '#f77f00'],
				['convertible', 3306.8, 1266.3, 3.14, '#ffb703'],
				['convertible', 3298.6, 1220.2, -1.6, '#2ec4b6'],
				['van', 3251.9, 1220.2, -1.59, '#d9a441'],
				['convertible', 3328.0, 1211.8, 1.6, '#8ecae6'],
				['convertible', 3281.3, 1220.2, -1.63, '#ff6f91'],
				['convertible', 3384.0, 1211.8, 1.51, '#2ec4b6'],
				['convertible', 3315.2, 1156.0, -0.0, '#ffb703'],
				['convertible', 3333.8, 1220.2, -1.55, '#e63946'],
				['van', 3315.2, 1193.2, -0.06, '#cfd3d6'],
				['moto', 3373.9, 1220.2, -1.59, '#222222'],
				['convertible', 3306.8, 1203.9, 3.14, '#e63946'],
				['convertible', 3346.6, 1220.2, -1.59, '#e63946'],
				['convertible', 3286.9, 1211.8, 1.56, '#e63946'],
				['moto', 3306.8, 1160.6, 3.12, '#c1121f'],
				['convertible', 3306.8, 1273.8, 3.18, '#f77f00']
			],
			places: [{ name: 'Lothlorien', at: [1285, 2915] }, { name: 'Saint Denis', at: [4910, 3615] }, { name: 'Winterhold', at: [3460, 5040] }, { name: 'Sandy Shores', at: [3310, 1215] }],
			roads: [
				[1200, 2910, 170, 12],
				[1280, 2850, 12, 130],
				[1200, 2874, 170, 8],
				[1200, 2948, 170, 8],
				[1232, 2850, 8, 130],
				[1330, 2850, 8, 130],
				[4825, 3610, 170, 12],
				[4905, 3550, 12, 130],
				[4825, 3574, 170, 8],
				[4825, 3648, 170, 8],
				[4857, 3550, 8, 130],
				[4955, 3550, 8, 130],
				[3375, 5035, 170, 12],
				[3455, 4975, 12, 130],
				[3375, 4999, 170, 8],
				[3375, 5073, 170, 8],
				[3407, 4975, 8, 130],
				[3505, 4975, 8, 130],
				[3225, 1210, 170, 12],
				[3305, 1150, 12, 130],
				[3225, 1174, 170, 8],
				[3225, 1248, 170, 8],
				[3257, 1150, 8, 130],
				[3355, 1150, 8, 130]
			],
			sites: [
				{ id: 'dc_lothlorien', type: 'data_center', name: 'Lothlorien Data Center', r: [1244, 2928, 8, 5] },
				{ id: 'emb_lothlorien', type: 'embassy', nation: 'china', name: 'Lothlorien Chinese Embassy', r: [1262, 2928, 6, 5] },
				{ type: 'building', r: [1207, 2885, 9, 8] },
				{ type: 'building', r: [1219, 2885, 9, 8] },
				{ type: 'building', r: [1207, 2896, 9, 9] },
				{ type: 'building', r: [1219, 2896, 9, 9] },
				{ type: 'building', r: [1207, 2925, 10, 10] },
				{ type: 'building', r: [1207, 2938, 9, 6] },
				{ type: 'building', r: [1219, 2938, 8, 6] },
				{ type: 'building', r: [1207, 2959, 12, 10] },
				{ type: 'building', r: [1243, 2857, 9, 6] },
				{ type: 'building', r: [1255, 2857, 12, 6] },
				{ type: 'building', r: [1243, 2885, 14, 7] },
				{ type: 'building', r: [1260, 2885, 12, 7] },
				{ type: 'building', r: [1243, 2895, 14, 8] },
				{ type: 'building', r: [1254, 2959, 8, 10] },
				{ type: 'building', r: [1265, 2959, 9, 10] },
				{ type: 'building', r: [1295, 2857, 9, 8] },
				{ type: 'building', r: [1307, 2857, 14, 8] },
				{ type: 'building', r: [1312, 2885, 9, 10] },
				{ type: 'building', r: [1312, 2898, 10, 7] },
				{ type: 'building', r: [1307, 2925, 12, 6] },
				{ type: 'building', r: [1295, 2934, 9, 9] },
				{ type: 'building', r: [1307, 2934, 8, 9] },
				{ type: 'building', r: [1318, 2934, 8, 9] },
				{ type: 'building', r: [1295, 2959, 14, 7] },
				{ type: 'building', r: [1312, 2959, 10, 7] },
				{ type: 'building', r: [1341, 2857, 14, 7] },
				{ type: 'building', r: [1341, 2885, 9, 8] },
				{ type: 'building', r: [1341, 2896, 14, 8] },
				{ type: 'building', r: [1341, 2925, 10, 8] },
				{ type: 'building', r: [1354, 2925, 9, 8] },
				{ type: 'building', r: [1341, 2936, 8, 7] },
				{ type: 'building', r: [1341, 2959, 10, 10] },
				{ id: 'dc_saint_denis', type: 'data_center', name: 'Saint Denis Data Center', r: [4869, 3628, 8, 5] },
				{ id: 'emb_saint_denis', type: 'embassy', nation: 'china', name: 'Saint Denis Chinese Embassy', r: [4887, 3628, 6, 5] },
				{ type: 'building', r: [4832, 3557, 8, 10] },
				{ type: 'building', r: [4843, 3557, 8, 10] },
				{ type: 'building', r: [4832, 3585, 14, 10] },
				{ type: 'building', r: [4832, 3598, 8, 10] },
				{ type: 'building', r: [4843, 3598, 9, 10] },
				{ type: 'building', r: [4832, 3625, 8, 9] },
				{ type: 'building', r: [4843, 3625, 9, 9] },
				{ type: 'building', r: [4832, 3637, 10, 8] },
				{ type: 'building', r: [4845, 3637, 9, 8] },
				{ type: 'building', r: [4832, 3659, 8, 8] },
				{ type: 'building', r: [4843, 3659, 9, 8] },
				{ type: 'building', r: [4868, 3557, 9, 7] },
				{ type: 'building', r: [4880, 3557, 9, 7] },
				{ type: 'building', r: [4868, 3585, 12, 10] },
				{ type: 'building', r: [4883, 3585, 10, 10] },
				{ type: 'building', r: [4868, 3598, 12, 6] },
				{ type: 'building', r: [4883, 3598, 10, 6] },
				{ type: 'building', r: [4868, 3638, 10, 8] },
				{ type: 'building', r: [4881, 3638, 12, 8] },
				{ type: 'building', r: [4868, 3659, 12, 10] },
				{ type: 'building', r: [4883, 3659, 9, 10] },
				{ type: 'building', r: [4920, 3557, 9, 7] },
				{ type: 'building', r: [4932, 3557, 8, 7] },
				{ type: 'building', r: [4920, 3585, 9, 6] },
				{ type: 'building', r: [4932, 3585, 8, 6] },
				{ type: 'building', r: [4937, 3594, 8, 8] },
				{ type: 'building', r: [4935, 3625, 8, 8] },
				{ type: 'building', r: [4920, 3636, 14, 6] },
				{ type: 'building', r: [4937, 3636, 12, 6] },
				{ type: 'building', r: [4920, 3659, 14, 9] },
				{ type: 'building', r: [4937, 3659, 9, 9] },
				{ type: 'building', r: [4966, 3557, 8, 7] },
				{ type: 'building', r: [4977, 3557, 9, 7] },
				{ type: 'building', r: [4966, 3585, 9, 9] },
				{ type: 'building', r: [4966, 3597, 9, 9] },
				{ type: 'building', r: [4966, 3625, 12, 6] },
				{ type: 'building', r: [4966, 3659, 8, 9] },
				{ type: 'building', r: [4977, 3659, 8, 9] },
				{ id: 'dc_winterhold', type: 'data_center', name: 'Winterhold Data Center', r: [3419, 5053, 8, 5] },
				{ id: 'col_winterhold', name: 'Winterhold Mages College', r: [3437, 5053, 6, 5] },
				{ type: 'building', r: [3382, 4982, 14, 6] },
				{ type: 'building', r: [3382, 4991, 10, 6] },
				{ type: 'building', r: [3382, 5010, 8, 6] },
				{ type: 'building', r: [3382, 5019, 8, 8] },
				{ type: 'building', r: [3393, 5019, 10, 8] },
				{ type: 'building', r: [3382, 5050, 12, 6] },
				{ type: 'building', r: [3382, 5059, 12, 10] },
				{ type: 'building', r: [3382, 5084, 14, 10] },
				{ type: 'building', r: [3418, 4982, 12, 6] },
				{ type: 'building', r: [3433, 4982, 8, 6] },
				{ type: 'building', r: [3429, 5010, 14, 10] },
				{ type: 'building', r: [3418, 5023, 10, 9] },
				{ type: 'building', r: [3431, 5023, 8, 9] },
				{ type: 'building', r: [3418, 5062, 14, 7] },
				{ type: 'building', r: [3435, 5062, 14, 7] },
				{ type: 'building', r: [3418, 5084, 9, 7] },
				{ type: 'building', r: [3430, 5084, 14, 7] },
				{ type: 'building', r: [3470, 4982, 8, 7] },
				{ type: 'building', r: [3481, 4982, 14, 7] },
				{ type: 'building', r: [3470, 5010, 14, 8] },
				{ type: 'building', r: [3487, 5010, 8, 8] },
				{ type: 'building', r: [3487, 5021, 9, 10] },
				{ type: 'building', r: [3483, 5050, 12, 9] },
				{ type: 'building', r: [3470, 5062, 10, 9] },
				{ type: 'building', r: [3483, 5062, 10, 9] },
				{ type: 'building', r: [3470, 5084, 9, 8] },
				{ type: 'building', r: [3482, 5084, 10, 8] },
				{ type: 'building', r: [3516, 4982, 14, 7] },
				{ type: 'building', r: [3516, 5010, 12, 7] },
				{ type: 'building', r: [3516, 5020, 9, 9] },
				{ type: 'building', r: [3528, 5020, 9, 9] },
				{ type: 'building', r: [3516, 5050, 9, 8] },
				{ type: 'building', r: [3528, 5050, 10, 8] },
				{ type: 'building', r: [3516, 5061, 9, 6] },
				{ type: 'building', r: [3516, 5084, 8, 8] },
				{ id: 'dc_sandy_shores', type: 'data_center', name: 'Sandy Shores Data Center', r: [3269, 1228, 8, 5] },
				{ id: 'emb_sandy_shores', type: 'embassy', nation: 'mars', name: 'Sandy Shores Martian Embassy', r: [3287, 1228, 6, 5] },
				{ type: 'building', r: [3232, 1157, 14, 6] },
				{ type: 'building', r: [3232, 1185, 8, 9] },
				{ type: 'building', r: [3243, 1185, 10, 9] },
				{ type: 'building', r: [3232, 1197, 12, 8] },
				{ type: 'building', r: [3232, 1225, 14, 9] },
				{ type: 'building', r: [3232, 1237, 10, 6] },
				{ type: 'building', r: [3268, 1157, 10, 10] },
				{ type: 'building', r: [3281, 1157, 14, 10] },
				{ type: 'building', r: [3268, 1185, 10, 6] },
				{ type: 'building', r: [3281, 1185, 8, 6] },
				{ type: 'building', r: [3292, 1185, 9, 6] },
				{ type: 'building', r: [3268, 1194, 9, 8] },
				{ type: 'building', r: [3280, 1194, 8, 8] },
				{ type: 'building', r: [3283, 1236, 14, 9] },
				{ type: 'building', r: [3268, 1259, 12, 6] },
				{ type: 'building', r: [3283, 1259, 10, 6] },
				{ type: 'building', r: [3320, 1157, 8, 6] },
				{ type: 'building', r: [3331, 1157, 8, 6] },
				{ type: 'building', r: [3320, 1185, 10, 7] },
				{ type: 'building', r: [3333, 1185, 14, 7] },
				{ type: 'building', r: [3343, 1195, 9, 10] },
				{ type: 'building', r: [3332, 1225, 8, 7] },
				{ type: 'building', r: [3343, 1225, 9, 7] },
				{ type: 'building', r: [3320, 1235, 10, 10] },
				{ type: 'building', r: [3333, 1235, 10, 10] },
				{ type: 'building', r: [3320, 1259, 14, 10] },
				{ type: 'building', r: [3337, 1259, 8, 10] },
				{ type: 'building', r: [3366, 1157, 12, 7] },
				{ type: 'building', r: [3366, 1185, 10, 7] },
				{ type: 'building', r: [3379, 1185, 9, 7] },
				{ type: 'building', r: [3366, 1195, 12, 8] },
				{ type: 'building', r: [3366, 1225, 12, 8] },
				{ type: 'building', r: [3366, 1236, 8, 10] },
				{ type: 'building', r: [3377, 1236, 9, 10] },
				{ type: 'building', r: [3366, 1259, 8, 7] },
				{ type: 'building', r: [3377, 1259, 10, 7] }
			]
		},
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
			innate_weapons: ['fists'],
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