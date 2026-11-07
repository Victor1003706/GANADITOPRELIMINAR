import { PUBLIC_API_URL, PUBLIC_WS_URL, PUBLIC_LIVE_AUCTIONS_ENABLED, PUBLIC_DEMO_ENABLED } from '$app/env/public';

export const apiBaseUrl = PUBLIC_API_URL.replace(/\/$/, '');
export const liveAuctionsEnabled = PUBLIC_LIVE_AUCTIONS_ENABLED;
export const demoHabilitada = PUBLIC_DEMO_ENABLED;

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/v1/') || path.startsWith('//') || path.includes('..')) {
    throw new Error('Ruta de API no permitida.');
  }
  return `${apiBaseUrl}${path}`;
}

export function apiWebSocketUrl(path: string): string {
  const base = PUBLIC_WS_URL || apiBaseUrl || window.location.origin;
  const url = new URL(path, base);
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  return url.toString();
}
