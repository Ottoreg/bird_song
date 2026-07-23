import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AudioEngine } from "./audio.js";
import { Spectrogram3D } from "./spectrogram.js";

// ------------------------------------------------------------------
// Paramètres de visualisation
// ------------------------------------------------------------------
const COLS = 160;            // colonnes de fréquence (résolution en hauteur de note)
const ROWS = 200;            // rangées de temps (profondeur de l'historique)
const FREQ_MIN = 700;        // Hz — bas de la plage des chants d'oiseaux
const FREQ_MAX = 11000;      // Hz — haut de la plage
const NOTE_NAMES = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

// ------------------------------------------------------------------
// Éléments du DOM
// ------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const fileInput = el("fileInput");
const demoBtn = el("demoBtn");
const playBtn = el("playBtn");
const resetViewBtn = el("resetViewBtn");
const seek = el("seek");
const timeLabel = el("time");
const player = el("player");
const hud = el("hud");
const legend = el("legend");
const overlay = el("overlay");
const hudNote = el("hudNote");
const hudFreq = el("hudFreq");
const hudLevel = el("hudLevel");

// ------------------------------------------------------------------
// Scène Three.js
// ------------------------------------------------------------------
const canvas = el("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070f);
scene.fog = new THREE.FogExp2(0x05070f, 0.0016);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
const DEFAULT_CAM = new THREE.Vector3(28, 58, 148);
camera.position.copy(DEFAULT_CAM);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 12, 0);
controls.minDistance = 40;
controls.maxDistance = 500;

// Lumières
scene.add(new THREE.AmbientLight(0x4060a0, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(60, 120, 80);
scene.add(key);
const rim = new THREE.DirectionalLight(0x4dd0e1, 0.5);
rim.position.set(-80, 40, -60);
scene.add(rim);

// Étoiles d'ambiance
scene.add(makeStars());

// Spectrogramme
const spectro = new Spectrogram3D({ cols: COLS, rows: ROWS, width: 130, depth: 160, height: 30 });
scene.add(spectro.group);

// ------------------------------------------------------------------
// Moteur audio + mapping fréquentiel
// ------------------------------------------------------------------
const audio = new AudioEngine();
audio.onEnded = () => setPlaying(false);

let binMap = null;   // pré-calcul bin -> colonne (dépend du sampleRate)
const rowBuf = new Float32Array(COLS);

function buildBinMap() {
  const nyquist = audio.sampleRate / 2;
  const bins = audio.binCount;
  // Pour chaque colonne, plage de bins FFT à moyenner (échelle logarithmique).
  binMap = new Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const f0 = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, c / COLS);
    const f1 = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, (c + 1) / COLS);
    let b0 = Math.floor((f0 / nyquist) * bins);
    let b1 = Math.ceil((f1 / nyquist) * bins);
    b0 = Math.max(0, Math.min(bins - 1, b0));
    b1 = Math.max(b0 + 1, Math.min(bins, b1));
    binMap[c] = [b0, b1];
  }
}

function columnFreq(c) {
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, (c + 0.5) / COLS);
}

function freqToNote(f) {
  if (!f || f <= 0) return "—";
  const n = Math.round(69 + 12 * Math.log2(f / 440));
  const name = NOTE_NAMES[((n % 12) + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  return `${name}${octave}`;
}

// ------------------------------------------------------------------
// Boucle de rendu
// ------------------------------------------------------------------
let lastFrameT = 0;
const FRAME_INTERVAL = 1000 / 45; // cadence d'échantillonnage du spectrogramme

function animate(now) {
  requestAnimationFrame(animate);
  controls.update();

  if (audio.playing && binMap && now - lastFrameT >= FRAME_INTERVAL) {
    lastFrameT = now;
    sampleAudio();
    updateTransport();
  }

  // Rotation douce du marqueur pour le rendre vivant
  if (spectro.marker.visible) spectro.marker.rotation.y += 0.05;

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

function sampleAudio() {
  const data = audio.sample();
  let peakIdx = 0, peakVal = 0;
  for (let c = 0; c < COLS; c++) {
    const [b0, b1] = binMap[c];
    let sum = 0;
    for (let b = b0; b < b1; b++) sum += data[b];
    let v = sum / (b1 - b0) / 255;
    // Léger gamma pour renforcer le contraste des notes.
    v = Math.pow(v, 1.35);
    rowBuf[c] = v;
    if (v > peakVal) { peakVal = v; peakIdx = c; }
  }
  spectro.pushFrame(rowBuf, { index: peakIdx, value: peakVal });
  updateHud(peakIdx, peakVal);
}

function updateHud(peakIdx, peakVal) {
  if (peakVal < 0.12) {
    hudNote.textContent = "—";
    hudFreq.textContent = "—";
    hudLevel.textContent = "silence";
    return;
  }
  const f = columnFreq(peakIdx);
  hudNote.textContent = freqToNote(f);
  hudFreq.textContent = `${Math.round(f)} Hz`;
  hudLevel.textContent = `${Math.round(peakVal * 100)} %`;
}

// ------------------------------------------------------------------
// Barre de transport (temps / seek)
// ------------------------------------------------------------------
let seeking = false;

function updateTransport() {
  const d = audio.duration || 0;
  const t = audio.currentTime || 0;
  if (!seeking) seek.value = d ? (t / d) * 100 : 0;
  timeLabel.textContent = `${fmt(t)} / ${fmt(d)}`;
}

function fmt(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

seek.addEventListener("input", () => { seeking = true; });
seek.addEventListener("change", () => {
  const d = audio.duration || 0;
  audio.seek((seek.value / 100) * d);
  seeking = false;
  updateTransport();
});

// ------------------------------------------------------------------
// Contrôles UI
// ------------------------------------------------------------------
function revealUI() {
  overlay.style.opacity = "0";
  setTimeout(() => overlay.classList.add("hidden"), 500);
  player.classList.remove("hidden");
  hud.classList.remove("hidden");
  legend.classList.remove("hidden");
  playBtn.disabled = false;
}

function setPlaying(on) {
  playBtn.textContent = on ? "⏸ Pause" : "▶︎ Lire";
}

async function afterLoad() {
  buildBinMap();
  spectro.clear();
  revealUI();
  updateTransport();
}

fileInput.addEventListener("change", async (e) => {
  audio.unlock();                 // déverrouille l'audio iOS dans le geste
  const file = e.target.files[0];
  if (!file) return;
  try {
    await audio.loadFile(file);
    await afterLoad();
    setPlaying(false);
  } catch (err) {
    alert("Impossible de lire ce fichier audio : " + err.message);
  }
});

demoBtn.addEventListener("click", async () => {
  audio.unlock();                 // déverrouille l'audio iOS dans le geste
  audio.buildDemo();
  await afterLoad();
  await audio.play();
  setPlaying(true);
});

playBtn.addEventListener("click", async () => {
  audio.unlock();                 // déverrouille l'audio iOS dans le geste
  if (audio.playing) {
    audio.pause();
    setPlaying(false);
  } else {
    await audio.play();
    setPlaying(true);
  }
});

resetViewBtn.addEventListener("click", () => {
  camera.position.copy(DEFAULT_CAM);
  controls.target.set(0, 12, 0);
});

// ------------------------------------------------------------------
// Divers
// ------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function makeStars() {
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 600 + Math.random() * 600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb8ff, size: 1.4, transparent: true, opacity: 0.6 });
  return new THREE.Points(geo, mat);
}
