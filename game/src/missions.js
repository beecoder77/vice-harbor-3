// Marina Sol's five jobs — the story of VICE HARBOR. A mission is a list of
// stages; a stage is a place (or a condition), an objective line, optional
// dialogue and an optional countdown. The engine in main.js feeds it the
// world state every frame; this module decides when stages advance, when
// jobs pay out and when they are blown.

import { PLAZA, PARK, WORKSHOP, TOWER_CORNER, SAFEHOUSE, PACKAGE_SPOT, PIER_DOCK } from './config.js';

export const GT_SPOT = { x: PLAZA.x + 14, z: PLAZA.z - 10 }; // the pink GT waits here

const CHECKPOINTS = [
  { x: -240, z: -80 }, { x: -80, z: -240 }, { x: 80, z: -160 }, { x: 240, z: -80 },
  { x: 160, z: 80 }, { x: 0, z: 240 }, { x: -160, z: 160 }, { x: -240, z: 0 },
];

export function buildMissions() {
  return [
    {
      id: 'first-wheels',
      title: 'JOB 1 · FIRST WHEELS',
      reward: 600,
      intro: [
        'MARINA: Rio. You owe me, so listen good.',
        'MARINA: My GT is parked up at the market plaza. Pink. You cannot miss it.',
        'MARINA: Bring it to my workshop. Scratch it and you pay in teeth.',
      ],
      stages: [
        { kind: 'reach', at: GT_SPOT, radius: 11, objective: 'Reach the pink Marina GT at the plaza', needsMode: 'any' },
        { kind: 'deliver-gt', at: WORKSHOP, radius: 11, objective: 'Deliver the GT to Marina\u2019s Workshop', needsMode: 'gt' },
      ],
    },
    {
      id: 'hot-package',
      title: 'JOB 2 · HOT PACKAGE',
      reward: 900,
      intro: [
        'MARINA: A package is sitting downtown. No questions, no peeking.',
        'MARINA: Take it to my yacht at the marina. And Rio — the PD will care.',
      ],
      stages: [
        { kind: 'reach', at: PACKAGE_SPOT, radius: 9, objective: 'Pick up the package downtown', needsMode: 'any',
          say: ['RIO: Got it. Smells like trouble and money.'] },
        { kind: 'reach', at: PIER_DOCK, radius: 11, objective: 'Deliver the package to the yacht', needsMode: 'any',
          timer: 165, heatOnStart: 2, say: ['MARINA (radio): PD just lit up. Move, Rio!'] },
      ],
    },
    {
      id: 'street-cred',
      title: 'JOB 3 · STREET CRED',
      reward: 1200,
      intro: [
        'MARINA: The harbour crews think you are a tourist.',
        'MARINA: Hit every checkpoint I marked. Show them Port Azura is yours.',
      ],
      stages: CHECKPOINTS.map((at, i) => ({
        kind: 'reach', at, radius: 12, needsMode: 'car',
        objective: `Checkpoint ${i + 1} of 8 — hit the gold ring`,
        timer: i === 0 ? 300 : null, timerCarry: i > 0,
        say: i === 0 ? ['MARINA (radio): Clock is running. Drive like you mean it.'] : [],
      })),
    },
    {
      id: 'heat-run',
      title: 'JOB 4 · HEAT RUN',
      reward: 1600,
      intro: [
        'MARINA: Nico crossed the wrong crew. He is hiding in the fountain park.',
        'MARINA: Pick him up, get him to the safehouse — and the whole PD will know.',
      ],
      stages: [
        { kind: 'reach', at: PARK, radius: 10, objective: 'Pick up Nico at the fountain park', needsMode: 'any',
          say: ['NICO: Rio! Man, am I glad to see you. Drive! DRIVE!'] },
        { kind: 'reach', at: SAFEHOUSE, radius: 11, objective: 'Get Nico to the safehouse', needsMode: 'any', heatOnStart: 3,
          say: ['NICO: They are everywhere! Lose them after the drop!'] },
        { kind: 'lose-heat', objective: 'Lose the heat — break line of sight and stay hidden', needsMode: 'any',
          say: ['MARINA (radio): Nearly there. Go quiet until it cools off.'] },
      ],
    },
    {
      id: 'harbor-finale',
      title: 'JOB 5 · HARBOR FINALE',
      reward: 2500,
      intro: [
        'MARINA: Last job, Rio. Three crates. Plaza, the tower corner, the pier.',
        'MARINA: Every crate makes the PD angrier. Then everything to the yacht.',
        'MARINA: Do this and we are square. Do it well and we are partners.',
      ],
      stages: [
        { kind: 'reach', at: PLAZA, radius: 9, objective: 'Collect crate 1 of 3 — the plaza', needsMode: 'any', timer: 240,
          heatPlus: 1, say: ['RIO: One crate. Two to go.'] },
        { kind: 'reach', at: TOWER_CORNER, radius: 9, objective: 'Collect crate 2 of 3 — Azura Tower corner', needsMode: 'any',
          timerCarry: true, heatPlus: 1, say: ['RIO: Two. The harbour better be worth it.'] },
        { kind: 'reach', at: { x: 0, z: 330 }, radius: 9, objective: 'Collect crate 3 of 3 — the pier', needsMode: 'any',
          timerCarry: true, heatPlus: 1, say: ['RIO: All three. Now the yacht, fast.'] },
        { kind: 'reach', at: PIER_DOCK, radius: 11, objective: 'Deliver the crates to the yacht', needsMode: 'any', timerCarry: true,
          say: ['MARINA: That is everything. Rio… you are really something.'] },
      ],
    },
  ];
}

