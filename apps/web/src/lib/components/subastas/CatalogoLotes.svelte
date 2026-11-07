<script lang="ts">
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import type { CatalogoLotesResponse, LoteCatalogo } from '@ganadito/contracts';

  // Catálogo del servidor: nada de datos de ejemplo si la API falla.
  let vista = $state<'publicos' | 'mios'>('publicos');
  let lotes = $state<LoteCatalogo[]>([]);
  let cursor = $state<string | null>(null);
  let cargando = $state(false);
  let error = $state('');
  let peticion: AbortController | undefined;
  const contextKey = $derived(`${$session.token ?? ''}:${$session.organizationId ?? ''}`);
  const puedeVerMios = $derived($session.status === 'authenticated' && !!$session.organizationId);

  function esLote(v: unknown): v is LoteCatalogo {
    if (!v || typeof v !== 'object') return false;
    const l = v as Record<string, unknown>;
    return typeof l.id === 'string' && typeof l.codigo_lote === 'string' && typeof l.estado === 'string' &&
      typeof l.precio_actual === 'number' && typeof l.fecha_cierre === 'string' && typeof l.es_abierta === 'boolean' &&
      (l.origen === null || (typeof l.origen === 'object' && typeof (l.origen as Record<string, unknown>).ubicacion_aproximada === 'boolean'));
  }

  async function cargar(reiniciar: boolean) {
    peticion?.abort();
    const controller = new AbortController();
    peticion = controller;
    const key = contextKey;
    cargando = true;
    error = '';
    if (reiniciar) { lotes = []; cursor = null; }
    const params = new URLSearchParams({ limit: '12' });
    if (vista === 'mios') params.set('mios', 'true');
    if (!reiniciar && cursor) params.set('cursor', cursor);
    try {
      const data = await apiRequest<CatalogoLotesResponse>(`/api/v1/subastas?${params}`, { signal: controller.signal, auth: vista === 'mios' || $session.status === 'authenticated' });
      if (controller.signal.aborted || key !== contextKey) return;
      if (!data || !Array.isArray(data.data) || !data.data.every(esLote)) throw new Error('La API devolvió un catálogo no válido.');
      lotes = reiniciar ? data.data : [...lotes, ...data.data.filter((l) => !lotes.some((x) => x.id === l.id))];
      cursor = typeof data.next_cursor === 'string' ? data.next_cursor : null;
    } catch (cause) {
      if (!controller.signal.aborted) error = cause instanceof Error ? cause.message : 'No se pudo consultar el catálogo.';
    } finally {
      if (!controller.signal.aborted) cargando = false;
    }
  }

  $effect(() => {
    vista;
    contextKey;
    if ($session.status === 'checking') return;
    if (vista === 'mios' && !puedeVerMios) { vista = 'publicos'; return; }
    void cargar(true);
    return () => peticion?.abort();
  });

  const fmt = (n: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(n);
  const fecha = (s: string) => new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' });
</script>

<section class="rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4" aria-label="Catálogo de lotes">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-xl font-bold">Catálogo de lotes</h2>
    <div class="flex gap-2" role="group" aria-label="Filtrar catálogo">
      <button type="button" class="rounded-lg px-3 py-1 text-sm border {vista === 'publicos' ? 'border-emerald-500 text-emerald-300' : 'border-slate-600'}" aria-pressed={vista === 'publicos'} onclick={() => (vista = 'publicos')}>Lotes activos</button>
      {#if puedeVerMios}<button type="button" class="rounded-lg px-3 py-1 text-sm border {vista === 'mios' ? 'border-emerald-500 text-emerald-300' : 'border-slate-600'}" aria-pressed={vista === 'mios'} onclick={() => (vista = 'mios')}>Mis lotes</button>{/if}
    </div>
  </div>
  <p class="text-sm text-slate-400">La puja es por el <strong>precio total del lote</strong>; no se liquida por kilo. El peso estimado por IA es orientativo y no vinculante.</p>
  {#if error}<p rol