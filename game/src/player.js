// Rio, the player character: on-foot movement, the punch, and the mouse-orbit
// camera that follows him (and whatever he is driving).

import * as THREE from 'three';
import { groundHeight, clampWorld } from './config.js';
import { collideCircle } from './city.js';
import { makePerson, posePerson } from './people.js';

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.pressed = new Set(); // one-shot, cleared by the game loop each frame
    this.camYaw = Math.PI;    // start looking north up the boulevard
    this.camPitch = 0.34;
    this.dragging = false;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => { this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lx, dy = e.clientY - this.ly;
      this.lx = e.clientX; this.ly = e.clientY;
      this.camYaw -= dx * 0.0052;
      this.camPitch = Math.max(0.06, Math.min(1.05, this.camPitch + dy * 0.004));
    });
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
}

export class Player {
  constructor(scene) {
    this.group = makePerson({ shirt: 0xff5c8a, pants: 0x27324a, skin: 0xc98d5f, hair: 0x14100c });
    this.x = -30; this.z = 138; // the plaza's south edge, a short stroll from the GT
    this.heading = Math.PI;
    this.speed = 0;
    this.phase = 0;
    this.health = 100;
    this.punchT = 0;
    this.dead = false;
    scene.add(this.group);
    this.sync(0);
  }

  // Returns the movement vector length actually travelled (for crime checks).
  update(dt, input) {
    let mx = 0, mz = 0;
    const sy = Math.sin(input.camYaw), cy = Math.cos(input.camYaw);
    // camera looks along -(sin yaw, cos yaw); W walks that way
    if (input.down('KeyW') || input.down('ArrowUp')) { mx += -sy; mz += -cy; }
    if (input.down('KeyS') || input.down('ArrowDown')) { mx -= -sy; mz -= -cy; }
    if (input.down('KeyD') || input.down('ArrowRight')) { mx += cy; mz += -sy; }
    if (input.down('KeyA') || input.down('ArrowLeft')) { mx -= cy; mz -= -sy; }
    const len = Math.hypot(mx, mz);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const target = len > 0 ? (sprint ? 6.6 : 3.4) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (len > 0) {
      mx /= len; mz /= len;
      this.heading = Math.atan2(mx, mz);
      this.x += mx * this.speed * dt;
      this.z += mz * this.speed * dt;
      this.phase += dt * this.speed * 2.6;
    }
    [this.x, this.z] = collideCircle(this.x, this.z, 0.42);
    this.x = clampWorld(this.x);
    this.z = Math.max(-254, Math.min(374, this.z));
    // keep Rio out of the deep: the sand is fine, the sea is not
    if (this.z > 306 && !(Math.abs(this.x) <= 7.5 && this.z <= 362)) this.z = Math.min(this.z, 310);
    if (this.punchT > 0) this.punchT -= dt;
    this.sync(dt);
    return this.speed;
  }

  punch() { this.punchT = 0.32; }

  sync() {
    const y = groundHeight(this.x, this.z);
    this.group.position.set(this.x, y, this.z);
    this.group.rotation.y = this.heading;
    this.group.userData.baseY = y;
    posePerson(this.group, this.phase, 0);
    if (this.punchT > 0) {
      const k = Math.sin((0.32 - this.punchT) / 0.32 * Math.PI);
      this.group.userData.parts.armR.rotation.x = -1.9 * k;
    }
  }
}

// Third-person camera: orbits with the mouse, eases behind a moving car.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(-24, 6, 80);
    this.look = new THREE.Vector3();
  }
  update(dt, input, tx, ty, tz, followHeading, driving) {
    if (driving && followHeading !== null) {
      // ease the yaw toward behind-the-car, but never fight a fresh drag
      let want = followHeading + Math.PI;
      let d = want - input.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 0.02 && !input.dragging) input.camYaw += d * Math.min(1, dt * 1.6);
    }
    const dist = driving ? 11.5 : 8;
    const cy = Math.cos(input.camPitch), sy = Math.sin(input.camPitch);
    const px = tx + Math.sin(input.camYaw) * cy * dist;
    const pz = tz + Math.cos(input.camYaw) * cy * dist;
    const py = ty + 1.4 + sy * dist;
    const k = Math.min(1, dt * 7);
    this.pos.x += (px - this.pos.x) * k;
    this.pos.y += (py - this.pos.y) * k;
    this.pos.z += (pz - this.pos.z) * k;
    this.camera.position.copy(this.pos);
    this.look.set(tx, ty + 1.7, tz);
    this.camera.lookAt(this.look);
  }
  snap(input, tx, ty, tz) {
    const dist = 9;
    this.pos.set(
      tx + Math.sin(input.camYaw) * Math.cos(input.camPitch) * dist,
      ty + 1.4 + Math.sin(input.camPitch) * dist,
      tz + Math.cos(input.camYaw) * Math.cos(input.camPitch) * dist,
    );
    this.camera.position.copy(this.pos);
    this.camera.lookAt(tx, ty + 1.7, tz);
  }
}
