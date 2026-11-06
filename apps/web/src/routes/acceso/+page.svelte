<script lang="ts">
  import { goto } from '$app/navigation';
  import { signIn, registerAccount, type RegistrationRole } from '#lib/auth.ts';
  import { session } from '#lib/session.ts';
  let creating = $state(false);
  let email = $state('');
  let password = $state('');
  let nombre = $state('');
  let organizacion = $state('');
  let registrationRole = $state<RegistrationRole>('COMPRADOR');
  let busy = $state(false);
  let error = $state('');
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true; error = '';
    try {
      if (creating) await registerAccount({ email: email.trim(), password, nombre: nombre.trim(), organizacion_nombre: organizacion.trim(), rol_inicial: registrationRole });
      else await signIn(email.trim(), password);
      password = '';
      await goto('/contexto');
    } catch (err) { error = err instanceof Error ? err.message : 'No se pudo iniciar sesión.'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Acceso | Ganadito</title></svelte:head>
<section class="page narrow">
  <p class="eyebrow">Tu espacio de trabajo</p>
  <h1>{creating ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
  <p class="muted">Accede con tu cuenta y confirma la organización con la que operarás.</p>
  {#if $session.status === 'authenticated'}<div class="notice">Ya tienes una sesión activa. <a href="/contexto">Revisar organización</a></div>{/if}
  <form class="panel form-grid" onsubmit={submit}>
    {#if creating}
      <label>Nombre<input bind:value={nombre} autocomplete="name" required maxlength="150" /></label>
      <label>Nombre de la organización<input bind:value={organizacion} autocomplete="organization" required maxlength="200" /></label>
      <label>Quiero operar como<select bind:value={registrationRole} required><option value="COMPRADOR">Comprador</option><option value="VENDEDOR">Vendedor</option></select></label>
    {/if}
    <label>Correo electrónico<input type="email" bind:value={email} autocomplete="username" required maxlength="254" /></label>
    <label>Contraseña<input type="password" bind:value={password} autocomplete={creating ? 'new-password' : 'current-password'} required minlength={creating ? 8 : 1} /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button disabled={busy || $session.status === 'checking'} type="submit">{busy ? 'Validando…' : creating ? 'Crear cuenta' : 'Entrar'}</button>
    <button type="button" class="secondary" disabled={busy} onclick={() => { creating = !creating; error = ''; password = ''; }}>{creating ? 'Ya tengo una cuenta' : 'Crear una cuenta'}</button>
  </form>
</section>
