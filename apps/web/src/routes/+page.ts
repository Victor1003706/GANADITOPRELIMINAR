import { redirect } from '@sveltejs/kit';
import { demoHabilitada } from '#lib/config.ts';

export const prerender = false;
// La pantalla de mapa Leaflet existente requiere ejecución en navegador.
export const ssr = false;

export function load() {
  if (demoHabilitada) redirect(307, '/demostracion');
}
