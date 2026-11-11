export function isIosEnv(ua: string, maxTouchPoints: number, platform: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (maxTouchPoints > 1 && /Mac/.test(platform));
}
export const isIOS = (): boolean => typeof navigator !== 'undefined' && isIosEnv(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
