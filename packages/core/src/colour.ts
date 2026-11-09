const M = [
  [1.2249401, -0.2249404, 0.0],
  [-0.0420569, 1.0420571, 0.0],
  [-0.0196376, -0.0786361, 1.0982735],
];
const TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();
const N = 4096;
const FROM_LIN = (() => {
  const t = new Uint8Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const v = i / N;
    t[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }
  return t;
})();
const enc = (v: number) => FROM_LIN[v <= 0 ? 0 : v >= 1 ? N : Math.round(v * N)];

export function p3ToSrgbInPlace(px: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < px.length; i += 4) {
    const r = TO_LIN[px[i]];
    const g = TO_LIN[px[i + 1]];
    const b = TO_LIN[px[i + 2]];
    px[i] = enc(M[0][0] * r + M[0][1] * g + M[0][2] * b);
    px[i + 1] = enc(M[1][0] * r + M[1][1] * g + M[1][2] * b);
    px[i + 2] = enc(M[2][0] * r + M[2][1] * g + M[2][2] * b);
  }
}

const lin = (c8: number) => {
  const v = c8 / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export function relativeLuminance(hex: string): number {
  let h = String(hex).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return 1;
  const n = parseInt(h, 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function captionInk(bg: string): string {
  const soft = contrastRatio('#333333', bg) >= contrastRatio('#eeeeee', bg) ? '#333333' : '#eeeeee';
  if (contrastRatio(soft, bg) >= 4.5) return soft;
  return contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? '#000000' : '#ffffff';
}
