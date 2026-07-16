<script setup>
import { ref, watch } from 'vue';
import client from '../api/client.js';

const props = defineProps({
  game: { type: Object, required: true }, // { igdbId, title }
});
const emit = defineEmits(['close', 'corrected', 'edit-manually']);

const query = ref(props.game.title || '');
const results = ref([]);
const selected = ref(null);
const searching = ref(false);
const saving = ref(false);
const error = ref(null);

let debounce = null;
watch(query, (q) => {
  clearTimeout(debounce);
  if (!q || q.length < 2) {
    results.value = [];
    return;
  }
  debounce = setTimeout(runSearch, 300);
});

async function runSearch() {
  searching.value = true;
  error.value = null;
  try {
    const { data } = await client.get('/igdb/search', { params: { q: query.value } });
    results.value = data;
  } catch (err) {
    error.value = err.response?.data?.error || 'Search failed. Is IGDB configured?';
  } finally {
    searching.value = false;
  }
}

async function confirm() {
  if (!selected.value) return;
  saving.value = true;
  error.value = null;
  try {
    await client.patch(`/games/${props.game.igdbId}/match`, {
      new_igdb_id: selected.value.igdbId,
    });
    emit('corrected', selected.value.igdbId);
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to apply the correction.';
  } finally {
    saving.value = false;
  }
}

// Search immediately on open with the existing title.
runSearch();
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" @click.self="emit('close')">
    <div class="card flex max-h-[85vh] w-full max-w-2xl flex-col p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-bold">Fix metadata match</h2>
        <button class="btn-ghost" @click="emit('close')">✕</button>
      </div>

      <input v-model="query" class="input mb-3" placeholder="Search IGDB…" autofocus />
      <p v-if="error" class="mb-2 rounded bg-red-100 p-2 text-sm text-red-700">{{ error }}</p>

      <div class="flex-1 overflow-y-auto">
        <p v-if="searching" class="py-6 text-center text-sm text-gray-400">Searching…</p>
        <ul v-else class="space-y-2">
          <li
            v-for="r in results"
            :key="r.igdbId"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition"
            :class="selected?.igdbId === r.igdbId
              ? 'border-shelf-accent bg-shelf-accent/10'
              : 'border-gray-200 hover:border-shelf-accent dark:border-shelf-border'"
            @click="selected = r"
          >
            <img v-if="r.coverUrl" :src="r.coverUrl" class="h-16 w-12 rounded object-cover" />
            <div v-else class="h-16 w-12 rounded bg-gray-200 dark:bg-shelf-elevated"></div>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ r.name }}</p>
              <p class="text-xs text-gray-500">{{ r.releaseYear || '—' }} · IGDB {{ r.igdbId }}</p>
            </div>
          </li>
        </ul>
        <p v-if="!searching && results.length === 0" class="py-6 text-center text-sm text-gray-400">
          No results.
        </p>
      </div>

      <div class="mt-4 flex items-center justify-between gap-2">
        <button class="btn-ghost text-sm" @click="emit('edit-manually')">Edit manually</button>
        <div class="flex gap-2">
          <button class="btn-ghost" @click="emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="!selected || saving" @click="confirm">
            {{ saving ? 'Applying…' : 'Confirm match' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
