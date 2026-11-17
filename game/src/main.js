// VICE HARBOR — main orchestration. Wires the city, Rio, traffic, crowd,
// police, missions, HUD and audio into one game loop, owns the state machine
// (title / play / pause / busted / wrecked / complete), the crime rules and
// the save file.

import * as THREE from 'three';
import { buildCity } from './city.js';
import { makeCar, placeCar, stepCar, syncCar, spawnTraffic, spawnParked, updateTrafficCar } from './vehicles.js';
import { spawnCrowd, updateCrowd, knockDown } from './people.js';
import { Player, Input, CameraRig } from './player.js';
import { Police } from './police.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { buildMissions, MissionRunner, GT_SPOT } from './missions.js';
import { SAVE_KEY, BUSTED_SPOT, WRECKED_SPOT, WORKSHOP, dist2d } from './config.js';
import { applyShot } from './shots.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);
camera.position.set(-24, 6, 78);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const cityAnim = buildCity(scene);
const hud = new Hud();
const audio = new GameAudio();
const input = new Input(canvas);

const player = new Player(scene);
const traffic = spawnTraffic(scene, 24);
const parked = spawnParked(scene);
const crowd = spawnCrowd(scene, 42);
const police = new Police(scene);

// Marina's GT — the pink car waiting at the plaza from the first minute.
const gt = makeCar('gt');
placeCar(gt, GT_SPOT.x, GT_SPOT.z, -0.7);
gt.ownedByPlayer = false;
gt.isGT = true;
scene.add(gt.group);

function allCars() {
  const list = [...traffic, ...parked, gt, ...police.cruisers.filter((c) => c.active)];
  if (game.car && !list.includes(game.car)) list.push(game.car);
  return list;
}

// ---- objective marker: a gold pillar of light -------------------------------
const marker = new THREE.Group();
{
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 36, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.y = 18;
  marker.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 2.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  marker.add(ring);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85),
    new THREE.MeshBasicMaterial({ color: 0xffe27a }),
  );
  gem.position.y = 3.4;
  gem.name = 'gem';
  marker.add(gem);
  marker.visible = false;
  scene.add(marker);
}

// ---- game state ---------------------------------------------------------------
const game = {
  state: shotName ? 'play' : 'title',
  mode: 'foot',           // 'foot' | 'car'
  car: null,
  cash: 250,
  missionIndex: 0,
  storyDone: false,
  frozen: !!shotName,
  time: 0,
  crimeCooldown: 0,
  prevX: player.x, prevZ: player.z,
  vx: 0, vz: 0,
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s.cash !== 'number' || typeof s.mission !== 'number') return null;
    return s;
  } catch { return null; }
}
function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: game.cash, mission: game.missionIndex, complete: game.storyDone,
    }));
  } catch { /* private mode etc. — the game runs fine without a save */ }
}

const runner = new MissionRunner(buildMissions(), {
  toast: (t, ms) => hud.toast(t, ms),
  banner: (t) => hud.setBanner(t),
  objective: (t) => hud.setObjective(t),
  timer: (s) => {
    if (s === null || s === undefined) hud.setTimer('');
    else {
      const m = Math.floor(s / 60), ss = Math.floor(s % 60);
      hud.setTimer(`${m}:${ss.toString().padStart(2, '0')}`, s < 30);
    }
  },
  heat: (n) => police.setHeat(n),
  heatPlus: (n) => police.addHeat(n),
  pay: (n) => { game.cash += n; hud.setCash(game.cash); audio.cash(); writeSave(); },
  stinger: (k) => audio.stinger(k),
  save: () => writeSave(),
});

// ---- screens ------------------------------------------------------------------
const screens = {};
for (const id of ['title-screen', 'pause-screen', 'busted-screen', 'wrecked-screen', 'complete-screen']) {
  screens[id] = document.getElementById(id);
}
function showScreen(id) {
  for (const k of Object.keys(screens)) screens[k].style.display = k === id ? 'flex' : 'none';
}
function hideScreens() { for (const k of Object.keys(screens)) screens[k].style.display = 'none'; }

const saveAtBoot = loadSave();
if (saveAtBoot) {
  document.getElementById('continue-btn').style.display = 'inline-block';
  document.getElementById('save-note').textContent =
    `Saved game: $${saveAtBoot.cash.toLocaleString('en-US')} · job ${Math.min(saveAtBoot.mission + 1, 5)} of 5${saveAtBoot.complete ? ' · story complete' : ''}`;
}

