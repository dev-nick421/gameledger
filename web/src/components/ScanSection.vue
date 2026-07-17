<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import client from '../api/client.js';
import { useJobsStore } from '../stores/jobs.js';

// Library scanning, embedded as a section of the Settings page
const jobsStore = useJobsStore();
const queue = ref({ running: [], pending: [], failed: [], completed: [], isRunning: false });
const toast = ref(null);

// Live per-job progress comes from the app-level WebSocket via the store.
const liveJobs = computed(() => Object.values(jobsStore.live));

async function loadQueue() {
  const { data } = await client.get('/queue');
  queue.value = data;
}

function showToast(text, kind = 'info') {
  toast.value = { text, kind };
  setTimeout(() => (toast.value = null), 3500);
}

async function startScan() {
  try {
    await client.post('/scan');
    showToast('Scan started.', 'ok');
    await loadQueue();
  } catch (err) {
    if (err.response?.status === 409) showToast('Scan already in progress.', 'warn');
    else showToast('Failed to start scan.', 'warn');
  }
}

async function cancelScan() {
  try {
    const { data } = await client.delete('/queue');
    showToast(`Cancelled ${data.cancelled} job${data.cancelled === 1 ? '' : 's'}.`, 'ok');
    jobsStore.clear();
    await loadQueue();
  } catch {
    showToast('Failed to cancel the scan.', 'warn');
  }
}

const refreshing = ref(false);
async function refreshLibrary() {
  refreshing.value = true;
  try {
    const { data } = await client.post('/library/refresh');
    showToast(
      data.removed
        ? `Removed ${data.removed} missing game${data.removed === 1 ? '' : 's'} from the library.`
        : 'Library is already in sync with disk.',
      'ok',
    );
  } catch {
    showToast('Failed to refresh the library.', 'warn');
  } finally {
    refreshing.value = false;
  }
}

async function retry(jobId) {
  try {
    await client.post(`/queue/${jobId}/retry`);
    showToast('Retrying job…', 'ok');
  } catch (err) {
    if (err.response?.status === 409) showToast('Scan already in progress.', 'warn');
  }
}

async function clearFailed(jobId) {
  try {
    await client.delete(`/queue/${jobId}`);
    showToast('Cleared.', 'ok');
    await loadQueue();
  } catch {
    showToast('Failed to clear the job.', 'warn');
  }
}

// Refresh queue counts whenever a job event arrives.
let refreshTimer = null;
watch(
  () => jobsStore.live,
  () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadQueue, 500);
  },
  { deep: true },
);

onMounted(loadQueue);
</script>

<template>
  <section class="card p-5">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Library scanning</h2>
      <div class="flex gap-2">
        <button
          v-if="queue.running.length || queue.pending.length"
          class="btn-ghost text-sm"
          @click="cancelScan"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Cancel scan
        </button>
        <button class="btn-primary" @click="startScan">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="7" y1="12" x2="17" y2="12" />
          </svg>
          Scan Library
        </button>
      </div>
    </div>

    <div
      v-if="toast"
      class="mb-3 rounded-lg p-3 text-sm"
      :class="{
        'bg-emerald-100 text-emerald-800': toast.kind === 'ok',
        'bg-amber-100 text-amber-800': toast.kind === 'warn',
        'bg-gray-100 text-gray-800': toast.kind === 'info',
      }"
    >
      {{ toast.text }}
    </div>

    <!-- Live progress (persists across navigation via jobs store) -->
    <div v-if="liveJobs.length === 0" class="text-sm text-gray-400">
      No active jobs. Trigger a scan to see real-time progress.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="text-left text-gray-500">
        <tr>
          <th class="py-1">Game</th>
          <th>Stage</th>
          <th>Progress</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="job in liveJobs"
          :key="job.jobId"
          class="border-t border-gray-100 dark:border-shelf-border"
        >
          <td class="py-2">{{ job.sourceName }}</td>
          <td>{{ job.stage }}</td>
          <td>
            <div class="flex items-center gap-2">
              <div class="h-2 w-32 overflow-hidden rounded-full bg-gray-200 dark:bg-shelf-elevated">
                <div
                  class="h-full bg-shelf-accent transition-all"
                  :style="{ width: `${job.progress || 0}%` }"
                ></div>
              </div>
              <span class="text-xs text-gray-500">{{ job.progress || 0 }}%</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Queue -->
    <div class="mt-5 grid gap-4 sm:grid-cols-3">
      <div>
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Running ({{ queue.running.length }})
        </h3>
        <p v-if="!queue.running.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-1 text-sm">
          <li v-for="j in queue.running" :key="j.id">{{ j.sourceName }} {{ j.stage }}</li>
        </ul>
      </div>
      <div>
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
          Pending ({{ queue.pending.length }})
        </h3>
        <p v-if="!queue.pending.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-1 text-sm">
          <li v-for="j in queue.pending" :key="j.id">{{ j.sourceName }}</li>
        </ul>
      </div>
      <div>
        <h3 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <svg class="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Failed ({{ queue.failed.length }})
        </h3>
        <p v-if="!queue.failed.length" class="text-xs text-gray-400">None</p>
        <ul class="space-y-2 text-sm">
          <li v-for="j in queue.failed" :key="j.id" class="flex items-center justify-between gap-2">
            <span class="min-w-0 flex-1 truncate" :title="j.error">{{ j.sourceName }}</span>
            <span class="flex shrink-0 items-center gap-2">
              <button class="inline-flex items-center gap-1 text-shelf-accent hover:underline" @click="retry(j.id)">
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Retry
              </button>
              <button
                class="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                title="Clear this failed entry"
                aria-label="Clear failed entry"
                @click="clearFailed(j.id)"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <!-- Refresh: reconcile the catalogue with what's actually on disk -->
  <section class="card mt-4 p-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh library
        </h2>
        <p class="mt-1 text-sm text-gray-500">
          Sync the library with disk. Games whose files were deleted from the
          library folder are removed from the catalogue.
        </p>
      </div>
      <button class="btn-ghost shrink-0" :disabled="refreshing" @click="refreshLibrary">
        {{ refreshing ? 'Refreshing…' : 'Refresh library' }}
      </button>
    </div>
  </section>
</template>
