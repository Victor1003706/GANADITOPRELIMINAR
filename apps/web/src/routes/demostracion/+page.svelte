<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type Department = { name: string; capital: string; lat: number; lon: number; x: number; y: number; short: string };
  type Lot = { id: string; title: string; species: string; department: string; quantity: number; price: number; detail: string; source: 'muestra' | 'publicado' };
  type Auction = { id: string; title: string; department: string; animals: number; bid: number; endsIn: number };
  type Purchase = { id: string; lotTitle: string; department: string; price: number; stage: number; createdAt: string };

  const departments: Department[] = [
    { name: 'Amazonas', capital: 'Chachapoyas', lat: -6.23, lon: -77.87, x: 35, y: 29, short: 'AM' },
    { name: 'Áncash', capital: 'Huaraz', lat: -9.53, lon: -77.53, x: 32, y: 47, short: 'AN' },
    { name: 'Apurímac', capital: 'Abancay', lat: -13.64, lon: -72.88, x: 57, y: 68, short: 'AP' },
    { name: 'Arequipa', capital: 'Arequipa', lat: -16.4, lon: -71.54, x: 62, y: 82, short: 'AR' },
    { name: 'Ayacucho', capital: 'Ayacucho', lat: -13.16, lon: -74.22, x: 47, y: 66, short: 'AY' },
    { name: 'Cajamarca', capital: 'Cajamarca', lat: -7.16, lon: -78.51, x: 28, y: 34, short: 'CA' },
    { name: 'Callao', capital: 'Callao', lat: -12.06, lon: -77.14, x: 30, y: 59, short: 'CL' },
    { name: 'Cusco', capital: 'Cusco', lat: -13.52, lon: -71.97, x: 63, y: 68, short: 'CU' },
    { name: 'Huancavelica', capital: 'Huancavelica', lat: -12.79, lon: -74.97, x: 43, y: 64, short: 'HV' },
    { name: 'Huánuco', capital: 'Huánuco', lat: -9.93, lon: -76.24, x: 37, y: 50, short: 'HU' },
    { name: 'Ica', capital: 'Ica', lat: -14.07, lon: -75.73, x: 35, y: 72, short: 'IC' },
    { name: 'Junín', capital: 'Huancayo', lat: -12.07, lon: -75.21, x: 42, y: 60, short: 'JU' },
    { name: 'La Libertad', capital: 'Trujillo', lat: -8.11, lon: -79.03, x: 24, y: 40, short: 'LL' },
    { name: 'Lambayeque', capital: 'Chiclayo', lat: -6.77, lon: -79.84, x: 21, y: 32, short: 'LA' },
    { name: 'Lima', capital: 'Lima', lat: -12.05, lon: -77.04, x: 31, y: 59, short: 'LI' },
    { name: 'Loreto', capital: 'Iquitos', lat: -3.75, lon: -73.25, x: 63, y: 17, short: 'LO' },
    { name: 'Madre de Dios', capital: 'Puerto Maldonado', lat: -12.59, lon: -69.19, x: 77, y: 62, short: 'MD' },
    { name: 'Moquegua', capital: 'Moquegua', lat: -17.2, lon: -70.93, x: 68, y: 86, short: 'MO' },
    { name: 'Pasco', capital: 'Cerro de Pasco', lat: -10.68, lon: -76.26, x: 37, y: 53, short: 'PA' },
    { name: 'Piura', capital: 'Piura', lat: -5.19, lon: -80.63, x: 16, y: 25, short: 'PI' },
    { name: 'Puno', capital: 'Puno', lat: -15.84, lon: -70.02, x: 72, y: 78, short: 'PU' },
    { name: 'San Martín', capital: 'Moyobamba', lat: -6.03, lon: -76.97, x: 40, y: 29, short: 'SM' },
    { name: 'Tacna', capital: 'Tacna', lat: -18.01, lon: -70.25, x: 72, y: 89, short: 'TA' },
    { name: 'Tumbes', capital: 'Tumbes', lat: -3.57, lon: -80.45, x: 16, y: 17, short: 'TU' },
    { name: 'Ucayali', capital: 'Pucallpa', lat: -8.38, lon: -74.53, x: 49, y: 40, short: 'UC' }
  ];

  const sections = [
    { id: 'inicio', label: 'Inicio', help: 'Un recorrido claro por el mercado, la subasta y el proceso de compra.' },
    { id: 'ganado', label: 'Ganado', help: 'Revisa lotes de ejemplo y explora una compra de principio a fin.' },
    { id: 'subastas', label: 'Subastas', help: 'Ensaya una puja y observa cómo cambia la oferta en la pantalla.' },
    { id: 'ubicacion', label: 'Ubicación', help: 'Explora los departamentos y calcula una distancia referencial.' },
    { id: 'publicar', label: 'Publicar ganado', help: 'Completa una publicación de ejemplo y agrega fotos de vista previa.' },
    { id: 'compras', label: 'Mis compras', help: 'Sigue los hitos ilustrativos de una compra de prueba.' }
  ] as const;

  const initialLots: Lot[] = [
    { id: 'L-101', title: 'Novillos para engorde', species: 'Bovinos', department: 'Cajamarca', quantity: 12, price: 18500, detail: 'Lote parejo · crianza local · ficha de muestra', source: 'muestra' },
    { id: 'L-102', title: 'Vacunos de doble propósito', species: 'Bovinos', department: 'Junín', quantity: 8, price: 14400, detail: 'Información y fotografías ilustrativas', source: 'muestra' },
    { id: 'L-103', title: 'Vacas para reproducción', species: 'Bovinos', department: 'San Martín', quantity: 10, price: 21000, detail: 'Lote de ejemplo · disponibilidad no confirmada', source: 'muestra' },
    { id: 'L-104', title: 'Ovinos para crianza', species: 'Ovinos', department: 'Ayacucho', quantity: 20, price: 5900, detail: 'Ficha de muestra · precio referencial', source: 'muestra' },
    { id: 'L-105', title: 'Lote caprino', species: 'Caprinos', department: 'Piura', quantity: 15, price: 6750, detail: 'Ejemplo para explorar el catálogo', source: 'muestra' }
  ];
  const initialAuctions: Auction[] = [
    { id: 'S-01', title: 'Subasta de novillos', department: 'Cajamarca', animals: 10, bid: 16200, endsIn: 648 },
    { id: 'S-02', title: 'Subasta de ovinos', department: 'Ayacucho', animals: 20, bid: 5900, endsIn: 1034 }
  ];
  const trackingSteps = ['Solicitud de compra', 'Preparación del traslado', 'En ruta', 'Entrega'];
  const storageKey = 'ganadito-presentation-demo-v2';
  const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 });

  let active = $state('inicio');
  let speciesFilter = $state('Todos');
  let departmentFilter = $state('');
  let lots = $state<Lot[]>([...initialLots]);
  let auctions = $state<Auction[]>(initialAuctions.map((item) => ({ ...item })));
  let purchases = $state<Purchase[]>([]);
  let selectedDepartment = $state('Cajamarca');
  let origin = $state<[number, number] | null>(null);
  let notice = $state('');
  let error = $state('');
  let fileError = $state('');
  let photoUrls = $state<string[]>([]);
  let previewUrlsToRevoke: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let formTitle = $state('');
  let formSpecies = $state('Bovinos');
  let formDepartment = $state('');
  let formQuantity = $state<number | undefined>();
  let formPrice = $state<number | undefined>();
  let formDescription = $state('');

  const currentSection = $derived(sections.find((item) => item.id === active) ?? sections[0]);
  const selectedDepartmentInfo = $derived(departments.find((item) => item.name === selectedDepartment) ?? departments[0]!);
  const visibleLots = $derived(lots.filter((item) =>
    (speciesFilter === 'Todos' || item.species === speciesFilter) &&
    (!departmentFilter || item.department === departmentFilter)
  ));
  const distanceKm = $derived(origin
    ? haversine(origin, [selectedDepartmentInfo.lat, selectedDepartmentInfo.lon])
    : null);

  onMount(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { lots?: Lot[]; auctions?: Auction[]; purchases?: Purchase[] };
        if (Array.isArray(saved.lots)) {
          lots = [...initialLots, ...saved.lots.filter((item) => validSavedLot(item))];
        }
        if (Array.isArray(saved.auctions)) {
          auctions = initialAuctions.map((base) => {
            const savedItem = saved.auctions?.find((item) => item.id === base.id);
            return savedItem && Number.isFinite(savedItem.bid) && savedItem.bid >= base.bid
              ? { ...base, bid: savedItem.bid }
              : { ...base };
          });
        }
        if (Array.isArray(saved.purchases)) purchases = saved.purchases.filter(validSavedPurchase);
      }
    } catch {
      notice = 'No se pudieron recuperar los datos guardados de esta demostración.';
    }

    timer = setInterval(() => {
      auctions = auctions.map((item) => ({ ...item, endsIn: Math.max(0, item.endsIn - 1) }));
    }, 1000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    previewUrlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
  });

  function validSavedLot(value: unknown): value is Lot {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<Lot>;
    return typeof item.id === 'string' && item.id.startsWith('D-') &&
      typeof item.title === 'string' && item.title.length <= 90 &&
      ['Bovinos', 'Ovinos', 'Caprinos'].includes(String(item.species)) &&
      departments.some((dept) => dept.name === item.department) &&
      Number.isInteger(item.quantity) && Number(item.quantity) > 0 &&
      Number.isFinite(item.price) && Number(item.price) > 0 &&
      typeof item.detail === 'string';
  }

  function validSavedPurchase(value: unknown): value is Purchase {
    if (!value || typeof value !== 'object') return false;
    const item = value as Partial<Purchase>;
    return typeof item.id === 'string' && item.id.startsWith('D-') &&
      typeof item.lotTitle === 'string' && item.lotTitle.length <= 90 &&
      departments.some((dept) => dept.name === item.department) &&
      Number.isFinite(item.price) && Number(item.price) > 0 &&
      Number.isInteger(item.stage) && Number(item.stage) >= 0 && Number(item.stage) < trackingSteps.length &&
      typeof item.createdAt === 'string';
  }

  function persistDemo() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        lots: lots.filter((item) => item.source === 'publicado'),
        auctions: auctions.map(({ id, bid }) => ({ id, bid })),
        purchases
      }));
    } catch {
      notice = 'El navegador no pudo guardar esta sesión; la demostración sigue disponible hasta que cierres esta pestaña.';
    }
  }

  function go(id: string) {
    active = id;
    notice = '';
    error = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function haversine(from: [number, number], to: [number, number]) {
    const radians = Math.PI / 180;
    const dLat = (to[0] - from[0]) * radians;
    const dLon = (to[1] - from[1]) * radians;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(from[0] * radians) * Math.cos(to[0] * radians) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      error = 'Este navegador no permite calcular la distancia desde el dispositivo.';
      return;
    }
    error = '';
    notice = 'Solicitando ubicación para calcular una distancia aproximada.';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        origin = [position.coords.latitude, position.coords.longitude];
        notice = 'Ubicación utilizada solo en este dispositivo; no se guarda ni se envía.';
      },
      () => {
        notice = '';
        error = 'No se pudo obtener la ubicación. Aún puedes explorar los departamentos y lotes de ejemplo.';
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  }

  function createPurchase(item: Lot) {
    const purchase: Purchase = {
      id: 'D-' + Date.now().toString().slice(-7),
      lotTitle: item.title,
      department: item.department,
      price: item.price,
      stage: 0,
      createdAt: new Date().toLocaleString('es-PE')
    };
    purchases = [purchase, ...purchases];
    persistDemo();
    notice = 'Compra de muestra creada en este navegador. No se generó una orden ni se procesó un pago.';
    go('compras');
  }

  function advancePurchase(id: string) {
    purchases = purchases.map((purchase) => purchase.id === id
      ? { ...purchase, stage: Math.min(purchase.stage + 1, trackingSteps.length - 1) }
      : purchase);
    persistDemo();
    notice = 'Avanzaste un hito de traslado de ejemplo; no se envió un evento a un transportista.';
  }

  function placeBid(id: string) {
    const auction = auctions.find((item) => item.id === id);
    if (!auction || auction.endsIn <= 0) return;
    auctions = auctions.map((item) => item.id === id ? { ...item, bid: item.bid + 100 } : item);
    persistDemo();
    notice = 'Puja ilustrativa registrada solo en esta pantalla. No es una oferta real.';
  }

  function selectDepartment(name: string) {
    selectedDepartment = name;
    const hasLot = lots.some((item) => item.department === name);
    if (!hasLot) {
      notice = 'No hay lotes de muestra en este departamento todavía; puedes explorar los demás.';
    } else {
      notice = '';
    }
  }

  function selectFromMap(name: string) {
    selectDepartment(name);
  }

  function publishLot(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (!formTitle.trim() || !formDepartment || !formQuantity || !formPrice || formQuantity <= 0 || formPrice <= 0) {
      error = 'Ingresa el título, departamento, cantidad y precio para crear la vista de ejemplo.';
      return;
    }
    const lot: Lot = {
      id: 'D-' + Date.now().toString().slice(-8),
      title: formTitle.trim(),
      species: formSpecies,
      department: formDepartment,
      quantity: Math.floor(formQuantity),
      price: formPrice,
      detail: formDescription.trim() || 'Publicación creada durante esta demostración.',
      source: 'publicado'
    };
    lots = [lot, ...lots];
    persistDemo();
    formTitle = '';
    formDepartment = '';
    formQuantity = undefined;
    formPrice = undefined;
    formDescription = '';
    photoUrls = [];
    notice = 'La publicación de ejemplo aparece en el catálogo de este navegador.';
    go('ganado');
  }

  function handlePhotos(event: Event) {
    fileError = '';
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 5) {
      fileError = 'Puedes previsualizar hasta cinco fotografías.';
      input.value = '';
      return;
    }
    if (files.some((file) => !file.type.startsWith('image/') || file.size > 4 * 1024 * 1024)) {
      fileError = 'Elige imágenes de hasta 4 MB cada una.';
      input.value = '';
      return;
    }
    previewUrlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    photoUrls = files.map((file) => URL.createObjectURL(file));
    previewUrlsToRevoke = [...photoUrls];
  }

  function resetDemo() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      error = 'No se pudieron borrar los datos locales.';
      return;
    }
    lots = [...initialLots];
    auctions = initialAuctions.map((item) => ({ ...item }));
    purchases = [];
    selectedDepartment = 'Cajamarca';
    speciesFilter = 'Todos';
    departmentFilter = '';
    origin = null;
    notice = 'La demostración volvió a sus datos iniciales.';
    error = '';
  }
