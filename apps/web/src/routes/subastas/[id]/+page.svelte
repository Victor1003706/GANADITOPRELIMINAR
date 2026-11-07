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
        if (!