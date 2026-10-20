<script setup>
import { ref, onMounted } from 'vue';
import client from '../../api/client.js';

const libraries = ref([]);
const newPath = ref('');
const error = ref(null);

async function load() {
  const { data } = await client.get('/libraries');
  libraries.value = data;
}

async function addLibrary() {
  if (!newPath.value) return;
  error.value = null;
  try {
    const { data } = await client.post('/libraries', { path: newPath.value });
    libraries.value.push(data);
    newPath.value = '';
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to add path.';
  }
}

async function removeLibrary(id) {
  await client.delete(`/libraries/${id}`);
  libraries.value = libraries.value.filter((l) => l.id !== id);
}

onMounted(load);
</script>

<template>
  <section class="card p-5">
    <h2 class="section-title">Library paths</h2>
    <p class="section-desc mb-4">
      Absolute paths the scanner reads from. Processed games are stored back into
      these folders.
    </p>

    <ul class="mb-3 space-y-2">
      <li
        v-for="lib in libraries"
        :key="lib.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-3 pr-1.5 text-sm dark:border-shelf-border dark:bg-shelf-elevated"
      >
        <span class="flex min-w-0 items-center gap-2">
          <svg class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          <span class="truncate font-mono">{{ lib.path }}</span>
        </span>
        <button v-tooltip="'Stop scanning this folder (files stay on disk)'" class="icon-btn !h-8 !w-8 hover:!bg-red-500/10 hover:!text-red-600" :aria-label="`Remove ${lib.path}`" @click="removeLibrary(lib.id)">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </li>
      <li v-if="!libraries.length" class="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400 dark:border-shelf-border">
        No library paths yet. Add the folder that holds your games; in Docker that’s <code class="font-mono">/games</code>.
      </li>
    </ul>

    <div class="flex gap-2">
      <input v-model="newPath" class="input" placeholder="/games" @keyup.enter="addLibrary" />
      <button class="btn-ghost shrink-0" @click="addLibrary">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add
      </button>
    </div>
    <p v-if="error" class="alert-error mt-3">{{ error }}</p>
  </section>
</template>
