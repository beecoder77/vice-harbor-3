// All-procedural WebAudio: an engine hum that follows speed, two-tone sirens,
// a sunset synth pad, and little stingers for mission beats. No audio files.
// Everything is created lazily on the first user gesture (autoplay rules) and
// every call is safe before that — it just stays silent.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);

      // engine: sawtooth through a lowpass, frequency follows speed
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();

      // siren: square blip alternating two tones while police are close
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
      this.sirenPhase = 0;

      // pad: two detuned triangles on a slow chord, very quiet
      this.padGain = ctx.createGain();
      this.padGain.gain.value = 0.035;
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass'; padFilter.frequency.value = 700;
      this.padGain.connect(padFilter).connect(this.master);
      this.padOscs = [196, 246.9, 294].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = i * 4 - 4;
        o.connect(this.padGain);
        o.start();
        return o;
      });
      this.started = true;
      return true;
    } catch {
      return false;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // speed in m/s, active only while driving
  engine(speed, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = speed !== null;
    const target = on ? 0.05 + Math.min(0.05, Math.abs(speed) * 0.0016) : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.09);
    if (on) {
      this.engineOsc.frequency.setTargetAtTime(52 + Math.abs(speed) * 6.5, t, 0.08);
      this.engineFilter.frequency.setTargetAtTime(280 + Math.abs(speed) * 42, t, 0.1);
    }
    if (dt) this.sirenPhase += dt;
  }

  siren(level) { // 0..1
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(level * 0.045, t, 0.15);
    if (level > 0) {
      this.sirenOsc.frequency.setTargetAtTime(Math.sin(this.sirenPhase * 5.2) > 0 ? 715 : 955, t, 0.03);
    }
  }

  blip(freq = 660, dur = 0.12, gain = 0.12, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  stinger(kind) {
    if (!this.ctx) return;
    const notes = kind === 'win' ? [523, 659, 784, 1046] : kind === 'fail' ? [392, 330, 262] : [440, 587];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 0.13, 'triangle'), i * 95));
  }

  punch() { this.blip(140, 0.08, 0.16, 'square'); }
  cash() { this.blip(988, 0.1, 0.1); setTimeout(() => this.blip(1318, 0.16, 0.1), 70); }
}
