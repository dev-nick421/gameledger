<script setup>
import { ref } from 'vue';
import client from '../../api/client.js';
import { useSettingsStore } from '../../stores/settings.js';

// Providers (issue #8): IGDB supplies metadata + matching; SteamGridDB
// supplements/replaces cover & background art. Either can be configured on
// its own, or both at once each card below manages its provider independently.
const settings = useSettingsStore();

const igdbForm = ref({ clientId: '', clientSecret: '' });
const igdbTestResult = ref(null);
const igdbMessage = ref(null);

async function saveIgdb() {
  igdbMessage.value = null;
  const payload = {};
  if (igdbForm.value.clientId) payload.igdbClientId = igdbForm.value.clientId;
  if (igdbForm.value.clientSecret) payload.igdbClientSecret = igdbForm.value.clientSecret;
  if (!Object.keys(payload).length) return;
  await settings.save(payload);
  igdbForm.value = { clientId: '', clientSecret: '' };
  igdbMessage.value = 'Credentials saved.';
}

async function testIgdb() {
  igdbTestResult.value = { loading: true };
  try {
    // The test endpoint reads saved settings, so persist the form first.
    if (igdbForm.value.clientId || igdbForm.value.clientSecret) await saveIgdb();
    const { data } = await client.post('/settings/test-igdb');
    igdbTestResult.value = { ok: true, text: `Connected sample: ${data.sample}` };
  } catch (err) {
    igdbTestResult.value = { ok: false, text: err.response?.data?.error || 'Connection failed' };
  }
}

const steamgridForm = ref({ apiKey: '' });
const steamgridTestResult = ref(null);
const steamgridMessage = ref(null);

async function saveSteamgrid() {
  steamgridMessage.value = null;
  if (!steamgridForm.value.apiKey) return;
  await settings.save({ steamgridApiKey: steamgridForm.value.apiKey });
  steamgridForm.value = { apiKey: '' };
  steamgridMessage.value = 'API key saved.';
}

async function testSteamgrid() {
  steamgridTestResult.value = { loading: true };
  try {
    if (steamgridForm.value.apiKey) await saveSteamgrid();
    const { data } = await client.post('/settings/test-steamgrid');
    steamgridTestResult.value = { ok: true, text: `Connected sample: ${data.sample}` };
  } catch (err) {
    steamgridTestResult.value = { ok: false, text: err.response?.data?.error || 'Connection failed' };
  }
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- IGDB: metadata + matching -->
    <section class="card p-5">
      <h2 class="mb-1 text-lg font-semibold">IGDB</h2>
      <p class="mb-4 text-sm text-gray-500">
        Status:
        <span :class="settings.igdbConfigured ? 'text-emerald-500' : 'text-amber-500'">
          {{ settings.igdbConfigured ? 'Configured' : 'Not configured' }}
        </span>
      </p>
      <p class="mb-4 text-xs text-gray-400">
        Powers title matching and metadata (summary, genres, platforms, rating, trailer).
      </p>

      <div class="grid gap-3">
        <input v-model="igdbForm.clientId" class="input" placeholder="Client ID" />
        <input v-model="igdbForm.clientSecret" type="password" class="input" placeholder="Client Secret" />
      </div>

      <p
        v-if="igdbMessage"
        class="mt-3 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
      >
        {{ igdbMessage }}
      </p>

      <div class="mt-4 flex items-center gap-2">
        <button class="btn-primary" @click="saveIgdb">Save</button>
        <button class="btn-ghost" @click="testIgdb">Test connection</button>
        <span
          v-if="igdbTestResult && !igdbTestResult.loading"
          :class="igdbTestResult.ok ? 'text-emerald-500' : 'text-red-500'"
          class="text-sm"
        >
          {{ igdbTestResult.text }}
        </span>
      </div>

      <p class="mt-4 text-xs text-gray-400">
        Obtain credentials from
        <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener" class="underline">dev.twitch.tv</a>.
      </p>
    </section>

    <!-- SteamGridDB: art only, independent of IGDB -->
    <section class="card p-5">
      <h2 class="mb-1 text-lg font-semibold">SteamGridDB</h2>
      <p class="mb-4 text-sm text-gray-500">
        Status:
        <span :class="settings.steamgridConfigured ? 'text-emerald-500' : 'text-amber-500'">
          {{ settings.steamgridConfigured ? 'Configured' : 'Not configured' }}
        </span>
      </p>
      <p class="mb-4 text-xs text-gray-400">
        Optional cover & background art source. Used automatically whenever IGDB
        has no art for a title works alongside IGDB or on its own.
      </p>

      <input v-model="steamgridForm.apiKey" type="password" class="input" placeholder="API key" />

      <p
        v-if="steamgridMessage"
        class="mt-3 rounded-lg bg-emerald-100 p-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400"
      >
        {{ steamgridMessage }}
      </p>

      <div class="mt-4 flex items-center gap-2">
        <button class="btn-primary" @click="saveSteamgrid">Save</button>
        <button class="btn-ghost" @click="testSteamgrid">Test connection</button>
        <span
          v-if="steamgridTestResult && !steamgridTestResult.loading"
          :class="steamgridTestResult.ok ? 'text-emerald-500' : 'text-red-500'"
          class="text-sm"
        >
          {{ steamgridTestResult.text }}
        </span>
      </div>

      <p class="mt-4 text-xs text-gray-400">
        Obtain an API key from
        <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noopener" class="underline">steamgriddb.com</a>.
      </p>
    </section>
  </div>
</template>
