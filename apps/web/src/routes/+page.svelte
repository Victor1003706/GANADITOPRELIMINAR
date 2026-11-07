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
      if (!controller.signal.aborted) establecimientos = data.estab