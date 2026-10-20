<script setup>
import { reactive, computed, onMounted } from 'vue';
import client from '../../api/client.js';
import { useSettingsStore } from '../../stores/settings.js';
import { useToastStore } from '../../stores/toast.js';

// Metadata providers: IGDB and SteamGridDB, usable on their own or together.
const settings = useSettingsStore();
const toast = useToastStore();

const PROVIDERS = [
  {
    id: 'igdb',
    name: 'IGDB',
    initials: 'IG',
    tile: 'from-violet-500 to-fuchsia-500',
    blurb:
      'The Internet Game Database (by Twitch). The most complete source: summaries, genres, platforms, ratings, screenshots and trailers, plus artwork.',
    provides: ['Details', 'Artwork', 'Screenshots', 'Trailers'],
    fields: [
      { key: 'igdbClientId', label: 'Client ID', type: 'text', autocomplete: 'off' },
      { key: 'igdbClientSecret', label: 'Client secret', type: 'password', autocomplete: 'new-password' },
    ],
    envVars: 'IGDB_CLIENT_ID / IGDB_CLIENT_SECRET',
    help: { href: 'https://dev.twitch.tv/console/apps', text: 'Register an app on dev.twitch.tv to get a client ID and secret.' },
    testPath: '/settings/test-igdb',
    configured: () => settings.igdbConfigured,
    source: () => settings.igdbSource,
  },
  {
    id: 'steamgrid',
    name: 'SteamGridDB',
    initials: 'SG',
    tile: 'from-sky-500 to-indigo-500',
    blurb:
      'Community-made covers and hero art. Works without IGDB (title, release year and artwork only), or alongside it to supply the artwork.',
    provides: ['Artwork', 'Title & year'],
    fields: [{ key: 'steamGridDbApiKey', label: 'API key', type: 'password', autocomplete: 'new-password' }],
    envVars: 'STEAMGRIDDB_API_KEY',
    help: { href: 'https://www.steamgriddb.com/profile/preferences/api', text: 'Generate an API key in your SteamGridDB preferences.' },
    testPath: '/settings/test-steamgrid',
    configured: () => settings.steamGridConfigured,
    source: () => settings.steamGridSource,
  },
];

// Per-provider form + request state.
const state = reactive(
  Object.fromEntries(
    PROVIDERS.map((p) => [p.id, { form: Object.fromEntries(p.fields.map((f) => [f.key, ''])), busy: null, result: null }]),
  ),
);

const mode = computed(() => {
  const igdb = settings.igdbConfigured;
  const sgdb = settings.steamGridConfigured;
  if (igdb && sgdb) return { tone: 'ok', text: 'Using both: IGDB supplies the details, SteamGridDB the cover and hero art (with IGDB art as the fallback).' };
  if (igdb) return { tone: 'ok', text: 'Using IGDB for details and artwork.' };
  if (sgdb) return { tone: 'info', text: 'Using SteamGridDB for titles, release years and artwork. Add IGDB as well for summaries, genres, platforms, screenshots and trailers.' };
  return { tone: 'warn', text: 'No provider is set up yet. Scans can’t match games until you add at least one.' };
});

function placeholder(p) {
  if (p.source() === 'environment') return 'Set in .env (enter a value to override)';
  if (p.source() === 'settings') return 'Saved (enter a new value to replace)';
  return '';
}

function hasInput(p) {
  return p.fields.some((f) => state[p.id].form[f.key].trim());
}

async function save(p, { quiet = false } = {}) {
  const payload = {};
  for (const f of p.fields) {
    const value = state[p.id].form[f.key].trim();
    if (value) payload[f.key] = value;
  }
  if (!Object.keys(payload).length) return;
  state[p.id].busy = 'save';
  state[p.id].result = null;
  try {
    await settings.save(payload);
    for (const f of p.fields) state[p.id].form[f.key] = '';
    if (!quiet) toast.push(`${p.name} credentials saved.`, 'ok');
  } catch (err) {
    state[p.id].result = { ok: false, text: err.response?.data?.error || 'Failed to save.' };
    throw err;
  } finally {
    state[p.id].busy = null;
  }
}

async function test(p) {
  try {
    // The probe reads saved settings, so persist whatever was typed first.
    if (hasInput(p)) await save(p, { quiet: true });
  } catch {
    return;
  }
  state[p.id].busy = 'test';
  state[p.id].result = null;
  try {
    const { data } = await client.post(p.testPath);
    state[p.id].result = { ok: true, text: data.sample ? `Connected. Found “${data.sample}”.` : 'Connected.' };
  } catch (err) {
    state[p.id].result = { ok: false, text: err.response?.data?.error || 'Connection failed.' };
  } finally {
    state[p.id].busy = null;
  }
}

