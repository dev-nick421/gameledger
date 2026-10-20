<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import AppLogo from '../components/AppLogo.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const password = ref('');
const reveal = ref(false);
const error = ref(null);
const loading = ref(false);

async function submit() {
  if (!password.value) return;
  loading.value = true;
  error.value = null;
  try {
    await auth.login(password.value);
    router.push(route.query.redirect || { name: 'settings-scanning' });
  } catch {
    error.value = 'That password didn’t work. Try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center py-10">
    <div class="mb-6 flex flex-col items-center text-center">
      <AppLogo class="!h-10" />
      <h1 class="mt-4 text-2xl font-bold tracking-tight">Admin login</h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to scan, organise and manage your library.</p>
    </div>
    <div class="card p-6 shadow-lg">
      <form @submit.prevent="submit">
        <label class="label" for="password">Password</label>
        <div class="relative">
          <input
            id="password"
            v-model="password"
            :type="reveal ? 'text' : 'password'"
            class="input pr-10"
            :class="{ '!border-red-400 focus:!ring-red-400/20': error }"
            autocomplete="current-password"
            autofocus
            :aria-invalid="Boolean(error)"
            aria-describedby="password-error"
          />
          <button
            type="button"
            class="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-400 transition hover:text-gray-700 dark:hover:text-gray-200"
            :aria-label="reveal ? 'Hide password' : 'Show password'"
            @click="reveal = !reveal"
          >
            <svg v-if="!reveal" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          </button>
        </div>
        <p id="password-error" class="mt-2 min-h-[1.25rem] text-sm text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        <button class="btn-primary mt-2 w-full !py-2.5" :disabled="loading || !password">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
    <p class="mt-4 text-center text-xs text-gray-400">The password is the <code>ADMIN_PASSWORD</code> from your <code>.env</code>.</p>
  </div>
</template>
