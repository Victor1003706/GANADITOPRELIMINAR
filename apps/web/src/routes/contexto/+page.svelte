<script lang="ts">
  import { session, type Membership } from '#lib/session.ts';
  import { switchContext } from '#lib/auth.ts';
  let busy = $state(false);
  let error = $state('');
  async function select(membership: Membership) {
    if (busy) return;
    busy = true; error = '';
    try { await switchContext(membership); }
    catch (err) { error = err instanceof Error ? err.message : 'No se pudo cambiar de organización.'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Organización activa | Ganadito</title></svelte:head>
<section class="page narrow">
  <p class="eyebrow">Acceso y organización</p><h1>Tu contexto de trabajo</h1>
  {#if $session.status === 'checking'}<p role="status">Validando la sesión con el servidor…</p>
  {:else if $session.status !== 'authenticated'}<div class="panel"><p>Inicia sesión para consultar tus organizaciones.</p><a class="button" href="/acceso">Iniciar sesión</a></div>
  {:else}
    <div class="panel"><h2>{$session.user?.nombre}</h2><p>{$session.user?.email}</p><p>Organización activa: <strong>{$session.context?.razon_social || 'Sin organización activa'}</strong></p><p>Rol activo: <strong>{$session.role || 'Sin rol activo'}</strong></p></div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <h2>Organizaciones y roles disponibles</h2>
    {#if $session.memberships.length === 0}<p class="notice">No tienes membresías disponibles. Solicita acceso al administrador de tu organización.</p>{/if}
    <div class="form-grid">
      {#each $session.memberships as membership (`${membership.organizacion_id}:${membership.rol}`)}
        <div class="panel context-card"><div><h3>{membership.razon_social}</h3><p class="muted">{membership.rol}</p></div>
          {#if membership.organizacion_id === $session.organizationId && membership.rol === $session.role}<span class="badge">Activo</span>
          {:else}<button disabled={busy} onclick={() => select(membership)}>Usar {membership.razon_social} como {membership.rol}</button>{/if}
        </div>
      {/each}
    </div>
    <p><a class="button" href="/subastas">Ir a subastas</a></p>
  {/if}
</section>
