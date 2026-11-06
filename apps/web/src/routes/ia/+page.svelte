<script lang="ts">
  import { apiRequest } from '#lib/api.ts';
  import { session } from '#lib/session.ts';
  import type {
    CalibracionReferencia,
    CrearEstimacionPesoInput,
    EstimacionPesoResponse,
    PuntoPx,
    PuntosAnatomicos,
    ResumenPesoLote
  } from '@ganadito/contracts';

  type PuntoObjetivo = keyof PuntosAnatomicos | 'punto_a' | 'punto_b';
  const objetivos: Array<{ value: PuntoObjetivo; label: string }> = [
    { value: 'punta_hombro', label: 'Punta del hombro' },
    { value: 'punta_nalga', label: 'Punta de la nalga' },
    { value: 'cruz', label: 'Cruz' },
    { value: 'pecho_inferior', label: 'Pecho inferior' },
    { value: 'punto_a', label: 'Referencia: extremo A' },
    { value: 'punto_b', label: 'Referencia: extremo B' }
  ];

  let loteId = $state('');
  let identificadorAnimal = $state('');
  let objetivo = $state<PuntoObjetivo>('punta_hombro');
  let imagenBase64 = $state('');
  let imagenPreview = $state('');
  let anchoImagen = $state(0);
  let altoImagen = $state(0);
  let imagenEl = $state<HTMLImageElement | undefined>(undefined);
  let puntos = $state<Partial<PuntosAnatomicos> & { punto_a?: PuntoPx; punto_b?: PuntoPx }>({});
  let distanciaReferencia = $state<number | undefined>();
  let cargandoImagen = $state(false);
  let enviando = $state(false);
  let consultando = $state(false);
  let error = $state('');
  let mensaje = $state('');
  let resumen = $state<ResumenPesoLote | null>(null);
  let idempotencyKey = $state('');

  function esPuntoCompleto(): boolean {
    return !!puntos.punta_hombro && !!puntos.punta_nalga && !!puntos.cruz &&
      !!puntos.pecho_inferior && !!puntos.punto_a && !!puntos.punto_b;
  }

  async function seleccionarImagen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    error = '';
    mensaje = '';
    puntos = {};
    imagenBase64 = '';
    imagenPreview = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { error = 'Selecciona una foto PNG o JPEG.'; input.value = ''; return; }
    if (file.size > 20 * 1024 * 1024) { error = 'La foto original supera 20 MB; elige una imagen más ligera.'; input.value = ''; return; }

    cargandoImagen = true;
    try {
      const bitmap = await createImageBitmap(file);
      const escala = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * escala));
      canvas.height = Math.max(1, Math.round(bitmap.height * escala));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar la foto en este navegador.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('No se pudo comprimir la foto.')), 'image/jpeg', 0.86);
      });
      if (blob.size > 8 * 1024 * 1024) throw new Error('La foto comprimida supera 8 MB; usa una foto con menor resolución.');
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer la foto.'));
        reader.onerror = () => reject(new Error('No se pudo leer la foto.'));
        reader.readAsDataURL(blob);
      });
      imagenPreview = dataUrl;
      imagenBase64 = dataUrl.split(',')[1] ?? '';
      anchoImagen = canvas.width;
      altoImagen = canvas.height;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'No se pudo preparar la foto.';
      input.value = '';
    } finally {
      cargandoImagen = false;
    }
  }

  function marcarPunto(event: PointerEvent) {
    if (!imagenEl || !imagenBase64) return;
    const rect = imagenEl.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) * (anchoImagen / rect.width));
    const y = Math.round((event.clientY - rect.top) * (altoImagen / rect.height));
    const point: PuntoPx = [Math.min(anchoImagen - 1, Math.max(0, x)), Math.min(altoImagen - 1, Math.max(0, y))];
    puntos = { ...puntos, [objetivo]: point };
    mensaje = `Punto ${objetivos.find(item => item.value === objetivo)?.label} marcado en ${point[0]}, ${point[1]} px.`;
  }

  async function consultarResumen() {
    error = '';
    mensaje = '';
    resumen = null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loteId.trim())) {
      error = 'Ingresa el UUID del lote publicado.';
      return;
    }
    consultando = true;
    try {
      resumen = await apiRequest<ResumenPesoLote>(
        `/api/v1/subastas/${encodeURIComponent(loteId.trim())}/estimaciones-peso`
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'No se pudieron consultar las estimaciones.';
    } finally {
      consultando = false;
    }
  }

  async function enviarEstimacion(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    mensaje = '';
    if ($session.status !== 'authenticated' || !$session.organizationId || $session.role !== 'VENDEDOR') {
      error = 'Inicia sesión y selecciona una organización con rol VENDEDOR para agregar estimaciones.';
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(loteId.trim())) {
      error = 'Ingresa el UUID válido del lote.';
      return;
    }
    if (!imagenBase64 || !esPuntoCompleto() || !distanciaReferencia || distanciaReferencia <= 0) {
      error = 'Carga la foto y marca los cuatro puntos anatómicos, los dos extremos de una referencia métrica y su distancia real en centímetros.';
      return;
    }

    enviando = true;
    if (!idempotencyKey) idempotencyKey = crypto.randomUUID();
    const puntosCompletos = puntos as PuntosAnatomicos & { punto_a: PuntoPx; punto_b: PuntoPx };
    const calibracion: CalibracionReferencia = {
      tipo: 'REFERENCIA',
      punto_a: puntosCompletos.punto_a,
      punto_b: puntosCompletos.punto_b,
      distancia_cm: distanciaReferencia
    };
    const payload: CrearEstimacionPesoInput = {
      ...(identificadorAnimal.trim() ? { identificador_animal: identificadorAnimal.trim() } : {}),
      vistas: [{
        imagen_base64: imagenBase64,
        puntos: {
          punta_hombro: puntosCompletos.punta_hombro,
          punta_nalga: puntosCompletos.punta_nalga,
          cruz: puntosCompletos.cruz,
          pecho_inferior: puntosCompletos.pecho_inferior
        },
        calibracion
      }]
    };
    try {
      const result = await apiRequest<EstimacionPesoResponse>(
        `/api/v1/subastas/${encodeURIComponent(loteId.trim())}/estimaciones-peso`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload)
        }
      );
      idempotencyKey = '';
      imagenBase64 = '';
      imagenPreview = '';
      puntos = {};
      const [min, max] = [result.rango_min_kg.toFixed(1), result.rango_max_kg.toFixed(1)];
      mensaje = `Estimación registrada por la API: ${result.peso_estimado_kg.toFixed(1)} kg (rango ${min}–${max} kg). No es vinculante.`;
      await consultarResumen();
    } catch (cause) {
      // Conserva la clave: el mismo envío se puede repetir de forma idempotente si hubo timeout.
      error = cause instanceof Error ? cause.message : 'No se pudo completar la estimación.';
    } finally {
      enviando = false;
    }
  }
