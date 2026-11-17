// People: a low-poly person factory shared by Rio and the crowd, plus the
// pedestrian system — sidewalk ring walkers who stroll, flee and get knocked
// down. A person is a small group of boxes with swinging limbs; `pose` walks
// the limbs, `fall` tips the whole body over.

import * as THREE from 'three';
import { BLOCK_CENTRES, groundHeight, clampWorld, dist2d } from './config.js';
import { collideCircle } from './city.js';
import { makeRng } from './rng.js';

const rng = makeRng(4242);

const SKIN = [0xf2c49b, 0xc98d5f, 0x8a5a34, 0x6e4226];
const SHIRTS = [0xd94f3d, 0x3d7bd9, 0xe8c33a, 0x59b06a, 0xe8e6df, 0xb84a8c, 0x3fb8b0, 0xd97b2f, 0x44506b, 0xf2f0ea];
const PANTS = [0x2e3138, 0x44506b, 0x6b4a30, 0x707880, 0x27324a];

function limb(w, h, d, mat, px, py, pz) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0); // pivot at the top so rotation swings it
  const m = new THREE.Mesh(geo, mat);
  m.position.set(px, py, pz);
  m.castShadow = true;
  return m;
}

export function makePerson({ shirt, pants, skin, hair = 0x2a2019 } = {}) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt ?? rng.pick(SHIRTS), roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants ?? rng.pick(PANTS), roughness: 0.95 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin ?? rng.pick(SKIN), roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirtMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), skinMat);
  head.position.y = 1.56;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), new THREE.MeshStandardMaterial({ color: hair, roughness: 1 }));
  cap.position.y = 1.76;
  g.add(cap);

  const armL = limb(0.13, 0.58, 0.13, shirtMat, -0.34, 1.34, 0);
  const armR = limb(0.13, 0.58, 0.13, shirtMat, 0.34, 1.34, 0);
  const legL = limb(0.16, 0.72, 0.16, pantsMat, -0.14, 0.74, 0);
  const legR = limb(0.16, 0.72, 0.16, pantsMat, 0.14, 0.74, 0);
  g.add(armL, armR, legL, legR);
  g.userData.parts = { armL, armR, legL, legR, torso, head };
  return g;
}

// Animate a walking person. phase advances with speed; fallT 0..1 tips over.
export function posePerson(group, phase, fallT) {
  const p = group.userData.parts;
  if (fallT > 0) {
    group.rotation.x = -Math.PI / 2 * Math.min(1, fallT);
    group.position.y = group.userData.baseY ?? 0;
    p.armL.rotation.x = -2.4; p.armR.rotation.x = -2.9;
    p.legL.rotation.x = 0.15; p.legR.rotation.x = -0.1;
    return;
  }
  group.rotation.x = 0;
  const s = Math.sin(phase);
  p.legL.rotation.x = s * 0.65;
  p.legR.rotation.x = -s * 0.65;
  p.armL.rotation.x = -s * 0.5;
  p.armR.rotation.x = s * 0.5;
}

// ---- the crowd ---------------------------------------------------------------
// Each walker owns a block and strolls its pavement ring (offset ~29 m from
// the block centre), turning at the corners.
export function spawnCrowd(scene, count) {
  const peds = [];
  for (let i = 0; i < count; i++) {
    const group = makePerson({});
    scene.add(group);
    const cx = rng.pick(BLOCK_CENTRES), cz = rng.pick(BLOCK_CENTRES);
    const ring = rng.range(27.5, 30.5);
    const side = rng.int(0, 3);
    const t = rng.range(-ring, ring);
    const ped = {
      group, cx, cz, ring, side, t,
      dirSign: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(1.1, 1.7),
      phase: rng.next() * 6,
      x: 0, z: 0, heading: 0,
      state: 'walk', // walk | flee | down
      timer: 0, fleeX: 0, fleeZ: 0,
    };
    ringPos(ped);
    posePerson(group, ped.phase, 0);
    syncPed(ped);
    peds.push(ped);
  }
  return peds;
}

