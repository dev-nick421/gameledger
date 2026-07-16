<script setup>
import { ref, onMounted } from 'vue';
import ScanSection from '../../components/ScanSection.vue';
import { useSettingsStore } from '../../stores/settings.js';

// Compression tuning -> default favours speed.
const settings = useSettingsStore();
const message = ref(null);
const error = ref(null);

const LEVELS = [
  { value: 0, label: 'Store no compression (fastest)' },
  { value: 1, label: 'Fastest (recommended)' },
  { value: 3, label: 'Fast' },
  { value: 6, label: 'Balanced' },
  { value: 9, label: 'Smallest (slowest)' },
];

onMounted(() => {
  if (!settings.loaded) settings.load();
});

async function save() {
  message.value = null;
  error.value = null;
  try {
    await settings.save({ compressionLevel: settings.compressionLevel });
    message.value = 'Compression settings saved.';
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to save.';
  }
}
</script>

<template>
  <ScanSection />

  <section class="card mt-4 p-5">
    <h2 class="flex items-center gap-2 text-lg font-semibold">
      <svg class="h-5 w-5 text-shelf-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><line x1="10" y1="12" x2="14" y2="12" />
      </svg>
      Compression
    </h2>
    <p class="mb-3 mt-1 text-sm text-gray-500">
      How hard to compress games when cataloguing them. Most game files are
      already compressed, so a lower level finishes much faster while barely
      affecting the archive size.
    </p>
    <select v-model.number="settings.compressionLevel" class="input max-w-md">
      <option v-for="l in LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
    </select>

    <div class="mt-4 flex items-center gap-3">
      <button class="btn-primary" @click="save">Save compression</button>
      <span v-if="message" class="text-sm text-emerald-600 dark:text-emerald-400">{{ message }}</span>
      <span v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</span>
    </div>
  </section>
</template>
