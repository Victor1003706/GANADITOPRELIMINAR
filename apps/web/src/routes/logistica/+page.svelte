<script lang="ts">
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import type {
    ActualizarEstadoFleteInput,
    CotizarFleteInput,
    CotizacionFleteResult,
    CrearSolicitudFleteInput,
    SolicitudFlete,
    TipoCargaLogistica,
    TipoUnidadTransporte,
    TomarFleteInput,
    UnidadTransporte
  } from '@ganadito/contracts';

  const tiposUnidad: Array<{ value: TipoUnidadTransporte; label: string }> = [
    { value: 'CAMION_JAULA_SIMPLE', label: 'Camión jaula simple' },
    { value: 'CAMION_JAULA_DOBLE_PISO', label: 'Camión jaula doble piso' },
    { value: 'FURGON_ISOTERMICO_REFRIGERADO', label: 'Furgón isotérmico refrigerado' },
    { value: 'FURGON_SECO', label: 'Furgón seco' }
  ];
  const tiposCarga: Array<{ value: TipoCargaLogistica; label: string }> = [
    { value: 'GANADO_EN_PIE', label: 'Ganado en pie' },
    { value: 'CARNE_CANAL', label: 'Carne en canal' },
    { value: 'INSUMOS_GRANOS', label: 'Insumos y granos' }
  ];

  let origenId = $state('');
  let destinoId = $state('');
  let pesoToneladas = $state<number | undefined>();
  let tipoUnidad = $state<TipoUnidadTransporte>('CAMION_JAULA_SIMPLE');
  let tipoCarga = $state<TipoCargaLogistica>('GANADO_EN_PIE');
  let cotizacion = $state<CotizacionFleteResult | null>(null);
  let cargandoCotizacion = $state(false);
  let errorCotizacion = $state('');
  let creandoSolicitud = $state(false);
  let errorSolicitud = $state('');
  let solicitudCreada = $state<SolicitudFlete | null>(null);

  let solicitudes = $state<SolicitudFlete[]>([]);
  let unidades = $state<UnidadTransporte[]>([]);
  let cargandoLista = $state(false);
  let errorLista = $state('');
  let placa = $state('');
  let capacidadTon = $state<number | undefined>();
  let capacidadCabezas = $state<number | undefined>();
  let termoregistrador = $state(false);
  let registrandoUnidad = $state(false);
  let errorUnidad = $state('');
  let aviso = $state('');
  let seleccionUnidadPorFlete = $state<Record<string, string>>({});

  async function cargarOperaciones() {
    if ($session.status !== 'authenticated' || !$session.organizationId) {
      solicitudes = [];
      unidades = [];
      return;
    }
    cargandoLista = true;
    errorLista = '';
    try {
      const [fletes, flota] = await Promise.all([
        apiRequest<{ solicitudes: SolicitudFlete[] }>('/api/v1/logistica/solicitudes'),
        apiRequest<{ unidades: UnidadTransporte[] }>('/api/v1/logistica/unidades')
      ]);
      solicitudes = fletes.solicitudes;
      unidades = flota.unidades;
    } catch (error) {
      errorLista = error instanceof Error ? error.message : 'No se pudieron consultar las operaciones logísticas.';
    } finally {
      cargandoLista = false;
    }
  }

  async function cotizar(event: SubmitEvent) {
    event.preventDefault();
    errorCotizacion = '';
    cotizacion = null;
    solicitudCreada = null;
    if (!$session.organizationId) { errorCotizacion = 'Inicia sesión y selecciona una organización activa.'; return; }
    if (!origenId.trim() || !destinoId.trim() || origenId.trim() === destinoId.trim() ||
        !pesoToneladas || pesoToneladas <= 0) {
      errorCotizacion = 'Indica dos establecimientos distintos y un peso positivo.';
      return;
    }
    cargandoCotizacion = true;
    const input: CotizarFleteInput = {
      origen_establecimiento_id: origenId.trim(),
      destino_establecimiento_id: destinoId.trim(),
      peso_toneladas: pesoToneladas,
      tipo_unidad: tipoUnidad
    };
    try {
      cotizacion = await apiRequest<CotizacionFleteResult>('/api/v1/logistica/cotizar', {
        method: 'POST', body: JSON.stringify(input), expectedStatus: 200
      });
    } catch (error) {
      errorCotizacion = error instanceof Error ? error.message : 'No se pudo calcular la cotización.';
    } finally {
      cargandoCotizacion = false;
    }
  }

  async function crearSolicitud() {
    if (!cotizacion) return;
    errorSolicitud = '';
    creandoSolicitud = true;
    const input: CrearSolicitudFleteInput = {
      origen_establecimiento_id: origenId.trim(),
      destino_establecimiento_id: destinoId.trim(),
      peso_toneladas: pesoToneladas!,
      tipo_unidad: tipoUnidad,
      tipo_carga: tipoCarga
    };
    try {
      solicitudCreada = await apiRequest<SolicitudFlete>('/api/v1/logistica/solicitudes', {
        method: 'POST', body: JSON.stringify(input), expectedStatus: 201
      });
      await cargarOperaciones();
    } catch (error) {
      errorSolicitud = error instanceof Error ? error.message : 'No se pudo registrar la solicitud.';
    } finally {
      creandoSolicitud = false;
    }
  }

  async function registrarUnidad(event: SubmitEvent) {
    event.preventDefault();
    errorUnidad = '';
    if ($session.role !== 'TRANSPORTISTA') { errorUnidad = 'Cambia al contexto de una organización con rol TRANSPORTISTA.'; return; }
    if (!placa.trim() || !capacidadTon || capacidadTon <= 0) { errorUnidad = 'Ingresa placa y capacidad positivas.'; return; }
    registrandoUnidad = true;
    try {
      await apiRequest<UnidadTransporte>('/api/v1/logistica/unidades', {
        method: 'POST',
        body: JSON.stringify({
          placa: placa.trim().toUpperCase(),
          tipo_unidad: tipoUnidad,
          capacidad_toneladas: capacidadTon,
          capacidad_cabezas: capacidadCabezas,
          tiene_termoregistrador: termoregistrador
        }),
        expectedStatus: 201
      });
      placa = '';
      capacidadTon = undefined;
      capacidadCabezas = undefined;
      await cargarOperaciones();
      aviso = 'Unidad registrada en la API.';
    } catch (error) {
      errorUnidad = error instanceof Error ? error.message : 'No se pudo registrar la unidad.';
    } finally {
      registrandoUnidad = false;
    }
  }

  async function tomarFlete(flete: SolicitudFlete, unidadId: string) {
    aviso = '';
    errorLista = '';
    try {
      const input: TomarFleteInput = { unidad_id: unidadId };
      await apiRequest<SolicitudFlete>(`/api/v1/logistica/solicitudes/${encodeURIComponent(flete.id)}/tomar-flete`, {
        method: 'POST', body: JSON.stringify(input), expectedStatus: 200
      });
      aviso = 'El servidor confirmó la asignación del flete.';
      await cargarOperaciones();
    } catch (error) {
      errorLista = error instanceof Error ? error.message : 'No se pudo tomar el flete.';
    }
  }

  async function actualizarEstado(flete: SolicitudFlete, estado: ActualizarEstadoFleteInput['estado']) {
    aviso = '';
    errorLista = '';
    try {
      await apiRequest<SolicitudFlete>(`/api/v1/logistica/solicitudes/${encodeURIComponent(flete.id)}/estado`, {
        method: 'PATCH', body: JSON.stringify({ estado }), expectedStatus: 200
      });
      aviso = `El servidor registró el estado ${estado.replaceAll('_', ' ').toLowerCase()}.`;
      await cargarOperaciones();
    } catch (error) {
      errorLista = error instanceof Error ? error.message : 'No se pudo actualizar el viaje.';
    }
  }

  $effect(() => { $session.token; $session.organizationId; $session.role; void cargarOperaciones(); });
