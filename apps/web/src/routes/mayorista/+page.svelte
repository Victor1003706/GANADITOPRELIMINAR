<script lang="ts">
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import type {
    CrearPoolMayoristaInput,
    PoolConProgreso,
    PoolCompraMayorista,
    TipoProductoMayorista,
    UnidadMedidaMayorista,
    UnirsePoolResponse
  } from '@ganadito/contracts';

  const productos: Array<{ value: TipoProductoMayorista; label: string }> = [
    { value: 'INSUMO_AGRICOLA', label: 'Insumo agrícola' },
    { value: 'GRANO_FORRAJE', label: 'Grano y forraje' },
    { value: 'MEDIAS_CANALES', label: 'Medias canales' },
    { value: 'CUARTOS_COMPENSADOS', label: 'Cuartos compensados' },
    { value: 'CORTES_CALIBRADOS', label: 'Cortes calibrados' },
    { value: 'EQUIPAMIENTO_SANITARIO', label: 'Equipamiento sanitario' }
  ];
  const unidades: UnidadMedidaMayorista[] = ['KG', 'TONELADA', 'UNIDAD', 'SACO_50KG'];

  let pools = $state<PoolConProgreso[]>([]);
  let productoFiltro = $state('');
  let soloFlash = $state(false);
  let cargando = $state(false);
  let errorLista = $state('');
  let seleccionId = $state('');
  let cantidadUnirse = $state<number | undefined>();
  let enviandoUnion = $state(false);
  let errorUnion = $state('');
  let unionConfirmada = $state<UnirsePoolResponse | null>(null);

  let productoNuevo = $state<TipoProductoMayorista>('INSUMO_AGRICOLA');
  let titulo = $state('');
  let descripcion = $state('');
  let precio = $state<number | undefined>();
  let metaVolumen = $state<number | undefined>();
  let unidad = $state<UnidadMedidaMayorista>('KG');
  let fechaLimite = $state('');
  let esFlash = $state(false);
  let creando = $state(false);
  let errorCrear = $state('');
  let poolCreado = $state<PoolCompraMayorista | null>(null);

  async function cargarPools() {
    cargando = true;
    errorLista = '';
    try {
      const query = new URLSearchParams();
      if (productoFiltro) query.set('tipo_producto', productoFiltro);
      if (soloFlash) query.set('flash', 'true');
      const suffix = query.size ? `?${query}` : '';
      const resultado = await apiRequest<PoolConProgreso[]>(`/api/v1/mayorista/pools${suffix}`, { auth: false });
      if (!Array.isArray(resultado)) throw new Error('La API devolvió un listado de campañas inválido.');
      pools = resultado;
    } catch (error) {
      pools = [];
      errorLista = error instanceof Error ? error.message : 'No se pudieron consultar las campañas.';
    } finally {
      cargando = false;
    }
  }

  async function crearPool(event: SubmitEvent) {
    event.preventDefault();
    errorCrear = '';
    poolCreado = null;
    if ($session.status !== 'authenticated' || !$session.organizationId) {
      errorCrear = 'Inicia sesión y selecciona una organización activa para crear una campaña.';
      return;
    }
    const fecha = Date.parse(fechaLimite);
    if (!titulo.trim() || !descripcion.trim() || !precio || precio <= 0 || !metaVolumen || metaVolumen <= 0 ||
        !Number.isFinite(fecha) || fecha <= Date.now()) {
      errorCrear = 'Completa los datos, usa valores positivos y elige una fecha límite futura.';
      return;
    }

    creando = true;
    const input: CrearPoolMayoristaInput = {
      tipo_producto: productoNuevo,
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      precio_unitario_mayorista: precio,
      meta_volumen: metaVolumen,
      unidad_medida: unidad,
      fecha_limite: new Date(fecha).toISOString(),
      es_oferta_flash: esFlash
    };
    try {
      poolCreado = await apiRequest<PoolCompraMayorista>('/api/v1/mayorista/pools', {
        method: 'POST',
        body: JSON.stringify(input),
        expectedStatus: 201
      });
      titulo = '';
      descripcion = '';
      precio = undefined;
      metaVolumen = undefined;
      fechaLimite = '';
      esFlash = false;
      await cargarPools();
    } catch (error) {
      errorCrear = error instanceof Error ? error.message : 'No se pudo crear la campaña.';
    } finally {
      creando = false;
    }
  }

  async function unirse(event: SubmitEvent) {
    event.preventDefault();
    errorUnion = '';
    unionConfirmada = null;
    if ($session.status !== 'authenticated' || !$session.organizationId) {
      errorUnion = 'Inicia sesión y selecciona una organización activa para reservar volumen.';
      return;
    }
    if (!seleccionId || !cantidadUnirse || cantidadUnirse <= 0) {
      errorUnion = 'Ingresa una cantidad mayor a cero.';
      return;
    }
    enviandoUnion = true;
    try {
      unionConfirmada = await apiRequest<UnirsePoolResponse>(
        `/api/v1/mayorista/pools/${encodeURIComponent(seleccionId)}/unirse`,
        { method: 'POST', body: JSON.stringify({ cantidad: cantidadUnirse }), expectedStatus: 201 }
      );
      cantidadUnirse = undefined;
      seleccionId = '';
      await cargarPools();
    } catch (error) {
      errorUnion = error instanceof Error ? error.message : 'No se pudo reservar el volumen.';
    } finally {
      enviandoUnion = false;
    }
  }

  $effect(() => { productoFiltro; soloFlash; void cargarPools(); });
