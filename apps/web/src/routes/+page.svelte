<script lang="ts">
  import { untrack } from 'svelte';
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import MapaInteractivo, { type MarcadorEstablecimiento } from '#lib/components/MapaInteractivo.svelte';
  import PizarraSpotTable, { type ItemCotizacionVisual } from '#lib/components/PizarraSpotTable.svelte';

  let latitud = $state(-12.046);
  let longitud = $state(-77.042);
  let radioKm = $state(50);
  let tipo = $state('');
  let producto = $state('');
  let categoria = $state('');
  let calidad = $state('');
  let ubigeo = $state('');
  let establecimientos = $state<MarcadorEstablecimiento[]>([]);
  let cotizaciones = $state<ItemCotizacionVisual[]>([]);
  let errorMapa = $state('');
  let errorSpot = $state('');
  let cargandoMapa = $state(false);
  let cargandoSpot = $state(false);
  let selectedId = $state<string | null>(null);
  let offsetMapa = $state(0);
  let offsetSpot = $state(0);
  const limite = 50;
  let mapaComponente: { centrarEn: (lat: number, lon: number, ubicacionAproximada: boolean) => void } | undefined;
  let peticionMapa: AbortController | undefined;
  let peticionSpot: AbortController | undefined;

  function esObjeto(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function esNumero(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
  function esEstablecimiento(value: unknown): value is MarcadorEstablecimiento {
    return esObjeto(value) && typeof value.id === 'string' && typeof value.nombre_comercial === 'string' &&
      typeof value.tipo === 'string' && esNumero(value.latitud) && value.latitud >= -90 && value.latitud <= 90 &&
      esNumero(value.longitud) && value.longitud >= -180 && value.longitud <= 180 &&
      typeof value.ubicacion_aproximada === 'boolean' &&
      (value.direccion_texto == null || typeof value.direccion_texto === 'string') &&
      (value.distancia_km == null || (esNumero(value.distancia_km) && value.distancia_km >= 0));
  }
  function esCotizacion(value: unknown): value is ItemCotizacionVisual {
    return esObjeto(value) && ['id', 'producto', 'categoria', 'calidad', 'moneda', 'unidad_medida', 'procedencia_ubigeo', 'vigencia_hasta'].every(key => typeof value[key] === 'string') &&
      esNumero(value.precio_unitario) && typeof value.verificado === 'boolean' && typeof value.ubicacion_aproximada === 'boolean' &&
      Number.isFinite(Date.parse(value.vigencia_hasta as string)) &&
      (value.establecimiento_id == null || typeof value.establecimiento_id === 'string') &&
      (value.establecimiento_nombre == null || typeof value.establecimiento_nombre === 'string') &&
      (value.latitud == null || (esNumero(value.latitud) && value.latitud >= -90 && value.latitud <= 90)) &&
      (value.longitud == null || (esNumero(value.longitud) && value.longitud >= -180 && value.longitud <= 180)) &&
      ((value.latitud == null) === (value.longitud == null));
  }

  async function consultarMapa() {
    peticionMapa?.abort();
    const controller = new AbortController();
    peticionMapa = controller;
    establecimientos = [];
    selectedId = null;
    errorMapa = '';
    cargandoMapa = true;
    try {
      const query = new URLSearchParams({ lat: String(latitud), lon: String(longitud), radio_km: String(radioKm), limit: String(limite), offset: String(offsetMapa) });
      if (tipo) query.set('tipo', tipo);
      const data = await apiRequest<unknown>(`/api/v1/establecimientos/cercanos?${query}`, { signal: controller.signal });
      if (!esObjeto(data) || !Array.isArray(data.establecimientos) || !data.establecimientos.every(esEstablecimiento) ||
          new Set(data.establecimientos.map(e => e.id)).size !== data.establecimientos.length) {
        throw new Error('La API no devolvió una lista de establecimientos válida.');
      }
      if (!controller.signal.aborted) establecimientos = data.establecimientos;
    } catch (error) {
      if (!controller.signal.aborted) errorMapa = error instanceof Error ? error.message : 'No se pudo consultar el mapa.';
    } finally {
      if (!controller.signal.aborted) cargandoMapa = false;
    }
  }

  async function consultarSpot() {
    peticionSpot?.abort();
    const controller = new AbortController();
    peticionSpot = controller;
    cotizaciones = [];
    errorSpot = '';
    cargandoSpot = true;
    try {
      const query = new URLSearchParams({ limit: String(limite), offset: String(offsetSpot) });
      if (producto) query.set('producto', producto);
      if (categoria.trim()) query.set('categoria', categoria.trim());
      if (calidad.trim()) query.set('calidad', calidad.trim());
      if (ubigeo.trim()) query.set('ubigeo', ubigeo.trim());
      const data = await apiRequest<unknown>(`/api/v1/cotizaciones/pizarra?${query}`, { signal: controller.signal });
      if (!esObjeto(data) || !Array.isArray(data.cotizaciones) || !data.cotizaciones.every(esCotizacion) ||
          new Set(data.cotizaciones.map(c => c.id)).size !== data.cotizaciones.length) {
        throw new Error('La API no devolvió una lista de cotizaciones válida.');
      }
      if (!controller.signal.aborted) cotizaciones = data.cotizaciones;
    } catch (error) {
      if (!controller.signal.aborted) errorSpot = error instanceof Error ? error.message : 'No se pudo consultar la pizarra.';
    } finally {
      if (!controller.signal.aborted) cargandoSpot = false;
    }
  }

  function consultar() {
    offsetMapa = 0;
    offsetSpot = 0;
    void consultarMapa();
    void consultarSpot();
  }

  $effect(() => {
    $session.organizationId;
    $session.token;
    untrack(consultar);
    return () => { peticionMapa?.abort(); peticionSpot?.abort(); };
  });

  function seleccionarCotizacion(cotizacion: ItemCotizacionVisual) {
    selectedId = cotizacion.establecimiento_id ?? null;
    if (Number.isFinite(cotizacion.latitud) && Number.isFinite(cotizacion.longitud)) {
      mapaComponente?.centrarEn(cotizacion.latitud!, cotizacion.longitud!, cotizacion.ubicacion_aproximada);
    }
  }
</script>

<svelte:head><title>Mapa y Pizarra Spot | Ganadito</title></svelte:head>

<div class="max-w-7xl mx-auto w-full px-4 py-8 space-y-6">
  <div>
    <p class="text-emerald-400 text-sm font-semibold">Consulta del mercado</p>
    <h1 class="text-3xl font-bold text-white mt-1">Mapa y Pizarra Spot</h1>
    <p class="text-slate-400 mt-2">Establecimientos y cotizaciones devueltos por la API. La búsqueda radial se aplica al mapa; los filtros comerciales se aplican a la pizarra.</p>
  </div>

  <form onsubmit={(event) => { event.preventDefault(); consultar(); }} class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
    <label class="text-sm text-slate-300">Latitud del centro<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" type="number" min="-90" max="90" step="any" required bind:value={latitud} /></label>
    <label class="text-sm text-slate-300">Longitud del centro<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" type="number" min="-180" max="180" step="any" required bind:value={longitud} /></label>
    <label class="text-sm text-slate-300">Radio del mapa (km)<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" type="number" min="1" max="2000" required bind:value={radioKm} /></label>
    <label class="text-sm text-slate-300">Tipo de establecimiento<select class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" bind:value={tipo}><option value="">Todos</option>{#each ['ESTABLO','CAMAL','CENTRO_BENEFICIO','FERIA_GANADERA','CENTRO_ACOPIO','ALMACEN_FRIGORIFICO','PUNTO_VENTA','OFICINA_ADMINISTRATIVA'] as valor}<option value={valor}>{valor.replaceAll('_', ' ')}</option>{/each}</select></label>
    <label class="text-sm text-slate-300">Producto Spot<select class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" bind:value={producto}><option value="">Todos</option>{#each ['GANADO_EN_PIE','CARNE_EN_CANAL','CUARTO_COMPENSADO','CORTE_PORTION_CONTROL','QUINTO_CUARTO'] as valor}<option value={valor}>{valor.replaceAll('_', ' ')}</option>{/each}</select></label>
    <label class="text-sm text-slate-300">Categoría Spot<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" placeholder="Ej. TORETE" bind:value={categoria} /></label>
    <label class="text-sm text-slate-300">Calidad Spot<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" placeholder="Ej. PRIMERA" bind:value={calidad} /></label>
    <label class="text-sm text-slate-300">Ubigeo Spot<input class="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 p-2 text-white" pattern={'[0-9]{6}'} placeholder="6 dígitos" bind:value={ubigeo} /></label>
    <button type="submit" class="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 font-semibold text-white sm:col-span-2 lg:col-span-4">Consultar mercado</button>
  </form>

  <div class="grid lg:grid-cols-2 gap-6 items-start">
    <section class="space-y-3" aria-label="Mapa de establecimientos" aria-busy={cargandoMapa}>
      <h2 class="text-xl font-semibold text-white">Establecimientos cercanos</h2>
      {#if cargandoMapa}<p role="status" class="text-slate-400">Consultando establecimientos…</p>
      {:else if errorMapa}<p role="alert" class="rounded-xl bg-rose-950/40 border border-rose-800 p-4 text-rose-200">{errorMapa}</p>
      {:else if establecimientos.length === 0}<p role="status" class="rounded-xl bg-slate-900 p-4 text-slate-400">No se encontraron establecimientos para esta consulta.</p>{/if}
      <div class="h-[440px]"><MapaInteractivo bind:this={mapaComponente} {establecimientos} {selectedId} centroDefecto={[latitud, longitud]} onSelectEstablecimiento={(establecimiento) => { selectedId = establecimiento.id; }} /></div>
      {#if establecimientos.length > 0}<ul class="divide-y divide-slate-800 rounded-xl border border-slate-800">{#each establecimientos as establecimiento (establecimiento.id)}<li><button type="button" class="w-full p-3 text-left hover:bg-slate-800 rounded-xl" onclick={() => { selectedId = establecimiento.id; mapaComponente?.centrarEn(establecimiento.latitud, establecimiento.longitud, establecimiento.ubicacion_aproximada); }}><span class="font-medium text-white">{establecimiento.nombre_comercial}</span><span class="block text-xs text-slate-400">{establecimiento.tipo} · {establecimiento.ubicacion_aproximada ? 'Ubicación aproximada' : 'Ubicación exacta'}</span><span class="block text-xs text-slate-400">{establecimiento.distancia_km == null ? 'Distancia no informada' : (establecimiento.ubicacion_aproximada ? 'Distancia aproximada: ' : 'Distancia: ') + establecimiento.distancia_km.toFixed(1) + ' km'}</span></button></li>{/each}</ul>{/if}
      <div class="flex items-center justify-between text-sm"><button class="text-emerald-400 disabled:opacity-40" type="button" disabled={offsetMapa === 0 || cargandoMapa} onclick={() => { offsetMapa = Math.max(0, offsetMapa - limite); void consultarMapa(); }}>Mapa anterior</button><span class="text-slate-500">Página {Math.floor(offsetMapa / limite) + 1}</span><button class="text-emerald-400 disabled:opacity-40" type="button" disabled={establecimientos.length < limite || cargandoMapa} onclick={() => { offsetMapa += limite; void consultarMapa(); }}>Mapa siguiente</button></div>
    </section>
    <section class="space-y-3" aria-label="Pizarra Spot" aria-busy={cargandoSpot}>
      <h2 class="text-xl font-semibold text-white">Cotizaciones vigentes</h2>
      {#if errorSpot}<p role="alert" class="rounded-xl bg-rose-950/40 border border-rose-800 p-4 text-rose-200">{errorSpot}</p>{/if}
      <PizarraSpotTable {cotizaciones} isLoading={cargandoSpot} {selectedId} onSelectCotizacion={seleccionarCotizacion} />
      <div class="flex items-center justify-between text-sm"><button class="text-emerald-400 disabled:opacity-40" type="button" disabled={offsetSpot === 0 || cargandoSpot} onclick={() => { offsetSpot = Math.max(0, offsetSpot - limite); void consultarSpot(); }}>Precios anteriores</button><span class="text-slate-500">Página {Math.floor(offsetSpot / limite) + 1}</span><button class="text-emerald-400 disabled:opacity-40" type="button" disabled={cotizaciones.length < limite || cargandoSpot} onclick={() => { offsetSpot += limite; void consultarSpot(); }}>Precios siguientes</button></div>
    </section>
  </div>
</div>
