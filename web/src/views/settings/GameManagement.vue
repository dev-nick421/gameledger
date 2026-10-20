<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import client from '../../api/client.js';
import GameFormModal from '../../components/GameFormModal.vue';
import { useMetadataRefreshStore } from '../../stores/metadataRefresh.js';
import { useToastStore } from '../../stores/toast.js';
import { useEscape } from '../../composables/useEscape.js';

// Game Management (CRUD)
const games = ref([]);
const loading = ref(true);
const error = ref(null);
const search = ref('');
const editing = ref(null); // game row being edited
const creating = ref(false);

const metadataRefreshStore = useMetadataRefreshStore();
const toast = useToastStore();
const showRefreshModal = ref(false);
const refreshMode = ref('missing');
useEscape(() => {
  showRefreshModal.value = false;
});

// What each status means, shown on hover so nobody has to guess.
const STATUS_INFO = {
  Completed: { tone: 'emerald', help: 'Processed and ready to download.' },
  Unmatched: {
    tone: 'amber',
    help: 'No confident metadata match was found. The original folder is kept untouched; edit the game (or fix its match from the library) to package it.',
  },
  Failed: { tone: 'red', help: 'Processing failed. Retry it from Settings → Scanning.' },
};
const IN_PROGRESS = { tone: 'accent', help: 'Being processed by the current scan.' };
const TONES = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  accent: 'bg-shelf-accent/10 text-shelf-accent',
};
const statusInfo = (status) => STATUS_INFO[status] ?? IN_PROGRESS;

const SOURCES = {
  igdb: { label: 'IGDB', help: 'Details and artwork come from IGDB.' },
  steamgriddb: { label: 'SteamGridDB', help: 'Matched through SteamGridDB: title, year and artwork only.' },
  custom: { label: 'Custom', help: 'Added by hand. Metadata refreshes never change it.' },
  none: { label: '—', help: 'Not matched to a provider yet. Fix the match from the library, or edit it to add details by hand.' },
};
const sourceInfo = (g) => (g.custom ? SOURCES.custom : SOURCES[g.provider] ?? SOURCES.none);

const COLUMN_HELP = {
  game: 'Title as shown in the library. Badges flag hand-added games and missing details.',
  year: 'Release year.',
  source: 'Where the game’s details and artwork come from.',
  status: 'Processing state. Hover a status to see what it means.',
  downloads: 'Completed downloads. Resuming a download doesn’t count twice.',
};

function missingHelp(g) {
  return `Missing: ${g.missingFields.join(', ')}.\n“Refresh metadata” can fill these in from your providers, or edit the game to add them by hand.`;
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return games.value;
  return games.value.filter((g) => g.title.toLowerCase().includes(q));
});

// Games "Fill in missing metadata" would actually touch (blank fields or no
// trailer yet).
const refreshCount = computed(() => games.value.filter((g) => g.needsRefresh).length);

async function load() {
  try {
    const { data } = await client.get('/games/manage');
    games.value = data.items;
    error.value = null;
  } catch {
    error.value = 'Failed to load games.';
  } finally {
    loading.value = false;
  }
}

function onSaved() {
  editing.value = null;
  creating.value = false;
  load();
}

async function remove(game) {
  if (!window.confirm(`Delete "${game.title}"? This removes its files and cannot be undone.`)) return;
  try {
    await client.delete(`/games/${game.igdbId}`);
    toast.push(`Deleted “${game.title}”.`, 'info');
    await load();
  } catch {
    toast.push('Failed to delete the game.', 'error');
  }
}

// Bulk metadata refresh
async function startRefresh() {
  try {
    await client.post('/games/refresh-metadata', { mode: refreshMode.value });
    metadataRefreshStore.start();
    showRefreshModal.value = false;
  } catch (err) {
    toast.push(
      err.response?.status === 409
        ? 'A metadata refresh is already in progress.'
        : 'Failed to start the metadata refresh.',
      err.response?.status === 409 ? 'warn' : 'error',
    );
  }
}

// Reload the table once a refresh run this page kicked off (or one triggered
// elsewhere, e.g. a scheduled run) finishes, so corrected titles/artwork show up.
watch(
  () => metadataRefreshStore.lastSummary,
  (summary) => {
    if (summary) load();
  },
);

