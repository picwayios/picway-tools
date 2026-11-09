export type Decoder = (bytes: Uint8Array, type: string) => Promise<boolean>;

export const browserDecoder: Decoder = async (bytes, type) => {
  try {
    const blob = new Blob([bytes as BlobPart], { type });
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      bmp.close?.();
      return true;
    }
    if (typeof Image === 'function' && typeof URL !== 'undefined') {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return true;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return true;
  } catch (e) {
    return !isDataError(e);
  }
};
const isDataError = (e: unknown): boolean => {
  const n = (e as { name?: string } | null)?.name;
  return n === 'InvalidStateError' || n === 'EncodingError';
};

export async function canDecode(bytes: Uint8Array, type = 'image/jpeg', decoder: Decoder = browserDecoder): Promise<boolean> {
  try {
    return await decoder(bytes, type);
  } catch {
    return false;
  }
}
