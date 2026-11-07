<script lang="ts">
  import MapaInteractivo from '#lib/components/MapaInteractivo.svelte';

  type Departamento = { nombre: string; capital: string; centro: [number, number] };

  const departamentos: Departamento[] = [
    { nombre: 'Amazonas', capital: 'Chachapoyas', centro: [-6.23, -77.87] },
    { nombre: 'Áncash', capital: 'Huaraz', centro: [-9.53, -77.53] },
    { nombre: 'Apurímac', capital: 'Abancay', centro: [-13.64, -72.88] },
    { nombre: 'Arequipa', capital: 'Arequipa', centro: [-16.40, -71.54] },
    { nombre: 'Ayacucho', capital: 'Ayacucho', centro: [-13.16, -74.22] },
    { nombre: 'Cajamarca', capital: 'Cajamarca', centro: [-7.16, -78.51] },
    { nombre: 'Callao', capital: 'Callao', centro: [-12.06, -77.14] },
    { nombre: 'Cusco', capital: 'Cusco', centro: [-13.52, -71.97] },
    { nombre: 'Huancavelica', capital: 'Huancavelica', centro: [-12.79, -74.97] },
    { nombre: 'Huánuco', capital: 'Huánuco', centro: [-9.93, -76.24] },
    { nombre: 'Ica', capital: 'Ica', centro: [-14.07, -75.73] },
    { nombre: 'Junín', capital: 'Huancayo', centro: [-12.07, -75.21] },
    { nombre: 'La Libertad', capital: 'Trujillo', centro: [-8.11, -79.03] },
    { nombre: 'Lambayeque', capital: 'Chiclayo', centro: [-6.77, -79.84] },
    { nombre: 'Lima', capital: 'Lima', centro: [-12.05, -77.04] },
    { nombre: 'Loreto', capital: 'Iquitos', centro: [-3.75, -73.25] },
    { nombre: 'Madre de Dios', capital: 'Puerto Maldonado', centro: [-12.59, -69.19] },
    { nombre: 'Moquegua', capital: 'Moquegua', centro: [-17.20, -70.93] },
    { nombre: 'Pasco', capital: 'Cerro de Pasco', centro: [-10.68, -76.26] },
    { nombre: 'Piura', capital: 'Piura', centro: [-5.19, -80.63] },
    { nombre: 'Puno', capital: 'Puno', centro: [-15.84, -70.02] },
    { nombre: 'San Martín', capital: 'Moyobamba', centro: [-6.03, -76.97] },
    { nombre: 'Tacna', capital: 'Tacna', centro: [-18.01, -70.25] },
    { nombre: 'Tumbes', capital: 'Tumbes', centro: [-3.57, -80.45] },
    { nombre: 'Ucayali', capital: 'Pucallpa', centro: [-8.38, -74.53] }
  ];

  const categorias = [
    { id: 'TODOS', nombre: 'Todos los productos', ayuda: 'Muestra las categorías de distribución disponibles.' },
    { id: 'GANADO_EN_PIE', nombre: 'Ganado en pie', ayuda: 'Lotes de ganado disponibles para compra o distribución.' },
    { id: 'CARNE_EN_CANAL', nombre: 'Carne en canal', ayuda: 'Oferta de canales y productos para procesamiento.' },
    { id: 'CORTES', nombre: 'Cortes cárnicos', ayuda: 'Cortes y productos cárnicos para comercios y HORECA.' },
    { id: 'INSUMOS', nombre: 'Insumos ganaderos', ayuda: 'Alimentos y suministros para la cadena ganadera.' },
    { id: 'EQUIPOS', nombre: 'Equipos ganaderos', ayuda: 'Equipos relacionados con producción, faena y comercialización.' }
  ];

  let departamentoSeleccionado = $state('');
  let categoriaSeleccionada = $state('TODOS');

  const departamentoActual = $derived(departamentos.find((d) => d.nombre === departamentoSeleccionado));
  const centroMapa = $derived<[number, number]>(departamentoActual?.centro ?? [-9.19, -75.02]);
  const zoomMapa = $derived(departamentoActual ? 7 : 4.5);
  const categoriaActual = $derived(categorias.find((c) => c.id === categoriaSeleccionada) ?? categorias[0]!);
</script>

<svelte:head>
  <title>Distribuidores por departamento | Ganadito</title>
  <meta name="description" content="Explora la distribución ganadera por producto y departamento en el Perú." />
</svelte:head>

<div class="min-h-screen bg-[#f6f4ee] text-slate-800">
  <section class="bg-gradient-to-r from-emerald-950 via-emerald-900 to-green-800 px-4 py-10 text-white sm:px-8">
    <div class="mx-auto max-w-7xl">
      <p class="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Mercado y distribución ganadera</p>
      <h1 class="mt-2 text-3xl font-extrabold sm:text-4xl">Encuentra distribuidores en el Perú</h1>
      <p class="mt-3 max-w-3xl text-sm leading-6 text-emerald-50 sm:text-base">
        Explora la o