function startGame(fromSave) {
  audio.ensure();
  hideScreens();
  game.state = 'play';
  if (fromSave && saveAtBoot) {
    game.cash = saveAtBoot.cash;
    game.missionIndex = saveAtBoot.mission;
    game.storyDone = !!saveAtBoot.complete;
  } else {
    game.cash = 250;
    game.missionIndex = 0;
    game.storyDone = false;
    writeSave();
  }
  hud.setCash(game.cash);
  if (game.storyDone) {
    hud.setBanner('FREE ROAM');
    hud.setObjective('Port Azura is yours. Marina will call again someday.');
    runner.started = false;
    runner.index = runner.missions.length;
  } else {
    runner.begin(game.missionIndex, game.cash);
  }
  rig.snap(input, player.x, 0, player.z);
}

document.getElementById('new-btn').addEventListener('click', () => startGame(false));
document.getElementById('continue-btn').addEventListener('click', () => startGame(true));
document.getElementById('resume-btn').addEventListener('click', () => { hideScreens(); game.state = 'play'; });
document.getElementById('busted-btn').addEventListener('click', () => afterBusted());
document.getElementById('wrecked-btn').addEventListener('click', () => afterWrecked());
document.getElementById('complete-btn').addEventListener('click', () => { hideScreens(); game.state = 'play'; });

function afterBusted() {
  hideScreens();
  game.state = 'play';
}
function afterWrecked() {
  hideScreens();
  game.state = 'play';
}

function doBusted() {
  const fine = 150 + police.stars * 100;
  game.cash = Math.max(0, game.cash - fine);
  hud.setCash(game.cash);
  document.getElementById('busted-detail').textContent =
    `The Azura PD impound your ride and fine you $${fine}. Marina is not impressed.`;
  police.clearAll();
  exitCar(true);
  player.x = BUSTED_SPOT.x; player.z = BUSTED_SPOT.z;
  player.health = Math.max(player.health, 60);
  if (!game.storyDone && runner.current) runner.fail('Busted. The job has to start over.');
  writeSave();
  game.state = 'busted';
  showScreen('busted-screen');
  audio.stinger('fail');
}

function doWrecked() {
  game.cash = Math.max(0, game.cash - 200);
  hud.setCash(game.cash);
  if (game.car) {
    const wreck = game.car;
    exitCar(true);
    wreck.group.visible = false;
    const ti = traffic.indexOf(wreck); if (ti >= 0) traffic.splice(ti, 1);
    const pi = parked.indexOf(wreck); if (pi >= 0) parked.splice(pi, 1);
    if (wreck === gt) { placeCar(gt, GT_SPOT.x, GT_SPOT.z, -0.7); gt.health = 100; gt.group.visible = true; }
  }
  police.clearAll();
  player.x = WRECKED_SPOT.x; player.z = WRECKED_SPOT.z;
  player.health = 100;
  if (!game.storyDone && runner.current) runner.fail('Wrecked. The job has to start over.');
  writeSave();
  game.state = 'wrecked';
  showScreen('wrecked-screen');
  audio.stinger('fail');
}