function ringPos(ped) {
  // position on the ring for (side, t): sides are the four pavement edges,
  // heading is the direction of travel along that edge
  const { cx, cz, ring, side, t } = ped;
  const d = ped.dirSign;
  if (side === 0) { ped.x = cx + t; ped.z = cz - ring; ped.heading = d > 0 ? Math.PI / 2 : -Math.PI / 2; }
  if (side === 1) { ped.x = cx + ring; ped.z = cz + t; ped.heading = d > 0 ? 0 : Math.PI; }
  if (side === 2) { ped.x = cx - t; ped.z = cz + ring; ped.heading = d > 0 ? -Math.PI / 2 : Math.PI / 2; }
  if (side === 3) { ped.x = cx - ring; ped.z = cz - t; ped.heading = d > 0 ? Math.PI : 0; }
}

export function knockDown(ped) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.timer = 4.5;
}

export function updateCrowd(peds, dt, threats) {
  for (const ped of peds) {
    const g = ped.group;
    if (ped.state === 'down') {
      ped.timer -= dt;
      posePerson(g, ped.phase, Math.min(1, (4.5 - ped.timer) * 3 + 0.4));
      if (ped.timer <= 0) { ped.state = 'walk'; g.rotation.x = 0; }
      syncPed(ped);
      continue;
    }
    // danger check: any fast car close by sends them running
    let danger = null;
    for (const th of threats) {
      if (Math.abs(th.speed) > 4 && dist2d(ped.x, ped.z, th.x, th.z) < 7) { danger = th; break; }
    }
    if (danger) {
      ped.state = 'flee';
      ped.timer = 1.6;
      const dx = ped.x - danger.x, dz = ped.z - danger.z;
      const d = Math.max(0.5, Math.hypot(dx, dz));
      ped.fleeX = dx / d; ped.fleeZ = dz / d;
    }
    if (ped.state === 'flee') {
      ped.timer -= dt;
      ped.x += ped.fleeX * 4.4 * dt;
      ped.z += ped.fleeZ * 4.4 * dt;
      ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
      ped.phase += dt * 11;
      [ped.x, ped.z] = collideCircle(ped.x, ped.z, 0.35);
      if (ped.timer <= 0) {
        ped.state = 'walk';
        // rejoin the nearest point of the home ring
        ped.side = nearestSide(ped);
        ped.t = sideCoord(ped);
      }
    } else {
      ped.t += ped.dirSign * ped.speed * dt;
      if (ped.t > ped.ring) { ped.t = -ped.ring + (ped.t - ped.ring); ped.side = (ped.side + 1) % 4; }
      if (ped.t < -ped.ring) { ped.t = ped.ring + (ped.t + ped.ring); ped.side = (ped.side + 3) % 4; }
      ringPos(ped);
      ped.phase += dt * ped.speed * 3.4;
      [ped.x, ped.z] = collideCircle(ped.x, ped.z, 0.35);
    }
    ped.x = clampWorld(ped.x); ped.z = Math.min(ped.z, 372);
    posePerson(g, ped.phase, 0);
    syncPed(ped);
  }
}

function nearestSide(ped) {
  const dx = ped.x - ped.cx, dz = ped.z - ped.cz;
  if (Math.abs(dz) > Math.abs(dx)) return dz < 0 ? 0 : 2;
  return dx > 0 ? 1 : 3;
}
function sideCoord(ped) {
  if (ped.side === 0 || ped.side === 2) return Math.max(-ped.ring, Math.min(ped.ring, ped.x - ped.cx)) * (ped.side === 2 ? -1 : 1);
  return Math.max(-ped.ring, Math.min(ped.ring, ped.z - ped.cz)) * (ped.side === 3 ? -1 : 1);
}

function syncPed(ped) {
  const y = groundHeight(ped.x, ped.z);
  ped.group.position.set(ped.x, y, ped.z);
  ped.group.rotation.y = ped.heading;
  ped.group.userData.baseY = y;
}
