<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { session } from '#lib/session.ts';
  import { getOrder, orderAmount, orderError, type Order } from '#lib/orders.ts';

  const id = $derived(page.params.id ?? '');
  const queryKey = $derived(JSON.stringify([id, $session.status, $session.token, $session.organizationId, $session.role]));
  let order = $state<Order | null>(null);
  let loading = $state(false);
  let error = $state('');
  let controller: AbortController | undefined;

  async function load(requestedId: string, key: string) {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    order = null;
    error = '';
    loading = true;
    try {
      const result = await getOrder(requestedId, request.signal);
      if (!request.signal.aborted && key === queryKey) order = result;
    } catch (err) {
      if (!request.signal.aborted && key === queryKey) error = orderError(err);
    } finally {
      if (!request.signal.aborted && key === queryKey) loading = false;
    }
  }

  $effect(() => {
    const key = queryKey;
    const requestedId = id;
    const canRead = $session.status === 'authenticated' && !!$session.token && !!$session.organizationId;
    untrack(() => {
      controller?.abort();
      order = null;
      error = '';
      loading = false;
      if (canRead && requestedId) void load(requestedId, key);
    });
    return () => controller?.abort();
  });
</script>

<svelte:head><title>Detalle de orden | Ganadito</title></svelte:head>
<section class="page" style="max-width: 850px">
  <a href="/ordenes">Volver a órdenes</a><h1>Detalle de orden</h1>
  {#if $session.status === 'checking'}<p role="status">Comprobando sesión…</p>
  {:else if $session.status !== 'authenticated'}
    <div class="panel"><p>Inicia sesión para consultar esta orden.</p><a href="/acceso">Iniciar sesión</a></div>
  {:else if !$session.organizationId}
    <p class="notice">Selecciona una organización para consultar la orden. <a href="/contexto">Cambiar contexto</a></p>
  {:else if loading}<p role="status">Consultando orden…</p>
  {:else if error}
    <div class="error"><p role="alert">{error}</p><a href="/contexto">Cambiar contexto</a> · <button type="button" class="secondary" onclick={() => void load(id, queryKey)}>Reintentar consulta</button></div>
  {:else if order}
    <article class="panel">
      <h2>{order.codigo_lote}</h2><p class="badge" style="display: inline-block">{order.estado}</p>
      <p class="muted">Importes en PEN, confirmados por el servidor.</p>
      <dl class="grid gap-4 break-all">
        <div><dt class="muted">Referencia de orden</dt><dd>{order.id}</dd></div>
        <div><dt class="muted">Monto adjudicado</dt><dd>{orderAmount(order.monto_adjudicado)}</dd></div>
        <div><dt class="muted">Comisión de plataforma</dt><dd>{orderAmount(order.comision_plataforma)}</dd></div>
        <div><dt class="muted">Total a pagar</dt><dd>{orderAmount(order.total_a_pagar)}</dd></div>
        <div><dt class="muted">Organización compradora</dt><dd>{order.organizacion_compradora_id ?? 'Sin organización compradora registrada'}</dd></div>
        <div><dt class="muted">Organización vendedora</dt><dd>{order.organizacion_vendedora_id}</dd></div>
        <div><dt class="muted">Fecha de registro</dt><dd><time datetime={order.created_at}>{new Date(order.created_at).toLocaleString('es-PE')}</time></dd></div>
      </dl>
      <p class="mt-4"><a href={`/subastas/${encodeURIComponent(order.lote_id)}`}>Ver lote</a></p>
    </article>
  {/if}
  <div class="panel"><button type="button" disabled>Pago no disponible</button><p class="muted">Los pagos permanecen deshabilitados.</p></div>
</section>