</script>

<svelte:head><title>Logística | Ganadito</title></svelte:head>

<section class="page">
  <p class="eyebrow">Transporte ganadero y de carga</p>
  <h1>Logística y fletes</h1>
  <p class="muted">La distancia y el costo se calculan en la API con los establecimientos registrados. El seguimiento disponible registra estados del viaje, no una ubicación GPS en vivo.</p>

  <section class="panel" aria-labelledby="quote-title">
    <h2 id="quote-title">Cotizar y solicitar transporte</h2>
    <p class="muted">Busca o registra los establecimientos en <a href="/distribuidores">Distribuidores</a> y copia sus identificadores. La API valida que tengas acceso a ambas ubicaciones.</p>
    {#if $session.status !== 'authenticated'}<p>Para cotizar, <a href="/acceso">inicia sesión</a>.</p>
    {:else if !$session.organizationId}<p>Selecciona una organización en <a href="/contexto">Contexto</a>.</p>
    {:else}
      <form class="form-grid md:grid-cols-2" onsubmit={cotizar}>
        <label>Identificador de establecimiento de origen<input bind:value={origenId} required maxlength="36" /></label>
        <label>Identificador de establecimiento de destino<input bind:value={destinoId} required maxlength="36" /></label>
        <label>Peso de carga (toneladas)<input type="number" min="0.01" step="0.01" bind:value={pesoToneladas} required /></label>
        <label>Tipo de unidad<select bind:value={tipoUnidad}>{#each tiposUnidad as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <label>Tipo de carga<select bind:value={tipoCarga}>{#each tiposCarga as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        {#if errorCotizacion}<p class="error md:col-span-2" role="alert">{errorCotizacion}</p>{/if}
        <button type="submit" disabled={cargandoCotizacion}>{cargandoCotizacion ? 'Calculando con PostGIS…' : 'Calcular cotización'}</button>
      </form>
    {/if}
    {#if cotizacion}
      <div class="notice" role="status">
        <strong>Cotización de la API</strong>
        <p>Distancia: {cotizacion.distancia_km.toFixed(2)} km · peso: {cotizacion.peso_toneladas.toFixed(2)} t.</p>
        <p>Flete bruto: S/ {cotizacion.costo_flete_bruto.toFixed(2)} · total estimado según tarifa configurada: <strong>S/ {cotizacion.total_flete.toFixed(2)}</strong>.</p>
        <p class="muted">El cálculo no constituye una aceptación de transporte ni un pago.</p>
        <label>Tipo de carga<select bind:value={tipoCarga}>{#each tiposCarga as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <button type="button" disabled={creandoSolicitud} onclick={() => void crearSolicitud()}>{creandoSolicitud ? 'Registrando…' : 'Crear solicitud real de flete'}</button>
        {#if errorSolicitud}<p class="error" role="alert">{errorSolicitud}</p>{/if}
      </div>
    {/if}
    {#if solicitudCreada}<div class="notice" role="status">Solicitud guardada: {solicitudCreada.id} · estado {solicitudCreada.estado}.</div>{/if}
  </section>

  <section class="panel" aria-labelledby="fleet-title">
    <h2 id="fleet-title">Flota transportista</h2>
    {#if $session.status !== 'authenticated'}<p>Inicia sesión con una organización transportista para registrar y operar unidades.</p>
    {:else if $session.role !== 'TRANSPORTISTA'}<p>Para administrar flota, selecciona en <a href="/contexto">Contexto</a> una organización donde tengas rol TRANSPORTISTA.</p>
    {:else}
      <form class="form-grid md:grid-cols-2" onsubmit={registrarUnidad}>
        <label>Placa<input bind:value={placa} maxlength="12" required /></label>
        <label>Tipo de unidad<select bind:value={tipoUnidad}>{#each tiposUnidad as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
        <label>Capacidad (toneladas)<input type="number" min="0.01" step="0.01" bind:value={capacidadTon} required /></label>
        <label>Capacidad (cabezas, opcional)<input type="number" min="1" step="1" bind:value={capacidadCabezas} /></label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={termoregistrador} /> Tiene termoregistrador</label>
        {#if errorUnidad}<p class="error md:col-span-2" role="alert">{errorUnidad}</p>{/if}
        <button type="submit" disabled={registrandoUnidad}>{registrandoUnidad ? 'Registrando…' : 'Registrar unidad'}</button>
      </form>
      {#if unidades.length}<ul>{#each unidades as unidad (unidad.id)}<li>{unidad.placa} · {tiposUnidad.find(t => t.value === unidad.tipo_unidad)?.label} · {unidad.capacidad_toneladas} t · {unidad.activa ? 'Activa' : 'Inactiva'}</li>{/each}</ul>{:else}<p class="muted">No hay unidades registradas para esta cuenta.</p>{/if}
    {/if}
  </section>

  <section class="panel" aria-labelledby="requests-title">
    <div class="context-card"><div><h2 id="requests-title">Solicitudes y viajes</h2><p class="muted">Estados guardados por el servidor.</p></div><button type="button" class="secondary" onclick={() => void cargarOperaciones()} disabled={cargandoLista}>{cargandoLista ? 'Actualizando…' : 'Actualizar'}</button></div>
    {#if $session.status !== 'authenticated'}<p>Inicia sesión para consultar fletes visibles para tu cuenta.</p>
    {:else if errorLista}<p class="error" role="alert">{errorLista}</p>
    {:else if cargandoLista && solicitudes.length === 0}<p role="status">Consultando la API…</p>
    {:else if solicitudes.length === 0}<p class="notice">No hay solicitudes visibles para tu usuario y contexto activo.</p>
    {:else}
      <div class="grid gap-4">
        {#each solicitudes as flete (flete.id)}
          <article class="panel">
            <div class="context-card"><h3>{flete.tipo_carga.replaceAll('_', ' ')}</h3><span class="badge">{flete.estado.replaceAll('_', ' ')}</span></div>
            <p>Flete {flete.id} · {flete.distancia_km.toFixed(0)} km aproximados · {flete.peso_toneladas.toFixed(2)} t · Total S/ {flete.costo_total_pagar?.toFixed(2) ?? flete.total_flete.toFixed(2)}.</p>
            <p class="muted">Origen {flete.origen_establecimiento_id} → destino {flete.destino_establecimiento_id}</p>
            {#if $session.role === 'TRANSPORTISTA' && flete.estado === 'PENDIENTE_ASIGNACION' && unidades.some(u => u.activa)}
              <div class="flex flex-wrap gap-2 items-end"><label>Unidad<select id={`unidad-${flete.id}`} bind:value={seleccionUnidadPorFlete[flete.id]}><option value="">Elige unidad</option>{#each unidades.filter(u => u.activa) as unidad (unidad.id)}<option value={unidad.id}>{unidad.placa}</option>{/each}</select></label><button type="button" onclick={() => { const unit = seleccionUnidadPorFlete[flete.id]; if (unit) void tomarFlete(flete, unit); }}>Tomar flete</button></div>
            {/if}
            {#if flete.estado === 'ASIGNADO' && flete.transportista_id === $session.user?.id}<button type="button" onclick={() => void actualizarEstado(flete, 'EN_TRANSITO')}>Iniciar viaje</button>{/if}
            {#if flete.estado === 'EN_TRANSITO' && flete.transportista_id === $session.user?.id}<button type="button" onclick={() => void actualizarEstado(flete, 'ENTREGADO')}>Confirmar entrega</button>{/if}
          </article>
        {/each}
      </div>
    {/if}
    {#if aviso}<p class="notice" role="status">{aviso}</p>{/if}
  </section>
</section>
