// Port Azura — shared world geometry and tuning constants.
// Every system (city builder, traffic, police, missions) reads the same map
// from here so the pieces can never disagree about where things are.

export const BLOCK = 64;          // city block footprint (m)
export const ROAD = 16;           // street width (m)
export const PITCH = 80;          // block pitch: BLOCK + ROAD
export const HALF = 248;          // streets span -HALF..HALF on both axes

export const ROAD_CENTRES = [-240, -160, -80, 0, 80, 160, 240];
export const BLOCK_CENTRES = [-200, -120, -40, 40, 120, 200];

// Named places. Block (i, j) is centred at (BLOCK_CENTRES[i], BLOCK_CENTRES[j]).
export const PLAZA = { x: -40, z: 120 };          // block (2,4) — market plaza
export const PARK = { x: 40, z: -120 };           // block (3,1) — fountain park
export const WORKSHOP = { x: 120, z: 140 };       // block (4,4) — Marina's Workshop forecourt
export const WORKSHOP_BLOCK = { x: 120, z: 120 };
export const TOWER = { x: -200, z: -200 };        // block (0,0) — Azura Tower
export const TOWER_CORNER = { x: -166, z: -166 }; // plaza-side corner of the tower block
export const SAFEHOUSE = { x: -150, z: 90 };
export const PACKAGE_SPOT = { x: -160, z: -160 }; // downtown alley crossing

export const WATER_Z = HALF + 46;                 // shoreline (south edge, +z)
export const PIER_END_Z = WATER_Z + 66;           // marina pier tip
export const PIER_DOCK = { x: 0, z: PIER_END_Z - 8 }; // delivery point near the yacht
export const YACHT = { x: 0, z: WATER_Z + 52 };

export const BUSTED_SPOT = { x: -80, z: -88 };    // Azura PD impound corner
export const WRECKED_SPOT = { x: 216, z: -208 };  // harbour clinic kerb

export const SAVE_KEY = 'vice-harbor-save-v1';

export const WORLD_MIN = -254;
export const WORLD_MAX = 254;

// Height of the walkable/drivable surface at a point: block pads sit 0.15 m
// above the streets, the pier deck 0.55 m above the sand.
export function groundHeight(x, z) {
  if (Math.abs(x) <= 7.5 && z >= WATER_Z - 4 && z <= PIER_END_Z + 2) return 0.55;
  for (const cx of BLOCK_CENTRES) {
    if (Math.abs(x - cx) > BLOCK / 2) continue;
    for (const cz of BLOCK_CENTRES) {
      if (Math.abs(z - cz) <= BLOCK / 2) return 0.15;
    }
  }
  return 0;
}

export function clampWorld(v) {
  return v < WORLD_MIN ? WORLD_MIN : v > WORLD_MAX ? WORLD_MAX : v;
}

// Distance helper in the ground plane.
export function dist2d(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
