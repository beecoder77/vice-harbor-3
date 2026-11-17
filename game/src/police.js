// The Azura PD: a pool of six cruisers running predictive pursuit, and the
// wanted-heat model they answer to. Heat rises on witnessed crime, decays
// while no cruiser can see Rio, and cruisers only hunt while heat is up.

import { ROAD_CENTRES, dist2d } from './config.js';
import { makeCar, placeCar, stepCar, syncCar } from './vehicles.js';
import { makeRng } from './rng.js';

const rng = makeRng(99);

export class Police {
  constructor(scene) {
    this.cruisers = [];
    for (let i = 0; i < 6; i++) {
      const car = makeCar('police');
      car.active = false;
      car.group.visible = false;
      scene.add(car.group);
      this.cruisers.push(car);
    }
    this.heat = 0;          // 0..5, fractional; stars shown = ceil
    this.seenTimer = 0;     // time since a cruiser last had eyes on Rio
    this.bust = 0;          // 0..1 bust meter
  }

  get stars() { return Math.ceil(this.heat); }

  addHeat(n) {
    this.heat = Math.max(0, Math.min(5, this.heat + n));
  }
  setHeat(n) { this.heat = Math.max(0, Math.min(5, n)); }

  // Is any active cruiser close enough to be watching the target?
  sees(x, z, range = 58) {
    for (const c of this.cruisers) {
      if (c.active && dist2d(c.x, c.z, x, z) < range) return true;
    }
    return false;
  }

  nearestActiveDist(x, z) {
    let best = Infinity;
    for (const c of this.cruisers) {
      if (c.active) best = Math.min(best, dist2d(c.x, c.z, x, z));
    }
    return best;
  }

  spawnPoint(tx, tz) {
    // a street junction 65–95 m away from the target
    for (let tries = 0; tries < 12; tries++) {
      const x = rng.pick(ROAD_CENTRES), z = rng.pick(ROAD_CENTRES);
      const d = dist2d(x, z, tx, tz);
      if (d > 60 && d < 110) return { x, z };
    }
    return { x: ROAD_CENTRES[0], z: ROAD_CENTRES[6] };
  }

  // target: {x, z, vx, vz, speed} — the thing being chased (Rio or his car).
  // Returns 'busted' when the bust meter fills, else null.
  update(dt, target, allCars, t) {
    const want = this.stars;
    let activeCount = 0;
    for (const c of this.cruisers) if (c.active) activeCount++;

    // bring cruisers in / send them home as heat changes
    for (const c of this.cruisers) {
      if (activeCount < want && !c.active) {
        const s = this.spawnPoint(target.x, target.z);
        placeCar(c, s.x, s.z, Math.atan2(target.x - s.x, target.z - s.z));
        c.active = true;
        c.group.visible = true;
        activeCount++;
      } else if (activeCount > want && c.active && dist2d(c.x, c.z, target.x, target.z) > 55) {
        c.active = false;
        c.group.visible = false;
        activeCount--;
      }
    }

    const seen = this.sees(target.x, target.z);
    if (seen) this.seenTimer = 0; else this.seenTimer += dt;
    if (this.seenTimer > 9 && this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * 0.09); // a star every ~11 s hidden
    }

    let bustNow = false;
    for (const c of this.cruisers) {
      if (!c.active) continue;
      // predictive pursuit: aim where the target will be in ~0.6 s
      const px = target.x + (target.vx || 0) * 0.6;
      const pz = target.z + (target.vz || 0) * 0.6;
      const dx = px - c.x, dz = pz - c.z;
      const dist = Math.hypot(dx, dz);
      const wantHeading = Math.atan2(dx, dz);
      let dh = wantHeading - c.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, dh * 1.9));
      let throttle = 1;
      if (Math.abs(dh) > 2.2) throttle = -0.6;        // target behind: back up and swing round
      else if (Math.abs(dh) > 1.1) throttle = 0.25;
      if (dist < 5 && Math.abs(target.speed) < 2) throttle = 0; // sit on him while the meter fills
      stepCar(c, { throttle, steer, brake: false }, dt, allCars);
      syncCar(c, t);
      if (dist < 8.5 && Math.abs(target.speed) < 2.2) bustNow = true;
    }

    if (bustNow && this.heat > 0) {
      this.bust += dt / 3;
      if (this.bust >= 1) {
        this.bust = 0;
        return 'busted';
      }
    } else {
      this.bust = Math.max(0, this.bust - dt * 0.8);
    }
    return null;
  }

  clearAll() {
    this.heat = 0;
    this.bust = 0;
    for (const c of this.cruisers) { c.active = false; c.group.visible = false; }
  }
}
