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
    <label style="max