onMounted(load);
</script>

<template>
  <section class="card p-5">
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="section-title">Manage games</h2>
        <p class="section-desc">{{ games.length }} game{{ games.length === 1 ? '' : 's' }} in the catalogue</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-tooltip="'Fill in blanks or re-fetch everything from your metadata providers'"
          class="btn-ghost"
          :disabled="metadataRefreshStore.running"
          @click="showRefreshModal = true"
        >
          <svg class="h-4 w-4" :class="{ 'animate-spin': metadataRefreshStore.running }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          Refresh metadata
        </button>
        <button class="btn-primary" @click="creating = true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add custom game
        </button>
      </div>
    </div>

    <div v-if="metadataRefreshStore.running" class="mb-4 rounded-lg bg-shelf-accent/10 p-3 text-sm text-shelf-accent" role="status">
      <div class="flex items-center justify-between gap-3">
        <span class="font-medium">Refreshing metadata…</span>
        <span v-if="metadataRefreshStore.total" class="text-xs">{{ metadataRefreshStore.done }} / {{ metadataRefreshStore.total }}</span>
      </div>
      <div v-if="metadataRefreshStore.total" class="mt-2 h-1.5 overflow-hidden rounded-full bg-shelf-accent/15">
        <div class="h-full rounded-full bg-shelf-accent transition-all" :style="{ width: `${(metadataRefreshStore.done / metadataRefreshStore.total) * 100}%` }"></div>
      </div>
    </div>

    <div class="relative mb-4">
      <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input v-model="search" type="search" class="input pl-9" placeholder="Search by title…" aria-label="Search games" />
    </div>

    <p v-if="error" class="alert-error mb-3">{{ error }}</p>

    <div v-if="loading" class="space-y-3" aria-hidden="true">
      <div v-for="n in 5" :key="n" class="flex items-center gap-3">
        <div class="skeleton h-10 w-7"></div>
        <div class="skeleton h-4 flex-1"></div>
        <div class="skeleton h-4 w-16"></div>
      </div>
    </div>
    <div v-else-if="!filtered.length" class="py-10 text-center text-sm text-gray-400">
      {{ search ? 'No games match your search.' : 'No games yet. Run a scan or add one by hand.' }}
    </div>

    <div v-else class="relative -mx-5 overflow-x-auto">
      <table class="w-full min-w-[640px] text-sm">
        <thead class="text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <tr class="border-b border-gray-100 dark:border-shelf-border">
            <th class="py-2.5 pl-5 pr-2"><span v-tooltip="COLUMN_HELP.game" class="cursor-help underline decoration-dotted underline-offset-4" tabindex="0">Game</span></th>
            <th class="px-2"><span v-tooltip="COLUMN_HELP.year" class="cursor-help underline decoration-dotted underline-offset-4" tabindex="0">Year</span></th>
            <th class="px-2"><span v-tooltip="COLUMN_HELP.source" class="cursor-help underline decoration-dotted underline-offset-4" tabindex="0">Source</span></th>
            <th class="px-2"><span v-tooltip="COLUMN_HELP.status" class="cursor-help underline decoration-dotted underline-offset-4" tabindex="0">Status</span></th>
            <th class="px-2 text-right"><span v-tooltip="COLUMN_HELP.downloads" class="cursor-help underline decoration-dotted underline-offset-4" tabindex="0">Downloads</span></th>
            <th class="py-2.5 pl-2 pr-5 text-right"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in filtered"
            :key="g.igdbId"
            class="border-b border-gray-50 transition last:border-0 hover:bg-gray-50/70 dark:border-shelf-border/50 dark:hover:bg-shelf-elevated/40"
          >
            <td class="py-2.5 pl-5 pr-2">
              <div class="flex items-center gap-3">
                <img v-if="g.coverUrl" :src="g.coverUrl" alt="" class="h-11 w-8 shrink-0 rounded object-cover ring-1 ring-black/5 dark:ring-white/5" loading="lazy" />
                <div v-else class="h-11 w-8 shrink-0 rounded bg-gray-200 dark:bg-shelf-elevated"></div>
                <div class="min-w-0">
                  <p class="flex items-center gap-1.5 truncate font-medium">
                    {{ g.title }}
                    <svg v-if="g.hasTrailer" v-tooltip="'Has a trailer'" class="h-3.5 w-3.5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="currentColor" tabindex="0" aria-label="Has a trailer"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" /></svg>
                  </p>
                  <div v-if="g.custom || g.missingMetadata" class="mt-0.5 flex flex-wrap gap-1">
                    <span v-if="g.custom" v-tooltip="SOURCES.custom.help" class="badge cursor-help bg-shelf-accent/15 text-shelf-accent" tabindex="0">Custom</span>
                    <span v-if="g.missingMetadata" v-tooltip="missingHelp(g)" class="badge cursor-help bg-amber-500/10 text-amber-700 dark:text-amber-400" tabindex="0">Missing info</span>
                  </div>
                </div>
              </div>
            </td>
            <td class="px-2 tabular-nums text-gray-500 dark:text-gray-400">{{ g.releaseYear || '—' }}</td>
            <td class="px-2">
              <span v-tooltip="sourceInfo(g).help" class="cursor-help text-gray-500 dark:text-gray-400" tabindex="0">{{ sourceInfo(g).label }}</span>
            </td>
            <td class="px-2">
              <span v-tooltip="statusInfo(g.status).help" class="badge cursor-help" :class="TONES[statusInfo(g.status).tone]" tabindex="0">
                <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                {{ g.status }}
              </span>
            </td>
            <td class="px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{{ g.downloadCount }}</td>
            <td class="py-2.5 pl-2 pr-5">
              <div class="flex items-center justify-end gap-0.5">
                <button
                  v-tooltip="'Edit details, artwork and trailer'"
                  class="icon-btn !h-8 !w-8 hover:!text-shelf-accent"
                  :aria-label="`Edit ${g.title}`"
                  @click="editing = g"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
                <button
                  v-tooltip="'Delete the game and its files'"
                  class="icon-btn !h-8 !w-8 hover:!bg-red-500/10 hover:!text-red-600"
                  :aria-label="`Delete ${g.title}`"
                  @click="remove(g)"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <GameFormModal v-if="creating" :game="null" @close="creating = false" @saved="onSaved" />
  <GameFormModal v-if="editing" :game="editing" @close="editing = null" @saved="onSaved" />

  <div v-if="showRefreshModal" class="modal-backdrop" @click.self="showRefreshModal = false">
    <div class="card my-auto w-full max-w-md p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="Refresh metadata">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">Refresh metadata</h2>
        <button class="icon-btn -mr-2" aria-label="Close" @click="showRefreshModal = false">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <fieldset class="space-y-2">
        <legend class="sr-only">Mode</legend>
        <label
          v-for="m in [
            { value: 'missing', label: `Fill in missing metadata${refreshCount ? ` (${refreshCount})` : ''}`, help: 'Only fills blank fields (summary, genres, platforms, rating, artwork) and missing trailers. Anything already set is left alone.' },
            { value: 'all', label: 'Refresh all metadata', help: 'Re-fetches details and artwork for every game, overwriting what’s there now. A trailer you added by hand is kept if the provider has none.' },
          ]"
          :key="m.value"
          class="flex cursor-pointer gap-3 rounded-lg border p-3 transition"
          :class="refreshMode === m.value ? 'border-shelf-accent bg-shelf-accent/5' : 'border-gray-200 hover:border-gray-300 dark:border-shelf-border'"
        >
          <input v-model="refreshMode" type="radio" :value="m.value" class="mt-0.5 h-4 w-4 accent-[#e84bd0]" />
          <span>
            <span class="block text-sm font-medium">{{ m.label }}</span>
            <span class="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{{ m.help }}</span>
          </span>
        </label>
      </fieldset>

      <div class="mt-5 flex justify-end gap-3">
        <button class="btn-ghost" @click="showRefreshModal = false">Cancel</button>
        <button class="btn-primary" @click="startRefresh">Start refresh</button>
      </div>
    </div>
  </div>
</template>
