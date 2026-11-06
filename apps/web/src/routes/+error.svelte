<script lang="ts">import { page } from '$app/state';</script>
<section class="page narrow"><p class="eyebrow">No se pudo abrir la página</p><h1>{page.status}</h1><p role="alert">{page.error?.message || 'Ocurrió un error inesperado.'}</p><a class="button" href="/">Volver al inicio</a></section>
