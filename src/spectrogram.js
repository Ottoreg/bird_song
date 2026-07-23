import * as THREE from "three";
import { inferno } from "./palette.js";

// Surface 3D "en cascade" (waterfall) : une grille dont chaque rangée
// représente un instant du chant. À chaque nouvelle trame, la grille
// défile vers l'arrière et la trame la plus récente apparaît au premier plan.
export class Spectrogram3D {
  /**
   * @param {object} opts
   * @param {number} opts.cols  - nombre de colonnes de fréquence (largeur, X)
   * @param {number} opts.rows  - nombre de rangées de temps (profondeur, Z)
   * @param {number} opts.width - taille physique en X
   * @param {number} opts.depth - taille physique en Z
   * @param {number} opts.height- amplitude verticale max (Y)
   */
  constructor({ cols = 160, rows = 200, width = 120, depth = 150, height = 26 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.width = width;
    this.depth = depth;
    this.height = height;

    // Tampon des magnitudes (rows x cols), 0..1. rangée 0 = plus récente.
    this.data = new Float32Array(rows * cols);

    this.group = new THREE.Group();
    this._buildSurface();
    this._buildMarker();
    this._buildAxes();
  }

  _buildSurface() {
    const { cols, rows, width, depth } = this;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);

    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const i = (z * cols + x) * 3;
        positions[i]     = (x / (cols - 1) - 0.5) * width;   // X : fréquence
        positions[i + 1] = 0;                                // Y : amplitude
        positions[i + 2] = (0.5 - z / (rows - 1)) * depth;   // Z : temps (récent au premier plan)
        colors[i] = colors[i + 1] = colors[i + 2] = 0;
      }
    }

    // Indices des triangles de la grille.
    const indices = [];
    for (let z = 0; z < rows - 1; z++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = z * cols + x;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.15,
      flatShading: false,
      side: THREE.DoubleSide,
    });

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    // Fine grille filaire par-dessus pour la lisibilité.
    const wire = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x9fd8ff, wireframe: true, transparent: true, opacity: 0.06 })
    );
    this.group.add(wire);
  }

  _buildMarker() {
    // Sphère lumineuse indiquant la note dominante de l'instant présent.
    const geo = new THREE.SphereGeometry(1.6, 20, 20);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    this.marker = new THREE.Mesh(geo, mat);
    this.marker.visible = false;
    this.group.add(this.marker);

    const halo = new THREE.PointLight(0xffd166, 0, 60);
    this.markerLight = halo;
    this.marker.add(halo);
  }

  _buildAxes() {
    const { width, depth, height } = this;
    const g = new THREE.Group();

    const mk = (color, from, to) => {
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
      return new THREE.Line(geo, m);
    };
    const x0 = -width / 2, z0 = depth / 2;
    // X (fréquence) rouge, Z (temps) cyan, Y (intensité) jaune.
    g.add(mk(0xff5d73, new THREE.Vector3(x0, 0, z0), new THREE.Vector3(-x0, 0, z0)));
    g.add(mk(0x4dd0e1, new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, 0, -z0)));
    g.add(mk(0xffd166, new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, height, z0)));

    // Sol de référence.
    const grid = new THREE.GridHelper(Math.max(width, depth) * 1.15, 24, 0x22406a, 0x152238);
    grid.position.y = -0.2;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    g.add(grid);

    this.group.add(g);
  }

  /**
   * Injecte une nouvelle trame de fréquences.
   * @param {number[]|Float32Array} row - cols valeurs normalisées 0..1
   * @param {{index:number, value:number}|null} peak - bin dominant
   */
  pushFrame(row, peak) {
    const { cols, rows } = this;
    // Décale toutes les rangées d'un cran vers l'arrière.
    this.data.copyWithin(cols, 0, cols * (rows - 1));
    // Écrit la nouvelle rangée en tête.
    for (let x = 0; x < cols; x++) this.data[x] = row[x];

    this._updateGeometry();
    this._updateMarker(peak);
  }

  _updateGeometry() {
    const { cols, rows, width, height } = this;
    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.color.array;
    const c = { r: 0, g: 0, b: 0 };

    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const v = this.data[z * cols + x];
        const idx = (z * cols + x) * 3;
        pos[idx + 1] = v * height;
        inferno(v, c);
        col[idx] = c.r; col[idx + 1] = c.g; col[idx + 2] = c.b;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  _updateMarker(peak) {
    if (!peak || peak.value < 0.12) {
      this.marker.visible = false;
      this.markerLight.intensity = 0;
      return;
    }
    const { cols, width, depth, height } = this;
    const x = (peak.index / (cols - 1) - 0.5) * width;
    const z = 0.5 * depth; // rangée la plus récente (z index 0), au premier plan
    this.marker.position.set(x, peak.value * height + 2, z);
    this.marker.visible = true;
    this.markerLight.intensity = 1.5 + peak.value * 2;
  }

  /** Réinitialise la surface. */
  clear() {
    this.data.fill(0);
    this._updateGeometry();
    this.marker.visible = false;
    this.markerLight.intensity = 0;
  }
}
