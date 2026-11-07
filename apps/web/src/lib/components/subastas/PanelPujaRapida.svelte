<script lang="ts">
  import { onDestroy } from 'svelte';
  import { apiRequest, ApiError } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import { bidAttempt, parseBidReceipt, type BidAttempt, type AcceptedBid } from '#lib/auctions/state.ts';

  interface Props {
    subastaId: string;
    precioActual: number;
    incrementoMinimo: number;
    proximaPujaMinima: number;
    esAbierta?: boolean;
    onPujaExitosa?: (resultado: AcceptedBid) => void;
  }
  let { subastaId, precioActual, incrementoMinimo, proximaPujaMinima, esAbierta = false, onPujaExitosa }: Props = $props();
  let amount = $state<number | undefined>();
  let submitting = $state(false);
  let error = $state('');
  let confirmation = $state('');
  let pending = $state<BidAttempt | null>(null);
  let uncertain = $state(false);
  let disposed = false;
  onDestroy(() => { disposed = true; });
  const sessionKey = $derived(`${$session.token ?? ''}:${$session.organizationId ?? ''}:${$session.role ?? ''}`);
  const hasSession = $derived($session.status === 'authenticated' && !!$session.organizationId);
  const canBid = $derived(hasSession && esAbierta);

  $effect(() => {
    const key = sessionKey;
    const id = subastaId;
    if (pending && (pending.sessionKey !== key || pending.lotId !== id)) {
      pending = null;
      uncertain = false;
      error = '';
      confirmation = '';
    }
  });

  async function sendBid(value: number, retry = false) {
    if (submitting || !(retry ? hasSession : canBid)) return;
    if (!Number.isFinite(value) || value <= 0 || (!retry && value < proximaPujaMinima)) {
      error = `Ingresa un importe de al menos S/ ${proximaPujaMinima.toFixed(2)}.`;
      return;
    }
    const attempt = bidAttempt(pending, subastaId, value, sessionKey);
    pending = attempt;
    submitting = true;
    uncertain = false;
    error = '';
    confirmation = '';
    try {
      const response = await apiRequest<unknown>(`/api/v1/subastas/${encodeURIComponent(subastaId)}/pujas`, {
        method: 'POST',
        expectedStatus: 201,
        headers: { 'Idempotency-Key': attempt.key },
        body: JSON.stringify({ monto: attempt.amount, idempotency_key: attempt.key })
      });
      if (disposed || sessionKey !== attempt.sessionKey || subastaId !== attempt.lotId) return;
      const receipt = parseBidReceipt(response, attempt.lotId);
      if (receipt.idempotency_key !== attempt.key || receipt.monto !== attempt.amount) {
        throw new Error('No se pudo verificar la confirmación de la puja.');
      }
      confirmation = `El servidor confirmó tu puja de S/ ${receipt.monto.toFixed(2)} (secuencia ${receipt.secuencia}).`;
      pending = null;
      amount = undefined;
      onPujaExitosa?.(receipt);
    } catch (cause) {
      if (disposed || sessionKey !== attempt.sessionKey || subastaId !== attempt.lotId) return;
      error = cause instanceof Error ? cause.message : 'No se pudo enviar la puja.';
      const processing = cause instanceof ApiError && cause.status === 409 && cause.data !== null
        && typeof cause.data === 'object' && 'code' in cause.data && cause.data.code === 'IDEMPOTENCY_IN_PROGRESS';
      const definitive = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && !processing;
      uncertain = !definitive;
      if (definitive) pending = null;
    } finally {
      if (!disposed) submitting = false;
    }
  }
</script>

<section class="rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" aria-label="Enviar puja">
  <h2 class="text-lg font-bold">Enviar una puja</h2>
  <p class="text-sm text-slate-300">Próxima puja mínima: <strong>S/ {proximaPujaMinima.toFixed(2)}</strong></p>
  {#if $session.status !== 'authenticated'}
    <p class="text-amber-200"><a href="/acceso" class="underline">Inicia sesión</a> para pujar.</p>
  {:else if !$session.organizationId}
    <p class="text-amber-200"><a href="/contexto" class="underline">Selecciona tu organización</a> para continuar.</p>
  {/if}
  {#if error}<p role="alert" class="text-rose-300">{error}</p>{/if}
  {#if confirmation}<p role="status" class="text-emerald-300">{confirmation}</p>{/if}
  {#if uncertain && pending}
    <div class="rounded-xl border border-amber-600 p-3 text-sm text-amber-100 space-y-2">
      <p>La respuesta no llegó completa. La puja podría haberse registrado. Reintenta la misma solicitud para consultar su resultado sin duplicarla.</p>
      <button type="button" class="rounded-lg border border-amber-400 px-3 py-2 disabled:opacity-50" disabled={submitting || !hasSession} onclick={() => pending && sendBid(pending.amount, true)}>Reintentar la misma puja</button>
    </div>
  {/if}
  <div class="grid grid-cols-3 gap-2">
    {#each [1, 2, 5] as factor}
      <button type="button" class="rounded-xl bg-emerald-700 hover:bg-emerald-600 px-2 py-3 text-sm font-bold disabled:opacity-40" disabled={!canBid || submitting || uncertain} onclick={() => sendBid(precioActual + incrementoMinimo * factor)}>
        S/ {(precioActual + incrementoMinimo * factor).toFixed(2)}
      </button>
    {/each}
  </div>
  <form class="space-y-3" onsubmit={(event) => { event.preventDefault(); if (amount !== undefined) void sendBid(amount); }}>
    <label for="bid-amount" class="block text-sm">Importe de tu puja (S/)</label>
    <input id="bid-amount" name="monto" class="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" type="number" min={proximaPujaMinima} step="0.01" required bind:value={amount} disabled={!canBid || submitting || uncertain} />
    <button type="submit" class="w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold disabled:opacity-40" disabled={!canBid || submitting || uncertain}>{submitting ? 'Esperando confirmación…' : 'Confirmar puja'}</button>
  </form>
  {#if !esAbierta}<p class="text-sm text-slate-400">El servidor no tiene habilitadas las pujas para este lote.</p>{/if}
</section>
