<script lang="ts">
  export type EstadoConexion = 'CONECTADO' | 'PERIODICO' | 'SINCRONIZANDO' | 'RECONECTANDO' | 'DESCONECTADO';

  interface Props {
    estado: EstadoConexion;
    reintento?: number;
    latenciaMs?: number | null;
  }

  let { estado = 'CONECTADO', reintento = 0, latenciaMs = null }: Props = $props();
</script>

<div
  class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors shadow-sm"
  class:bg-emerald-500-15={estado === 'CONECTADO'}
  class:text-emerald-300={estado === 'CONECTADO'}
  class:border-emerald-500-40={estado === 'CONECTADO'}
  class:bg-amber-500-15={estado === 'SINCRONIZANDO'}
  class:text-amber-300={estado === 'SINCRONIZANDO'}
  class:border-amber-500-40={estado === 'SINCRONIZANDO'}
  class:bg-rose-500-15={estado === 'RECONECTANDO' || estado === 'DESCONECTADO'}
  class:text-rose-300={estado === 'RECONECTANDO' || estado === 'DESCONECTADO'}
  class:border-rose-500-40={estado === 'RECONECTANDO' || estado === 'DESCONECTADO'}
  style="
    {estado === 'CONECTADO' || estado === 'PERIODICO'
      ? 'background-color: rgba(16, 185, 129, 0.12); border-color: rgba(16, 185, 129, 0.35); color: #6ee7b7;'
      : estado === 'SINCRONIZANDO'
        ? 'background-color: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.35); color: #fcd34d;'
        : 'background-color: rgba(244, 63, 94, 0.12); border-color: rgba(244, 63, 94, 0.35); color: #fda4af;'}
  "
  role="status"
  aria-live="polite"
>
  <!-- Indicador luminoso / ping -->
  <span class="relative flex h-2.5 w-2.5">
    {#if estado === 'CONECTADO' || estado === 'PERIODICO'}
      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
      <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
    {:else if estado === 'SINCRONIZANDO'}
      <span class="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
      <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
    {:else}
      <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 animate-pulse"></span>
    {/if}
  </span>

  <span class="font-semibold tracking-wide">
    {#if estado === 'PERIODICO'}
      Actualización periódica
    {:else if estado === 'CONECTADO'}
      En Vivo
    {:else if estado === 'SINCRONIZANDO'}
      Sincronizando
    {:else if estado === 'RECONECTANDO'}
      Reconectando{#if reintento > 0} (intento {reintento}){/if}
    {:else}
      Sin Conexión
    {/if}
  </span>

  {#if latenciaMs !== null && estado === 'CONECTADO'}
    <span class="text-[10px] font-mono opacity-70">
      {latenciaMs}ms
    </span>
  {/if}
</div>
