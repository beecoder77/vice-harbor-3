// Port Azura itself: streets, towers, the plaza, the park, Marina's Workshop,
// the beach and the marina. Built once from the shared map in config.js.
// Also owns the static collision set (building AABBs + round obstacles) that
// the player, traffic and police all collide against.

import * as THREE from 'three';
import {
  BLOCK, ROAD, HALF, ROAD_CENTRES, BLOCK_CENTRES,
  PLAZA, PARK, WORKSHOP_BLOCK, TOWER, WATER_Z, PIER_END_Z, YACHT,
} from './config.js';
import { makeRng } from './rng.js';

export const colliders = [];  // {minX, maxX, minZ, maxZ}
export const circles = [];    // {x, z, r}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function addCollider(x, z, w, d) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

// Resolve a circle (x, z, r) out of every static collider. Returns corrected [x, z].
export function collideCircle(x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = x - c.minX, pr = c.maxX - x, pt = z - c.minZ, pb = c.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r; else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r; else z = c.maxZ + r;
      }
    }
  }
  for (const c of circles) {
    const dx = x - c.x, dz = z - c.z;
    const rr = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      x = c.x + (dx / d) * rr;
      z = c.z + (dz / d) * rr;
    }
  }
  return [x, z];
}

// A facade texture painted on a canvas: plaster colour + a grid of windows,
// some of them already lit for the evening.
function facadeTexture(rng, base, litRatio) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 128, 10);
  const cols = 6, rows = 12;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const lit = rng.next() < litRatio;
      g.fillStyle = lit ? '#ffd98a' : 'rgba(38,52,74,0.85)';
      g.fillRect(8 + i * 20, 16 + j * 20, 12, 12);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const FACADE_BASES = ['#c96f4a', '#b8b0a4', '#7fa3b8', '#d9a05b', '#9c7bb8', '#68a08c', '#c2c9d1'];

