import { redirect } from '@sveltejs/kit';

// La versión pública presenta el recorrido de demostración.
export const prerender = false;
export const ssr = false;

export function load() {
  redirect(307, '/demostracion');
}
