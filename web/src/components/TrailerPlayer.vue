<script setup>
import { ref } from 'vue';

// Click-to-play YouTube embed. Nothing is requested from YouTube until the
// viewer presses play (the poster is the game's own locally cached artwork),
// so opening a game page stays private and fast. Uses the privacy-enhanced
// youtube-nocookie.com domain once playing.
const props = defineProps({
  videoId: { type: String, required: true },
  poster: { type: String, default: null },
  title: { type: String, default: 'Trailer' },
});

const playing = ref(false);
const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(props.videoId)}?autoplay=1&rel=0&modestbranding=1`;

function play() {
  playing.value = true;
}

defineExpose({ play });
</script>

<template>
  <div class="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-black/10 dark:ring-white/5">
    <iframe
      v-if="playing"
      class="absolute inset-0 h-full w-full"
      :src="embedUrl"
      :title="title"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
    <button
      v-else
      class="group absolute inset-0 flex h-full w-full items-center justify-center focus:outline-none"
      :aria-label="`Play ${title}`"
      @click="play"
    >
      <img v-if="poster" :src="poster" alt="" class="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-[1.02] group-hover:opacity-80" />
      <span class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20"></span>
      <span class="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-xl transition group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-shelf-accent/60">
        <svg class="ml-1 h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" /></svg>
      </span>
      <span class="absolute bottom-3 left-4 text-sm font-medium text-white/90 drop-shadow">Plays from YouTube</span>
    </button>
  </div>
</template>
