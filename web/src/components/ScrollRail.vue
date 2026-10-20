<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';

const props = defineProps({
  // Re-evaluate overflow when the underlying item count changes.
  itemKey: { type: [String, Number], default: 0 },
});

const track = ref(null);
const atStart = ref(true);
const atEnd = ref(true);

function update() {
  const el = track.value;
  if (!el) return;
  atStart.value = el.scrollLeft <= 1;
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
}

function scrollBy(dir) {
  const el = track.value;
  if (!el) return;
  el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
}

let ro;
onMounted(() => {
  update();
  ro = new ResizeObserver(update);
  if (track.value) ro.observe(track.value);
});
onUnmounted(() => ro?.disconnect());

// Items can load/relayout after mount; recheck once the DOM settles.
watch(
  () => props.itemKey,
  () => nextTick(update),
);
</script>

<template>
  <div class="group/rail relative">
    <!-- Left arrow -->
    <button
      v-show="!atStart"
      class="absolute left-0 top-0 z-10 flex h-full w-10 items-center justify-start bg-gradient-to-r from-gray-50 to-transparent opacity-0 transition group-hover/rail:opacity-100 dark:from-shelf-bg"
      aria-label="Scroll left"
      @click="scrollBy(-1)"
    >
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-md dark:bg-shelf-elevated dark:text-gray-100">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </span>
    </button>

    <div ref="track" class="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth pb-2" @scroll="update">
      <slot />
    </div>

    <!-- Right arrow -->
    <button
      v-show="!atEnd"
      class="absolute right-0 top-0 z-10 flex h-full w-10 items-center justify-end bg-gradient-to-l from-gray-50 to-transparent opacity-0 transition group-hover/rail:opacity-100 dark:from-shelf-bg"
      aria-label="Scroll right"
      @click="scrollBy(1)"
    >
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-md dark:bg-shelf-elevated dark:text-gray-100">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </span>
    </button>
  </div>
</template>
