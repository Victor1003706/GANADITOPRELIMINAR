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
        Explora la oferta por tipo de producto y departamento. Selecciona una categoría o una región para preparar tu búsqueda.
        Las ubicaciones puntuales aparecerán cuando se incorporen datos verificados de distribuidores.
      </p>
    </div>
  </section>

  <section aria-labelledby="categorias-title" class="border-b border-emerald-100 bg-white px-4 py-4 shadow-sm sm:px-8">
    <div class="mx-auto max-w-7xl">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="categorias-title" class="m-0 text-base font-bold text-slate-800">Explora por producto</h2>
        <p class="m-0 text-xs text-slate-500">Elige una categoría para acotar el catálogo.</p>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categorías de producto">
        {#each categorias as categoria (categoria.id)}
          <button
            type="button"
            aria-pressed={categoriaSeleccionada === categoria.id}
            class="shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition {categoriaSeleccionada === categoria.id ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-emerald-100 bg-emerald-50 text-emerald-900 hover:border-emerald-400'}"
            onclick={() => (categoriaSeleccionada = categoria.id)}
          >
            {categoria.nombre}
          </button>
        {/each}
      </div>
      <p class="mb-0 mt-2 text-xs text-slate-500">{categoriaActual.ayuda}</p>
    </div>
  </section>

  <div class="mx-auto grid max-w-7xl gap-5 px-4 py-6 lg:grid-cols-[290px_minmax(0,1fr)] sm:px-8">
    <aside class="space-y-4" aria-label="Filtros del directorio">
      <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" aria-labelledby="filtro-producto">
        <h2 id="filtro-producto" class="m-0 text-lg font-bold">Productos</h2>
        <p class="mt-2 text-sm leading-5 text-slate-500">Selecciona qué necesitas distribuir. Los resultados se mostrarán cuando haya publicaciones disponibles.</p>
        <ul class="mt-4 space-y-1">
          {#each categorias as categoria (categoria.id)}
            <li>
              <button
                type="button"
                aria-pressed={categoriaSeleccionada === categoria.id}
                class="w-full rounded-lg px-3 py-2 text-left text-sm transition {categoriaSeleccionada === categoria.id ? 'bg-emerald-100 font-semibold text-emerald-900' : 'text-slate-700 hover:bg-stone-100'}"
                onclick={() => (categoriaSeleccionada = categoria.id)}
              >
                {categoria.nombre}
              </button>
            </li>
          {/each}
        </ul>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" aria-labelledby="filtro-ubicacion">
        <h2 id="filtro-ubicacion" class="m-0 text-lg font-bold">Ubicación</h2>
        <p class="mt-2 text-sm leading-5 text-slate-500">Elige un departamento para enfocar el mapa. Por ahora se muestra una vista regional, sin pines de distribuidores.</p>
        <label class="mt-4 block text-sm font-semibold text-slate-700" for="departamento">Departamento</label>
        <select id="departamento" class="mt-2 border-stone-300 bg-white text-slate-800" bind:value={departamentoSeleccionado}>
          <option value="">Todo el Perú</option>
          {#each departamentos as departamento (departamento.nombre)}
            <option value={departamento.nombre}>{departamento.nombre}</option>
          {/each}
        </select>
        {#if departamentoActual}
          <p class="mt-2 text-xs text-slate-500">Vista referencial del área de {departamentoActual.nombre}, alrededor de {departamentoActual.capital}; no representa la dirección de un distribuidor.</p>
        {/if}
      </section>

      <section class="rounded-2xl border border-emerald-100 bg-emerald-50 p-5" aria-labelledby="instrucciones-filtros">
        <h2 id="instrucciones-filtros" class="m-0 text-base font-bold text-emerald-950">Cómo usar los filtros</h2>
        <ol class="mb-0 mt-3 list-inside list-decimal space-y-2 text-sm leading-5 text-emerald-950">
          <li>Elige el producto que buscas.</li>
          <li>Selecciona el departamento de destino.</li>
          <li>Revisa las publicaciones cuando haya distribuidores registrados.</li>
        </ol>
      </section>
    </aside>

    <main class="min-w-0 space-y-5" aria-label="Mapa y resultados de distribuidores">
      <section class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" aria-labelledby="mapa-title">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="mapa-title" class="m-0 text-xl font-bold">Cobertura por departamento</h2>
            <p class="mb-0 mt-1 text-sm text-slate-500">{departamentoActual ? `Vista referencial: ${departamentoActual.nombre}` : 'Vista general del Perú'}</p>
          </div>
          <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Sin ubicaciones puntuales</span>
        </div>
        <div class="h-[360px] bg-stone-100 sm:h-[440px]">
          <MapaInteractivo establecimientos={[]} centroDefecto={centroMapa} zoomDefecto={zoomMapa} />
        </div>
        <div class="border-t border-stone-100 bg-stone-50 px-5 py-3 text-xs leading-5 text-slate-600 sm:px-6">
          Este mapa orienta la búsqueda por departamento. No señala la ubicación de distribuidores; agregaremos puntos únicamente cuando existan datos de ubicación validados y autorizados.
        </div>
      </section>

      <section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="resultados-title">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="m-0 text-xs font-bold uppercase tracking-wide text-emerald-700">Directorio comercial</p>
            <h2 id="resultados-title" class="mb-0 mt-1 text-xl font-bold">Distribuidores disponibles</h2>
            <p class="mb-0 mt-2 text-sm text-slate-500">Filtro: {categoriaActual.nombre} · {departamentoSeleccionado || 'Todo el Perú'}</p>
          </div>
          <span class="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-slate-600">Catálogo en preparación</span>
        </div>

        <div class="mt-5 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-5 py-8 text-center">
          <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-2xl" aria-hidden="true">⌖</div>
          <h3 class="mb-0 mt-3 text-lg font-bold">Aún no hay distribuidores publicados</h3>
          <p class="mx-auto mb-0 mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Cuando se incorporen, podrás comparar su oferta por producto y departamento. No mostramos datos de ejemplo ni contactos fuera de la plataforma.
          </p>
        </div>
      </section>

      <section class="grid gap-4 sm:grid-cols-2" aria-label="Instrucciones para compradores y distribuidores">
        <article class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 class="m-0 text-base font-bold">Para quien busca productos</h2>
          <p class="mb-0 mt-2 text-sm leading-6 text-slate-600">Filtra por categoría y departamento. Al publicarse una oferta, aquí verás su descripción, condiciones de entrega y disponibilidad para iniciar la coordinación dentro de Ganadito.</p>
        </article>
        <article class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 class="m-0 text-base font-bold">Para distribuidores</h2>
          <p class="mb-0 mt-2 text-sm leading-6 text-slate-600">Prepara el tipo de producto, presentación, volumen y departamentos de cobertura. La ubicación exacta no se publicará hasta que se cargue y valide con autorización.</p>
        </article>
      </section>
    </main>
  </div>
</div>
