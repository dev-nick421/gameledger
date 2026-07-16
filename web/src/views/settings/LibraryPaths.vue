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
    <h2 class="mb-1 text-lg font-semibold">Library paths</h2>
    <p class="mb-4 text-sm text-gray-500">
      Absolute paths the scanner reads from. Processed games are stored back into
      these folders.
    </p>

    <ul class="mb-3 space-y-2">
      <li
        v-for="lib in libraries"
        :key="lib.id"
        class="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-shelf-elevated"
      >
        <span class="truncate font-mono">{{ lib.path }}</span>
        <button class="inline-flex shrink-0 items-center gap-1 text-red-500 hover:underline" @click="removeLibrary(lib.id)" title="Remove">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </li>
      <li v-if="!libraries.length" class="text-sm text-gray-400">No library paths configured.</li>
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
    <p v-if="error" class="mt-2 text-sm text-red-500">{{ error }}</p>
  </section>
</template>
