<script lang="ts">
  import { page } from '$app/state';
  import type { VerificacionCadenaResponse } from '@ganadito/contracts';
  import { consultarPasaporte, verificarPasaporte, type PasaporteLectura } from '#lib/trazabilidad/pasaporte.ts';
  import VistaPasaporte from '#lib/components/trazabilidad/VistaPasaporte.svelte';

  // Ruta del QR: siempre anónima (sin token aunque haya sesión), para que cualquiera vea
  // exactamente lo mismo: la vista PUBLICA de la API.
  let identificador = $derived(page.params.id ?? '');
  let pasaporte = $state<PasaporteLectura | null>(null);
  let verificacion = $state<VerificacionCadenaResponse | null>(null);
  let cargando = $state(true);
  let auditando = $state(false);
  let errorConsulta = $state('');
  let errorAuditoria = $state('');
  let peticionAuditoria: AbortController | undefined;

  $effect(() => {
    const id = identificador;
    const controller = new AbortController();
    pasaporte = null;
    verificacion = null;
    errorConsulta = '';
    errorAuditoria = '';
    auditando = false;
    cargando = true;
    if (!id) { cargando = false; return; }
    consultarPasaporte(id, { anonimo: true, organizacionId: null, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) pasaporte = data; })
      .catch((error) => { if (!controller.signal.aborted) errorConsulta = error instanceof Error ? error.message : 'No se pudo consultar el pasaporte.'; })
      .finally(() => { if (!controller.signal.aborted) cargando = false; });
    return () => { controller.abort(); peticionAuditoria?.abort(); };
  });

  async function auditar() {
    if (!pasaporte || auditando) return;
    peticionAuditoria?.abort();
    const controller = new AbortController();
    peticionAuditoria = controller;
    const id = identificador;
    auditando = true;
    verificacion = null;
    errorAuditoria = '';
    try {
      const data = await verificarPasaporte(id, { anonimo: true, signal: controller.signal });
      if (!controller.signal.aborted && identificador === id) verificacion = data;
    } catch (error) {
      if (!controller.signal.aborted && identificador === id) errorAuditoria = error instanceof Error ? error.message : 'No se pudo verificar la cadena.';
    } finally {
      if (!controller.signal.aborted && identificador === id) auditando = false;
    }
  }
</script>

<svelte:head><title>Pasaporte bovino público | Ganadito</title><meta name="robots" content="noindex" /></svelte:head>
<div class="max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
  <div><h1 class="text-3xl font-bold text-white">Pasaporte bovino público</h1><p class="text-sm text-slate-400 mt-2 break-all">Identificador: {identificador}</p></div>
  {#if cargando}<p role="status" class="rounded-xl bg-slate-900 p-6 text-slate-400">Consultando pasaporte…</p>
  {:else if errorConsulta}<p role="alert" class="rounded-xl border border-rose-800 bg-rose-950/40 p-5 text-rose-200">{errorConsulta}</p>
  {:else if pasaporte}
    <VistaPasaporte {pasaporte} {verificacion} {auditando} {errorAuditoria} onVerificar={() => void auditar()} />
  {:else}<p role="status" class="text-slate-400">No hay un pasaporte disponible para esta consulta.</p>{/if}
</div>
