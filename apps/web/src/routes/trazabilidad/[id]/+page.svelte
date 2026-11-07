<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { session, sessionStorageKey } from '#lib/session.ts';
  import type { VerificacionCadenaResponse } from '@ganadito/contracts';
  import { consultarPasaporte, verificarPasaporte, type PasaporteLectura } from '#lib/trazabilidad/pasaporte.ts';
  import VistaPasaporte from '#lib/components/trazabilidad/VistaPasaporte.svelte';

  // Con sesión: COMPLETA para la organización dueña, PUBLICA para las demás.
  // Sin sesión: se consulta sin token y la API devuelve siempre la vista PUBLICA.
  let identificador = $derived(page.params.id ?? '');
  let pasaporte = $state<PasaporteLectura | null>(null);
  let verificacion = $state<VerificacionCadenaResponse | null>(null);
  let cargando = $state(false);
  let auditando = $state(false);
  let errorConsulta = $state('');
  let errorAuditoria = $state('');
  let peticion: AbortController | undefined;
  let peticionAuditoria: AbortController | undefined;

  const anonimo = () => $session.status !== 'authenticated';

  // La sesión arranca como 'anonymous' y el layout la restaura en onMount (después del
  // primer $effect). Con un token guardado no se consulta como anónimo mientras se valida:
  // evita una consulta duplicada y que la vista pública parpadee antes de la COMPLETA.
  function sesionPendiente(estado: string): boolean {
    if (estado === 'checking') return true;
    if (estado !== 'anonymous') return false;
    try { return !!sessionStorage.getItem(sessionStorageKey); } catch { return false; }
  }

  async function cargar(id: string) {
    peticion?.abort();
    peticionAuditoria?.abort();
    const controller = new AbortController();
    peticion = controller;
    const sinSesion = anonimo();
    const organizacionId = sinSesion ? null : $session.organizationId;
    pasaporte = null;
    verificacion = null;
    errorConsulta = '';
    errorAuditoria = '';
    auditando = false;
    cargando = true;
    try {
      const data = await consultarPasaporte(id, { anonimo: sinSesion, organizacionId, signal: controller.signal });
      // Una respuesta de otro contexto (sesión u organización cambiadas) nunca llena la pantalla.
      if (!controller.signal.aborted && identificador === id && anonimo() === sinSesion && (sinSesion || $session.organizationId === organizacionId)) pasaporte = data;
    } catch (error) {
      if (!controller.signal.aborted) errorConsulta = error instanceof Error ? error.message : 'No se pudo consultar el pasaporte.';
    } finally {
      if (!controller.signal.aborted) cargando = false;
    }
  }

  async function auditar() {
    if (!pasaporte || auditando) return;
    if (pasaporte.vista === 'COMPLETA' && pasaporte.bovino.organizacion_id !== $session.organizationId) return;
    peticionAuditoria?.abort();
    const controller = new AbortController();
    peticionAuditoria = controller;
    const id = identificador;
    auditando = true;
    verificacion = null;
    errorAuditoria = '';
    try {
      const data = await verificarPasaporte(id, { anonimo: anonimo(), signal: controller.signal });
      if (!controller.signal.aborted && identificador === id) verificacion = data;
    } catch (error) {
      if (!controller.signal.aborted) errorAuditoria = error instanceof Error ? error.message : 'No se pudo verificar la cadena.';
    } finally {
      if (!controller.signal.aborted) auditando = false;
    }
  }

  $effect(() => {
    const id = identificador;
    const estado = $session.status;
    $session.token;
    $session.organizationId;
    untrack(() => {
      peticion?.abort();
      peticionAuditoria?.abort();
      pasaporte = null;
      verificacion = null;
      errorConsulta = '';
      errorAuditoria = '';
      cargando = false;
      auditando = false;
      if (!sesionPendiente(estado) && id) void cargar(id);
    });
    return () => { peticion?.abort(); peticionAuditoria?.abort(); };
  });
</script>

<svelte:head><title>Pasaporte bovino | Ganadito</title></svelte:head>
<div class="max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
  <div class="flex flex-wrap justify-between items-start gap-4"><div><a class="text-sm text-emerald-400 hover:underline" href="/trazabilidad">Buscar otro bovino</a><h1 class="text-3xl font-bold text-white mt-2">Pasaporte bovino</h1><p class="text-sm text-slate-400 mt-2 break-all">Identificador solicitado: {identificador}</p></div><button type="button" class="rounded-xl border border-slate-700 px-4 py-2 text-slate-200 disabled:opacity-50" disabled={cargando || $session.status === 'checking'} onclick={() => void cargar(identificador)}>Actualizar pasaporte</button></div>
  {#if sesionPendiente($session.status)}<p role="status" class="text-slate-400">Comprobando sesión…</p>
  {:else if cargando}<p role="status" class="rounded-xl bg-slate-900 p-6 text-slate-400">Consultando pasaporte…</p>
  {:else if errorConsulta}<p role="alert" class="rounded-xl border border-rose-800 bg-rose-950/40 p-5 text-rose-200">{errorConsulta}</p>
  {:else if pasaporte}
    <VistaPasaporte {pasaporte} {verificacion} {auditando} {errorAuditoria} onVerificar={() => void auditar()} />
    {#if pasaporte.vista === 'COMPLETA'}
      <div class="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400"><button type="button" disabled class="rounded-lg bg-slate-800 px-4 py-2 opacity-60">Registrar evento no disponible</button><p class="mt-2">El registro de nuevos eventos desde la web todavía no está habilitado.</p></div>
    {:else if $session.status !== 'authenticated'}
      <p class="text-sm text-slate-400">¿Eres la organización dueña? <a href="/acceso" class="text-emerald-400 underline">Inicia sesión</a> para ver la vista completa.</p>
    {/if}
  {:else}<p role="status" class="text-slate-400">No hay un pasaporte disponible para esta consulta.</p>{/if}
</div>