export function buildCity(scene) {
  const rng = makeRng(20261117);
  const animated = { water: null, fountain: null, time: 0 };

  // ---- sky dome: a sunset gradient with a low sun disc, drawn in a shader --
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { sunDir: { value: new THREE.Vector3(-0.45, 0.16, -0.88).normalize() } },
      vertexShader: `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir;
        void main() {
          float h = clamp(vDir.y, -0.08, 1.0);
          vec3 zen = vec3(0.20, 0.27, 0.52);
          vec3 mid = vec3(0.93, 0.52, 0.38);
          vec3 hor = vec3(1.00, 0.72, 0.42);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
          col = mix(col, zen, smoothstep(0.12, 0.65, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.75, 0.45) * pow(s, 220.0) * 1.6;
          col += vec3(1.0, 0.55, 0.30) * pow(s, 7.0) * 0.28;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  scene.fog = new THREE.Fog(0xe8906a, 150, 620);
  const hemi = new THREE.HemisphereLight(0x9db8ff, 0x6b4a30, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.0);
  sun.position.set(-140, 90, -260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  animated.sun = sun;

  // ---- ground: city slab, streets, block pads ------------------------------
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40),
    new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -0.05;
  slab.receiveShadow = true;
  scene.add(slab);

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.95 });
  const dashTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#33363c'; g.fillRect(0, 0, 16, 64);
    g.fillStyle = '#e8e4da'; g.fillRect(6, 6, 4, 30);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const dashMat = new THREE.MeshStandardMaterial({ map: dashTex, roughness: 0.95 });

  for (const c of ROAD_CENTRES) {
    for (const along of [0, 1]) {
      // one plain strip + one dashed centre strip per street
      const plain = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + ROAD, ROAD), roadMat);
      plain.rotation.x = -Math.PI / 2;
      if (along === 0) { plain.position.set(0, 0, c); } else { plain.rotation.z = Math.PI / 2; plain.position.set(c, 0, 0); }
      plain.receiveShadow = true;
      scene.add(plain);
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 0.7), dashMat.clone());
      dash.material.map = dashTex.clone();
      dash.material.map.needsUpdate = true;
      dash.material.map.repeat.set(HALF * 2 / 8, 1);
      dash.rotation.x = -Math.PI / 2;
      if (along === 0) { dash.position.set(0, 0.012, c); } else { dash.rotation.z = Math.PI / 2; dash.position.set(c, 0.012, 0); }
      scene.add(dash);
    }
  }

  // The z=0 avenue is the palm boulevard: a planted median down its middle.
  const median = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2, 0.3, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x5d7d4a, roughness: 1 }),
  );
  median.position.set(0, 0.15, 0);
  median.receiveShadow = true;
  scene.add(median);
  colliders.push({ minX: -HALF, maxX: HALF, minZ: -1.2, maxZ: 1.2 });

  const padMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 1 });
  for (const cx of BLOCK_CENTRES) {
    for (const cz of BLOCK_CENTRES) {
      const pad = box(BLOCK, 0.3, BLOCK, padMat);
      pad.position.set(cx, 0, cz);
      pad.castShadow = false;
      scene.add(pad);
    }
  }

  // ---- buildings -----------------------------------------------------------
  const facades = FACADE_BASES.map((b) => facadeTexture(rng, b, 0.35));
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4c4640, roughness: 1 });
  const skip = new Set(['2,4', '3,1', '4,4', '0,0']); // plaza, park, workshop, tower blocks
  BLOCK_CENTRES.forEach((cx, i) => {
    BLOCK_CENTRES.forEach((cz, j) => {
      if (skip.has(`${i},${j}`)) return;
      const n = rng.int(3, 5);
      const slots = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) slots.push([a * 20, b * 20]);
      for (let s = slots.length - 1; s > 0; s--) { const k = Math.floor(rng.next() * (s + 1)); [slots[s], slots[k]] = [slots[k], slots[s]]; }
      for (let k = 0; k < n; k++) {
        const [ox, oz] = slots[k];
        const w = rng.range(11, 16), d = rng.range(11, 16);
        const h = rng.range(12, 44) * (rng.chance(0.18) ? 1.7 : 1);
        const tex = rng.pick(facades);
        const mat = new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.9,
          emissive: 0xff9a3c, emissiveMap: tex, emissiveIntensity: 0.32,
        });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
        b.position.set(cx + ox, 0.15 + h / 2, cz + oz);
        b.castShadow = true; b.receiveShadow = true;
        scene.add(b);
        addCollider(cx + ox, cz + oz, w, d);
        if (rng.chance(0.5)) { // rooftop water tank / AC block
          const t = box(w * 0.3, 1.6, d * 0.3, roofMat);
          t.position.set(cx + ox + rng.range(-2, 2), 0.15 + h + 0.8, cz + oz + rng.range(-2, 2));
          scene.add(t);
        }
      }
    });
  });

  // ---- Azura Tower ----------------------------------------------------------
  {
    const tex = facadeTexture(rng, '#5d7d9e', 0.5);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.6, metalness: 0.25,
      emissive: 0xffb35c, emissiveMap: tex, emissiveIntensity: 0.45,
    });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(22, 92, 22), [mat, mat, roofMat, roofMat, mat, mat]);
    tower.position.set(TOWER.x, 0.15 + 46, TOWER.z);
    tower.castShadow = true; tower.receiveShadow = true;
    scene.add(tower);
    addCollider(TOWER.x, TOWER.z, 22, 22);
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 1.4, 14, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.7, roughness: 0.35 }),
    );
    spire.position.set(TOWER.x, 0.15 + 92 + 7, TOWER.z);
    scene.add(spire);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4444 }),
    );
    beacon.position.set(TOWER.x, 0.15 + 92 + 14.5, TOWER.z);
    scene.add(beacon);
    animated.beacon = beacon;
  }

  // ---- market plaza (block 2,4) --------------------------------------------
  {
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8c39a, roughness: 1 });
    const floor = box(BLOCK - 6, 0.34, BLOCK - 6, stone);
    floor.position.set(PLAZA.x, 0.02, PLAZA.z);
    floor.castShadow = false;
    scene.add(floor);
    const stallRoof = [0xd95555, 0x3f9e6b, 0xe0a83c, 0x4a7fc9];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = PLAZA.x + Math.cos(a) * 21, sz = PLAZA.z + Math.sin(a) * 21;
      const post = box(0.25, 2.4, 0.25, roofMat);
      post.position.set(sx, 1.35, sz);
      scene.add(post);
      const roof = box(4.6, 0.18, 3.6, new THREE.MeshStandardMaterial({ color: stallRoof[k % 4], roughness: 0.8 }));
      roof.position.set(sx, 2.65, sz);
      roof.rotation.y = a;
      scene.add(roof);
      const crate = box(3.4, 1.0, 2.4, new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 1 }));
      crate.position.set(sx, 0.65, sz);
      crate.rotation.y = a;
      scene.add(crate);
      circles.push({ x: sx, z: sz, r: 2.2 });
    }
    const obelisk = box(2, 9, 2, stone);
    obelisk.position.set(PLAZA.x, 4.65, PLAZA.z);
    scene.add(obelisk);
    addCollider(PLAZA.x, PLAZA.z, 2.4, 2.4);
  }

  // ---- fountain park (block 3,1) -------------------------------------------
  {
    const grass = box(BLOCK - 4, 0.34, BLOCK - 4, new THREE.MeshStandardMaterial({ color: 0x5d8a4c, roughness: 1 }));
    grass.position.set(PARK.x, 0.02, PARK.z);
    grass.castShadow = false;
    scene.add(grass);
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7.6, 1.1, 24),
      new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.7 }),
    );
    basin.position.set(PARK.x, 0.7, PARK.z);
    basin.castShadow = true; basin.receiveShadow = true;
    scene.add(basin);
    circles.push({ x: PARK.x, z: PARK.z, r: 8 });
    const waterDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.4, 0.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x3f7fbf, roughness: 0.15, metalness: 0.4 }),
    );
    waterDisc.position.set(PARK.x, 1.2, PARK.z);
    scene.add(waterDisc);
    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.5, 4.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xbfe2ff, roughness: 0.1, transparent: true, opacity: 0.75 }),
    );
    jet.position.set(PARK.x, 3.4, PARK.z);
    scene.add(jet);
    animated.fountain = jet;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      const bx = PARK.x + Math.cos(a) * 16, bz = PARK.z + Math.sin(a) * 16;
      const bench = box(3.2, 0.5, 0.9, new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 }));
      bench.position.set(bx, 0.45, bz);
      bench.rotation.y = -a;
      scene.add(bench);
    }
  }

  // ---- Marina's Workshop (block 4,4) ----------------------------------------
  {
    const wall = new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.9 });
    const shed = box(30, 8, 20, wall);
    shed.position.set(WORKSHOP_BLOCK.x, 0.15 + 4, WORKSHOP_BLOCK.z - 14);
    scene.add(shed);
    addCollider(WORKSHOP_BLOCK.x, WORKSHOP_BLOCK.z - 14, 30, 20);
    const signMat = new THREE.MeshStandardMaterial({ color: 0x27324a, emissive: 0xff5c8a, emissiveIntensity: 0.9, roughness: 0.6 });
    const sign = box(24, 2.2, 0.4, signMat);
    sign.position.set(WORKSHOP_BLOCK.x, 7.2, WORKSHOP_BLOCK.z - 3.7);
    scene.add(sign);
    const door = box(9, 5, 0.3, new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.7, metalness: 0.4 }));
    door.position.set(WORKSHOP_BLOCK.x - 6, 2.65, WORKSHOP_BLOCK.z - 3.8);
    scene.add(door);
    const door2 = door.clone();
    door2.position.x = WORKSHOP_BLOCK.x + 6;
    scene.add(door2);
    for (let k = 0; k < 4; k++) {
      const tyre = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12),
        new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 1 }),
      );
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(WORKSHOP_BLOCK.x - 13 + k * 1.3, 0.55, WORKSHOP_BLOCK.z + 2);
      scene.add(tyre);
    }
  }

  // ---- palms + lamps (instanced) --------------------------------------------
  {
    const spots = [];
    for (let x = -HALF + 14; x <= HALF - 10; x += 26) { spots.push([x, -6.4]); spots.push([x + 13, 6.4]); }
    for (const c of ROAD_CENTRES) {
      if (c === 0) continue;
      for (let t = -HALF + 20; t <= HALF - 16; t += 52) {
        spots.push([t, c - 9.6]); spots.push([c + 9.6, t + 26]);
      }
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      spots.push([PARK.x + Math.cos(a) * 24, PARK.z + Math.sin(a) * 24]);
      spots.push([PLAZA.x + Math.cos(a + 0.3) * 27, PLAZA.z + Math.sin(a + 0.3) * 27]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.4, 6);
    trunkGeo.translate(0, 2.7, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 });
    const frondGeo = new THREE.ConeGeometry(2.4, 1.05, 7);
    frondGeo.translate(0, 5.75, 0);
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    spots.forEach(([x, z], idx) => {
      e.set(rng.range(-0.05, 0.05), rng.next() * Math.PI * 2, rng.range(-0.05, 0.05));
      q.setFromEuler(e);
      const s = rng.range(0.85, 1.25);
      m4.compose(new THREE.Vector3(x, groundY(x, z), z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(idx, m4);
      fronds.setMatrixAt(idx, m4);
      if (Math.abs(z) > 2 || Math.abs(x) > 2) circles.push({ x, z, r: 0.45 });
    });
    trunks.castShadow = true;
    scene.add(trunks); scene.add(fronds);

    const lampSpots = [];
    for (const c of ROAD_CENTRES) {
      for (let t = -HALF + 24; t <= HALF - 20; t += 48) {
        lampSpots.push([t, c - 9.2]); lampSpots.push([t + 24, c + 9.2]);
        lampSpots.push([c - 9.2, t + 12]); lampSpots.push([c + 9.2, t + 36]);
      }
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6);
    poleGeo.translate(0, 2.8, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.5 });
    const bulbGeo = new THREE.SphereGeometry(0.32, 8, 6);
    bulbGeo.translate(0, 5.7, 0);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpots.length);
    lampSpots.forEach(([x, z], idx) => {
      m4.makeTranslation(x, 0, z);
      poles.setMatrixAt(idx, m4);
      bulbs.setMatrixAt(idx, m4);
    });
    scene.add(poles); scene.add(bulbs);
  }

  // ---- beach, sea, pier, yacht ----------------------------------------------
  {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2 + 160, 104),
      new THREE.MeshStandardMaterial({ color: 0xe3c491, roughness: 1 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, -0.02, 299);
    sand.receiveShadow = true;
    scene.add(sand);

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 460, 48, 16),
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          uniform float uTime; varying float vWave; varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            float w = sin(p.x * 0.08 + uTime * 1.4) * 0.35 + sin(p.y * 0.13 - uTime * 1.1) * 0.28;
            p.z += w; vWave = w;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          varying float vWave; varying vec2 vUv;
          void main() {
            vec3 deep = vec3(0.05, 0.23, 0.42);
            vec3 lift = vec3(0.25, 0.55, 0.72);
            vec3 col = mix(deep, lift, clamp(vWave * 1.4 + 0.35, 0.0, 1.0));
            col += vec3(1.0, 0.6, 0.35) * smoothstep(0.75, 1.0, vWave) * 0.35;
            gl_FragColor = vec4(col, 0.93);
          }`,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.12, WATER_Z + 250);
    scene.add(water);
    animated.water = water;

    const deckMat = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 1 });
    const deck = box(14, 0.5, PIER_END_Z - WATER_Z + 14, deckMat);
    deck.position.set(0, 0.3, (WATER_Z + PIER_END_Z) / 2 + 2);
    deck.castShadow = false;
    scene.add(deck);
    for (let z = WATER_Z + 2; z <= PIER_END_Z; z += 9) {
      for (const px of [-6.4, 6.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 8), deckMat);
        post.position.set(px, -0.3, z);
        scene.add(post);
      }
    }
    // yacht: hull, cabin, mast
    const hull = box(5.4, 1.8, 15, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.35 }));
    hull.position.set(YACHT.x + 10, 0.7, YACHT.z);
    scene.add(hull);
    const cabin = box(3.6, 1.6, 6, new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.3 }));
    cabin.position.set(YACHT.x + 10, 2.3, YACHT.z - 1);
    scene.add(cabin);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 9, 6),
      new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.6, roughness: 0.4 }),
    );
    mast.position.set(YACHT.x + 10, 6, YACHT.z + 2);
    scene.add(mast);
    circles.push({ x: YACHT.x + 10, z: YACHT.z, r: 8 });
  }

  animated.update = (dt, focus) => {
    animated.time += dt;
    if (animated.water) animated.water.material.uniforms.uTime.value = animated.time;
    if (animated.fountain) animated.fountain.scale.y = 1 + Math.sin(animated.time * 7) * 0.08;
    if (animated.beacon) animated.beacon.material.color.setHex(Math.sin(animated.time * 2.4) > 0 ? 0xff4444 : 0x661111);
    if (animated.sun && focus) {
      animated.sun.position.set(focus.x - 140, 90, focus.z - 260);
      animated.sun.target.position.set(focus.x, 0, focus.z);
    }
  };
  return animated;
}

function groundY(x, z) {
  // local copy of the pad rule so instanced dressing sits on the pads
  for (const cx of BLOCK_CENTRES) {
    if (Math.abs(x - cx) > BLOCK / 2) continue;
    for (const cz of BLOCK_CENTRES) if (Math.abs(z - cz) <= BLOCK / 2) return 0.15;
  }
  return 0;
}
