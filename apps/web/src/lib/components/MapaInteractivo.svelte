<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import type * as Leaflet from 'leaflet';

  export interface MarcadorEstablecimiento {
    id: string;
    nombre_comercial: string;
    tipo: string;
    latitud: number;
    longitud: number;
    direccion_texto?: string | null;
    distancia_km?: number | null;
    ubicacion_aproximada: boolean;
  }
  interface Props {
    establecimientos?: MarcadorEstablecimiento[];
    selectedId?: string | null;
    centroDefecto?: [number, number];
    zoomDefecto?: number;
    onSelectEstablecimiento?: (establecimiento: MarcadorEstablecimiento) => void;
  }
  let { establecimientos = [], selectedId = null, centroDefecto = [-12.046, -77.042], zoomDefecto = 8, onSelectEstablecimiento }: Props = $props();
  let mapContainer: HTMLDivElement;
  let mapa: Leaflet.Map | undefined;
  let capa: Leaflet.LayerGroup | undefined;
  let leaflet: typeof Leaflet | undefined;
  let cargando = $state(true);
  let errorMapa = $state('');
  let destruido = false;

  function coordenadasValidas(lat: number, lon: number) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  function actualizarMarcadores() {
    if (!mapa || !capa || !leaflet) return;
    mapa.closePopup();
    capa.clearLayers();
    const validos = establecimientos.filter((e) => coordenadasValidas(e.latitud, e.longitud));
    for (const establecimiento of validos) {
      const seleccionado = selectedId === establecimiento.id;
      // The public point belongs to a 0.01° privacy grid. Show a geographic area,
      // never a precise center pin; its size remains geographic when zoom changes.
      const marcador = establecimiento.ubicacion_aproximada
        ? leaflet.circle([establecimiento.latitud, establecimiento.longitud], {
            radius: 800, className: 'ubicacion-aproximada', color: seleccionado ? '#fcd34d' : '#f59e0b',
            weight: seleccionado ? 3 : 2, dashArray: '5 5', fillColor: '#f59e0b', fillOpacity: 0.15
          })
        : leaflet.circleMarker([establecimiento.latitud, establecimiento.longitud], {
            radius: seleccionado ? 12 : 8, className: 'ubicacion-exacta', color: '#ffffff',
            weight: 2, fillColor: '#059669', fillOpacity: 0.9
          });
      // Leaflet accepts DOM nodes. textContent keeps API-controlled names and addresses inert.
      const contenido = document.createElement('div');
      const nombre = document.createElement('strong');
      nombre.textContent = establecimiento.nombre_comercial;
      contenido.append(nombre);
      for (const texto of [establecimiento.tipo,
        establecimiento.ubicacion_aproximada ? 'Ubicación aproximada. El área es orientativa y no indica el punto exacto.' : 'Ubicación exacta',
        establecimiento.ubicacion_aproximada ? null : establecimiento.direccion_texto]) {
        if (!texto) continue;
        const linea = document.createElement('div');
        linea.textContent = texto;
        contenido.append(linea);
      }
      if (Number.isFinite(establecimiento.distancia_km)) {
        const distancia = document.createElement('div');
        distancia.textContent = (establecimiento.ubicacion_aproximada ? 'Distancia aproximada: ' : 'Distancia: ') + Number(establecimiento.distancia_km).toFixed(1) + ' km';
        contenido.append(distancia);
      }
      marcador.bindPopup(contenido).on('click', () => onSelectEstablecimiento?.(establecimiento));
      capa.addLayer(marcador);
      if (seleccionado) marcador.openPopup();
    }
    if (validos.length > 0 && !selectedId) {
      mapa.fitBounds(leaflet.latLngBounds(validos.map((e) => [e.latitud, e.longitud])), {
        padding: [35, 35], maxZoom: validos.some(e => e.ubicacion_aproximada) ? 11 : 14, animate: false
      });
    } else if (validos.length === 0 && coordenadasValidas(...centroDefecto)) {
      mapa.setView(centroDefecto, zoomDefecto);
    }
  }
  $effect(() 