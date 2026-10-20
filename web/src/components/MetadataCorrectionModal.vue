<script setup>
import { ref, watch } from 'vue';
import client from '../api/client.js';
import { useEscape } from '../composables/useEscape.js';
import { useToastStore } from '../stores/toast.js';

const props = defineProps({
  game: { type: Object, required: true }, // { igdbId, title }
});
const emit = defineEmits(['close', 'corrected', 'edit-manually']);
useEscape(() => emit('close'));
const toast = useToastStore();

const PROVIDER_LABELS = { igdb: 'IGDB', steamgriddb: 'SteamGridDB' };

const query = ref(props.game.title || '');
const results = ref([]);
const selected = ref(null);
const searching = ref(false);
const saving = ref(false);
const error = ref(null);
// Set when the picked game is already in the library: this entry is a
// duplicate, and the user decides whether to merge it away.
const conflict = ref(null);

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
    const { data } = await client.get('/providers/search', { params: { q: query.value } });
    results.value = data;
  } catch (err) {
    error.value = err.response?.data?.error || 'Search failed. Is a metadata provider configured?';
  } finally {
    searching.value = false;
  }
}

async function confirm({ merge = false } = {}) {
  if (!selected.value) return;
  saving.value = true;
  error.value = null;
  try {
    const { data } = await client.patch(`/games/${props.game.igdbId}/match`, {
      new_igdb_id: selected.value.igdbId,
      merge,
    });
    if (data.merged) {
      toast.push(`Merged into “${data.title}”, which was already in your library.`, 'ok');
    }
    emit('corrected', selected.value.igdbId);
  } catch (err) {
    if (err.response?.data?.code === 'ALREADY_IN_LIBRARY') conflict.value = err.response.data;
    else error.value = err.response?.data?.error || 'Failed to apply the correction.';
  } finally {
    saving.value = false;
  }
}

watch(selected, () => {
  conflict.value = null;
});

// Search immediately on open with the existing title.
runSearch();
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="card my-auto flex max-h-[85vh] w-full max-w-2xl flex-col p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label="Fix metadata match">
      <div class="mb-1 flex items-center justify-between">
        <h2 class="text-lg font-semibold">Fix metadata match</h2>
        <button class="icon-btn -mr-2" aria-label="Close" @click="emit('close')">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Pick the right game for <span class="font-medium text-gray-700 dark:text-gray-200">{{ game.title }}</span>. Its metadata and artwork are fetched and the files are filed under the new name.
      </p>

      <div class="relative mb-3">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input v-model="query" class="input pl-9" placeholder="Search by title…" autofocus />
      </div>
      <p v-if="error" class="alert-error mb-2">{{ error }}</p>

      <div class="-mx-1 flex-1 overflow-y-auto px-1">
        <ul v-if="searching" class="space-y-2" aria-hidden="true">
          <li v-for="n in 4" :key="n" class="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-shelf-border">
            <div class="skeleton h-16 w-12"></div>
            <div class="flex-1 space-y-2"><div class="skeleton h-4 w-1/2"></div><div class="skeleton h-3 w-1/4"></div></div>
          </li>
        </ul>
        <ul v-else class="space-y-2">
          <li v-for="r in results" :key="r.igdbId">
            <button
              class="flex w-full items-center gap-3 rounded-lg border p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent/50"
              :class="selected?.igdbId === r.igdbId
                ? 'border-shelf-accent bg-shelf-accent/10'
                : 'border-gray-200 hover:border-shelf-accent/60 hover:bg-gray-50 dark:border-shelf-border dark:hover:bg-shelf-elevated'"
              :aria-pressed="selected?.igdbId === r.igdbId"
              @click="selected = r"
            >
              <img v-if="r.coverUrl" :src="r.coverUrl" alt="" class="h-16 w-12 rounded-md object-cover" />
              <div v-else class="h-16 w-12 rounded-md bg-gray-200 dark:bg-shelf-elevated"></div>
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ r.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ r.releaseYear || 'Unknown year' }} · {{ PROVIDER_LABELS[r.provider] ?? 'IGDB' }} #{{ r.providerId ?? r.igdbId }}
                </p>
              </div>
              <svg v-if="selected?.igdbId === r.igdbId" class="mr-1 h-5 w-5 shrink-0 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </button>
          </li>
        </ul>
        <p v-if="!searching && results.length === 0" class="py-8 text-center text-sm text-gray-400">
          No results. Try a shorter or different title.
        </p>
      </div>

      <div v-if="conflict" class="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
        <p class="font-medium">“{{ conflict.existing.title }}” is already in your library.</p>
        <p class="mt-1">
          This entry is a second copy. Merging removes it<template v-if="conflict.duplicatePath"> and deletes its folder
          <code class="break-all rounded bg-amber-100 px-1 dark:bg-black/30">{{ conflict.duplicatePath }}</code></template>.
          The game already in your library is not touched.
        </p>
        <div class="mt-3 flex justify-end gap-2">
          <button class="btn-ghost !py-1.5" @click="conflict = null">Keep both</button>
          <button class="btn-primary !py-1.5" :disabled="saving" @click="confirm({ merge: true })">
            {{ saving ? 'Merging…' : 'Merge' }}
          </button>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 dark:border-shelf-border">
        <button class="text-sm font-medium text-gray-500 transition hover:text-gray-900 dark:hover:text-gray-100" @click="emit('edit-manually')">
          Can't find it? Enter details by hand
        </button>
        <div class="flex gap-2">
          <button class="btn-ghost" @click="emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="!selected || saving || !!conflict" @click="confirm()">
            {{ saving ? 'Applying…' : 'Confirm match' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