</script>

<svelte:head><title>Compras mayoristas | Ganadito</title></svelte:head>

<section class="page">
  <p class="eyebrow">Compra agrupada</p>
  <h1>Compras mayoristas</h1>
  <p class="muted">Consulta campañas registradas, reserva una cantidad en la API y sigue el avance real frente a la meta.</p>

  <section class="panel" aria-labelledby="listado-title">
    <div class="context-card">
      <div><h2 id="listado-title">Campañas abiertas</h2><p class="muted">El porcentaje se calcula con las participaciones guardadas por el servidor.</p></div>
      <label>Filtrar por producto
        <select bind:value={productoFiltro}><option value="">Todos</option>{#each productos as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select>
      </label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={soloFlash} /> Solo ofertas flash</label>
      <button type="button" class="secondary" onclick={() => void cargarPools()} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
    </div>
    {#if errorLista}<p class="error" role="alert">{errorLista}</p>
    {:else if cargando && pools.length === 0}<p role="status">Consultando campañas en la API…</p>
    {:else if pools.length === 0}<p class="notice">La API no tiene campañas abiertas que coincidan con este filtro.</p>
    {:else}
      <div class="grid md:grid-cols-2 gap-4">
        {#each pools as pool (pool.id)}
          <article class="panel">
            <div class="context-card"><h3>{pool.titulo}</h3>{#if pool.es_oferta_flash}<span class="badge">Oferta flash</span>{/if}</div>
            <p>{pool.descripcion}</p>
            <p class="muted">{productos.find(p => p.value === pool.tipo_producto)?.label ?? pool.tipo_producto} · vence <time datetime={new Date(pool.fecha_limite).toISOString()}>{new Date(pool.fecha_limite).toLocaleString('es-PE')}</time></p>
            <p><strong>S/ {pool.precio_unitario_mayorista.toFixed(2)}</strong> por {pool.unidad_medida}</p>
            <p>Avance: {pool.volumen_acumulado.toLocaleString('es-PE')} / {pool.meta_volumen.toLocaleString('es-PE')} {pool.unidad_medida} ({Math.min(100, Math.max(0, pool.progreso_porcentaje)).toFixed(1)} %)</p>
            <progress class="w-full" max="100" value={Math.min(100, Math.max(0, pool.progreso_porcentaje))} aria-label={`Avance de ${pool.titulo}`}></progress>
            {#if $session.status === 'authenticated' && $session.organizationId}
              <button type="button" class="secondary" onclick={() => { seleccionId = pool.id; errorUnion = ''; unionConfirmada = null; }}>Reservar volumen</button>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if seleccionId}
    <section class="panel" aria-labelledby="join-title">
      <h2 id="join-title">Reservar en la campaña seleccionada</h2>
      <p class="muted">La reserva se registra con tu organización activa; no es un pago ni confirma una compra liquidada.</p>
      <form class="form-grid md:grid-cols-2" onsubmit={unirse}>
        <label>Cantidad ({unidades.join(', ')})<input type="number" min="0.01" step="0.01" bind:value={cantidadUnirse} required /></label>
        {#if errorUnion}<p class="error" role="alert">{errorUnion}</p>{/if}
        <div class="flex gap-3"><button type="submit" disabled={enviandoUnion}>{enviandoUnion ? 'Registrando reserva…' : 'Confirmar reserva'}</button><button class="secondary" type="button" onclick={() => { seleccionId = ''; errorUnion = ''; }}>Cancelar</button></div>
      </form>
    </section>
  {/if}
  {#if unionConfirmada}<div class="notice" role="status">Reserva registrada. Total: S/ {unionConfirmada.participacion.monto_total.toFixed(2)}. {unionConfirmada.meta_alcanzada ? 'La campaña alcanzó su meta.' : 'La API actualizó el avance.'}</div>{/if}

  <section class="panel" aria-labelledby="create-title">
    <h2 id="create-title">Publicar campaña</h2>
    {#if $session.status !== 'authenticated'}<p>Para crear una campaña, <a href="/acceso">inicia sesión</a>.</p>
    {:else if !$session.organizationId}<p>Selecciona una organización en <a href="/contexto">Contexto</a>.</p>
    {:else}
      <form class="form-grid md:grid-cols-2" onsubmit={crearPool}>
        <label>Producto<select bind:value={productoNuevo}>{#each productos as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <label>Título<input bind:value={titulo} required maxlength="160" /></label>
        <label class="md:col-span-2">Descripción<textarea bind:value={descripcion} required maxlength="2000" rows="3"></textarea></label>
        <label>Precio mayorista (S/ por unidad)<input type="number" min="0.01" step="0.01" bind:value={precio} required /></label>
        <label>Meta de volumen<input type="number" min="0.01" step="0.01" bind:value={metaVolumen} required /></label>
        <label>Unidad<select bind:value={unidad}>{#each unidades as item (item)}<option value={item}>{item}</option>{/each}</select></label>
        <label>Fecha límite<input type="datetime-local" bind:value={fechaLimite} required /></label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={esFlash} /> Marcar como oferta flash</label>
        {#if errorCrear}<p class="error md:col-span-2" role="alert">{errorCrear}</p>{/if}
        <button type="submit" disabled={creando}>{creando ? 'Enviando a la API…' : 'Crear campaña real'}</button>
      </form>
    {/if}
    {#if poolCreado}<div class="notice" role="status">Campaña creada en la base de datos: {poolCreado.id} · {poolCreado.estado}.</div>{/if}
  </section>
</section>
