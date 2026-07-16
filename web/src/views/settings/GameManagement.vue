<script setup>
import { ref, onMounted, computed } from 'vue';
import client from '../../api/client.js';
import GameFormModal from '../../components/GameFormModal.vue';

// Game Management (CRUD)
const games = ref([]);
const loading = ref(true);
const error = ref(null);
const search = ref('');
const editing = ref(null); // game row being edited
const creating = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return games.value;
  return games.value.filter((g) => g.title.toLowerCase().includes(q));
});

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

onMounted(load);
</script>

<template>
  <section class="card p-5">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Manage games</h2>
        <p class="mt-1 text-sm text-gray-500">{{ games.length }} game{{ games.length === 1 ? '' : 's' }} in the catalogue</p>
      </div>
      <button class="btn-primary" @click="creating = true">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Add custom game
      </button>
    </div>

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
</template>
