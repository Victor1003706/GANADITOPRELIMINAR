import { error } from '@sveltejs/kit';
import { demoHabilitada } from '#lib/config.ts';

export const prerender = false;

export function load() {
  if (!demoHabilitada) error(404, 'No encontrado');
}
