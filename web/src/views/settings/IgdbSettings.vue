<script setup>
import { ref } from 'vue';
import client from '../../api/client.js';
import { useSettingsStore } from '../../stores/settings.js';

const settings = useSettingsStore();
const form = ref({ clientId: '', clientSecret: '' });
const testResult = ref(null);
const message = ref(null);

async function save() {
  message.value = null;
  const payload = {};
  if (form.value.clientId) payload.igdbClientId = form.value.clientId;
  if (form.value.clientSecret) payload.igdbClientSecret = form.value.clientSecret;
  if (!Object.keys(payload).length) return;
  await settings.save(payload);
  form.value = { clientId: '', clientSecret: '' };
  message.value = 'Credentials saved.';
}

async function testIgdb() {
  testResult.value = { loading: true };
  try {
    // The test endpoint reads saved settings, so persist the form first.
    if (form.value.clientId || form.value.clientSecret) await save();
    const { data } = await client.post('/settings/test-igdb');
    testResult.value = { ok: true, text: `Connected sample: ${data.sample}` };
  } catch (err) {
    testResult.value = { ok: false, text: err.response?.data?.error || 'Connection failed' };
  }
}
</script>

<template>
  <section class="card p-5">
    <h2 class="mb-1 text-lg font-semibold">IGDB credentials</h2>
    <p class="mb-4 text-sm text-gray-500">
      Status:
      <span :class="settings.igdbConfigured ? 'text-emerald-500' : 'text-amber-500'">
        {{ settings.igdbConfigured ? 'Configured' : 'Not configured' }}
      </span>
    </p>

    <div class="grid gap-3 sm:grid-cols-2">
      <input v-model="form.clientId" class="input" placeholder="Client ID" />
      <input v-model="form.clientSecret" type="password" class="input" placeholder="Client Secret" />
    </div>

    <p
      v-if="message"
      class="mt-3 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
    >
      {{ message }}
    </p>

    <div class="mt-4 flex items-center gap-2">
      <button class="btn-primary" @click="save">Save</button>
      <button class="btn-ghost" @click="testIgdb">Test connection</button>
      <span
        v-if="testResult && !testResult.loading"
        :class="testResult.ok ? 'text-emerald-500' : 'text-red-500'"
        class="text-sm"
      >
        {{ testResult.text }}
      </span>
    </div>

    <p class="mt-4 text-xs text-gray-400">
      Obtain credentials from
      <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener" class="underline">dev.twitch.tv</a>.
    </p>
  </section>
</template>
