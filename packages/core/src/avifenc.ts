let mod: Promise<{ encode(data: Uint8Array, w: number, h: number, o: Record<string, unknown>): Uint8Array | null }> | undefined;
let defaults: Record<string, unknown> = {};

export function loadAvif() {
  return (mod ??= (async () => {
    const [factory, meta, utils] = await Promise.all([
      // @ts-expect-error untyped module path
      import('@jsquash/avif/codec/enc/avif_enc.js'),
      // @ts-expect-error untyped module path
      import('@jsquash/avif/meta.js'),
      // @ts-expect-error untyped module path
      import('@jsquash/avif/utils.js'),
    ]);
    defaults = meta.defaultOptions;
    return utils.initEmscriptenModule(factory.default);
  })());
}

export async function encodeAvif(data: ImageData, quality: number): Promise<Uint8Array> {
  const m = await loadAvif();
  const out = m.encode(new Uint8Array(data.data.buffer), data.width, data.height, { ...defaults, quality, speed: 8 });
  if (!out) throw new Error('AVIF encoding failed');
  return new Uint8Array(out);
}
