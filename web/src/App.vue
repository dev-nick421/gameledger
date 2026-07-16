<script setup>
import { RouterView } from 'vue-router';
import AppHeader from './components/AppHeader.vue';
import { useJobsStore } from './stores/jobs.js';
import { useJobEvents } from './composables/useJobEvents.js';

// Hold the WebSocket at the app root so scan progress survives page navigation.
const jobsStore = useJobsStore();
useJobEvents((event) => jobsStore.onJobEvent(event));
</script>

<template>
  <div class="min-h-full">
    <AppHeader />
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <RouterView />
    </main>
  </div>
</template>
