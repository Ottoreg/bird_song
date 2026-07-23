// Moteur audio : gère la lecture, l'analyse fréquentielle (FFT) et la
// synthèse d'un chant d'oiseau de démonstration.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;       // Uint8Array des magnitudes par bin
    this.sourceNode = null;     // MediaElementSource ou BufferSource (démo)
    this.audioEl = null;        // <audio> pour les fichiers
    this.demoNodes = null;      // noeuds de la démo à arrêter
    this.mode = null;           // 'file' | 'demo'
    this.demoDuration = 0;
    this.demoStartTime = 0;
    this.onEnded = () => {};
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;          // bonne résolution fréquentielle
      this.analyser.smoothingTimeConstant = 0.55;
      this.analyser.minDecibels = -95;
      this.analyser.maxDecibels = -20;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.connect(this.ctx.destination);
    }
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  /** Nombre total de bins FFT (frequencyBinCount). */
  get binCount() {
    return this.analyser ? this.analyser.frequencyBinCount : 2048;
  }

  /** Charge un fichier audio et le prépare pour la lecture. */
  async loadFile(file) {
    this._ensureContext();
    this._teardownSource();

    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.src = url;
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    await new Promise((res, rej) => {
      el.addEventListener("loadedmetadata", res, { once: true });
      el.addEventListener("error", () => rej(new Error("Fichier audio illisible")), { once: true });
    });

    this.audioEl = el;
    this.sourceNode = this.ctx.createMediaElementSource(el);
    this.sourceNode.connect(this.analyser);
    this.mode = "file";
    el.addEventListener("ended", () => this.onEnded());
    return el.duration;
  }

  /** Construit un chant d'oiseau synthétique (gazouillis + trilles). */
  buildDemo() {
    this._ensureContext();
    this._teardownSource();
    this.mode = "demo";
    this.demoDuration = 12;
    return this.demoDuration;
  }

  _startDemo(offset = 0) {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(this.analyser);

    const t0 = ctx.currentTime + 0.05;
    this.demoStartTime = t0 - offset;

    // Une "syllabe" = balayage de fréquence + enveloppe d'amplitude.
    const syllable = (start, dur, f0, f1, gain = 0.9, type = "sine") => {
      if (start + dur < offset) return;         // déjà passée
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      const s = t0 + Math.max(0, start - offset);
      osc.frequency.setValueAtTime(f0, s);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, f1), s + dur);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(gain, s + dur * 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      osc.connect(g); g.connect(master);
      osc.start(s);
      osc.stop(s + dur + 0.02);
    };

    // Un "trille" = série rapide de courtes syllabes.
    const trill = (start, count, step, dur, f0, f1, gain = 0.7) => {
      for (let i = 0; i < count; i++) syllable(start + i * step, dur, f0, f1, gain, "triangle");
    };

    // Motif de chant (fréquences typiques d'oiseaux : 2–8 kHz).
    syllable(0.0, 0.35, 3200, 5200, 0.9);
    syllable(0.5, 0.30, 4800, 2600, 0.85);
    trill(1.1, 8, 0.09, 0.06, 5600, 6400, 0.55);
    syllable(2.2, 0.45, 2400, 6000, 0.9);
    syllable(2.9, 0.25, 6200, 3800, 0.8);
    trill(3.6, 12, 0.075, 0.05, 4200, 4800, 0.5);
    syllable(4.9, 0.6, 3000, 7200, 0.95);
    syllable(5.8, 0.3, 5000, 2800, 0.8);
    trill(6.5, 10, 0.08, 0.055, 6000, 6800, 0.55);
    syllable(7.6, 0.4, 2600, 5400, 0.9);
    syllable(8.3, 0.5, 7000, 3200, 0.85);
    trill(9.1, 14, 0.07, 0.045, 4600, 5200, 0.5);
    syllable(10.4, 0.7, 3400, 6600, 0.95);
    syllable(11.3, 0.35, 5800, 3000, 0.8);

    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.6, t0 + 0.1);

    this.demoNodes = { master };

    // Fin automatique.
    this._demoTimer = setTimeout(
      () => this.onEnded(),
      (this.demoDuration - offset) * 1000 + 200
    );
  }

  _stopDemo() {
    if (this._demoTimer) { clearTimeout(this._demoTimer); this._demoTimer = null; }
    if (this.demoNodes) {
      try { this.demoNodes.master.disconnect(); } catch (e) {}
      this.demoNodes = null;
    }
  }

  async play() {
    this._ensureContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.mode === "file") {
      await this.audioEl.play();
    } else if (this.mode === "demo") {
      // (re)construit le graphe de la démo à partir de la position courante.
      this._startDemo(this.currentTime >= this.demoDuration ? 0 : this.currentTime);
    }
  }

  pause() {
    if (this.mode === "file" && this.audioEl) {
      this.audioEl.pause();
    } else if (this.mode === "demo") {
      this._pausedAt = this.currentTime;
      this._stopDemo();
    }
  }

  seek(time) {
    if (this.mode === "file" && this.audioEl) {
      this.audioEl.currentTime = time;
    } else if (this.mode === "demo") {
      const wasRunning = !!this.demoNodes;
      this._stopDemo();
      this._pausedAt = time;
      if (wasRunning) this._startDemo(time);
    }
  }

  get duration() {
    if (this.mode === "file") return this.audioEl ? this.audioEl.duration : 0;
    return this.demoDuration;
  }

  get currentTime() {
    if (this.mode === "file") return this.audioEl ? this.audioEl.currentTime : 0;
    if (this.mode === "demo") {
      if (this.demoNodes) return Math.min(this.demoDuration, this.ctx.currentTime - this.demoStartTime);
      return this._pausedAt || 0;
    }
    return 0;
  }

  get playing() {
    if (this.mode === "file") return this.audioEl && !this.audioEl.paused && !this.audioEl.ended;
    if (this.mode === "demo") return !!this.demoNodes;
    return false;
  }

  /** Remplit freqData avec le spectre courant et le renvoie. */
  sample() {
    if (!this.analyser) return this.freqData;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  _teardownSource() {
    this._stopDemo();
    if (this.audioEl) {
      this.audioEl.pause();
      if (this.audioEl.src) URL.revokeObjectURL(this.audioEl.src);
      this.audioEl = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
      this.sourceNode = null;
    }
    this._pausedAt = 0;
  }
}
