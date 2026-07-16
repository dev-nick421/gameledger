<script setup>
import { RouterView } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import ToastHost from './components/ToastHost.vue';
import { useJobsStore } from './stores/jobs.js';
import { useToastStore } from './stores/toast.js';
import { useJobEvents } from './composables/useJobEvents.js';

// Hold the WebSocket at the app root so scan progress survives page navigation.
const jobsStore = useJobsStore();
const toastStore = useToastStore();

// A scan run (manual or scheduled) previously finished in silence  nothing
// told the user it was done, new games just appeared on the next reload. This
// summary event fires once per run, everywhere in the app, not just the
// Settings page where the button lives.
function announceScan(summary) {
  const { found, adopted, completed, unmatched, failed, cancelled } = summary;
  if (cancelled) {
    toastStore.push('Scan cancelled.', 'warn');
    return;
  }
  if (found === 0 && adopted === 0) {
    toastStore.push('Scan complete: no new items found.', 'info');
    return;
  }
  const parts = [];
  if (completed) parts.push(`${completed} game${completed === 1 ? '' : 's'} added`);
  if (adopted) parts.push(`${adopted} existing folder${adopted === 1 ? '' : 's'} adopted`);
  if (unmatched) parts.push(`${unmatched} need${unmatched === 1 ? 's' : ''} review`);
  if (failed) parts.push(`${failed} failed`);
  toastStore.push(`Scan complete: ${parts.join(', ')}.`, failed ? 'warn' : 'ok');
}

useJobEvents(
  (event) => jobsStore.onJobEvent(event),
  (summary) => announceScan(summary),
);
</script>

<template>
  <div class="min-h-full">
    <AppHeader />
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <RouterView />
    </main>
    <ToastHost />
  </div>
</template>
