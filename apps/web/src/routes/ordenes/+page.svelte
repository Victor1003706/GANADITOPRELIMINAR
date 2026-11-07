<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { session } from '#lib/session.ts';
  import { ApiError } from '#lib/api.ts';
  import { listOrders, orderAmount, orderError, type Order, type OrderRole } from '#lib/orders.ts';

  const contextKey = $derived(JSON.stringify([$session.status, $session.token, $session.organizationId, $session.role]));
  const lotId = $derived(page.url.searchParams.get('lote_id') ?? '');
  let roleChoice = $state<{ context: string; role: OrderRole } | null>(null);
  const role = $derived(roleChoice?.context === contextKey ? roleChoice.role : $session.role === 'VENDEDOR' ? 'vendedor' : 'comprador');
  const queryKey = $derived(JSON.stringify([contextKey, role, lotId, page.url.pathname]));
  let orders = $state<Order[]>([]);
  let nextCursor = $state<string | null>(null);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');
  let cursorWarning = $state('');
  let controller: AbortController | undefined;
  let requestedCursors = new Set<string>();
  let activeQuery = '';
  const visibleOrders = $derived(lotId ? orders.filter(order => order.lote_id === lotId) : orders);

  async function load(cursor: string | null, key: string, requestedRole: OrderRole) {
    if (loading || key !== activeQuery) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    if (cursor !== null) requestedCursors.add(cursor);
    loading = true;
    error = '';
    try {
      const result = await listOrders(requestedRole, cursor, request.signal);
      if (request.signal.aborted || key !== activeQuery || key !== queryKey) return;
      const ids = new Set(orders.map(order => order.id));
      orders = [...orders, ...result.data.filter(order => {
        if (ids.has(order.id)) return false;
        ids.add(order.id);
        return true;
      })];
      loaded = true;
      if (result.next_cursor !== null && requestedCursors.has(result.next_cursor)) {
        nextCursor = null;
        cursorWarning = 'La API devolvió un cursor repetido. Se detuvo la paginación; esta consulta puede estar incompleta.';
      } else nextCursor = result.next_cursor;
    } catch (err) {
      if (!request.signal.aborted && key === activeQuery && key === queryKey) {
        if (err instanceof ApiError && err.status === 403) {
          orders = [];
          nextCursor = null;
          loaded = false;
          requestedCursors.clear();
          cursorWarning = '';
        }
        error = orderError(err);
      }
    } finally {
      if (!request.signal.aborted && key === activeQuery && key === queryKey) loading = false;
    }
  }

  $effect(() => {
    const key = queryKey;
    const selectedRole = role;
    const canRead = $session.status === 'authenticated' && !!$session.token && !!$session.organizationId;
    untrack(() => {
      controller?.abort();
      activeQuery = key;
      orders = [];
      nextCursor = null;
      requestedCursors = new Set();
      loading = false;
      loaded = false;
      error = '';
      cursorWarning = '';
      if (canRead) void load(null, key, selectedRole);
    });
    return () => controller?.abort();
  });
</script>

<svelte:head><title>Órdenes | Ganadito</title></svelte:head>
<section class="page" style="max-width: 850px">
  <p class="eyebrow">Consulta autorizada</p><h1>Órdenes de compra</h1>
  {#if $session.status === 'checking'}<p role="status">Comprobando sesión…</p>
  {:else if $session.status !== 'authenticated'}
    <div class="panel"><p>Inicia sesión para consultar tus órdenes.</p><a href="/acceso">Iniciar sesión</a></div>
  {:else if !$session.organizationId}
    <p class="notice">Selecciona una organización para consultar sus órdenes. <a href="/contexto">Cambiar contexto</a></p>
  {:else}
    <p class="muted">Organización: {$session.context?.razon_social ?? $session.organizationId}. Importes en PEN, según el servidor.</p>
    <label style="max-width: 300px">Ver órdenes como
      <select value={role} onchange={event => { roleChoice = { context: contextKey, role: event.currentTarget.value as OrderRole }; }}>
        <option value="comprador">Comprador</option><option value="vendedor">Vendedor</option>
      </select>
    </label>
    {#if lotId}<p class="muted break-all">Lote filtrado: {lotId}. El filtro se aplica únicamente a las páginas consultadas.</p>{/if}
    {#if error}<div class="error"><p role="alert">{error}</p><a href="/contexto">Cambiar contexto</a> · <button type="button" class="secondary" disabled={loading} onclick={() => void load(nextCursor, queryKey, role)}>Reintentar consulta</button></div>{/if}
    {#if loading}<p role="status">Consultando órdenes…</p>{/if}
    {#each visibleOrders as order (order.id)}
      <article class="panel">
        <h2>{order.codigo_lote}</h2><p class="badge" style="display: inline-block">{order.estado}</p>
        <p>Total a pagar (PEN): <strong>{orderAmount(order.total_a_pagar)}</strong></p>
        <p class="muted">Registro: <time datetime={order.created_at}>{new Date(order.created_at).toLocaleString('es-PE')}</time></p>
        <a href={`/ordenes/${encodeURIComponent(order.id)}`} aria-label={`Ver orden ${order.codigo_lote}`}>Ver orden</a>
      </article>
    {/each}
    {#if loaded && visibleOrders.length === 0}
      <p role="status">{lotId ? 'No hay coincidencias en las páginas consultadas.' : 'No se recibieron órdenes en esta consulta.'}</p>
    {/if}
    {#if nextCursor !== null}
      <p class="muted">Hay más páginas por consultar.</p>
      <button type="button" disabled={loading} onclick={() => void load(nextCursor, queryKey, role)}>Cargar más órdenes</button>
    {/if}
    {#if cursorWarning}<p class="notice" role="status">{cursorWarning}</p>{/if}
    {#if loaded}<p class="muted">Se muestran los registros recibidos. La consulta paginada no garantiza un historial completo.</p>{/if}
  {/if}
  <div class="panel"><button type="button" disabled>Pago no disponible</button><p class="muted">Los pagos permanecen deshabilitados.</p></div>
  <a href="/subastas">Ir a lotes y subastas</a>
</section>
