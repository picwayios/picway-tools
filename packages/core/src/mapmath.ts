export const TILE = 256;
export const MAX_LAT = 85.0511287798;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function toWorld(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
export function fromWorld(x: number, y: number, z: number) {
  const n = TILE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon: wrapLon(lon) };
}

export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

export const exifToLocal = (s: string | undefined) => (s && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(s) ? s.slice(0, 10).replace(/:/g, '-') + 'T' + s.slice(11, 19) : '');
export const localToExif = (s: string) => {
  const m = s.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}` : '';
};

export const validOffset = (s: string) => /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(s);

export function browserOffset(d = new Date()): string {
  const m = -d.getTimezoneOffset();
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function parseCoordInputs(latText: string, lonText: string): { kind: 'empty' } | { kind: 'ok'; lat: number; lon: number } | { kind: 'bad' } {
  const norm = (x: string) => x.trim().replace(/[−–]/g, '-');
  const a = norm(latText);
  const b = norm(lonText);
  if (!a && !b) return { kind: 'empty' };
  const num = /^[+-]?\d+(?:\.\d+)?$/;
  if (!num.test(a) || !num.test(b)) return { kind: 'bad' };
  const lat = Number(a);
  const lon = Number(b);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { kind: 'ok', lat, lon } : { kind: 'bad' };
}
