import { MAX_LAT, TILE, clamp, fromWorld, toWorld, wrapLon } from './mapmath.ts';
import { h } from './ui.ts';

export interface MapOptions {
  lat: number;
  lon: number;
  zoom: number;
  onPick: (lat: number, lon: number) => void;
  labels: { zoomIn: string; zoomOut: string };
}
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export class TileMap {
  readonly el: HTMLElement;
  private layer = h('div', { class: 'tl-map-layer' });
  private pin = h('div', { class: 'tl-pin', hidden: true });
  private cLat: number;
  private cLon: number;
  private z: number;
  private pinAt: { lat: number; lon: number } | null = null;
  private tiles = new Map<string, HTMLImageElement>();
  private on = false;

  constructor(private o: MapOptions) {
    this.cLat = o.lat;
    this.cLon = o.lon;
    this.z = o.zoom;
    const btn = (text: string, label: string, dz: number) => h('button', { type: 'button', class: 'tl-btn tl-btn--ghost tl-zoom', 'aria-label': label, onclick: () => this.zoom(dz) }, text);
    this.el = h('div', { class: 'tl-map', tabIndex: 0 }, this.layer, this.pin, h('div', { class: 'tl-zoombar' }, btn('+', o.labels.zoomIn, 1), btn('−', o.labels.zoomOut, -1)));
    this.bind();
    new ResizeObserver(() => this.render()).observe(this.el);
  }

  enable() {
    this.on = true;
    this.render();
  }
  get enabled() {
    return this.on;
  }
  setCenter(lat: number, lon: number, zoom?: number) {
    this.cLat = clamp(lat, -MAX_LAT, MAX_LAT);
    this.cLon = wrapLon(lon);
    if (zoom !== undefined) this.z = clamp(zoom, 1, 18);
    this.render();
  }
  setPin(p: { lat: number; lon: number } | null) {
    this.pinAt = p;
    this.render();
  }
  private zoom(d: number) {
    this.z = clamp(this.z + d, 1, 18);
    this.render();
  }

  private render() {
    if (!this.on) return;
    const w = this.el.clientWidth || 300;
    const hgt = this.el.clientHeight || 280;
    const c = toWorld(this.cLat, this.cLon, this.z);
    const x0 = c.x - w / 2;
    const y0 = c.y - hgt / 2;
    const n = 2 ** this.z;
    const want = new Set<string>();
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + hgt) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + w) / TILE); tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${this.z}/${wx}/${ty}@${tx}`;
        want.add(key);
        let img = this.tiles.get(key);
        if (!img) {
          img = h('img', { src: TILE_URL(this.z, wx, ty), alt: '', draggable: false, loading: 'eager', referrerPolicy: 'strict-origin-when-cross-origin' });
          this.tiles.set(key, img);
          this.layer.append(img);
        }
        img.style.left = `${Math.round(tx * TILE - x0)}px`;
        img.style.top = `${Math.round(ty * TILE - y0)}px`;
      }
    }
    for (const [k, img] of this.tiles) if (!want.has(k)) (img.remove(), this.tiles.delete(k));
    this.pin.hidden = !this.pinAt;
    if (this.pinAt) {
      const p = toWorld(this.pinAt.lat, this.pinAt.lon, this.z);
      let px = p.x - x0;
      const span = TILE * n;
      if (px < -span / 2) px += span;
      if (px > w + span / 2) px -= span;
      this.pin.style.left = `${px}px`;
      this.pin.style.top = `${p.y - y0}px`;
    }
  }

  private bind() {
    let drag: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.tl-zoombar')) return;
      const c = toWorld(this.cLat, this.cLon, this.z);
      drag = { x: e.clientX, y: e.clientY, wx: c.x, wy: c.y, moved: false };
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const c = fromWorld(drag.wx - dx, drag.wy - dy, this.z);
      (this.cLat = clamp(c.lat, -MAX_LAT, MAX_LAT)), (this.cLon = c.lon);
      this.render();
    });
    this.el.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const r = this.el.getBoundingClientRect();
        const c = toWorld(this.cLat, this.cLon, this.z);
        const p = fromWorld(c.x + (e.clientX - r.left - r.width / 2), c.y + (e.clientY - r.top - r.height / 2), this.z);
        this.o.onPick(p.lat, p.lon);
      }
      drag = null;
    });
    this.el.addEventListener('wheel', (e) => (e.preventDefault(), this.zoom(e.deltaY < 0 ? 1 : -1)), { passive: false });
  }
}
