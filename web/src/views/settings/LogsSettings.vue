<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import client from '../../api/client.js';

// Audit log viewer
const logs = ref([]);
const total = ref(0);
const loading = ref(false);
const sourceFilter = ref('');
const error = ref(null);

const SOURCES = [
  { value: '', label: 'All' },
  { value: 'user', label: 'User' },
  { value: 'scheduler', label: 'Scheduler' },
  { value: 'system', label: 'System' },
];

const SOURCE_STYLES = {
  user: 'bg-shelf-accent/15 text-shelf-accent',
  scheduler: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  system: 'bg-gray-500/15 text-gray-600 dark:text-gray-300',
  scanner: 'bg-gray-500/15 text-gray-600 dark:text-gray-300',
};

const LEVEL_STYLES = {
  info: 'text-gray-700 dark:text-gray-200',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const params = { limit: 200 };
    if (sourceFilter.value) params.source = sourceFilter.value;
    const { data } = await client.get('/logs', { params });
    logs.value = data.items;
    total.value = data.total;
  } catch {
    error.value = 'Failed to load logs.';
  } finally {
    loading.value = false;
  }
}

async function clearLogs() {
  if (!window.confirm('Clear the entire audit log? This cannot be undone.')) return;
  try {
    await client.delete('/logs');
    await load();
  } catch {
    error.value = 'Failed to clear logs.';
  }
}

let poll = null;
onMounted(() => {
  load();
  // Light auto-refresh so live scheduler/scan activity shows without a manual reload.
  poll = setInterval(load, 5000);
});
onUnmounted(() => clearInterval(poll));
</script>

<template>
  <section class="card p-5">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Logs
        </h2>
        <p class="mt-1 text-sm text-gray-500">{{ total }} entr{{ total === 1 ? 'y' : 'ies' }}</p>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="sourceFilter" class="input !w-auto py-1.5 text-sm" @change="load">
          <option v-for="s in SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
        <button class="btn-ghost text-sm" @click="load" title="Refresh">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        <button class="btn-ghost text-sm text-red-500" @click="clearLogs">Clear</button>
      </div>
    </div>

    <p v-if="error" class="mb-3 rounded-lg bg-red-100 p-2 text-sm text-red-700">{{ error }}</p>

    <div v-if="loading && !logs.length" class="py-10 text-center text-sm text-gray-400">Loading…</div>
    <div v-else-if="!logs.length" class="py-10 text-center text-sm text-gray-400">No log entries yet.</div>

    <div v-else class="overflow-hidden rounded-lg border border-gray-100 dark:border-shelf-border">
      <div
        v-for="log in logs"
        :key="log.id"
        class="flex items-start gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-0 dark:border-shelf-border"
      >
        <span class="w-32 shrink-0 font-mono text-xs text-gray-400">{{ fmtTime(log.createdAt) }}</span>
        <span
          class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide"
          :class="SOURCE_STYLES[log.source] || SOURCE_STYLES.system"
        >
          {{ log.source }}
        </span>
        <span class="min-w-0 flex-1 break-words" :class="LEVEL_STYLES[log.level] || LEVEL_STYLES.info">
          {{ log.message }}
        </span>
      </div>
    </div>
  </section>
</template>
