<script lang="ts">
  import type { VerificacionCadenaResponse } from '@ganadito/contracts';
  import type { PasaporteLectura } from '#lib/trazabilidad/pasaporte.ts';
  import FichaBovinoHeader from '#lib/components/trazabilidad/FichaBovinoHeader.svelte';
  import CertificadoAuditoria from '#lib/components/trazabilidad/CertificadoAuditoria.svelte';
  import LineaTiempoEventos from '#lib/components/trazabilidad/LineaTiempoEventos.svelte';

  interface Props {
    pasaporte: PasaporteLectura;
    verificacion: VerificacionCadenaResponse | null;
    auditando: boolean;
    errorAuditoria: string;
    onVerificar: () => void;
  }
  let { pasaporte, verificacion, auditando, errorAuditoria, onVerificar }: Props = $props();
</script>

<FichaBovinoHeader bovino={pasaporte.bovino} />
{#if pasaporte.vista === 'PUBLICA'}
  <p role="status" class="rounded-xl border border-amber-800 bg-slate-900 p-4 text-sm text-slate-300">
    Vista pública: la organización dueña, los autores y los datos privados (ubicación, documentos, contacto) están reservados.
    La integridad de la cadena la confirma el servidor; esta vista no muestra hashes.
  </p>
{/if}
<p class="text-sm text-slate-400">Los datos y eventos provienen del registro consultado. La integridad de la cadena no acredita certificaciones sanitarias ni verifica el contenido declarado.</p>
<CertificadoAuditoria {verificacion} isLoading={auditando} onReverificar={onVerificar} />
{#if errorAuditoria}<p role="alert" class="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-rose-200">{errorAuditoria}</p>{/if}
<LineaTiempoEventos eventos={pasaporte.eventos} />
