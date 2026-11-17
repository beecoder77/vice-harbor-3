// Cars: one factory that builds every vehicle in Port Azura (traffic, parked,
// police and Marina's GT share it), one arcade physics step that all of them
// drive with, and the lane-following traffic brain.

import * as THREE from 'three';
import { ROAD_CENTRES, HALF, groundHeight, clampWorld, dist2d } from './config.js';
import { collideCircle } from './city.js';
import { makeRng } from './rng.js';

const rng = makeRng(777);

const BODY_COLORS = [0xd94f3d, 0x3d7bd9, 0xe8c33a, 0x59b06a, 0xe8e6df, 0x2e3138, 0xb84a8c, 0x3fb8b0, 0xd97b2f, 0x7a5fd0];

const geoCache = {
  body: new THREE.BoxGeometry(1.86, 0.62, 4.3),
  cabin: new THREE.BoxGeometry(1.66, 0.55, 2.1),
  wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12),
  lightBar: new THREE.BoxGeometry(1.3, 0.16, 0.5),
};
const matCache = {
  tyre: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1d2c3f, roughness: 0.15, metalness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.3, metalness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.4 }),
  black: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 }),
  pink: new THREE.MeshStandardMaterial({ color: 0xff5c8a, roughness: 0.25, metalness: 0.3 }),
  redLight: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  blueLight: new THREE.MeshBasicMaterial({ color: 0x2a6aff }),
};

let carSeq = 0;

// Build a car. kind: 'traffic' | 'parked' | 'police' | 'gt'
// Cars face +z; heading h means forward = (sin h, cos h) in the ground plane.
export function makeCar(kind, colorHex) {
  const group = new THREE.Group();
  const paint = kind === 'police'
    ? matCache.white
    : kind === 'gt'
      ? matCache.pink
      : new THREE.MeshStandardMaterial({ color: colorHex ?? rng.pick(BODY_COLORS), roughness: 0.35, metalness: 0.25 });

  const body = new THREE.Mesh(geoCache.body, paint);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.9), paint);
  nose.position.set(0, 0.42, 2.35);
  group.add(nose);
  const cabin = new THREE.Mesh(geoCache.cabin, matCache.glass);
  cabin.position.set(0, 1.1, -0.25);
  cabin.castShadow = true;
  group.add(cabin);
  if (kind === 'gt') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), matCache.black);
    spoiler.position.set(0, 1.0, -2.05);
    group.add(spoiler);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 4.32), matCache.white);
    stripe.position.set(0, 0.89, 0);
    group.add(stripe);
  }
  if (kind === 'police') {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.3, 4.32), matCache.black);
    skirt.position.y = 0.3;
    group.add(skirt);
    const bar = new THREE.Mesh(geoCache.lightBar, matCache.black);
    bar.position.set(0, 1.48, -0.25);
    group.add(bar);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.4), matCache.redLight);
    rl.position.set(-0.34, 1.48, -0.25);
    group.add(rl);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.4), matCache.blueLight);
    bl.position.set(0.34, 1.48, -0.25);
    group.add(bl);
    group.userData.lights = [rl, bl];
  }
  const wheels = [];
  for (const [wx, wz] of [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]]) {
    const w = new THREE.Mesh(geoCache.wheel, matCache.tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.36, wz);
    group.add(w);
    wheels.push(w);
  }
  group.userData.wheels = wheels;

  const car = {
    id: carSeq++,
    kind,
    group,
    x: 0, z: 0, heading: 0, speed: 0,
    health: 100,
    radius: 1.55,
    maxSpeed: kind === 'police' ? 30 : kind === 'gt' ? 34 : 24,
    accel: kind === 'police' ? 13 : kind === 'gt' ? 15 : 11,
    // traffic brain state
    dir: 0, avenue: 0, targetSpeed: 9, turnAt: null, turnDir: 0,
    flash: rng.next() * 6,
  };
  return car;
}

export function placeCar(car, x, z, heading) {
  car.x = x; car.z = z; car.heading = heading; car.speed = 0;
  syncCar(car, 0);
}

export function syncCar(car, t) {
  car.group.position.set(car.x, groundHeight(car.x, car.z), car.z);
  car.group.rotation.y = car.heading;
  for (const w of car.group.userData.wheels) w.rotation.x = car.wheelSpin || 0;
  if (car.group.userData.lights) {
    const on = Math.sin((t || 0) * 10 + car.flash) > 0;
    car.group.userData.lights[0].visible = on;
    car.group.userData.lights[1].visible = !on;
  }
}

