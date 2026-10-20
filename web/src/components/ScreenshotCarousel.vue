<script setup>
import { ref, watch, onUnmounted } from 'vue';

const props = defineProps({ shots: { type: Array, default: () => [] } });
const open = ref(null); // index of the screenshot shown full-screen

function show(i) {
  open.value = (i + props.shots.length) % props.shots.length;
}

function onKey(e) {
  if (open.value == null) return;
  if (e.key === 'Escape') open.value = null;
  else if (e.key === 'ArrowRight') show(open.value + 1);
  else if (e.key === 'ArrowLeft') show(open.value - 1);
}

watch(open, (i) => {
  if (i == null) window.removeEventListener('keydown', onKey);
  else window.addEventListener('keydown', onKey);
});
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="shots.length">
    <h2 class="section-title mb-3">
      Screenshots
      <span class="text-sm font-normal text-gray-400">{{ shots.length }}</span>
    </h2>
    <div class="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
      <button
        v-for="(src, i) in shots"
        :key="i"
        class="group shrink-0 snap-start overflow-hidden rounded-lg ring-1 ring-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent dark:ring-white/5"
        :aria-label="`Open screenshot ${i + 1}`"
        @click="show(i)"
      >
        <img :src="src" alt="" class="h-36 w-auto object-cover transition duration-300 group-hover:scale-105 sm:h-40" loading="lazy" />
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="open != null"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
        role="dialog"
        aria-label="Screenshot viewer"
        @click.self="open = null"
      >
        <img :src="shots[open]" alt="" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <span class="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">{{ open + 1 }} / {{ shots.length }}</span>
        <button class="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20" aria-label="Close" @click="open = null">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <template v-if="shots.length > 1">
          <button class="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20" aria-label="Previous screenshot" @click="show(open - 1)">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button class="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20" aria-label="Next screenshot" @click="show(open + 1)">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
