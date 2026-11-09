export type Preset = 'balanced' | 'smaller' | 'convert';
export interface SrcInfo {
  w: number;
  h: number;

  bitrate: number;
  fps: number;

  hevc: boolean;
}
export interface Plan {
  w: number;
  h: number;
  bitrate: number;
  fps: number;
  codec: string;
}
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function planEncode(src: SrcInfo, preset: Preset, maxLong: number): Plan {
  const long = Math.max(src.w, src.h);
  const k = maxLong > 0 && long > maxLong ? maxLong / long : 1;
  const w = even(src.w * k);
  const h = even(src.h * k);
  const fps = Math.min(Math.max(src.fps || 30, 1), 60);
  const ratio = (w * h) / (src.w * src.h);
  const factor = preset === 'convert' ? (src.hevc ? 1.6 : 1) : src.hevc ? (preset === 'balanced' ? 0.9 : 0.5) : preset === 'balanced' ? 0.6 : 0.35;
  const floorBpp = preset === 'convert' ? 0.08 : preset === 'balanced' ? 0.05 : 0.03;
  const floor = w * h * fps * floorBpp;
  const wanted = src.bitrate > 0 ? src.bitrate * factor * ratio : w * h * fps * 0.08;
  const bitrate = Math.round(Math.min(Math.max(wanted, floor, 300_000), 40_000_000));
  const mbps = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
  const level = mbps <= 245_760 ? 0x28 : mbps <= 522_240 ? 0x2a : mbps <= 983_040 ? 0x33 : 0x34;
  return { w, h, bitrate, fps, codec: `avc1.6400${level.toString(16)}` };
}

export const LIMIT_IOS = 300 * 1024 * 1024;
export const LIMIT_DESKTOP = 2 * 1024 * 1024 * 1024;

const PCM_CODECS = /^(lpcm|sowt|twos|in24|in32|fl32|fl64|ipcm|raw )/i;
export const hasHiddenAudio = (tracks: { codec?: string; type?: string }[] | undefined): boolean =>
  !!tracks?.some((t) => t.type !== 'video' && t.type !== 'audio' && PCM_CODECS.test(t.codec ?? ''));

export const displaySize = (w: number, h: number, rotation: number): { w: number; h: number } => (rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h });

export type AudioState = 'none' | 'kept' | 'dropped';
export const audioState = (m: { hasAudio: boolean; audioKept: boolean }): AudioState => (!m.hasAudio ? 'none' : m.audioKept ? 'kept' : 'dropped');

export const resultDetail = (m: { w: number; h: number; rotation: number; hasAudio: boolean; audioKept: boolean }, plan: { w: number; h: number }, t: (k: string, v?: Record<string, string | number>) => string): string => {
  const a = displaySize(m.w, m.h, m.rotation);
  const b = displaySize(plan.w, plan.h, m.rotation);
  return [t('resChange', { fw: a.w, fh: a.h, tw: b.w, th: b.h }), t({ none: 'audioNone', kept: 'audioKept', dropped: 'audioDropped' }[audioState(m)])].join(' ');
};

export const estimateBytes = (p: Plan, seconds: number) => Math.ceil(((p.bitrate + 256_000) * Math.max(0, seconds)) / 8);

export const convertBytes = (m: SrcInfo & { duration: number }) => estimateBytes(planEncode(m, 'convert', 0), m.duration);