</script>

<svelte:head><title>Estimación de peso | Ganadito</title></svelte:head>

<section class="page">
  <p class="eyebrow">Herramienta orientativa</p>
  <h1>Estimación de peso vivo</h1>
  <p class="muted">El cálculo usa fotos, medidas marcadas y una referencia métrica. La API envía la imagen al satélite de zoometría y guarda únicamente la estimación y sus medidas; la foto no se conserva.</p>

  <section class="panel">
    <h2>1. Lote y animal</h2>
    <p>Consulta el identificador desde <a href="/subastas">Lotes y subastas</a>. Solo se pueden agregar datos a lotes de tu organización antes del inicio de la subasta.</p>
    <label>UUID del lote<input bind:value={loteId} autocomplete="off" maxlength="36" required /></label>
    <label>Identificador del animal / arete (opcional)<input bind:value={identificadorAnimal} maxlength="64" /></label>
    <button type="button" class="secondary" onclick={() => void consultarResumen()} disabled={consultando}>{consultando ? 'Consultando…' : 'Consultar estimaciones guardadas'}</button>
  </section>

  <section class="panel">
    <h2>2. Foto de perfil y puntos</h2>
    <p class="muted">Coloca una regla o vara de longitud conocida junto al animal y en el mismo plano. Marca en la foto hombro, nalga, cruz, pecho inferior y los dos extremos de la referencia.</p>
    <label>Foto PNG o JPEG<input type="file" accept="image/png,image/jpeg" onchange={seleccionarImagen} disabled={cargandoImagen} /></label>
    {#if cargandoImagen}<p role="status">Comprimiendo foto en este dispositivo…</p>{/if}
    {#if imagenPreview}
      <label>Próximo punto a marcar<select bind:value={objetivo}>{#each objetivos as item (item.value)}<option value={item.value}>{item.label}</option>{/each}</select></label>
      <div class="relative max-w-3xl mx-auto cursor-crosshair" onpointerdown={marcarPunto} role="application" aria-label="Foto. Selecciona un punto y haz clic para marcar sus coordenadas">
        <img bind:this={imagenEl} src={imagenPreview} alt="Foto de perfil del animal preparada para marcar medidas" class="block w-full h-auto" />
        {#each objetivos as item (item.value)}
          {#if puntos[item.value]}
            {@const point = puntos[item.value] ?? ([0, 0] as PuntoPx)}
            <span class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-600 px-1.5 py-0.5 text-xs" style={`left: ${(point[0] / anchoImagen) * 100}%; top: ${(point[1] / altoImagen) * 100}%`} aria-label={item.label}>{item.label}</span>
          {/if}
        {/each}
      </div>
      <ul class="text-sm">{#each objetivos as item (item.value)}<li>{item.label}: {#if puntos[item.value]}{puntos[item.value]?.[0]}, {puntos[item.value]?.[1]} px{:else}pendiente{/if}</li>{/each}</ul>
      <label>Distancia real entre los puntos de referencia (cm)<input type="number" min="0.1" step="0.1" bind:value={distanciaReferencia} required /></label>
    {/if}
  </section>

  <section class="panel">
    <h2>3. Solicitar estimación a la API</h2>
    {#if $session.status !== 'authenticated'}<p>Para enviar la foto, <a href="/acceso">inicia sesión</a>.</p>
    {:else if $session.role !== 'VENDEDOR'}<p>Selecciona en <a href="/contexto">Contexto</a> una organización donde tengas rol VENDEDOR.</p>
    {:else}
      <form onsubmit={enviarEstimacion}>
        <p>Se enviará una sola foto y sus coordenadas a la API. No se calculará un peso si el satélite no está disponible; en ese caso se mostrará el error real.</p>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if mensaje}<p class="notice" role="status">{mensaje}</p>{/if}
        <button type="submit" disabled={enviando || cargandoImagen}>{enviando ? 'Consultando satélite…' : 'Solicitar estimación real'}</button>
      </form>
    {/if}
    <p class="muted">Advertencia: el resultado es orientativo, no es un pesaje ni una medición validada en campo. La precisión del método requiere contrastarlo con básculas.</p>
  </section>

  {#if resumen}
    <section class="panel" aria-labelledby="summary-title">
      <h2 id="summary-title">Resumen guardado en PostgreSQL</h2>
      <p>{resumen.numero_estimaciones} estimación(es) · total central {resumen.peso_total_estimado_kg.toFixed(1)} kg · rango conservador {resumen.rango_total_conservador_kg[0].toFixed(1)}–{resumen.rango_total_conservador_kg[1].toFixed(1)} kg.</p>
      <p class="muted">{resumen.advertencia}</p>
      <div class="grid gap-3">{#each resumen.estimaciones as estimacion (estimacion.id)}
        <article class="panel">
          <h3>{estimacion.identificador_animal || 'Animal sin arete registrado'}</h3>
          <p>{estimacion.peso_estimado_kg.toFixed(1)} kg · intervalo {estimacion.rango_min_kg.toFixed(1)}–{estimacion.rango_max_kg.toFixed(1)} kg · confianza {Math.round(estimacion.nivel_confianza * 100)} % · {estimacion.numero_vistas} vista(s).</p>
          <p class="muted">Método {estimacion.metodo} · versión {estimacion.version_parametros} · {estimacion.tiene_pesaje ? 'tiene pesaje de balanza' : 'sin pesaje de balanza'}.</p>
          {#if estimacion.advertencias.length}<ul>{#each estimacion.advertencias as item (item)}<li>{item}</li>{/each}</ul>{/if}
        </article>
      {/each}</div>
    </section>
  {/if}
</section>
