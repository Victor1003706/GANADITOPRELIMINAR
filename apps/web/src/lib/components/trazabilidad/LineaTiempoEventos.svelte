<script lang="ts">
  import type { TipoEventoTrazabilidad } from '@ganadito/contracts';
  import type { EventoLectura } from '#lib/trazabilidad/pasaporte.ts';

  // Historic names are read literally; the business enum still governs writes.
  // Public events (vista PUBLICA) arrive without author and without chain hashes.
  export type { EventoLectura };

  interface Props {
    eventos: readonly EventoLectura[];
  }

  let { eventos }: Props = $props();

  let hashCopiado = $state<string | null>(null);

  async function copiarHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      hashCopiado = hash;
      setTimeout(() => {
        hashCopiado = null;
      }, 2500);
    } catch {
      console.info('Hash SHA-256:', hash);
    }
  }

  interface ConfigEvento { titulo: string; icono: string; badgeClases: string; nodoColor: string }
  const CONFIG_EVENTOS: Readonly<Record<string, ConfigEvento>> = {
    REGISTRO_INICIAL: {
      titulo: 'Registro Génesis del Bovino',
      icono: '🌱',
      badgeClases: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      nodoColor: 'bg-emerald-500 ring-emerald-500/30'
    },
    VACUNACION: {
      titulo: 'Vacunación registrada',
      icono: '💉',
      badgeClases: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
      nodoColor: 'bg-teal-500 ring-teal-500/30'
    },
    TRATAMIENTO: {
      titulo: 'Tratamiento Veterinario',
      icono: '💊',
      badgeClases: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      nodoColor: 'bg-yellow-500 ring-yellow-500/30'
    },
    PESAJE: {
      titulo: 'Control de Pesaje Periódico',
      icono: '⚖️',
      badgeClases: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
      nodoColor: 'bg-cyan-500 ring-cyan-500/30'
    },
    MOVILIZACION_CSTI: {
      titulo: 'Movilización CSTI declarada',
      icono: '🚛',
      badgeClases: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      nodoColor: 'bg-amber-500 ring-amber-500/30'
    },
    PESAJE_CAMAL: {
      titulo: 'Ingreso & Pesaje en Camal Frigorífico',
      icono: '🥩',
      badgeClases: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      nodoColor: 'bg-rose-500 ring-rose-500/30'
    },
    INSPECCION_POST_MORTEM: {
      titulo: 'Inspección Sanitaria Post-Mortem',
      icono: '🔬',
      badgeClases: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      nodoColor: 'bg-purple-500 ring-purple-500/30'
    },
    CAMBIO_PROPIEDAD: {
      titulo: 'Transferencia de Propiedad Comercial',
      icono: '🤝',
      badgeClases: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      nodoColor: 'bg-blue-500 ring-blue-500/30'
    }
  } satisfies Record<TipoEventoTrazabilidad, ConfigEvento>;

  function formatoFecha(fecha: string | Date): string {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    return d.toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between border-b border-slate-800 pb-3">
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
      <h3 class="text-base font-bold text-white tracking-tight">
        Eventos registrados ({eventos.length})
      </h3>
    </div>
    <span class="text-xs font-mono text-slate-400">
      Algoritmo: SHA-256 Event Sourcing
    </span>
  </div>

  {#if eventos.length === 0}
    <div class="p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
      No hay eventos registrados en este pasaporte bovino aún.
    </div>
  {:else}
    <!-- Línea de tiempo vertical -->
    <div class="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-2.5 sm:before:left-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
      {#each eventos as evento (even