// Palette de couleurs de type "inferno" (sombre -> feu -> clair).
// Chaque entrée : [position 0..1, r, g, b] en 0..255.
const STOPS = [
  [0.00,   2,   2,  20],
  [0.15,  40,  11,  84],
  [0.30, 101,  21, 110],
  [0.45, 159,  42,  99],
  [0.60, 212,  72,  66],
  [0.75, 245, 125,  21],
  [0.88, 250, 193,  39],
  [1.00, 252, 255, 164],
];

/**
 * Convertit une valeur normalisée (0..1) en couleur RGB (0..1 par canal).
 * @param {number} t
 * @param {{r:number,g:number,b:number}} out - objet cible réutilisable
 */
export function inferno(t, out) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const span = b[0] - a[0] || 1;
  const f = (t - a[0]) / span;
  out.r = (a[1] + (b[1] - a[1]) * f) / 255;
  out.g = (a[2] + (b[2] - a[2]) * f) / 255;
  out.b = (a[3] + (b[3] - a[3]) * f) / 255;
  return out;
}
