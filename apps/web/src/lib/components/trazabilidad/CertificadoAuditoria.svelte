<script lang="ts">
  import type { VerificacionCadenaResponse } from '@ganadito/contracts';
  let { verificacion, isLoading = false, onReverificar }: { verificacion: VerificacionCadenaResponse | null; isLoading?: boolean; onReverificar?: () => void } = $props();
</script>
<section class="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3" aria-label="Integridad de la cadena">
  <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-lg font-semibold text-white">Integridad del registro</h2><button type="button" disabled={isLoading} onclick={onReverificar} class="rounded-xl border border-slate-700 px-4 py-2 text-sm text-emerald-400 disabled:opacity-50">{isLoading ? 'Verificando…' : 'Verificar cadena'}</button></div>
  {#if isLoading}<p role="status" class="text-slate-400">Consultando la verificación del servidor…</p>
  {:else if verificacion}<p role="status" class={verificacion.integro ? 'text-emerald-300' : 'text-rose-300'}>{verificacion.integro ? 'El servidor confirmó la integridad de la cadena.' : 'El servidor detectó una inconsistencia en la cadena.'}</p><p class="text-sm text-slate-400">Eventos verificados: {verificacion.total_eventos}{verificacion.secuencia_corrupta === undefined ? '' : ' · Secuencia afectada: ' + verificacion.secuencia_corrupta}</p>{#if verificacion.detalle}<p class="text-sm text-slate-300">{verificacion.detalle}</p>{/if}
  {:else}<p class="text-sm text-slate-400">La cadena aún no ha sido verificada en esta consulta.</p>{/if}
</section>
