// Screenshot poses: ?shot=title|chase|onfoot|mission freezes the world in a
// composed scene so the entry's screenshots are real renders of the game
// itself, framed on purpose. The world does not simulate in a pose (main.js
// keeps `game.frozen` set); this module only arranges and dresses the HUD.

import * as THREE from 'three';
import { placeCar } from './vehicles.js';
import { GT_SPOT } from './missions.js';
import { PIER_DOCK } from './config.js';

function goldPillar(scene, x, z) {
  const grp = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 36, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 18;
  grp.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 2.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  grp.add(ring);
  grp.position.set(x, 0, z);
  scene.add(grp);
  return grp;
}

function cam(camera, x, y, z, lx, ly, lz) {
  camera.position.set(x, y, z);
  camera.lookAt(lx, ly, lz);
}

export function applyShot(g, name) {
  const { scene, camera, player, gt, police, hud, game } = g;
  hud.setCash(1450);

  if (name === 'title') {
    document.body.classList.add('hide-hud');
    // Rio beside the GT on the palm boulevard, camera low on the road looking
    // west into the sunset, subjects in the near ground.
    player.x = 16.5; player.z = 5.6; player.heading = -2.1; player.sync(0);
    placeCar(gt, 6, 2.8, Math.PI / 2 + 0.3);
    cam(camera, 28, 2.4, 6.2, 2, 2.6, 1.6);
  } else if (name === 'chase') {
    // The GT at speed down a north–south street (no median palms to block the
    // view), two cruisers on its tail, 4 stars — the whole pack receding into
    // the sunset from a camera behind the last cruiser.
    placeCar(gt, 76.6, 52, 0);
    gt.speed = 21;
    game.mode = 'car';
    game.car = gt;
    player.group.visible = false;
    const [c1, c2] = police.cruisers;
    placeCar(c1, 83.2, 33, 0.1);
    c1.active = true; c1.group.visible = true; c1.speed = 20;
    placeCar(c2, 76.8, 24, -0.06);
    c2.active = true; c2.group.visible = true; c2.speed = 19;
    police.setHeat(4);
    hud.setBanner('JOB 4 · HEAT RUN');
    hud.setObjective('Get Nico to the safehouse — lose them, Rio!');
    hud.setCash(2870);
    cam(camera, 71.5, 4.6, 12, 79, 1.0, 48);
  } else if (name === 'onfoot') {
    // Rio walks the market plaza toward the GT and its gold job marker.
    player.x = -31; player.z = 114; player.heading = Math.atan2(GT_SPOT.x - player.x, GT_SPOT.z - player.z);
    player.sync(0);
    placeCar(gt, GT_SPOT.x, GT_SPOT.z, -0.7);
    goldPillar(scene, GT_SPOT.x, GT_SPOT.z);
    hud.setBanner('JOB 1 · FIRST WHEELS');
    hud.setObjective('Reach the pink Marina GT at the plaza');
    cam(camera, -50, 3.0, 130, -26, 1.5, 109);
  } else if (name === 'mission') {
    // Hot Package at speed, southbound for the marina, timer running, 2 stars.
    placeCar(gt, -3.4, 178, 0);
    gt.speed = 17;
    game.mode = 'car';
    game.car = gt;
    player.group.visible = false;
    police.setHeat(2);
    const [c1] = police.cruisers;
    placeCar(c1, -12, 148, 0.1);
    c1.active = true; c1.group.visible = true; c1.speed = 16;
    hud.setBanner('JOB 2 · HOT PACKAGE');
    hud.setObjective('Deliver the package to the yacht');
    hud.setTimer('2:28', false);
    hud.setCash(1750);
    goldPillar(scene, PIER_DOCK.x, PIER_DOCK.z);
    cam(camera, -13.5, 4.4, 160, 2, 1.4, 200);
  }
}
