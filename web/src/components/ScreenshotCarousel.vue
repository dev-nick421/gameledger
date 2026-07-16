<script setup>
import { ref } from 'vue';

defineProps({ shots: { type: Array, default: () => [] } });
const fullscreen = ref(null);
</script>

<template>
  <div v-if="shots.length">
    <h2 class="mb-3 text-lg font-semibold">Screenshots</h2>
    <div class="flex gap-3 overflow-x-auto pb-2">
      <img
        v-for="(src, i) in shots"
        :key="i"
        :src="src"
        class="h-40 cursor-pointer rounded-lg object-cover transition hover:opacity-90"
        loading="lazy"
        @click="fullscreen = src"
      />
    </div>

    <div
      v-if="fullscreen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      @click="fullscreen = null"
    >
      <img :src="fullscreen" class="max-h-full max-w-full rounded-lg" />
    </div>
  </div>
</template>
