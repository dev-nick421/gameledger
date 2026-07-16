<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import client from '../../api/client.js';
import GameFormModal from '../../components/GameFormModal.vue';
import { useMetadataRefreshStore } from '../../stores/metadataRefresh.js';

// Game Management (CRUD)
const games = ref([]);
const loading = ref(true);
const error = ref(null);
const search = ref('');
const editing = ref(null); // game row being edited
const creating = ref(false);

const metadataRefreshStore = useMetadataRefreshStore();
const showRefreshModal = ref(false);
const refreshMode = ref('missing');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return games.value;
  return games.value.filter((g) => g.title.toLowerCase().includes(q));
});

const missingCount = computed(() => games.value.filter((g) => g.missingMetadata).length);

async function load() {
  loading.value = true;
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
    await load();
  } catch {
    error.value = 'Failed to delete game.';
  }
}

// Bulk metadata refresh
async function startRefresh() {
  try {
    await client.post('/games/refresh-metadata', { mode: refreshMode.value });
    metadataRefreshStore.start();
    error.value = null;
    showRefreshModal.value = false;
  } catch (err) {
    error.value =
      err.response?.status === 409
        ? 'A metadata refresh is already in progress.'
        : 'Failed to start the metadata refresh.';
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
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Manage games</h2>
        <p class="mt-1 text-sm text-gray-500">{{ games.length }} game{{ games.length === 1 ? '' : 's' }} in the catalogue</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-ghost text-sm" :disabled="metadataRefreshStore.running" @click="showRefreshModal = true">
          Refresh metadata
        </button>
        <button class="btn-primary" @click="creating = true">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add custom game
        </button>
      </div>
    </div>

    <p v-if="metadataRefreshStore.running" class="mb-3 rounded-lg bg-shelf-accent/10 p-2 text-sm text-shelf-accent">
      Refreshing metadata…
      <template v-if="metadataRefreshStore.total">{{ metadataRefreshStore.done }} / {{ metadataRefreshStore.total }}</template>
    </p>

    <input v-model="search" class="input mb-4" placeholder="Search by title…" />

    <p v-if="error" class="mb-3 rounded-lg bg-red-100 p-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

    <div v-if="loading" class="py-10 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="!filtered.length" class="py-10 text-center text-sm text-gray-400">No games found.</div>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-gray-500">
          <tr class="border-b border-gray-100 dark:border-shelf-border">
            <th class="py-2 pr-2">Game</th>
            <th class="px-2">Year</th>
            <th class="px-2">Status</th>
            <th class="px-2">Downloads</th>
            <th class="px-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in filtered"
            :key="g.igdbId"
            class="border-b border-gray-50 last:border-0 dark:border-shelf-border/50"
          >
            <td class="py-2 pr-2">
              <div class="flex items-center gap-2.5">
                <img v-if="g.coverUrl" :src="g.coverUrl" class="h-10 w-7 shrink-0 rounded object-cover" />
                <div v-else class="h-10 w-7 shrink-0 rounded bg-gray-200 dark:bg-shelf-elevated"></div>
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ g.title }}</p>
                  <span v-if="g.custom" class="badge bg-shelf-accent/15 text-shelf-accent">Custom</span>
                  <span v-if="g.missingMetadata" class="badge bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">Missing info</span>
                </div>
              </div>
            </td>
            <td class="px-2 text-gray-500">{{ g.releaseYear || '—' }}</td>
            <td class="px-2">
              <span class="text-gray-500">{{ g.status }}</span>
            </td>
            <td class="px-2 text-gray-500">{{ g.downloadCount }}</td>
            <td class="px-2">
              <div class="flex items-center justify-end gap-1">
                <button
                  class="rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-shelf-accent dark:hover:bg-shelf-elevated"
                  title="Edit"
                  @click="editing = g"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                </button>
                <button
                  class="rounded-lg p-1.5 text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  title="Delete"
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

  <div v-if="showRefreshModal" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" @click.self="showRefreshModal = false">
    <div class="card my-8 w-full max-w-sm p-6">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">Refresh metadata</h2>
        <button class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-shelf-elevated" @click="showRefreshModal = false">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <label class="mb-1 block text-sm text-gray-500">Mode</label>
      <select v-model="refreshMode" class="input mb-3">
        <option value="missing">Fill in missing metadata{{ missingCount ? ` (${missingCount})` : '' }}</option>
        <option value="all">Refresh all metadata</option>
      </select>

      <p class="mb-5 text-xs text-gray-400">
        {{ refreshMode === 'all'
          ? "Re-fetches metadata and artwork for every game from IGDB, overwriting what's there now."
          : "Only fills in blank fields (summary, genres, platforms, rating, artwork) from IGDB; anything already set is left untouched." }}
      </p>

      <div class="flex justify-end gap-3">
        <button class="btn-ghost" @click="showRefreshModal = false">Cancel</button>
        <button class="btn-primary" @click="startRefresh">Start</button>
      </div>
    </div>
  </div>
</template>