async function remove(p) {
  if (!window.confirm(`Remove the ${p.name} credentials saved here?`)) return;
  state[p.id].busy = 'remove';
  try {
    await settings.save(Object.fromEntries(p.fields.map((f) => [f.key, ''])));
    state[p.id].result = null;
    toast.push(`${p.name} credentials removed.`, 'info');
  } catch {
    toast.push(`Failed to remove the ${p.name} credentials.`, 'error');
  } finally {
    state[p.id].busy = null;
  }
}

onMounted(() => {
  if (!settings.loaded) settings.load();
});
</script>

<template>
  <div class="space-y-4">
    <section class="card p-5">
      <h2 class="section-title">Metadata providers</h2>
      <p class="section-desc">
        Where GameLedger looks up each game’s details and artwork. Use either one, or both together.
      </p>
      <div
        class="mt-4 flex items-start gap-2.5 rounded-lg p-3 text-sm"
        :class="{
          'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300': mode.tone === 'ok',
          'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300': mode.tone === 'info',
          'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300': mode.tone === 'warn',
        }"
      >
        <svg class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        <span>{{ mode.text }}</span>
      </div>
    </section>

    <section v-for="p in PROVIDERS" :key="p.id" class="card overflow-hidden">
      <div class="flex flex-wrap items-start gap-4 p-5">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm" :class="p.tile">
          {{ p.initials }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold">{{ p.name }}</h3>
            <span
              v-if="p.configured()"
              class="badge bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
              Connected
            </span>
            <span v-else class="badge bg-gray-500/10 text-gray-500 dark:text-gray-400">
              <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
              Not configured
            </span>
            <span
              v-if="p.source() === 'environment'"
              v-tooltip="`Read from ${p.envVars}. Credentials saved here take precedence.`"
              class="badge cursor-help bg-violet-500/10 text-violet-600 dark:text-violet-300"
              tabindex="0"
            >
              from .env
            </span>
          </div>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ p.blurb }}</p>
          <div class="mt-2.5 flex flex-wrap gap-1.5">
            <span v-for="item in p.provides" :key="item" class="badge bg-gray-100 font-medium text-gray-600 dark:bg-shelf-elevated dark:text-gray-300">{{ item }}</span>
          </div>
        </div>
      </div>

      <form class="border-t border-gray-100 bg-gray-50/60 p-5 dark:border-shelf-border/70 dark:bg-black/10" autocomplete="off" @submit.prevent="save(p)">
        <div class="grid gap-3" :class="p.fields.length > 1 ? 'sm:grid-cols-2' : ''">
          <div v-for="f in p.fields" :key="f.key">
            <label class="label" :for="`${p.id}-${f.key}`">{{ f.label }}</label>
            <input
              :id="`${p.id}-${f.key}`"
              v-model="state[p.id].form[f.key]"
              :type="f.type"
              class="input font-mono placeholder:font-sans"
              :autocomplete="f.autocomplete"
              :placeholder="placeholder(p)"
            />
          </div>
        </div>

        <p
          v-if="state[p.id].result"
          class="mt-3 flex items-center gap-1.5 text-sm"
          :class="state[p.id].result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
          role="status"
        >
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline v-if="state[p.id].result.ok" points="20 6 9 17 4 12" />
            <template v-else><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></template>
          </svg>
          {{ state[p.id].result.text }}
        </p>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button type="submit" class="btn-primary" :disabled="!hasInput(p) || !!state[p.id].busy">
            {{ state[p.id].busy === 'save' ? 'Saving…' : 'Save' }}
          </button>
          <button type="button" class="btn-ghost" :disabled="(!p.configured() && !hasInput(p)) || !!state[p.id].busy" @click="test(p)">
            {{ state[p.id].busy === 'test' ? 'Testing…' : 'Test connection' }}
          </button>
          <button
            v-if="p.source() === 'settings'"
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            :disabled="!!state[p.id].busy"
            @click="remove(p)"
          >
            Remove
          </button>
        </div>

        <p class="mt-4 text-xs text-gray-500 dark:text-gray-400">
          {{ p.help.text }}
          <a :href="p.help.href" target="_blank" rel="noopener noreferrer" class="font-medium text-shelf-accent hover:underline">Open ↗</a>
          <br />
          Can also be set with <code class="rounded bg-gray-200/70 px-1 py-0.5 text-[11px] dark:bg-shelf-elevated">{{ p.envVars }}</code> in your <code class="rounded bg-gray-200/70 px-1 py-0.5 text-[11px] dark:bg-shelf-elevated">.env</code>.
        </p>
      </form>
    </section>
  </div>
</template>
