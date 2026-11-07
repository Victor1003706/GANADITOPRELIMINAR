<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { restoreSession, signOut } from '#lib/auth.ts';
  import { session } from '#lib/session.ts';
  import { demoHabilitada } from '#lib/config.ts';
  let { children }: { children?: import('svelte').Snippet } = $props();
  const esDemo = $derived(page.url.pathname === '/demostracion');
  onMount(() => { if (!demoHabilitada) void restoreSession().catch(() => {}); });
</script>
<svelte:head><title>Ganadito | Mercado ganadero</title><meta name="description" content="Consulta establecimientos, lotes y trazabilidad con información del servidor." /></svelte:head>
<div class="app-shell">
  <a class="skip-link" href="#contenido">Saltar al contenido</a>
  {#if !esDemo}<header class="site-header">
    <a class="brand" href="/"><span class="brand-mark">G</span><span>GANADITO<small>Mercado ganadero</small></span></a>
    <nav aria-label="Navegación principal">
      <a href="/">Mapa y Spot</a><a href="/distribuidores">Distribuidores</a>{#if demoHabilitada}<a href="/demostracion">Demo MVP</a>{/if}<a href="/subastas">Subastas</a><a href="/ordenes">Órdenes</a><a href="/trazabilidad">Trazabilidad</a><a href="/mayorista">Mayoristas</a><a href="/gmx">GMX</a><a href="/logistica">Logística</a><a href="/ia">Peso por IA</a>
    </nav>
    <div class="session-nav">
      {#if $session.status === 'authenticated'}
        <a href="/contexto">{$session.context?.razon_social || 'Seleccionar organización'}<small>{$session.role || 'Sin contexto activo'}</small></a>
        <button class="secondary" onclick={signOut}>Cerrar sesión</button>
      {:else if $session.status === 'checking'}
        <span role="status">Validando sesión…</span>
      {:else}<a class="button" href="/acceso">Iniciar sesión</a>{/if}
    </div>
  </header>
  {#if !esDemo && $session.message}<div class="notice" role="alert">{$session.message} <a href="/acceso">Ir al acceso</a></div>{/if}{/if}
  <main id="contenido">{@render children?.()}</main>
  {#if !esDemo}<footer class="site-footer"><span>GANADITO · Entorno de desarrollo</span><span>Pagos e integraciones externas no habilitados.</span></footer>{/if}
</div>