// Shared arcade step. input: {throttle -1..1, steer -1..1, brake bool}
export function stepCar(car, input, dt, allCars) {
  const handbrake = input.brake ? 2.6 : 1;
  if (input.throttle > 0) {
    car.speed += car.accel * input.throttle * dt * (car.speed < 0 ? 2.2 : 1);
  } else if (input.throttle < 0) {
    car.speed += car.accel * 0.7 * input.throttle * dt * (car.speed > 0 ? 2.2 : 1);
  }
  // rolling drag + air drag
  car.speed -= car.speed * 0.55 * dt * handbrake;
  if (input.brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 14 * dt);
  const cap = car.maxSpeed * (input.boost ? 1.25 : 1);
  car.speed = Math.max(-9, Math.min(cap, car.speed));

  const steerAuthority = Math.min(1, Math.abs(car.speed) / 6) * (input.brake ? 1.5 : 1);
  car.heading += input.steer * 1.55 * steerAuthority * dt * (car.speed < 0 ? -1 : 1) * Math.min(1, Math.abs(car.speed) / 9 + 0.25);

  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  car.x += fx * car.speed * dt;
  car.z += fz * car.speed * dt;
  car.wheelSpin = (car.wheelSpin || 0) + (car.speed * dt) / 0.36;

  // static world collision (radius ~ car half width, checked at centre + nose)
  const before = Math.abs(car.speed);
  let [nx, nz] = collideCircle(car.x, car.z, 1.15);
  if (nx !== car.x || nz !== car.z) { car.x = nx; car.z = nz; car.speed *= 0.45; }
  const noseX = car.x + fx * 1.9, noseZ = car.z + fz * 1.9;
  [nx, nz] = collideCircle(noseX, noseZ, 0.9);
  if (nx !== noseX || nz !== noseZ) {
    car.x += nx - noseX; car.z += nz - noseZ;
    car.speed *= 0.5;
    if (before > 7) car.health -= (before - 7) * 1.6;
  }
  car.x = clampWorld(car.x); car.z = Math.min(car.z, HALF + 130);
  if (car.z > HALF + 2 && Math.abs(car.x) > 8) car.z = Math.min(car.z, HALF + 44); // sand stops cars off-pier

  // car-vs-car soft collision
  if (allCars) {
    for (const other of allCars) {
      if (other === car) continue;
      const d = dist2d(car.x, car.z, other.x, other.z);
      const min = car.radius + other.radius;
      if (d > 0.01 && d < min) {
        const push = (min - d) / 2;
        const ux = (car.x - other.x) / d, uz = (car.z - other.z) / d;
        car.x += ux * push; car.z += uz * push;
        other.x -= ux * push; other.z -= uz * push;
        const impact = Math.abs(car.speed - other.speed);
        if (impact > 6) { car.health -= (impact - 6) * 1.2; other.health -= (impact - 6) * 0.8; }
        car.speed *= 0.72; other.speed *= 0.72;
      }
    }
  }
}

// ---- traffic brain ---------------------------------------------------------
// Directions: 0:+x 1:-x 2:+z 3:-z. `avenue` is the fixed coordinate of the
// street the car is currently travelling along (z for x-dirs, x for z-dirs).
const DIR_VEC = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_HEADING = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];

function laneOffset(dir) {
  // right-hand traffic: offset to the driver's right of the street centre
  return dir === 0 ? 3.4 : dir === 1 ? -3.4 : dir === 2 ? -3.4 : 3.4;
}

export function initTrafficCar(car) {
  car.dir = rng.int(0, 3);
  car.avenue = rng.pick(ROAD_CENTRES);
  const along = rng.range(-HALF + 10, HALF - 10);
  if (car.dir <= 1) placeCar(car, along, car.avenue + laneOffset(car.dir), DIR_HEADING[car.dir]);
  else placeCar(car, car.avenue + laneOffset(car.dir), along, DIR_HEADING[car.dir]);
  car.targetSpeed = rng.range(8, 11.5);
  car.speed = car.targetSpeed;
}

