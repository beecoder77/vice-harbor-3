// The HUD: DOM chrome (cash, stars, objective, toasts, vitals) plus the round
// minimap painted on a 2D canvas every frame — streets, water, the objective
// ring, police blips and Rio's arrow.

import { ROAD_CENTRES, WATER_Z, PIER_END_Z } from './config.js';

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['cash', 'stars', 'banner', 'objective', 'timer', 'toasts', 'vitals', 'prompt', 'bustbar']) {
      this.el[id] = document.getElementById(id);
    }
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastSeq = 0;
  }

  setCash(n) { this.el.cash.textContent = '$' + n.toLocaleString('en-US'); }

  setStars(n, bust) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    this.el.stars.textContent = s;
    this.el.stars.style.opacity = n > 0 ? '1' : '0.25';
    this.el.bustbar.style.width = (bust * 100).toFixed(0) + '%';
    this.el.bustbar.parentElement.style.opacity = bust > 0.02 ? '1' : '0';
  }

  setBanner(text) { this.el.banner.textContent = text || ''; }
  setObjective(text) { this.el.objective.textContent = text || ''; }
  setTimer(text, urgent) {
    this.el.timer.textContent = text || '';
    this.el.timer.classList.toggle('urgent', !!urgent);
  }
  setPrompt(text) { this.el.prompt.textContent = text || ''; }
  setVitals(html) { this.el.vitals.innerHTML = html; }

  toast(text, ms = 4200) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    this.el.toasts.appendChild(div);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => { div.classList.add('fade'); setTimeout(() => div.remove(), 600); }, ms);
  }

  // world → map: the map covers x ∈ [-264, 264], z ∈ [-264, 396]
  mx(x) { return (x + 264) / 528 * 176; }
  mz(z) { return (z + 264) / 660 * 176; }

  drawMap(state) {
    const g = this.mapCtx;
    const S = 176;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#232a38';
    g.fillRect(0, 0, S, S);
    // sea
    g.fillStyle = '#1d4e6b';
    g.fillRect(0, this.mz(WATER_Z + 12), S, S - this.mz(WATER_Z + 12));
    // blocks
    g.fillStyle = '#39415a';
    for (const cx of [-200, -120, -40, 40, 120, 200]) {
      for (const cz of [-200, -120, -40, 40, 120, 200]) {
        g.fillRect(this.mx(cx - 32), this.mz(cz - 32), 64 / 528 * S, 64 / 660 * S);
      }
    }
    // streets
    g.strokeStyle = '#59637e';
    g.lineWidth = 4;
    for (const c of ROAD_CENTRES) {
      g.beginPath(); g.moveTo(this.mx(-248), this.mz(c)); g.lineTo(this.mx(248), this.mz(c)); g.stroke();
      g.beginPath(); g.moveTo(this.mx(c), this.mz(-248)); g.lineTo(this.mx(c), this.mz(248)); g.stroke();
    }
    // pier
    g.strokeStyle = '#8a6a44';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(this.mx(0), this.mz(WATER_Z)); g.lineTo(this.mx(0), this.mz(PIER_END_Z)); g.stroke();
    // objective
    if (state.objective) {
      const ox = this.mx(state.objective.x), oz = this.mz(state.objective.z);
      g.strokeStyle = '#ffc93c';
      g.lineWidth = 2;
      g.beginPath(); g.arc(ox, oz, 5 + Math.sin(state.t * 4) * 1.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffc93c';
      g.beginPath(); g.arc(ox, oz, 2, 0, Math.PI * 2); g.fill();
    }
    // police blips
    for (const c of state.police) {
      g.fillStyle = Math.sin(state.t * 9) > 0 ? '#ff4040' : '#4070ff';
      g.beginPath(); g.arc(this.mx(c.x), this.mz(c.z), 2.6, 0, Math.PI * 2); g.fill();
    }
    // player arrow
    const px = this.mx(state.x), pz = this.mz(state.z);
    g.save();
    g.translate(px, pz);
    g.rotate(Math.PI - state.heading); // canvas y runs south, same as world +z
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(0, 2.4); g.lineTo(-4, 5);
    g.closePath(); g.fill();
    g.restore();
  }
}