</script>
<svelte:head>
  <title>Demostración comercial | Ganadito</title>
  <meta name="description" content="Recorrido local de presentación por el marketplace ganadero Ganadito." />
</svelte:head>

<div class="demo-page">
  <div class="demo-shell">
    <div class="demo-topbar">
      <a class="demo-brand" href="/" aria-label="Ganadito, inicio de la presentación"><span class="demo-brand-mark">G</span><span>GANADITO<small>Comercio ganadero</small></span></a>
      <span class="demo-mode-label"><span aria-hidden="true"></span> Presentación del MVP</span>
    </div>
    <aside class="demo-disclaimer" role="note">
      <span class="disclaimer-mark" aria-hidden="true">i</span>
      <p><strong>Modo demostración.</strong> Lotes, precios, pujas y compras son ilustrativos. Los cambios se guardan solo en este navegador; no se publica, cobra ni coordina un traslado real.</p>
    </aside>

    <section class="demo-hero" aria-labelledby="demo-title">
      <div class="hero-copy">
        <p class="eyebrow">Comercio ganadero digital</p>
        <h1 id="demo-title">{active === 'inicio' ? 'Conecta el ganado con nuevos compradores.' : currentSection.label}</h1>
        <p class="hero-description">{currentSection.help}</p>
        <div class="hero-actions">
          <button type="button" onclick={() => go('ganado')}>Explorar lotes</button>
          <button type="button" class="button-secondary" onclick={() => go('publicar')}>Publicar ganado</button>
        </div>
        <p class="hero-caption">Recorrido local para conocer la experiencia de compradores y vendedores.</p>
      </div>

      <div class="hero-preview" aria-label="Resumen ilustrativo del mercado">
        <div class="preview-heading">
          <span class="preview-label"><span class="status-dot" aria-hidden="true"></span>Subasta de muestra</span>
          <span class="preview-code">LOTE S-01</span>
        </div>
        <div class="preview-landscape" aria-hidden="true">
          <svg viewBox="0 0 480 180" preserveAspectRatio="xMidYMid slice">
            <rect width="480" height="180" fill="#dce8d6" />
            <circle cx="385" cy="40" r="22" fill="#e2bf73" />
            <path d="M0 113 C78 83 122 95 190 110 C260 128 338 72 480 99 L480 180 L0 180Z" fill="#94b38d" />
            <path d="M0 139 C110 111 175 147 273 124 C353 105 418 122 480 111 L480 180 L0 180Z" fill="#527e5b" />
            <path d="M0 158 C105 137 179 164 272 146 C355 131 421 146 480 131 L480 180 L0 180Z" fill="#315f40" />
            <g fill="#263e2d">
              <path d="M166 111c0-12 9-21 24-21h33c10 0 17 7 17 16v19h-7v27h-8v-25h-32v25h-8v-25h-24v-16z" />
              <path d="M228 96l11-10 10 2 4 8-10 5z" />
              <path d="M157 104l-9 8 4 5 10-5z" />
              <path d="M177 91l-4-10 5-2 8 12M208 90l4-10 5 2-1 10" />
              <path d="M261 123c0-10 7-18 20-18h29c9 0 15 6 15 14v15h-7v22h-8v-20h-29v20h-8v-20h-12z" />
              <path d="M315 109l10-8 9 2 4 7-10 5z" />
            </g>
          </svg>
          <span class="illustration-caption">Imagen ilustrativa</span>
        </div>
        <div class="preview-content">
          <div><h2>Novillos para engorde</h2><p>Cajamarca · 10 animales · lote de muestra</p></div>
          <div class="preview-price"><span>Precio referencial</span><strong>{currency.format(16200)}</strong></div>
        </div>
        <div class="preview-footer"><span>Compra por lote</span><span>Sin pago real</span></div>
      </div>
    </section>

    <div class="demo-disclosure">
      <div><strong>Compra y venta en un mismo perfil</strong><span>Una persona puede publicar lotes y comprar ganado desde la misma cuenta.</span></div>
      <div><strong>Subastas con registro</strong><span>El producto final valida las pujas en el servidor.</span></div>
      <div><strong>Pagos desactivados</strong><span>Las compras de esta presentación no generan órdenes ni cobros reales.</span></div>
    </div>

    <section class="demo-workflow" aria-labelledby="workflow-title">
      <div class="section-heading">
        <div><p class="eyebrow">Un recorrido sencillo</p><h2 id="workflow-title">Del lote a la coordinación de compra</h2></div>
        <p>Esta demo muestra la experiencia propuesta; los pasos y registros son de ejemplo.</p>
      </div>
      <ol class="workflow-list">
        <li><span class="step-number">01</span><strong>Publicar el lote</strong><span>Datos, ubicación departamental y fotos de referencia.</span></li>
        <li><span class="step-number">02</span><strong>Recibir interés</strong><span>Catálogo y subasta con un precio visible por lote.</span></li>
        <li><span class="step-number">03</span><strong>Coordinar la compra</strong><span>Resumen de la operación y siguiente paso logístico.</span></li>
        <li><span class="step-number">04</span><strong>Seguir el traslado</strong><span>Hitos de ejemplo; el seguimiento real requiere operadores autorizados.</span></li>
      </ol>
    </section>

    <section class="demo-capabilities" aria-labelledby="capabilities-title">
      <div class="section-heading">
        <div><p class="eyebrow">Explora la experiencia</p><h2 id="capabilities-title">Elige una sección</h2></div>
        <button type="button" class="text-button" onclick={resetDemo}>Reiniciar la demostración</button>
      </div>

      <div class="section-tabs" role="group" aria-label="Secciones de la demostración">
        {#each sections as section (section.id)}
          <button type="button" class:tab-active={active === section.id} aria-pressed={active === section.id} onclick={() => go(section.id)}>
            {section.label}
          </button>
        {/each}
      </div>

      {#if notice}<p class="demo-message" role="status">{notice}</p>{/if}
      {#if error}<p class="demo-error" role="alert">{error}</p>{/if}

      {#if active === 'inicio'}
        <div class="content-grid">
          <article class="feature-card">
            <p class="eyebrow">Mercado de ganado en pie</p>
            <h3>Encuentra lotes por especie y departamento.</h3>
            <p>Explora fichas ilustrativas y simula una compra para ver el seguimiento dentro de la aplicación.</p>
            <button type="button" onclick={() => go('ganado')}>Ver lotes de muestra</button>
          </article>
          <article class="feature-card feature-card-light">
            <p class="eyebrow">Para vender</p>
            <h3>Prepara una publicación de ganado.</h3>
            <p>Completa los datos principales y agrega imágenes para ver cómo quedaría una ficha.</p>
            <button type="button" class="button-secondary" onclick={() => go('publicar')}>Crear una publicación de prueba</button>
          </article>
        </div>
        <div class="roadmap-block">
          <div><p class="eyebrow">Crecimiento por etapas</p><h3>Una base para ampliar la cadena ganadera.</h3><p>Las siguientes líneas se presentan como evolución del producto; no están habilitadas como operaciones en esta demo.</p></div>
          <div class="roadmap-list">
            <div><span>01</span><strong>Cortes y carne en canal</strong><small>Próxima etapa de catálogo</small></div>
            <div><span>02</span><strong>Insumos y equipamiento</strong><small>Próxima etapa de marketplace</small></div>
            <div><span>03</span><strong>Servicios y logística</strong><small>Integración con proveedores</small></div>
          </div>
        </div>
      {:else if active === 'ganado'}
        <div class="filter-row">
          <label>Tipo de ganado
            <select bind:value={speciesFilter}>
              <option>Todos</option><option>Bovinos</option><option>Ovinos</option><option>Caprinos</option>
            </select>
          </label>
          <label>Departamento
            <select bind:value={departmentFilter}>
              <option value="">Todos los departamentos</option>
              {#each departments as department}<option value={department.name}>{department.name}</option>{/each}
            </select>
          </label>
          <span class="result-count">{visibleLots.length} lotes de muestra</span>
        </div>
        <div class="lot-grid">
          {#each visibleLots as lot (lot.id)}
            <article class="lot-card">
              <div class="lot-art" aria-hidden="true">
                <span>{lot.species === 'Bovinos' ? 'B' : lot.species === 'Ovinos' ? 'O' : 'C'}</span>
                <small>Ficha ilustrativa</small>
              </div>
              <div class="lot-details">
                <div class="lot-meta"><span>{lot.species}</span><span>{lot.department}</span></div>
                <h3>{lot.title}</h3>
                <p>{lot.quantity} animales · {lot.detail}</p>
                <div class="lot-price"><span>Precio referencial por lote</span><strong>{currency.format(lot.price)}</strong></div>
                <button type="button" onclick={() => createPurchase(lot)}>Simular proceso de compra</button>
              </div>
            </article>
          {:else}
            <div class="empty-state"><h3>No hay lotes de muestra con estos filtros.</h3><p>Prueba otra especie o departamento.</p><button type="button" class="button-secondary" onclick={() => { speciesFilter = 'Todos'; departmentFilter = ''; }}>Limpiar filtros</button></div>
          {/each}
        </div>
      {:else if active === 'subastas'}
        <div class="auction-intro"><div><p class="eyebrow">Subastas de ejemplo</p><h3>Puja por el lote completo.</h3></div><p>En esta presentación, las ofertas solo cambian el estado local de la pantalla.</p></div>
        <div class="auction-grid">
          {#each auctions as auction (auction.id)}
            <article class="auction-card">
              <div class="auction-card-top"><span class="auction-tag">Subasta de muestra</span><span class="lot-meta">{auction.department}</span></div>
              <h3>{auction.title}</h3><p>{auction.animals} animales · precio de lote</p>
              <div class="auction-value"><span>Oferta ilustrativa actual</span><strong>{currency.format(auction.bid)}</strong></div>
              <div class="auction-countdown"><span>Cierre de referencia</span><strong>{Math.floor(auction.endsIn / 60).toString().padStart(2, '0')}:{(auction.endsIn % 60).toString().padStart(2, '0')}</strong></div>
              <button type="button" disabled={auction.endsIn === 0} onclick={() => placeBid(auction.id)}>{auction.endsIn === 0 ? 'Tiempo de muestra concluido' : 'Simular puja de S/ 100'}</button>
            </article>
          {/each}
        </div>
      {:else if active === 'ubicacion'}
        <div class="location-grid">
          <aside class="location-controls">
            <p class="eyebrow">Ubicación referencial</p><h3>Selecciona un departamento</h3>
            <p>El mapa marca capitales departamentales como referencia. No muestra establos ni ubicaciones exactas.</p>
            <label>Departamento
              <select bind:value={selectedDepartment} onchange={() => selectDepartment(selectedDepartment)}>
                {#each departments as department}<option value={department.name}>{department.name}</option>{/each}
              </select>
            </label>
            <div class="selected-place"><span>Destino seleccionado</span><strong>{selectedDepartmentInfo.name}</strong><small>Capital: {selectedDepartmentInfo.capital}</small></div>
            <button type="button" class="button-secondary" onclick={requestLocation}>Calcular distancia desde mi ubicación</button>
            {#if distanceKm !== null}<p class="distance-result"><strong>{distanceKm.toFixed(0)} km aprox.</strong><span>Distancia en línea recta hasta {selectedDepartmentInfo.capital}; no es una ruta vial.</span></p>{/if}
            <p class="privacy-copy">La ubicación del dispositivo se usa solo en memoria para este cálculo y no se envía ni se guarda.</p>
          </aside>
          <div class="map-panel">
            <div class="map-heading"><div><p class="eyebrow">Perú</p><h3>Departamentos</h3></div><span>25 referencias</span></div>
            <div class="peru-map" role="group" aria-label="Mapa referencial del Perú. Selecciona un punto para elegir un departamento.">
              <svg class="peru-shape" viewBox="0 0 300 420" aria-hidden="true" focusable="false">
                <path d="M28 66 L45 44 L75 34 L91 20 L128 25 L148 10 L181 20 L207 11 L232 26 L236 51 L263 65 L250 89 L260 113 L248 137 L254 159 L236 183 L245 205 L228 229 L234 251 L217 275 L220 301 L201 325 L205 350 L184 371 L174 396 L151 410 L135 393 L119 377 L103 358 L89 339 L75 318 L66 295 L54 273 L46 249 L40 225 L32 202 L25 179 L18 157 L16 132 L22 110 L17 91 Z" />
              </svg>
              {#each departments as department (department.name)}
                <button type="button" class:map-point-active={selectedDepartment === department.name} class="map-point" style={`left:${department.x}%;top:${department.y}%`} aria-label={"Seleccionar " + department.name} aria-pressed={selectedDepartment === department.name} onclick={() => selectFromMap(department.name)} title={department.name}>
                  <span>{department.short}</span>
                </button>
              {/each}
            </div>
            <div class="map-footer"><span class="map-key" aria-hidden="true"></span>Capital departamental referencial</div>
          </div>
        </div>
      {:else if active === 'publicar'}
        <div class="publish-grid">
          <form class="publish-form" onsubmit={publishLot}>
            <p class="eyebrow">Vista previa de publicación</p><h3>Describe el lote</h3>
            <p>Completa la información básica y revisa la ficha que se agregará al catálogo de esta demostración.</p>
            <label>Nombre del lote<input required maxlength="90" bind:value={formTitle} placeholder="Ej.: Novillos para engorde" /></label>
            <div class="form-two">
              <label>Especie<select bind:value={formSpecies}><option>Bovinos</option><option>Ovinos</option><option>Caprinos</option></select></label>
              <label>Departamento<select required bind:value={formDepartment}><option value="">Selecciona</option>{#each departments as department}<option value={department.name}>{department.name}</option>{/each}</select></label>
            </div>
            <div class="form-two">
              <label>Cantidad de animales<input required type="number" min="1" max="10000" step="1" bind:value={formQuantity} /></label>
              <label>Precio estimado del lote (S/)<input required type="number" min="1" step="0.01" bind:value={formPrice} /></label>
            </div>
            <label>Descripción<textarea rows="3" maxlength="500" bind:value={formDescription} placeholder="Raza, edad aproximada y características visibles"></textarea></label>
            <label>Fotos de referencia<input type="file" accept="image/*" multiple onchange={handlePhotos} /></label>
            <span class="field-hint">Hasta 5 imágenes de 4 MB. Se previsualizan en este dispositivo y no se suben a un servidor.</span>
            {#if fileError}<p class="demo-error" role="alert">{fileError}</p>{/if}
            {#if photoUrls.length}<div class="photo-preview" aria-label="Vista previa de fotos">{#each photoUrls as url, index}<img src={url} alt={"Foto de referencia " + (index + 1)} />{/each}</div>{/if}
            <button type="submit">Agregar lote de muestra</button>
          </form>
          <aside class="publish-guide">
            <h3>Antes de publicar en el producto final</h3>
            <ol>
              <li>Registra cantidad, categoría y características del ganado.</li>
              <li>Selecciona departamento y revisa la ubicación mostrada.</li>
              <li>Agrega fotografías nítidas del lote.</li>
              <li>Confirma los datos antes de solicitar la publicación.</li>
            </ol>
            <div class="guide-note">La publicación de esta demo queda guardada solo en el navegador. No aparece en el catálogo real.</div>
          </aside>
        </div>
      {:else if active === 'compras'}
        <div class="purchase-header"><div><p class="eyebrow">Seguimiento de ejemplo</p><h3>Mis compras</h3><p>Los hitos se avanzan manualmente para que puedas mostrar el recorrido.</p></div><button type="button" class="button-secondary" onclick={() => go('ganado')}>Elegir un lote</button></div>
        {#if purchases.length === 0}
          <div class="empty-state"><h3>Aún no hay compras de muestra.</h3><p>Ve al catálogo y selecciona “Simular proceso de compra” en un lote.</p><button type="button" onclick={() => go('ganado')}>Explorar ganado</button></div>
        {:else}
          <div class="purchase-list">
            {#each purchases as purchase (purchase.id)}
              <article class="purchase-card">
                <div class="purchase-title"><div><span class="purchase-id">Compra de muestra · {purchase.id}</span><h4>{purchase.lotTitle}</h4><p>{purchase.department} · {currency.format(purchase.price)} referencial</p></div><span class="purchase-date">{purchase.createdAt}</span></div>
                <ol class="tracking-steps">
                  {#each trackingSteps as step, index}
                    <li class:step-done={index < purchase.stage} class:step-current={index === purchase.stage}>
                      <span class="step-indicator">{index < purchase.stage ? 'Hecho' : index === purchase.stage ? 'En curso' : 'Pendiente'}</span><strong>{step}</strong>
                    </li>
                  {/each}
                </ol>
                {#if purchase.stage < trackingSteps.length - 1}
                  <button type="button" class="button-secondary" onclick={() => advancePurchase(purchase.id)}>Avanzar al siguiente hito (demo)</button>
                {:else}<p class="completed-note">Recorrido de ejemplo completado.</p>{/if}
              </article>
            {/each}
          </div>
        {/if}
        <p class="tracking-disclaimer">Este avance no usa GPS ni eventos de transportistas. No representa un traslado en curso.</p>
      {/if}
    </section>

    <section class="demo-footer-note">
      <div><p class="eyebrow">La siguiente etapa</p><h2>Una plataforma que puede crecer con el sector.</h2><p>La experiencia final incorporará proveedores y transacciones reales tras completar las integraciones, validaciones y pruebas correspondientes.</p></div>
      <div class="footer-chip-row"><span>Ganado en pie</span><span>Subastas</span><span>Trazabilidad</span><span>Coordinación logística</span></div>
    </section>
  </div>
</div>

<style>
  .demo-page {
    --demo-ink: #17281d;
    --demo-muted: #5b6a60;
    --demo-line: #d6dfd3;
    --demo-surface: #fff;
    --demo-field: #f2f5ef;
    --demo-green: #1e5a35;
    --demo-deep: #143f25;
    --demo-green-light: #e6f0e7;
    --demo-maize: #d9a441;
    --demo-warn: #754900;
    --demo-warn-bg: #fcf3df;
    min-height: 100%;
    background: #f2f4ee;
    color: var(--demo-ink);
    padding: 1.25rem 1rem 3rem;
  }
  .demo-page * { box-sizing: border-box; }
  .demo-shell { width: min(100%, 1180px); margin: 0 auto; }
  .demo-topbar { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:.15rem 0 1.1rem; }
  .demo-brand { display:flex; align-items:center; gap:.65rem; color:var(--demo-ink); font-size:.9rem; font-weight:850; letter-spacing:.06em; text-decoration:none; }
  .demo-brand small { display:block; color:var(--demo-muted); font-size:.68rem; font-weight:500; letter-spacing:0; }
  .demo-brand-mark { display:grid; place-items:center; width:2.35rem; height:2.35rem; border-radius:.7rem; background:var(--demo-green); color:#fff; font-size:1.2rem; }
  .demo-mode-label { display:flex; align-items:center; gap:.45rem; padding:.4rem .7rem; border:1px solid var(--demo-line); border-radius:99px; background:var(--demo-surface); color:var(--demo-muted); font-size:.75rem; font-weight:650; }
  .demo-mode-label span { width:.5rem; height:.5rem; border-radius:50%; background:var(--demo-maize); }
  .demo-disclaimer { display:flex; align-items:flex-start; gap:.7rem; padding:.9rem 1rem; border:1px solid #e3bf74; border-radius:.75rem; background:var(--demo-warn-bg); color:var(--demo-warn); }
  .demo-disclaimer p { margin:0; font-size:.9rem; line-height:1.5; }
  .disclaimer-mark { flex:none; display:grid; place-items:center; width:1.35rem; height:1.35rem; border:1px solid currentColor; border-radius:50%; font-size:.8rem; font-weight:800; }
  .demo-hero { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr); gap:2rem; align-items:center; padding:2.2rem 0 1.8rem; }
  .hero-copy { max-width:640px; }
  .eyebrow { margin:0 0 .5rem; color:var(--demo-green); font-size:.82rem; font-weight:700; }
  .demo-hero h1 { margin:.15rem 0 .85rem; max-width:15ch; color:var(--demo-ink); font-size:clamp(2.3rem,4.6vw,4.2rem); line-height:1.02; letter-spacing:-.04em; }
  .hero-description { max-width:58ch; margin:0; color:var(--demo-muted); font-size:1.05rem; line-height:1.65; }
  .hero-actions { display:flex; flex-wrap:wrap; gap:.7rem; margin:1.25rem 0 .8rem; }
  .demo-page button { border:1px solid var(--demo-green); border-radius:.55rem; background:var(--demo-green); color:#fff; padding:.66rem .95rem; font:inherit; font-weight:650; cursor:pointer; }
  .demo-page button:hover { background:var(--demo-deep); border-color:var(--demo-deep); }
  .demo-page button:disabled { opacity:.5; cursor:not-allowed; }
  .demo-page button:focus-visible, .demo-page input:focus-visible, .demo-page select:focus-visible, .demo-page textarea:focus-visible { outline:3px solid var(--demo-maize); outline-offset:2px; }
  .demo-page .button-secondary { background:var(--demo-surface); color:var(--demo-ink); border-color:var(--demo-line); }
  .demo-page .button-secondary:hover { background:var(--demo-field); color:var(--demo-ink); border-color:#aab9a7; }
  .hero-caption { margin:0; color:var(--demo-muted); font-size:.83rem; }
  .hero-preview { overflow:hidden; border:1px solid var(--demo-line); border-radius:1rem; background:var(--demo-surface); box-shadow:0 18px 40px rgba(21,45,28,.11); }
  .preview-heading { display:flex; justify-content:space-between; align-items:center; gap:.75rem; padding:.9rem 1rem; }
  .preview-label { display:flex; align-items:center; gap:.5rem; color:var(--demo-green); font-size:.83rem; font-weight:700; }
  .status-dot { width:.55rem; height:.55rem; border-radius:50%; background:var(--demo-maize); }
  .preview-code { color:var(--demo-muted); font-size:.72rem; letter-spacing:.06em; }
  .preview-landscape { position:relative; height:175px; overflow:hidden; background:#dce8d6; }
  .preview-landscape svg { width:100%; height:100%; display:block; }
  .illustration-caption { position:absolute; right:.65rem; bottom:.6rem; padding:.2rem .45rem; border-radius:99px; background:rgba(255,255,255,.86); color:var(--demo-muted); font-size:.68rem; }
  .preview-content { display:flex; justify-content:space-between; gap:1rem; padding:1rem; }
  .preview-content h2 { margin:0 0 .3rem; font-size:1.12rem; color:var(--demo-ink); }
  .preview-content p { margin:0; color:var(--demo-muted); font-size:.82rem; }
  .preview-price { display:grid; justify-items:end; gap:.15rem; white-space:nowrap; }
  .preview-price span, .auction-value span, .auction-countdown span, .lot-price span { color:var(--demo-muted); font-size:.72rem; }
  .preview-price strong { color:var(--demo-green); font-size:1.35rem; font-variant-numeric:tabular-nums; }
  .preview-footer { display:flex; justify-content:space-between; gap:1rem; padding:.7rem 1rem; border-top:1px solid var(--demo-line); color:var(--demo-muted); font-size:.78rem; }
  .demo-disclosure { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--demo-line); border-radius:.9rem; background:var(--demo-surface); }
  .demo-disclosure div { display:grid; gap:.25rem; padding:1rem 1.1rem; }
  .demo-disclosure div + div { border-left:1px solid var(--demo-line); }
  .demo-disclosure strong { font-size:.9rem; color:var(--demo-ink); }
  .demo-disclosure span { color:var(--demo-muted); font-size:.8rem; line-height:1.45; }
  .demo-workflow { padding:2rem 0 1rem; }
  .section-heading { display:flex; justify-content:space-between; align-items:end; gap:1rem; margin-bottom:1rem; }
  .section-heading h2 { margin:0; color:var(--demo-ink); font-size:1.6rem; letter-spacing:-.02em; }
  .section-heading > p { max-width:46ch; margin:0; color:var(--demo-muted); font-size:.88rem; }
  .workflow-list { display:grid; grid-template-columns:repeat(4,1fr); gap:.75rem; margin:0; padding:0; list-style:none; }
  .workflow-list li { display:grid; gap:.42rem; padding:1rem; border:1px solid var(--demo-line); border-radius:.75rem; background:var(--demo-surface); }
  .step-number { color:var(--demo-green); font-size:.78rem; font-weight:800; letter-spacing:.05em; }
  .workflow-list strong { color:var(--demo-ink); font-size:.9rem; }
  .workflow-list li > span:last-child { color:var(--demo-muted); font-size:.78rem; line-height:1.5; }
  .demo-capabilities { margin:1.5rem 0 2rem; padding:1.3rem; border:1px solid var(--demo-line); border-radius:1rem; background:var(--demo-surface); }
  .text-button { border:0!important; background:transparent!important; color:var(--demo-green)!important; padding:.45rem!important; }
  .text-button:hover { text-decoration:underline; }
  .section-tabs { display:flex; gap:.45rem; overflow-x:auto; padding:.2rem 0 .8rem; border-bottom:1px solid var(--demo-line); }
  .section-tabs button { flex:none; border-color:transparent; background:transparent; color:var(--demo-muted); padding:.55rem .8rem; font-size:.85rem; }
  .section-tabs button:hover { background:var(--demo-field); color:var(--demo-ink); }
  .section-tabs button.tab-active { background:var(--demo-green-light); border-color:#b8d0bb; color:var(--demo-deep); }
  .demo-message, .demo-error { margin:1rem 0; padding:.8rem .9rem; border-radius:.65rem; font-size:.88rem; }
  .demo-message { border:1px solid #afd0b5; background:var(--demo-green-light); color:var(--demo-deep); }
  .demo-error { border:1px solid #e4a8a0; background:#fcedea; color:#a3261a; }
  .content-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:1rem; padding:1.2rem 0; }
  .feature-card { display:grid; align-content:start; gap:.55rem; min-height:210px; padding:1.25rem; border-radius:.85rem; background:var(--demo-deep); color:#fff; }
  .feature-card .eyebrow { color:#d6e7d8; }
  .feature-card h3 { margin:0; max-width:24ch; color:#fff; font-size:1.4rem; line-height:1.25; }
  .feature-card p:not(.eyebrow) { max-width:52ch; margin:0; color:#e0ebe1; font-size:.9rem; line-height:1.5; }
  .feature-card button { justify-self:start; align-self:end; margin-top:.35rem; background:#fff; color:var(--demo-deep); border-color:#fff; }
  .feature-card button:hover { background:var(--demo-field); border-color:var(--demo-field); }
  .feature-card-light { background:var(--demo-field); border:1px solid var(--demo-line); }
  .feature-card-light .eyebrow { color:var(--demo-green); }
  .feature-card-light h3 { color:var(--demo-ink); }
  .feature-card-light p:not(.eyebrow) { color:var(--demo-muted); }
  .feature-card-light button { background:var(--demo-green); border-color:var(--demo-green); color:#fff; }
  .roadmap-block { display:grid; grid-template-columns:.8fr 1.2fr; gap:1.25rem; padding:1.1rem 0 .15rem; border-top:1px solid var(--demo-line); }
  .roadmap-block h3 { margin:.2rem 0 .35rem; color:var(--demo-ink); font-size:1.25rem; }
  .roadmap-block p:not(.eyebrow) { margin:0; color:var(--demo-muted); font-size:.85rem; line-height:1.5; }
  .roadmap-list { display:grid; grid-template-columns:repeat(3,1fr); gap:.65rem; }
  .roadmap-list div { display:grid; align-content:start; gap:.3rem; padding:.75rem; border:1px solid var(--demo-line); border-radius:.7rem; }
  .roadmap-list span { color:var(--demo-green); font-size:.73rem; font-weight:800; }
  .roadmap-list strong { font-size:.84rem; color:var(--demo-ink); }
  .roadmap-list small { color:var(--demo-muted); line-height:1.35; }
  .filter-row { display:flex; align-items:end; gap:1rem; flex-wrap:wrap; padding:1.15rem 0; }
  .filter-row label { display:grid; gap:.3rem; width:min(100%,250px); color:var(--demo-ink); font-size:.84rem; font-weight:650; }
  .demo-page input, .demo-page select, .demo-page textarea { width:100%; border:1px solid #b7c3b4; border-radius:.5rem; background:#fff; color:var(--demo-ink); padding:.6rem .7rem; font:inherit; }
  .result-count { margin-left:auto; padding-bottom:.4rem; color:var(--demo-muted); font-size:.84rem; }
  .lot-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.9rem; padding:.35rem 0 1rem; }
  .lot-card { overflow:hidden; border:1px solid var(--demo-line); border-radius:.85rem; background:var(--demo-surface); }
  .lot-art { display:flex; justify-content:space-between; align-items:end; min-height:118px; padding:.85rem; background:linear-gradient(135deg,#dce8d6 0%,#a5c19c 56%,#769773 100%); color:var(--demo-deep); }
  .lot-art > span { display:grid; place-items:center; width:2.4rem; height:2.4rem; border-radius:50%; background:rgba(255,255,255,.86); font-weight:850; font-size:1.05rem; }
  .lot-art small { padding:.2rem .45rem; border-radius:99px; background:rgba(255,255,255,.88); color:var(--demo-muted); font-size:.68rem; }
  .lot-details { padding:1rem; }
  .lot-meta { display:flex; justify-content:space-between; gap:.5rem; color:var(--demo-green); font-size:.75rem; font-weight:700; }
  .lot-details h3 { margin:.45rem 0 .3rem; color:var(--demo-ink); font-size:1.04rem; }
  .lot-details p { min-height:2.3em; margin:0; color:var(--demo-muted); font-size:.81rem; line-height:1.45; }
  .lot-price { display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; margin:1rem 0 .85rem; padding-top:.75rem; border-top:1px solid var(--demo-line); }
  .lot-price strong { color:var(--demo-green); font-size:1.2rem; font-variant-numeric:tabular-nums; }
  .lot-details button { width:100%; }
  .lot-art span { flex: none; }
  .empty-state { grid-column:1/-1; padding:2rem; border:1px dashed #bdc9b8; border-radius:.75rem; text-align:center; }
  .empty-state h3 { margin:0 0 .4rem; color:var(--demo-ink); }
  .empty-state p { margin:0 0 1rem; color:var(--demo-muted); }
  .auction-intro { display:flex; justify-content:space-between; align-items:end; gap:1rem; padding:1.2rem 0 .8rem; }
  .auction-intro h3 { margin:0; color:var(--demo-ink); font-size:1.3rem; }
  .auction-intro > p { max-width:45ch; margin:0; color:var(--demo-muted); font-size:.86rem; }
  .auction-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:.9rem; padding:.35rem 0 1rem; }
  .auction-card { padding:1.1rem; border:1px solid var(--demo-line); border-radius:.85rem; background:var(--demo-surface); }
  .auction-card-top { display:flex; justify-content:space-between; align-items:center; gap:.6rem; }
  .auction-tag { padding:.23rem .5rem; border:1px solid #e3bf74; border-radius:99px; background:var(--demo-warn-bg); color:var(--demo-warn); font-size:.72rem; font-weight:700; }
  .auction-card h3 { margin:.75rem 0 .15rem; color:var(--demo-ink); }
  .auction-card > p { margin:0; color:var(--demo-muted); font-size:.84rem; }
  .auction-value { display:flex; justify-content:space-between; align-items:baseline; gap:.75rem; margin:1rem 0 .65rem; }
  .auction-value strong { color:var(--demo-green); font-size:1.45rem; font-variant-numeric:tabular-nums; }
  .auction-countdown { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:1rem; padding-top:.65rem; border-top:1px solid var(--demo-line); }
  .auction-countdown strong { color:var(--demo-ink); font-variant-numeric:tabular-nums; }
  .location-grid { display:grid; grid-template-columns:minmax(250px,.72fr) minmax(0,1.28fr); gap:1rem; padding:1.15rem 0 1rem; }
  .location-controls, .map-panel, .publish-form, .publish-guide, .purchase-card { padding:1.1rem; border:1px solid var(--demo-line); border-radius:.85rem; background:var(--demo-surface); }
  .location-controls h3, .publish-form h3, .publish-guide h3, .purchase-header h3 { margin:.15rem 0 .4rem; color:var(--demo-ink); font-size:1.15rem; }
  .location-controls > p:not(.eyebrow) { color:var(--demo-muted); font-size:.83rem; line-height:1.5; }
  .location-controls label { display:grid; gap:.35rem; margin:1rem 0; color:var(--demo-ink); font-size:.84rem; font-weight:650; }
  .selected-place { display:grid; gap:.16rem; margin:1rem 0; padding:.8rem; border-radius:.65rem; background:var(--demo-field); }
  .selected-place > span, .selected-place small { color:var(--demo-muted); font-size:.76rem; }
  .selected-place strong { color:var(--demo-ink); }
  .distance-result { display:grid; gap:.2rem; padding:.75rem; border-left:3px solid var(--demo-maize); background:var(--demo-warn-bg); color:var(--demo-warn); }
  .distance-result strong { font-size:1.1rem; }
  .distance-result span, .privacy-copy { font-size:.76rem; line-height:1.45; }
  .privacy-copy { color:var(--demo-muted); }
  .map-heading { display:flex; justify-content:space-between; align-items:end; gap:.75rem; }
  .map-heading h3 { margin:.1rem 0; color:var(--demo-ink); font-size:1.2rem; }
  .map-heading > span { color:var(--demo-muted); font-size:.78rem; }
  .peru-map { position:relative; width:min(100%,390px); height:480px; margin:0 auto; }
  .peru-shape { position:absolute; inset:0; width:100%; height:100%; }
  .peru-shape path { fill:#e5eee1; stroke:#789779; stroke-width:2.5; stroke-linejoin:round; }
  .map-point { position:absolute; display:grid; place-items:center; width:1.75rem; height:1.75rem; transform:translate(-50%,-50%); padding:0!important; border:2px solid #fff!important; border-radius:50%!important; background:var(--demo-green)!important; box-shadow:0 1px 4px rgba(20,63,37,.3); color:#fff!important; font-size:.57rem!important; font-weight:800!important; }
  .map-point:hover { z-index:2; transform:translate(-50%,-50%) scale(1.12); }
  .map-point.map-point-active { z-index:3; outline:3px solid var(--demo-maize); outline-offset:1px; background:#a26d12!important; }
  .map-footer { display:flex; align-items:center; gap:.45rem; padding-top:.6rem; border-top:1px solid var(--demo-line); color:var(--demo-muted); font-size:.77rem; }
  .map-key { width:.6rem; height:.6rem; border-radius:50%; background:var(--demo-green); }
  .publish-grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(230px,.7fr); gap:1rem; padding:1.15rem 0; }
  .publish-form { display:grid; gap:.85rem; }
  .publish-form > p:not(.eyebrow) { margin:0; color:var(--demo-muted); font-size:.84rem; line-height:1.5; }
  .publish-form label { display:grid; gap:.35rem; color:var(--demo-ink); font-size:.84rem; font-weight:650; }
  .form-two { display:grid; grid-template-columns:repeat(2,1fr); gap:.8rem; }
  .publish-guide ol { margin:1rem 0; padding-left:1.25rem; color:var(--demo-muted); font-size:.85rem; line-height:1.55; }
  .publish-guide li + li { margin-top:.55rem; }
  .guide-note { padding:.75rem; border-radius:.65rem; background:var(--demo-warn-bg); color:var(--demo-warn); font-size:.78rem; line-height:1.45; }
  .field-hint { margin-top:-.55rem; color:var(--demo-muted); font-size:.75rem; }
  .photo-preview { display:flex; flex-wrap:wrap; gap:.5rem; }
  .photo-preview img { width:5rem; height:5rem; border-radius:.5rem; object-fit:cover; border:1px solid var(--demo-line); }
  .purchase-header { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:1.15rem 0; }
  .purchase-header > div > p:last-child { margin:0; color:var(--demo-muted); font-size:.85rem; }
  .purchase-list { display:grid; gap:.85rem; padding:.2rem 0 1rem; }
  .purchase-title { display:flex; justify-content:space-between; gap:1rem; }
  .purchase-id { color:var(--demo-green); font-size:.75rem; font-weight:700; }
  .purchase-title h4 { margin:.25rem 0; color:var(--demo-ink); font-size:1.05rem; }
  .purchase-title p, .purchase-date { margin:0; color:var(--demo-muted); font-size:.78rem; }
  .tracking-steps { display:grid; grid-template-columns:repeat(4,1fr); gap:.45rem; margin:1rem 0; padding:0; list-style:none; }
  .tracking-steps li { display:grid; gap:.45rem; padding:.65rem; border:1px solid var(--demo-line); border-radius:.55rem; background:var(--demo-field); }
  .tracking-steps li.step-done { border-color:#afcdb3; background:var(--demo-green-light); }
  .tracking-steps li.step-current { border-color:#e3bf74; background:var(--demo-warn-bg); }
  .step-indicator { color:var(--demo-muted); font-size:.69rem; }
  .tracking-steps li strong { color:var(--demo-ink); font-size:.78rem; }
  .completed-note, .tracking-disclaimer { color:var(--demo-muted); font-size:.8rem; }
  .empty-state { text-align:center; }
  .demo-footer-note { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:1.4rem; border:1px solid var(--demo-line); border-radius:.9rem; background:var(--demo-deep); color:#fff; }
  .demo-footer-note .eyebrow { color:#d6e7d8; }
  .demo-footer-note h2 { margin:.1rem 0 .35rem; color:#fff; font-size:1.25rem; }
  .demo-footer-note p:not(.eyebrow) { margin:0; color:#e0ebe1; font-size:.83rem; line-height:1.5; }
  .footer-chip-row { display:flex; flex-wrap:wrap; justify-content:end; gap:.4rem; min-width:240px; }
  .footer-chip-row span { padding:.36rem .55rem; border:1px solid #54755b; border-radius:99px; color:#e0ebe1; font-size:.72rem; white-space:nowrap; }
  @media (max-width:850px) {
    .demo-hero { grid-template-columns:1fr 1fr; gap:1rem; }
    .workflow-list { grid-template-columns:repeat(2,1fr); }
    .demo-disclosure { grid-template-columns:1fr; }
    .demo-disclosure div + div { border-left:0; border-top:1px solid var(--demo-line); }
    .location-grid { grid-template-columns:1fr; }
    .peru-map { height:430px; }
  }
  @media (max-width:600px) {
    .demo-page { padding:1rem .75rem 2rem; }
    .demo-topbar { align-items:flex-start; }
    .demo-hero { grid-template-columns:1fr; padding:1.4rem 0; }
    .demo-hero h1 { max-width:17ch; font-size:2.55rem; }
    .hero-preview { max-width:520px; }
    .section-heading, .purchase-header, .auction-intro { align-items:flex-start; flex-direction:column; }
    .section-heading > p { margin-top:.2rem; }
    .content-grid, .lot-grid, .auction-grid, .publish-grid, .form-two, .roadmap-block { grid-template-columns:1fr; }
    .result-count { width:100%; margin:0; }
    .peru-map { height:380px; }
    .tracking-steps { grid-template-columns:repeat(2,1fr); }
    .purchase-title { flex-direction:column; }
    .demo-footer-note { align-items:flex-start; flex-direction:column; }
    .footer-chip-row { justify-content:flex-start; min-width:0; }
    .demo-capabilities { padding:.8rem; }
    .section-tabs button { padding:.55rem .65rem; font-size:.78rem; }
  }
  @media (prefers-reduced-motion:reduce) {
    .demo-page *, .demo-page *::before, .demo-page *::after { scroll-behavior:auto!important; transition:none!important; animation:none!important; }
  }
</style>
