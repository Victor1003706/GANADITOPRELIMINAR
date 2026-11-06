<script lang="ts">
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import type {
    CalcularEscandalloInput,
    CrearOrdenGmxInput,
    CrearOrdenGmxResponse,
    OrderbookGmxResponse,
    ProductoGmx,
    ResultadoEscandalloAnatomico,
    TipoOperacionGmx
  } from '@ganadito/contracts';

  const productos: Array<{ value: ProductoGmx; label: string }> = [
    { value: 'MEDIA_CANAL', label: 'Media canal' },
    { value: 'CUARTO_DELANTERO', label: 'Cuarto delantero' },
    { value: 'CUARTO_TRASERO', label: 'Cuarto trasero' },
    { value: 'CORTES_CALIBRADOS', label: 'Cortes calibrados' }
  ];

  let producto = $state<ProductoGmx>('MEDIA_CANAL');
  let orderbook = $state<OrderbookGmxResponse | null>(null);
  let cargandoLibro = $state(false);
  let errorLibro = $state('');
  let tipoOperacion = $state<TipoOperacionGmx>('COMPRA');
  let cantidadKg = $state<number | undefined>();
  let precioLimite = $state<number | undefined>();
  let enviandoOrden = $state(false);
  let errorOrden = $state('');
  let ordenCreada = $state<CrearOrdenGmxResponse | null>(null);

  let pesoCanalKg = $state<number | undefined>();
  let costoKiloCanalPen = $state<number | undefined>();
  let margenPct = $state(22);
  let mermaPct = $state(3.5);
  let resultadoEscandallo = $state<ResultadoEscandalloAnatomico | null>(null);
  let calculando = $state(false);
  let errorEscandallo = $state('');

  async function cargarLibro() {
    cargandoLibro = true;
    errorLibro = '';
    try {
      orderbook = await apiRequest<OrderbookGmxResponse>(
        `/api/v1/gmx/orderbook?producto=${encodeURIComponent(producto)}`,
        { auth: false }
      );
    } catch (error) {
      orderbook = null;
      errorLibro = error instanceof Error ? error.message : 'No se pudo consultar el libro de órdenes.';
    } finally {
      cargandoLibro = false;
    }
  }

  async function calcularEscandallo(event: SubmitEvent) {
    event.preventDefault();
    errorEscandallo = '';
    resultadoEscandallo = null;
    if (!pesoCanalKg || !costoKiloCanalPen || pesoCanalKg <= 0 || costoKiloCanalPen <= 0 ||
        margenPct <= 0 || margenPct >= 95 || mermaPct < 0 || mermaPct >= 50) {
      errorEscandallo = 'Ingresa peso y costo positivos, margen entre 0 y 95 %, y merma entre 0 y 50 %.';
      return;
    }

    calculando = true;
    const input: CalcularEscandalloInput = {
      pesoCanalKg,
      costoKiloCanalPEN: costoKiloCanalPen,
      margenObjetivoPct: margenPct / 100,
      mermaDespostePct: mermaPct / 100
    };
    try {
      resultadoEscandallo = await apiRequest<ResultadoEscandalloAnatomico>(
        '/api/v1/gmx/escandallo',
        { method: 'POST', auth: false, body: JSON.stringify(input), expectedStatus: 200 }
      );
    } catch (error) {
      errorEscandallo = error instanceof Error ? error.message : 'No se pudo calcular el escandallo.';
    } finally {
      calculando = false;
    }
  }

  async function registrarOrden(event: SubmitEvent) {
    event.preventDefault();
    errorOrden = '';
    ordenCreada = null;
    if ($session.status !== 'authenticated' || !$session.organizationId) {
      errorOrden = 'Inicia sesión y selecciona una organización activa antes de registrar una orden.';
      return;
    }
    if (!cantidadKg || !precioLimite || cantidadKg <= 0 || precioLimite <= 0) {
      errorOrden = 'La cantidad y el precio límite deben ser mayores a cero.';
      return;
    }

    enviandoOrden = true;
    const input: CrearOrdenGmxInput = {
      tipo_operacion: tipoOperacion,
      producto,
      cantidad_kg: cantidadKg,
      precio_kilo_limite: precioLimite
    };
    try {
      ordenCreada = await apiRequest<CrearOrdenGmxResponse>('/api/v1/gmx/ordenes', {
        method: 'POST',
        body: JSON.stringify(input),
        expectedStatus: 201
      });
      await cargarLibro();
    } catch (error) {
      errorOrden = error instanceof Error ? error.message : 'No se pudo registrar la orden.';
    } finally {
      enviandoOrden = false;
    }
  }

  $effect(() => { producto; void cargarLibro(); });
