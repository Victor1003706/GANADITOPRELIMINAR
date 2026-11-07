<script lang="ts">
  import { goto } from '$app/navigation';
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import CatalogoLotes from '#lib/components/subastas/CatalogoLotes.svelte';
  let id = $state('');
  let cantidad = $state<number | undefined>();
  let categoria = $state('');
  let raza = $state('');
  let descripcion = $state('');
  let code = $state('');
  let price = $state<number | undefined>();
  let increment = $state<number | undefined>();
  let closing = $state('');
  let submitting = $state(false);
  let uncertain = $state(false);
  let error = $state('');
  let created = $state<{ id: string; codigo_lote: string; estado: string } | null>(null);
  const contextKey = $derived(`${$session.token ?? ''}:${$session.organizationId ?? ''}:${$session.role ?? ''}`);
  let lastContext = $state('');
  $effect(() => {
    if (lastContext !== contextKey) {
      lastContext = contextKey;
      created = null;
      uncertain = false;
      error = '';
    }
  });

  async function publish(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || uncertain || $session.status !== 'authenticated' || !$session.organizationId) return;
    if (!price || !Number.isFinite(price) || price <= 0 || !increment || !Number.isFinite(increment) || increment <= 0 ||
      !Number.isFinite(Date.parse(closing)) || Date.parse(closing) <= Date.now()) {
      error = 'Revisa los importes y elige una fecha de cierre futura.';
      return;
    }
    const key = contextKey;
    submitting = true;
    error = '';
    created = null;
    try {
      const result = await apiRequest<{ id: string; codigo_lote: string; estado: string }>('/api/v1/subastas', {
        method: 'POST', expectedStatus: 201, body: JSON.stringify({ codigo_lote: code.trim() || undefined,
          precio_base: price, incremento_minimo: increment, fecha_cierre: new Date(closing).toISOString(), estado: 'ACTIVO',
          cantidad_animales: cantidad && Number.isInteger(cantidad) ? cantidad : undefined,
          categoria: categoria.trim() || undefined, raza: raza.trim() || undefined, descripcion: descripcion.trim() || undefined })
      });
      if (contextKey !== key) return;
      if (!result || typeof result.id !== 'string' || !result.id || typeof result.codigo_lote !== 'string' || typeof result.estado !== 'string') {
        uncertain = true;
        throw new Error('No se recibió una confirmación completa. Comprueba el lote antes de volver a publicarlo.');
      }
      created = result;
    } catch (cause) {
      if (contextKey !== key) return;
      error = cause instanceof Error ? cause.message : 'No se pudo publicar el lote.';
      const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
      if (!(status >= 400 && status < 500)) uncertain = true;
    } finally { submitting = false; }
  }
</script>

<svelte:head><title>Lotes y subastas | Ganadito</title></svelte:head>
<div class="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
  <div><h1 class="text-3xl font-bold">Lotes y subastas</h1><p class="text-slate-400 mt-2">Explora los lotes activos, abre uno por su identificador o publica un lote para tu organización activa.</p></div>
  <CatalogoLotes />
  <section class="rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-3">
    <h2 class="text-xl font-bold">Abrir un lote</h2>
    <form class="flex flex-wrap gap-3 items-end" onsubmit={(event) => { event.preventDefault(); if (id.trim()) void goto(`/subastas/${encodeURIComponent(id.trim())}`); }}>
      <div class="flex-1 min-w-52"><label for="lot-id" class="block text-sm mb-1">Identificador del lote</label><input id="lot-id" class="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" required maxlength="100" bind:value={id} /></div>
      <button class="rounded-lg bg-emerald-700 px-5 py-2 font-semibold" type="submit">Consultar lote</button>
    </form>
  </section>
  <section class="rounded-2xl border b