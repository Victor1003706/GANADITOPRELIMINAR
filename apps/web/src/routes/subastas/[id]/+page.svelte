<script lang="ts">
  import { page } from '$app/state';
  import { apiRequest, ApiError } from '#lib/api.ts';
  import { apiWebSocketUrl, liveAuctionsEnabled } from '#lib/config.ts';
  import { session } from '#lib/session.ts';
  import { parseSnapshot, parseLiveEvent, type AuctionSnapshot, type AcceptedBid, type PublicBid } from '#lib/auctions/state.ts';
  import PanelPujaRapida from '#lib/components/subastas/PanelPujaRapida.svelte';
  import EstadoConexionWs, { type EstadoConexion } from '#lib/components/subastas/EstadoConexionWs.svelte';

  const lotId = $derived(page.params.id ?? '');
  const contextKey = $derived(`${$session.token ?? ''}:${$session.organizationId ?? ''}:${$session.role ?? ''}`);
  let snapshot = $state<AuctionSnapshot | null>(null);
  let loading = $state(true);
  let error = $state('');
  let connection = $state<EstadoConexion>('SINCRONIZANDO');
  let retries = $state(0);
  let seconds = $state(0);
  let lastUpdated = $state('');
  let bids = $state<PublicBid[]>([]);
  const synchronized = $derived(connection === 'CONECTADO' || connection === 'PERIODICO');
  let refresh: () => Promise<boolean> = async () => false;

  $effect(() => {
    const id = lotId;
    const key = contextKey;
    const checkingSession = $session.status === 'checking';
    const token = $session.status === 'authenticated' ? $session.token : null;
    const useLive = liveAuctionsEnabled && !!token;
    snapshot = null;
    bids = [];
    error = '';
    loading = true;
    connection = 'SINCRONIZANDO';
    retries = 0;
    seconds = 0;
    // Do not open a short-lived transport while the stored session is being restored.
    if (checkingSession) {
      refresh = async () => false;
      return;
    }
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let requestNumber = 0;
    let successfulAt = 0;
    let remainingAtSync = 0;
    let attempts = 0;
    let inFlight: Promise<boolean> | null = null;
    let refreshQueued = false;
    let observedSequence = 0;
    // Un ticket inválido o vencido se reintenta UNA vez con uno nuevo; después se desiste.
    let ticketRetried = false;
    // Momento en que abrió el socket actual: una "expiración" justo al abrir no es una vida
    // cumplida y no debe reconectar sin retroceso (evita un bucle de pedidos de ticket).
    let openedAt = 0;
    const VIDA_MINIMA_MS = 5000;

    async function querySnapshot(): Promise<boolean> {
      if (disposed || !id) return false;
      const number = ++requestNumber;
      const querySocket = socket;
      const startedWithOpenSocket = querySocket?.readyState === WebSocket.OPEN;
      connection = 'SINCRONIZANDO';
      request = new AbortController();
      try {
        const result = await apiRequest<unknown>(`/api/v1/subastas/${encodeURIComponent(id)}/snapshot`, { signal: request.signal });
        if (disposed || number !== requestNumber) return false;
        const official = parseSnapshot(result, id);
        snapshot = official;
        observedSequence = Math.max(observedSequence, official.secuencia_maxima);
        remainingAtSync = official.tiempo_restante_segundos;
        successfulAt = Date.now();
        seconds = remainingAtSync;
        lastUpdated = new Date().toLocaleTimeString('es-PE');
        error = '';
        const recovered = startedWithOpenSocket && querySocket === socket && socket?.readyState === WebSocket.OPEN;
        connection = !useLive ? 'PERIODICO' : recovered ? 'CONECTADO' : socket?.readyState === WebSocket.OPEN ? 'SINCRONIZANDO' : 'DESCONECTADO';
        if (recovered) { attempts = 0; retries = 0; }
        return true;
      } catch (cause) {
        if (disposed || number !== requestNumber) return false;
        error = cause instanceof Error ? cause.message : 'No se pudo consultar este lote.';
        connection = 'DESCONECTADO';
        return false;
      } finally {
        if (!disposed && number === requestNumber) loading = false;
      }
    }
    function synchronize(): Promise<boolean> {
      if (disposed) return Promise.resolve(false);
      if (inFlight) {
        refreshQueued = true;
        return inFlight;
      }
      const operation = querySnapshot();
      inFlight = operation;
      void operation.then(() => {
        inFlight = null;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void synchronize();
        }
      });
      return operation;
    }
    refresh = synchronize;

    function scheduleReconnect(delay = Math.min(1000 * 2 ** Math.min(attempts + 1, 5), 30000)) {
      connection = 'RECONECTANDO';
      attempts += 1;
      retries = attempts;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => void connect(), delay);
    }

    /**
     * Ticket de un solo uso (30 s, un lote) para abrir el WebSocket sin poner el JWT en la
     * URL. Cada conexión y cada reconexión piden uno nuevo.
     */
    async function requestTicket(): Promise<string> {
      const data = await apiRequest<unknown>(`/api/v1/subastas/${encodeURIComponent(id)}/live/ticket`, { method: 'POST', expectedStatus: 201 });
      const ticket = data && typeof data === 'object' && 'ticket' in data ? (data as { ticket: unknown }).ticket : null;
      if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 100) throw new ApiError('La API no devolvió un ticket válido.', 502);
      return ticket;
    }

    async function connect() {
      if (disposed || !useLive || !token) return;
      connection = attempts ? 'RECONECTANDO' : 'SINCRONIZANDO';
      let ticket: string;
      try {
        ticket = await requestTicket();
      } catch (cause) {
        if (disposed || contextKey !== key) return;
        // Sin sesión, sin contexto o lote inexistente: no tiene sentido reintentar en bucle.
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) { connection = 'DESCONECTADO'; return; }
        scheduleReconnect();
        return;
      }
      if (disposed || contextKey !== key) return;
      try {
        const url = new URL(apiWebSocketUrl(`/api/v1/subastas/${encodeURIComponent(id)}/live`));
        url.searchParams.set('ticket', ticket);
        const transport = new WebSocket(url);
        socket = transport;
        transport.onopen = () => {
          if (disposed || socket !== transport) return;
          openedAt = Date.now();
          // Recover official state on every connection, including the first one.
          connection = 'SINCRONIZANDO';
          void synchronize();
        };
        transport.onmessage = (message) => {
          if (disposed || socket !== transport || contextKey !== key) return;
          try {
            const event = parseLiveEvent(JSON.parse(String(message.data)), id);
            if (!event) return;
            if (event.kind === 'bid') {
              if (event.data.secuencia <= Math.max(snapshot?.secuencia_maxima ?? 0, observedSequence)) return;
              observedSequence = event.data.secuencia;
              if (connection === 'CONECTADO' && snapshot && event.data.secuencia === snapshot.secuencia_maxima + 1) recordBid(event.data);
            }
            // Events trigger a query; they do not decide the official price, status or winner.
            void synchronize();
          } catch { void synchronize(); }
        };
        transport.onerror = () => {
          if (disposed || socket !== transport) return;
          connection = 'DESCONECTADO';
          transport.close();
        };
        transport.onclose = (event) => {
          if (disposed || socket !== transport) return;
          // Solo una conexión que vivió lo suficiente rehabilita el reintento de ticket: el
          // servidor acepta el upgrade y LUEGO cierra con 1008, así que onopen no basta.
          if (openedAt > 0 && Date.now() - openedAt >= VIDA_MINIMA_MS) ticketRetried = false;
          if (event.code === 1008) {
            // Vida máxima cumplida (15 min o exp del JWT): reconectar en seguida con ticket nuevo.
            if (/expirada/i.test(event.reason)) {
              const vidaCumplida = openedAt > 0 && Date.now() - openedAt >= VIDA_MINIMA_MS;
              if (vidaCumplida) { attempts = 0; retries = 0; scheduleReconnect(1000); } else scheduleReconnect();
              return;
            }
            // Ticket vencido o consumido (p. ej., demora entre pedirlo y abrir): un reintento.
            if (/ticket/i.test(event.reason) && !ticketRetried) { ticketRetried = true; scheduleReconnect(0); return; }
            // Sesión revocada, sin contexto o lote inexistente: requiere nueva sesión o contexto.
            connection = 'DESCONECTADO';
            return;
          }
          // 1011 (no se pudo verificar) y cortes de red: reintento con retroceso exponencial.
          scheduleReconnect();
        };
      } catch {
        connection = 'DESCONECTADO';
        scheduleReconnect(5000);
      }
    }

    void synchronize();
    if (useLive) void connect();
    const polling = setInterval(() => { if (!inFlight) void synchronize(); }, 10000);
    const clock = setInterval(() => {
      if (successfulAt) seconds = Math.max(0, remainingAtSync - Math.floor((Date.now() - successfulAt) / 1000));
    }, 1000);
    const onVisible = () => { if (!document.hidden) void synchronize(); };
    const onOnline = () => { void synchronize(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(reconnectTimer);
      clearInterval(polling);
      clearInterval(clock);
      socket?.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  });

  function recordBid(bid: PublicBid) {
    bids = [bid, ...bids.filter(item => item.puja_id !== bid.puja_id)].sort((a, b) => b.secuencia - a.secuencia).slice(0, 30);
  }
  function accepted(bid: AcceptedBid) { recordBid(bid); void refresh(); }