</script>

<svelte:head><title>GMX | Ganadito</title></svelte:head>

<section class="page">
  <p class="eyebrow">Mercado de carne</p>
  <h1>Bolsa cárnica GMX</h1>
  <p class="muted">Consulta el libro real de órdenes, registra una compra o venta y calcula el rendimiento estimado de una canal.</p>

  <section class="panel" aria-labelledby="orderbook-title">
    <div class="context-card">
      <div><h2 id="orderbook-title">Libro de órdenes</h2><p class="muted">Los precios y volúmenes provienen de órdenes registradas en la base de datos.</p></div>
      <label>Producto
        <select bind:value={producto} aria-label="Producto del libro GMX">
          {#each productos as item (item.value)}<option value={item.value}>{item.label}</option>{/each}
        </select>
      </label>
      <button type="button" class="secondary" onclick={() => void cargarLibro()} disabled={cargandoLibro}>
        {cargandoLibro ? 'Consultando…' : 'Actualizar'}
      </button>
    </div>

    {#if errorLibro}<p class="error" role="alert">{errorLibro}</p>
    {:else if cargandoLibro && !orderbook}<p role="status">Consultando el libro en la API…</p>
    {:else if orderbook}
      <p>Última consulta: <time datetime={orderbook.timestamp}>{new Date(orderbook.timestamp).toLocaleString('es-PE')}</time>
        · Diferencial: {orderbook.spread_pen === null ? 'Sin contraparte' : `S/ ${orderbook.spread_pen.toFixed(2)}`}</p>
      <div class="grid md:grid-cols-2 gap-4">
        <div><h3>Compras</h3>
          {#if orderbook.compras.length === 0}<p class="muted">No hay órdenes de compra activas para este producto.</p>
          {:else}<ul>{#each orderbook.compras as nivel (nivel.precio_kilo)}<li>S/ {nivel.precio_kilo.toFixed(2)}/kg · {nivel.volumen_total_kg.toLocaleString('es-PE')} kg · {nivel.ordenes_count} órdenes</li>{/each}</ul>{/if}
        </div>
        <div><h3>Ventas</h3>
          {#if orderbook.ventas.length === 0}<p class="muted">No hay órdenes de venta activas para este producto.</p>
          {:else}<ul>{#each orderbook.ventas as nivel (nivel.precio_kilo)}<li>S/ {nivel.precio_kilo.toFixed(2)}/kg · {nivel.volumen_total_kg.toLocaleString('es-PE')} kg · {nivel.ordenes_count} órdenes</li>{/each}</ul>{/if}
        </div>
      </div>
    {/if}
  </section>

  <section class="panel" aria-labelledby="order-title">
    <h2 id="order-title">Registrar una orden</h2>
    {#if $session.status !== 'authenticated'}
      <p>Para operar, <a href="/acceso">inicia sesión</a>.</p>
    {:else if !$session.organizationId}
      <p>Selecciona primero tu organización activa en <a href="/contexto">Contexto</a>.</p>
    {:else}
      <p class="muted">La orden se registra con tu organización activa y puede cruzarse con una contraparte compatible.</p>
      <form class="form-grid md:grid-cols-2" onsubmit={registrarOrden}>
        <label>Operación<select bind:value={tipoOperacion}><option value="COMPRA">Comprar</option><option value="VENTA">Vender</option></select></label>
        <label>Producto<select bind:value={producto}>{#each productos as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <label>Cantidad (kg)<input type="number" min="0.01" step="0.01" bind:value={cantidadKg} required /></label>
        <label>Precio límite (S/ por kg)<input type="number" min="0.01" step="0.01" bind:value={precioLimite} required /></label>
        {#if errorOrden}<p class="error md:col-span-2" role="alert">{errorOrden}</p>{/if}
        <button type="submit" disabled={enviandoOrden}>{enviandoOrden ? 'Enviando a la API…' : 'Registrar orden real'}</button>
      </form>
    {/if}
    {#if ordenCreada}
      <div class="notice" role="status">
        <strong>Orden registrada:</strong> {ordenCreada.orden.id} · Estado: {ordenCreada.orden.estado} · Saldo: {ordenCreada.orden.cantidad_restante_kg.toLocaleString('es-PE')} kg.
        {#if ordenCreada.calces.length > 0}<p>La API confirmó {ordenCreada.calces.length} calce(s) y sus importes.</p>{:else}<p>La orden quedó en el libro; aún no tiene contraparte compatible.</p>{/if}
      </div>
    {/if}
  </section>

  <section class="panel" aria-labelledby="escandallo-title">
    <h2 id="escandallo-title">Escandallo anatómico NTP 201.055</h2>
    <p class="muted">Estimación matemática de cortes, merma e ingresos; no reemplaza el pesaje ni una cotización comercial.</p>
    <form class="form-grid md:grid-cols-2" onsubmit={calcularEscandallo}>
      <label>Peso de canal (kg)<input type="number" min="0.01" step="0.01" bind:value={pesoCanalKg} required /></label>
      <label>Costo de canal (S/ por kg)<input type="number" min="0.01" step="0.01" bind:value={costoKiloCanalPen} required /></label>
      <label>Margen objetivo (%)<input type="number" min="0.01" max="94.99" step="0.01" bind:value={margenPct} required /></label>
      <label>Merma de desposte (%)<input type="number" min="0" max="49.99" step="0.01" bind:value={mermaPct} required /></label>
      {#if errorEscandallo}<p class="error md:col-span-2" role="alert">{errorEscandallo}</p>{/if}
      <button type="submit" disabled={calculando}>{calculando ? 'Calculando…' : 'Calcular con la API'}</button>
    </form>
    {#if resultadoEscandallo}
      <div class="notice" role="status">
        <strong>{resultadoEscandallo.norma_tecnica}</strong>: aprovechable {resultadoEscandallo.peso_aprovechable_kg.toFixed(2)} kg de {resultadoEscandallo.peso_canal_kg.toFixed(2)} kg · merma {resultadoEscandallo.merma_kg.toFixed(2)} kg · ingreso estimado S/ {resultadoEscandallo.ingreso_total_estimado_pen.toFixed(2)} · utilidad estimada S/ {resultadoEscandallo.utilidad_neta_estimada_pen.toFixed(2)}.
      </div>
      <div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr><th class="text-left p-2">Corte</th><th class="text-right p-2">Kg</th><th class="text-right p-2">Precio sugerido/kg</th><th class="text-right p-2">Ingreso estimado</th></tr></thead>
        <tbody>{#each resultadoEscandallo.cortes as corte (corte.codigo)}
          <tr class="border-t border-slate-700"><td class="p-2">{corte.nombre}</td><td class="text-right p-2">{corte.peso_estimado_kg.toFixed(2)}</td><td class="text-right p-2">S/ {corte.precio_sugerido_kilo_pen.toFixed(2)}</td><td class="text-right p-2">S/ {corte.ingreso_estimado_pen.toFixed(2)}</td></tr>
        {/each}</tbody>
      </table></div>
    {/if}
  </section>
</section>