// ---- entering / leaving cars ---------------------------------------------------
function nearestStealable() {
  let best = null, bestD = 3.4;
  for (const car of [...parked, ...traffic, gt]) {
    const d = dist2d(player.x, player.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function enterCar(car) {
  game.mode = 'car';
  game.car = car;
  player.group.visible = false;
  if (car.kind === 'traffic') car.driverless = true;
  if (!car.isGT && !car.ownedByPlayer) {
    car.ownedByPlayer = true;
    const witnessed = police.sees(player.x, player.z, 75) || crowd.some((p) => dist2d(p.x, p.z, player.x, player.z) < 22);
    if (witnessed) {
      police.addHeat(1);
      hud.toast('Witnessed: vehicle theft. The PD is rolling.', 3600);
    } else {
      hud.toast('You lift the car clean. Nobody saw a thing.', 3000);
    }
  }
  audio.ensure();
}

function exitCar(silent) {
  if (game.mode !== 'car') return;
  const car = game.car;
  game.mode = 'foot';
  game.car = null;
  if (car) {
    // step out on the left side of the car
    const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
    player.x = car.x + rx * 2.1;
    player.z = car.z + rz * 2.1;
    player.heading = car.heading;
    if (car.kind === 'traffic') {
      car.driverless = false;
      reinitTraffic(car); // hand the car back to the traffic brain
    }
  }
  player.group.visible = true;
  if (!silent) audio.engine(null, 0);
}

function reinitTraffic(car) {
  // snap a returned car onto the nearest street axis so it can rejoin traffic
  const ROAD_CENTRES_LOCAL = [-240, -160, -80, 0, 80, 160, 240];
  const near = (v) => ROAD_CENTRES_LOCAL.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const horiz = Math.abs(Math.sin(car.heading)) > Math.abs(Math.cos(car.heading));
  if (horiz) {
    car.dir = Math.sin(car.heading) > 0 ? 0 : 1;
    car.avenue = near(car.z - (car.dir === 0 ? 3.4 : -3.4));
  } else {
    car.dir = Math.cos(car.heading) > 0 ? 2 : 3;
    car.avenue = near(car.x - (car.dir === 2 ? -3.4 : 3.4));
  }
  car.turnAt = null;
  car.targetSpeed = 9;
}

// ---- combat: the punch -----------------------------------------------------------
function doPunch() {
  player.punch();
  audio.ensure();
  audio.punch();
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  for (const ped of crowd) {
    if (ped.state === 'down') continue;
    const dx = ped.x - player.x, dz = ped.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.8 && (dx * fx + dz * fz) / Math.max(d, 0.01) > 0.25) {
      knockDown(ped);
      if (police.sees(player.x, player.z, 75) || crowd.some((p) => p !== ped && dist2d(p.x, p.z, player.x, player.z) < 20)) {
        police.addHeat(1);
        hud.toast('Witnessed: assault. Bad idea, Rio.', 3200);
      }
    }
  }
}

// ---- per-frame update --------------------------------------------------------------
const rig = new CameraRig(camera);
const clock = new THREE.Clock();

function focusObject() {
  return game.mode === 'car' && game.car ? game.car : player;
}

function update(dt) {
  game.time += dt;
  const focus = focusObject();
  game.vx = (focus.x - game.prevX) / Math.max(dt, 0.001);
  game.vz = (focus.z - game.prevZ) / Math.max(dt, 0.001);
  game.prevX = focus.x; game.prevZ = focus.z;

  cityAnim.update(dt, focus);

  // traffic (skip cars Rio is driving or has emptied; frozen solid for shots)
  const cars = allCars();
  if (!game.frozen) {
    for (const car of traffic) {
      if (car === game.car || car.driverless) continue;
      updateTrafficCar(car, dt, cars, game.time);
    }
    const threats = cars.filter((c) => Math.abs(c.speed) > 0.5);
    updateCrowd(crowd, dt, threats);
  }
  for (const car of parked) if (car !== game.car) syncCar(car, game.time);
  if (gt !== game.car) syncCar(gt, game.time);

  if (game.state === 'play' && !game.frozen) {
    if (game.mode === 'foot') {
      player.update(dt, input);
      // car ramming Rio himself is the one thing Port Azura does not forgive — skip: traffic brakes for him via car-following
      const near = nearestStealable();
      hud.setPrompt(near ? 'F — get in the car' : '');
      if (input.hit('KeyF') && near) enterCar(near);
      if (input.hit('KeyJ') || input.hit('KeyK')) doPunch();
    } else {
      const car = game.car;
      const drive = {
        throttle: (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) + (input.down('KeyS') || input.down('ArrowDown') ? -1 : 0),
        steer: (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) + (input.down('KeyD') || input.down('ArrowRight') ? -1 : 0),
        brake: input.down('Space'),
        boost: input.down('ShiftLeft') || input.down('ShiftRight'),
      };
      stepCar(car, drive, dt, cars);
      syncCar(car, game.time);
      hud.setPrompt('F — get out · Space — handbrake · Shift — boost');
      if (input.hit('KeyF') && Math.abs(car.speed) < 4) exitCar(false);
      // running people down is a crime, and it shows
      for (const ped of crowd) {
        if (ped.state !== 'down' && Math.abs(car.speed) > 3.5 && dist2d(ped.x, ped.z, car.x, car.z) < 1.8) {
          knockDown(ped);
          police.addHeat(1);
          hud.toast('You ran someone down. The whole city saw that.', 3400);
          audio.punch();
        }
      }
      // ramming a cruiser is also a crime
      game.crimeCooldown -= dt;
      for (const c of police.cruisers) {
        if (c.active && game.crimeCooldown <= 0 && dist2d(car.x, car.z, c.x, c.z) < 3.6 && Math.abs(car.speed) > 6) {
          police.addHeat(1);
          game.crimeCooldown = 3;
          hud.toast('You rammed a police cruiser!', 3000);
        }
      }
      if (car.health <= 0) { doWrecked(); }
    }

    // police + bust
    const target = {
      x: focus.x, z: focus.z, vx: game.vx, vz: game.vz,
      speed: game.mode === 'car' ? game.car.speed : player.speed,
    };
    if (police.update(dt, target, cars, game.time) === 'busted') doBusted();

    // Rio's own health: hard crashes hurt, standing around heals
    if (game.mode === 'car' && game.car) {
      const carDmg = 100 - game.car.health;
      if (carDmg > 55) player.health -= dt * 2.2;
    } else if (player.health < 100) {
      player.health = Math.min(100, player.health + dt * 2.5);
    }
    if (player.health <= 0 && game.state === 'play') doWrecked();

    // missions
    if (!game.storyDone) {
      const ev = runner.update(dt, {
        x: focus.x, z: focus.z,
        mode: game.mode,
        inGT: game.car === gt,
        heat: police.heat,
      });
      if (ev === 'mission' || ev === 'story') {
        game.missionIndex = runner.index;
        game.storyDone = runner.complete;
        writeSave();
        if (ev === 'story') { game.state = 'complete'; showScreen('complete-screen'); }
      }
      const s = runner.stageDef;
      if (s && s.at) {
        marker.visible = true;
        marker.position.set(s.at.x, 0, s.at.z);
        marker.getObjectByName('gem').position.y = 3.4 + Math.sin(game.time * 2.2) * 0.4;
      } else {
        marker.visible = false;
      }
    }

    // pause
    if (input.hit('Escape') || input.hit('KeyP')) {
      game.state = 'pause';
      showScreen('pause-screen');
    }
    if (input.hit('KeyM')) {
      hud.toast(audio.toggleMute() ? 'Sound off.' : 'Sound on.', 1600);
    }
  }

  // camera
  if (!game.frozen) {
    const f = focusObject();
    const ty = game.mode === 'car' ? 0.8 : 0;
    rig.update(dt, input, f.x, ty, f.z, game.mode === 'car' ? game.car.heading : null, game.mode === 'car');
  }

  // audio beds
  if (game.mode === 'car' && game.car && game.state === 'play') audio.engine(game.car.speed, dt);
  else audio.engine(null, dt);
  const pd = police.nearestActiveDist(focus.x, focus.z);
  audio.siren(police.heat > 0 && pd < 55 ? Math.max(0, 1 - pd / 55) : 0);

  // HUD
  hud.setStars(police.stars, police.bust);
  const f2 = focusObject();
  if (game.mode === 'car' && game.car) {
    const kmh = Math.round(Math.abs(game.car.speed) * 3.6);
    hud.setVitals(
      `RIO ♥ ${Math.ceil(player.health)}% &nbsp;·&nbsp; ${game.car.isGT ? 'MARINA GT' : 'CAR'} ▓ ${Math.ceil(game.car.health)}% &nbsp;·&nbsp; ${kmh} km/h`,
    );
  } else {
    hud.setVitals(`RIO ♥ ${Math.ceil(player.health)}%${player.speed > 4.5 ? ' · sprinting' : ''}`);
  }
  hud.drawMap({
    x: f2.x, z: f2.z, heading: game.mode === 'car' ? game.car.heading : player.heading,
    objective: (!game.storyDone && runner.stageDef && runner.stageDef.at) ? runner.stageDef.at : null,
    police: police.cruisers.filter((c) => c.active),
    t: game.time,
  });

  input.endFrame();
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'play' || game.state === 'title') update(dt);
  else if (game.state === 'pause') { /* hold the world still behind the menu */ }
  else update(0);
  renderer.render(scene, camera);
}

if (shotName) {
  hideScreens();
  document.body.classList.add('shot');
  applyShot({ scene, camera, player, gt, police, hud, game, traffic, parked }, shotName);
  // a few warm-up frames so shaders and shadows settle before the capture
  for (let i = 0; i < 4; i++) renderer.render(scene, camera);
  window.__vhReady = true;
} else {
  showScreen('title-screen');
}

// ---- test handle ---------------------------------------------------------------------
window.__vh = {
  game, player, police, runner, gt, traffic, parked, crowd, hud,
  state() {
    return {
      state: game.state, mode: game.mode, cash: game.cash,
      mission: runner.index, stage: runner.stage,
      heat: police.heat, stars: police.stars,
      x: focusObject().x, z: focusObject().z,
      speed: game.mode === 'car' ? game.car.speed : player.speed,
      inGT: game.car === gt, health: player.health,
      carHealth: game.car ? game.car.health : null,
    };
  },
  start(fromSave = false) { startGame(fromSave); },
  teleport(x, z) {
    const f = focusObject();
    if (game.mode === 'car' && game.car) placeCar(game.car, x, z, game.car.heading);
    else { player.x = x; player.z = z; player.sync(0); }
  },
  enterNearest() { const c = nearestStealable(); if (c) { enterCar(c); return true; } return false; },
  exitCar() { exitCar(false); },
  setHeat(n) { police.setHeat(n); },
  markerPos() { const s = runner.stageDef; return s && s.at ? { ...s.at } : null; },
};

frame();