function nearestCrossAhead(car) {
  // next intersection centre strictly ahead of the car along its direction
  const along = car.dir <= 1 ? car.x : car.z;
  const s = car.dir === 0 || car.dir === 2 ? 1 : -1;
  let best = null, bestD = Infinity;
  for (const c of ROAD_CENTRES) {
    const d = (c - along) * s;
    if (d > 1 && d < bestD) { bestD = d; best = c; }
  }
  return best === null ? null : { at: best, dist: bestD };
}

export function updateTrafficCar(car, dt, allCars, t) {
  const cross = nearestCrossAhead(car);
  // decide a turn when the next junction is coming up
  if (cross && car.turnAt === null && cross.dist < 26) {
    const atEdge = Math.abs(cross.at) >= 240;
    if (atEdge || rng.chance(0.34)) {
      car.turnAt = cross.at;
      // turn left or right (never a U-turn); at the map edge both work
      car.turnDir = rng.chance(0.5) ? 1 : -1;
    } else {
      car.turnAt = Infinity; // straight through this one; re-arm after passing
      car.passAt = cross.at;
    }
  }
  if (car.turnAt === Infinity) {
    const along = car.dir <= 1 ? car.x : car.z;
    const s = car.dir === 0 || car.dir === 2 ? 1 : -1;
    if ((along - car.passAt) * s > 4) car.turnAt = null;
  }

  // execute the turn once we reach the junction centre
  if (car.turnAt !== null && car.turnAt !== Infinity && cross && cross.dist < 1.6) {
    const nd = car.dir <= 1
      ? (car.turnDir > 0 ? 2 : 3)   // heading ±x, turn to ±z
      : (car.turnDir > 0 ? 1 : 0);  // heading ±z, turn to ±x
    // check the new direction stays in the city from this junction
    const junctionAlong = car.dir <= 1 ? car.z : car.x; // coordinate of current street
    car.avenue = car.dir <= 1 ? car.x : car.z;          // the street we are turning onto
    car.dir = nd;
    car.turnAt = null;
    void junctionAlong;
  }

  // desired heading + lane-centre pull
  const targetHeading = DIR_HEADING[car.dir];
  let dh = targetHeading - car.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, dh * 2.4));
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const lateral = car.dir <= 1
    ? (car.avenue + laneOffset(car.dir)) - car.z
    : (car.avenue + laneOffset(car.dir)) - car.x;
  const lateralAlongRight = car.dir <= 1 ? lateral * fz : -lateral * fx;
  const steerTotal = Math.max(-1, Math.min(1, steer + lateralAlongRight * 0.12));

  // car-following: slow for anything ahead in our corridor
  let desired = car.targetSpeed;
  if (cross && car.turnAt !== null && car.turnAt !== Infinity && cross.dist < 16) desired = Math.min(desired, 5.5);
  for (const other of allCars) {
    if (other === car) continue;
    const dx = other.x - car.x, dz = other.z - car.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < 11 && side < 2.3) {
      desired = Math.min(desired, Math.max(0, other.speed) * (ahead / 11));
      if (ahead < 4.6) desired = 0;
    }
  }

  const throttle = car.speed < desired ? 0.75 : -0.4;
  stepCar(car, { throttle, steer: steerTotal, brake: car.speed - desired > 3 }, dt, null);
  syncCar(car, t);
}

// Parked fleet: nose-in along kerbs and on forecourts, all stealable.
export function spawnParked(scene) {
  const cars = [];
  const spots = [];
  for (const c of ROAD_CENTRES) {
    for (let t = -HALF + 34; t <= HALF - 40 && spots.length < 15; t += 61) {
      if (rng.chance(0.6)) spots.push([t + rng.range(-6, 6), c - 6.6, 0]);
      if (rng.chance(0.6)) spots.push([t + 30, c + 6.6, Math.PI]);
    }
  }
  spots.push([-58, 96, 0.4], [150, 96, -0.5], [-113, -73.5, 0], [66, 166.5, Math.PI / 2], [-186, 73.5, -Math.PI / 2]);
  for (const [x, z, h] of spots.slice(0, 20)) {
    const car = makeCar('parked');
    placeCar(car, x, z, h + rng.range(-0.12, 0.12));
    scene.add(car.group);
    cars.push(car);
  }
  return cars;
}

export function spawnTraffic(scene, count) {
  const cars = [];
  for (let i = 0; i < count; i++) {
    const car = makeCar('traffic');
    initTrafficCar(car);
    scene.add(car.group);
    cars.push(car);
  }
  return cars;
}
