// VICE HARBOR — hand-in program for the make.fun gta6-01 entry.
//
// The game itself is the static site in game/ (open game/index.html in a
// browser and play; there is no build step). This program's whole job is the
// delivery run: walk the game folder and the screenshots folder, copy every
// file into the output directory in a stable order, then ask the vendored
// make.fun library to summarise the result into dossier.json — the document
// the competition's scorer rebuilds and compares byte for byte, so the caps
// below are passed exactly as the gate specifies them.
//
// Run locally the same way the grader does, with MAKEFUN_OUTPUT_DIR standing
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Recursively list a folder's files in sorted order so the copy (and the log
// it prints) is identical on every run and every machine.
function listFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  walk(dir);
  return found;
}

// Copy one staged folder (game/ or screenshots/) into the output tree,
// mirroring its relative layout, and report what moved.
function stageFolder(name: string): number {
  const source = join(repoRoot, name);
  if (!existsSync(source)) {
    console.log(`stage: ${name}/ not present, skipped`);
    return 0;
  }
  mkdirSync(join(outDir, name), { recursive: true });
  let bytes = 0;
  for (const file of listFiles(source)) {
    const rel = relative(source, file);
    const dest = join(outDir, name, rel);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(file, dest);
    bytes += statSync(file).size;
    console.log(`stage: ${name}/${rel}`);
  }
  console.log(`stage: ${name}/ complete, ${bytes} bytes`);
  return bytes;
}

mkdirSync(outDir, { recursive: true });
stageFolder('game');
stageFolder('screenshots');

// The gate's own limits, mirrored from the kit so a bad entry fails here
// first rather than at the scorer: at most 160 KiB of dossier text, 4
// screenshots of 256 KiB, 993 game files totalling 48 MiB, and no game path
// longer than 1,000 bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`dossier: wrote ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
