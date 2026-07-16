<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import client from '../api/client.js';
import ScreenshotCarousel from '../components/ScreenshotCarousel.vue';

const route = useRoute();
const game = ref(null);
const loading = ref(true);
const notFound = ref(false);

async function load() {
  loading.value = true;
  notFound.value = false;
  try {
    const { data } = await client.get(`/games/${route.params.igdbId}`);
    game.value = data;
  } catch (err) {
    if (err.response?.status === 404) notFound.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => route.params.igdbId, load);

// Hero gradient derived from accent colours extracted at scan time.
const heroStyle = computed(() => {
  if (!game.value) return {};
  const a = game.value.accentColorPrimary || '#1c2330';
  const b = game.value.accentColorSecondary || '#0b0e14';
  return { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` };
});

const downloadUrl = computed(() =>
  game.value ? `/api/games/${game.value.igdbId}/download` : '#',
);
</script>

<template>
  <div v-if="loading" class="py-20 text-center text-gray-400">Loading…</div>

  <div v-else-if="notFound" class="card p-10 text-center">
    <p class="text-lg font-medium">Game not found</p>
    <RouterLink :to="{ name: 'library' }" class="mt-2 inline-block text-shelf-accent underline">
      Back to library
    </RouterLink>
  </div>

  <div v-else-if="game">
    <!-- Hero -->
    <section class="relative -mx-4 -mt-6 overflow-hidden sm:-mx-6">
      <div
        v-if="game.backgroundUrl"
        class="absolute inset-0 bg-cover bg-center opacity-30"
        :style="{ backgroundImage: `url(${game.backgroundUrl})` }"
      ></div>
      <div class="absolute inset-0" :style="heroStyle" :class="{ 'opacity-80': game.backgroundUrl }"></div>

      <div class="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:px-6">
        <img
          v-if="game.coverUrl"
          :src="game.coverUrl"
          :alt="game.title"
          class="mx-auto w-40 rounded-xl shadow-2xl sm:mx-0 sm:w-52"
        />
        <div class="flex flex-1 flex-col justify-end text-white">
          <h1 class="text-3xl font-bold drop-shadow sm:text-4xl">{{ game.title }}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-white/90">
            <span v-if="game.releaseYear">{{ game.releaseYear }}</span>
            <span v-if="game.rating" class="badge bg-white/20">★ {{ game.rating }}</span>
            <span v-for="g in game.genres" :key="g" class="badge bg-white/15">{{ g }}</span>
          </div>
          <a :href="downloadUrl" class="btn-primary mt-5 w-fit text-base" download>⬇ Download</a>
        </div>
      </div>
    </section>

    <div class="mt-8 grid gap-8 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <h2 class="mb-2 text-lg font-semibold">About</h2>
        <p class="whitespace-pre-line leading-relaxed text-gray-700 dark:text-gray-300">
          {{ game.summary || 'No description available.' }}
        </p>

        <div class="mt-8">
          <ScreenshotCarousel :shots="game.screenshots" />
        </div>
      </div>

      <aside class="card h-fit space-y-3 p-4 text-sm">
        <div>
          <p class="text-gray-500">Platforms</p>
          <p>{{ game.platforms?.length ? game.platforms.join(', ') : '—' }}</p>
        </div>
        <div>
          <p class="text-gray-500">Genres</p>
          <p>{{ game.genres?.length ? game.genres.join(', ') : '—' }}</p>
        </div>
        <div>
          <p class="text-gray-500">IGDB rating</p>
          <p>{{ game.rating ?? '—' }}</p>
        </div>
        <div>
          <p class="text-gray-500">Download filename</p>
          <p class="break-all font-mono text-xs">{{ game.displayName }}.zip</p>
        </div>
      </aside>
    </div>
  </div>
</template>
