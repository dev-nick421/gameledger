<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const password = ref('');
const error = ref(null);
const loading = ref(false);

async function submit() {
  loading.value = true;
  error.value = null;
  try {
    await auth.login(password.value);
    router.push(route.query.redirect || { name: 'settings-scanning' });
  } catch {
    error.value = 'Invalid password.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-16 max-w-sm">
    <div class="card p-6">
      <h1 class="mb-1 text-xl font-bold">Admin login</h1>
      <p class="mb-4 text-sm text-gray-500">Enter the admin password to manage your library.</p>
      <form @submit.prevent="submit">
        <input v-model="password" type="password" class="input mb-3" placeholder="Password" autofocus />
        <p v-if="error" class="mb-3 text-sm text-red-600">{{ error }}</p>
        <button class="btn-primary w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