// Runtime state for the active mission.
export class MissionRunner {
  constructor(missions, hooks) {
    this.missions = missions;
    this.hooks = hooks; // {toast, banner, objective, timer, heat(n|'plus'), pay(n), stinger, save}
    this.index = 0;     // active mission index; == missions.length when the story is done
    this.stage = 0;
    this.timeLeft = null;
    this.started = false;
  }

  get current() { return this.missions[this.index] || null; }
  get stageDef() {
    const m = this.current;
    return m ? m.stages[this.stage] : null;
  }
  get complete() { return this.index >= this.missions.length; }

  begin(index, cash) {
    this.index = index;
    this.stage = 0;
    this.timeLeft = null;
    this.started = true;
    const m = this.current;
    if (m) {
      this.hooks.banner(m.title);
      for (const line of m.intro) this.hooks.toast(line, 5200);
      this.enterStage();
    }
  }

  enterStage() {
    const s = this.stageDef;
    if (!s) return;
    if (s.timer) this.timeLeft = s.timer;
    else if (!s.timerCarry) this.timeLeft = null;
    if (s.heatOnStart) this.hooks.heat(s.heatOnStart);
    if (s.heatPlus) this.hooks.heatPlus(s.heatPlus);
    for (const line of s.say || []) this.hooks.toast(line, 4600);
    this.hooks.objective(s.objective);
  }

  fail(reason) {
    const m = this.current;
    this.hooks.toast(reason || 'Job blown. Marina sends you back to the start of it.', 5200);
    this.hooks.stinger('fail');
    this.stage = 0;
    this.timeLeft = null;
    if (m) {
      this.hooks.banner(m.title + ' — AGAIN');
      this.enterStage();
    }
  }

  // ctx: {x, z, mode: 'foot'|'car', inGT, heat}
  // Returns events the caller acts on: 'stage', 'mission', 'story'.
  update(dt, ctx) {
    const m = this.current;
    if (!m || !this.started) return null;
    const s = this.stageDef;
    if (!s) return null;

    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      this.hooks.timer(this.timeLeft);
      if (this.timeLeft <= 0) {
        this.timeLeft = null;
        this.fail('Out of time. The job is blown.');
        return 'fail';
      }
    } else {
      this.hooks.timer(null);
    }

    let done = false;
    if (s.kind === 'reach') {
      const d = Math.hypot(ctx.x - s.at.x, ctx.z - s.at.z);
      const modeOk = s.needsMode === 'any' || (s.needsMode === 'car' && ctx.mode === 'car');
      if (d <= s.radius && modeOk) done = true;
    } else if (s.kind === 'deliver-gt') {
      const d = Math.hypot(ctx.x - s.at.x, ctx.z - s.at.z);
      if (d <= s.radius && ctx.inGT) done = true;
    } else if (s.kind === 'lose-heat') {
      if (ctx.heat <= 0.01) done = true;
    }
    if (!done) return null;

    this.stage++;
    if (this.stage >= m.stages.length) {
      const reward = m.reward;
      this.index++;
      this.stage = 0;
      this.timeLeft = null;
      this.hooks.pay(reward);
      this.hooks.stinger('win');
      this.hooks.toast(`JOB DONE — $${reward.toLocaleString('en-US')} wired to your account.`, 5600);
      if (this.complete) {
        this.hooks.banner('STORY COMPLETE');
        this.hooks.objective('Port Azura is yours. Free roam — Marina will call again someday.');
        return 'story';
      }
      const next = this.current;
      this.hooks.banner(next.title);
      for (const line of next.intro) this.hooks.toast(line, 5200);
      this.enterStage();
      return 'mission';
    }
    this.hooks.stinger('stage');
    this.enterStage();
    return 'stage';
  }
}