</script>

<svelte:head><title>Subasta | Ganadito</title></svelte:head>
<div class="max-w-6xl mx-auto w-full px-4 py-8 space-y-6">
  <div class="flex flex-wrap justify-between items-center gap-4">
    <div><a href="/subastas" class="text-sm text-emerald-300 underline">Volver a lotes</a><h1 class="text-3xl font-bold mt-2">Sala de subasta</h1></div>
    <EstadoConexionWs estado={connection} reintento={retries} />
  </div>
  <p class="text-sm text-slate-400 break-all">Identificador: {lotId}</p>
  {#if loading}<p role="status">Consultando el lote solicitado…</p>{/if}
  {#if error}
    <div role="alert" class="rounded-xl border border-rose-600 bg-rose-950/40 p-4 space-y-2"><p>{error}</p><button type="button" onclick={() => refresh()} class="underline">Reintentar consulta</button></div>
  {/if}
  {#if snapshot}
    <div class="grid lg:grid-cols-2 gap-6">
      <section class="rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-5" aria-label="Estado oficial del lote">
        <div class="flex justify-between gap-4"><h2 class="text-xl font-bold">{snapshot.codigo_lote}</h2><span class="text-emerald-300">{snapshot.estado}</span></div>
        <dl class="grid grid-cols-2 gap-5 text-sm">
          <div><dt class="text-slate-400">Precio actual</dt><dd class="text-2xl font-bold">S/ {snapshot.precio_actual.toFixed(2)}</dd></div>
          <div><dt class="text-slate-400">Precio base</dt><dd>S/ {snapshot.precio_base.toFixed(2)}</dd></div>
          <div><dt class="text-slate-400">Incremento mínimo</dt><dd>S/ {snapshot.incremento_minimo.toFixed(2)}</dd></div>
          <div><dt class="text-slate-400">Pujas registradas</dt><dd>{snapshot.secuencia_maxima}</dd></div>
        </dl>
        <div><p class="text-slate-400 text-sm">Tiempo orientativo restante</p><p class="font-mono text-3xl">{Math.floor(seconds / 3600).toString().padStart(2, '0')}:{Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</p></div>
        {#if seconds === 0 && snapshot.estado === 'ACTIVO'}<p role="status" class="text-amber-200">Esperando la confirmación del cierre por el servidor.</p>{/if}
        <p class="text-xs text-slate-400">Última consulta: {lastUpdated}. Versión {snapshot.version}. El reloj no adjudica el lote.</p>
        {#if ['ADJUDICADO', 'CERRADO', 'DESIERTO', 'CANCELADO'].includes(snapshot.estado)}
          <div class="border-t border-slate-700 pt-4 space-y-2"><p>Estado de cierre confirmado: {snapshot.estado}.</p><a href={`/ordenes?lote_id=${encodeURIComponent(lotId)}`} class="text-emerald-300 underline">Consultar información de órdenes</a><p class="text-sm text-slate-400">Los pagos permanecen deshabilitados.</p></div>
        {/if}
      </section>
      {#key contextKey}
        <fieldset class="min-w-0" disabled={!synchronized} aria-label="Acciones de puja">
          <PanelPujaRapida subastaId={lotId} precioActual={snapshot.precio_actual} incrementoMinimo={snapshot.incremento_minimo} proximaPujaMinima={snapshot.proxima_puja_minima} esAbierta={snapshot.es_abierta && synchronized && !error && !loading} onPujaExitosa={accepted} />
        </fieldset>
      {/key}
    </div>
    <section class="rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-3">
      <h2 class="text-lg font-bold">Pujas recibidas durante esta visita</h2>
      <p class="text-sm text-slate-400">La consulta oficial informa {snapshot.secuencia_maxima} pujas en total. El historial anterior no está disponible en esta pantalla.</p>
      {#if bids.length === 0}<p class="text-slate-300">Todavía no se recibieron pujas en esta visita.</p>{:else}<ul class="space-y-2">{#each bids as bid (bid.puja_id)}<li class="flex justify-between border-t border-slate-800 pt-2"><span>Secuencia {bid.secuencia}</span><span>S/ {bid.monto.toFixed(2)}</span></li>{/each}</ul>{/if}
    </section>
  {:else if !loading && !error}<p>No hay información del lote solicitado.</p>{/if}
</div>
