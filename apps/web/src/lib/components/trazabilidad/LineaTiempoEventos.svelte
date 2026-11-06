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
      {#each eventos as evento (evento.secuencia)}
        {@const config = (Object.hasOwn(CONFIG_EVENTOS, evento.event_type) ? CONFIG_EVENTOS[evento.event_type] : undefined) ?? {
          titulo: evento.event_type,
          icono: '📌',
          badgeClases: 'bg-slate-800 text-slate-300 border-slate-700',
          nodoColor: 'bg-slate-700 ring-slate-800'
        }}
        <div class="relative group">
          <!-- Nodo en la línea vertical -->
          <div
            class="absolute -left-6 sm:-left-8 top-1.5 w-5 h-5 rounded-full {config.nodoColor} ring-4 flex items-center justify-center text-[10px] text-white shadow-md z-10 transition-transform group-hover:scale-110"
          >
            <span class="text-[9px] font-black">{evento.secuencia}</span>
          </div>

          <!-- Tarjeta del Evento -->
          <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3 transition-colors hover:border-slate-700">
            <!-- Encabezado del Evento -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
              <div class="flex items-center gap-2.5">
                <span class="text-lg">{config.icono}</span>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-white">{config.titulo}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold border {config.badgeClases}">
                      {evento.event_type}
                    </span>
                  </div>
                  <span class="text-[11px] text-slate-400">
                    {#if evento.autor_id}Autor: <code class="font-mono text-slate-300">USR-{evento.autor_id.slice(0, 8)}</code>{:else}<span>Autor reservado</span>{/if}
                  </span>
                </div>
              </div>

              <!-- Fecha y hora -->
              <div class="text-xs font-mono text-slate-400 self-start sm:self-auto">
                🕒 {formatoFecha(evento.created_at)}
              </div>
            </div>

            <!-- Contenido del Metadata JSON renderizado -->
            {#if evento.metadata && Object.keys(evento.metadata).length > 0}
              <div class="bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                <span class="text-[10px] uppercase font-bold text-slate-500 block mb-1.5 tracking-wider">
                  Detalles del Evento Pecuario
                </span>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  {#each Object.entries(evento.metadata) as [clave, valor]}
                    <div class="bg-slate-900/80 px-2.5 py-1.5 rounded border border-slate-800/60">
                      <span class="text-[10px] text-slate-400 uppercase font-medium block truncate">
                        {clave.replace(/_/g, ' ')}:
                      </span>
                      <span class="font-semibold text-slate-200 font-mono text-xs break-all">
                        {typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <!-- Auditoría de Eslabón Criptográfico (prev_hash y current_hash): solo en la vista
                 COMPLETA. La vista PUBLICA no trae hashes; su integridad la confirma /verificar. -->
            {#if evento.prev_hash && evento.current_hash}
            {@const prevHash = evento.prev_hash}
            {@const currentHash = evento.current_hash}
            <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800/50 space-y-1.5 text-[11px]">
              <!-- Hash Previo -->
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span class="text-slate-500 font-medium">Hash Previo (Parent SHA-256):</span>
                <span class="font-mono text-slate-400 text-[10px] break-all sm:text-right" title={prevHash}>
                  {prevHash === '0'.repeat(64) ? '0000000000000000... (Génesis)' : `${prevHash.slice(0, 16)}...${prevHash.slice(-16)}`}
                </span>
              </div>

              <!-- Hash Actual -->
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1 border-t border-slate-900">
                <span class="text-emerald-400 font-bold flex items-center gap-1">
                  <span>🔒 Hash Bloque #{evento.secuencia}:</span>
                </span>
                <div class="flex items-center gap-2 self-end sm:self-auto">
                  <span class="font-mono font-bold text-emerald-300 text-[10px] break-all" title={currentHash}>
                    {currentHash.slice(0, 18)}...{currentHash.slice(-18)}
                  </span>
                  <button
                    type="button"
                    onclick={() => copiarHash(currentHash)}
                    class="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition-colors shrink-0"
                    title="Copiar hash completo"
                  >
                    {hashCopiado === currentHash ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
