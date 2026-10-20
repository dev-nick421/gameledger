<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import client from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';
import ScreenshotCarousel from '../components/ScreenshotCarousel.vue';
import TrailerPlayer from '../components/TrailerPlayer.vue';
import GameFormModal from '../components/GameFormModal.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const game = ref(null);
const loading = ref(true);
const notFound = ref(false);
const editing = ref(false);
const trailerSection = ref(null);
const player = ref(null);

async function load() {
  loading.value = !game.value || String(game.value.igdbId) !== String(route.params.igdbId);
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
  const a = game.value.accentColorPrimary || '#3a2438';
  const b = game.value.accentColorSecondary || '#150e16';
  return { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` };
});

const downloadUrl = computed(() => (game.value ? `/api/games/${game.value.igdbId}/download` : '#'));

// Searching YouTube opens the YouTube app on phones that have it installed.
const youtubeSearchUrl = computed(() =>
  game.value
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${game.value.title} trailer`)}`
    : '#',
);

const PROVIDER_LABELS = { igdb: 'IGDB', steamgriddb: 'SteamGridDB', custom: 'Added by hand' };

async function watchTrailer() {
  trailerSection.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await nextTick();
  player.value?.play();
}

// Back to wherever the user came from (keeps their library filters), or the
// library when the page was opened directly.
function goBack() {
  if (window.history.state?.back) router.back();
  else router.push({ name: 'library' });
}

function onSaved() {
  editing.value = false;
  load();
}
</script>

<template>
  <div v-if="loading" aria-hidden="true">
    <div class="skeleton -mt-6 ml-[calc(50%-50vw)] h-80 w-screen !rounded-none"></div>
    <div class="mt-8 grid gap-8 lg:grid-cols-3">
      <div class="space-y-3 lg:col-span-2">
        <div class="skeleton h-5 w-24"></div>
        <div class="skeleton h-4 w-full"></div>
        <div class="skeleton h-4 w-11/12"></div>
        <div class="skeleton h-4 w-4/5"></div>
      </div>
      <div class="skeleton h-48 !rounded-xl"></div>
    </div>
  </div>

  <div v-else-if="notFound" class="card mx-auto mt-10 max-w-md p-10 text-center">
    <p class="text-lg font-semibold">Game not found</p>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">It may have been removed from the library.</p>
    <RouterLink :to="{ name: 'library' }" class="btn-ghost mt-5">Back to library</RouterLink>
  </div>

  <div v-else-if="game">
    <!-- Hero -->
    <!-- Full-bleed: breaks out of the centred content column to the viewport edges. -->
    <section class="relative -mt-6 ml-[calc(50%-50vw)] w-screen overflow-hidden">
      <div
        v-if="game.backgroundUrl"
        class="absolute inset-0 bg-cover bg-center"
        :style="{ backgroundImage: `url(${game.backgroundUrl})` }"
      ></div>
      <div class="absolute inset-0" :style="heroStyle" :class="{ 'opacity-50 mix-blend-multiply': game.backgroundUrl }"></div>
      <div class="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-black/10"></div>
      <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30"></div>
      <div class="absolute inset-x-0 bottom-0 hidden h-16 bg-gradient-to-t from-shelf-bg to-transparent dark:block"></div>

      <div class="relative mx-auto max-w-7xl px-4 pb-8 pt-4 sm:px-6 sm:pb-10">
        <button
          class="mb-6 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-white/80 transition hover:text-white"
          @click="goBack"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          Library
        </button>

        <div class="flex flex-col gap-6 sm:flex-row sm:items-end">
          <img
            v-if="game.coverUrl"
            :src="game.coverUrl"
            :alt="game.title"
            class="mx-auto w-40 rounded-xl shadow-2xl ring-1 ring-white/10 sm:mx-0 sm:w-52"
          />
          <div class="flex flex-1 flex-col text-white">
            <h1 class="text-3xl font-bold tracking-tight drop-shadow sm:text-5xl">{{ game.title }}</h1>
            <div class="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/90">
              <span v-if="game.releaseYear" class="font-medium">{{ game.releaseYear }}</span>
              <span v-if="game.releaseYear && game.rating" class="text-white/40">•</span>
              <span v-if="game.rating" class="inline-flex items-center gap-1 font-medium">
                <svg class="h-4 w-4 text-amber-300" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></svg>
                {{ game.rating }}
              </span>
              <span v-for="g in game.genres" :key="g" class="badge bg-white/15 font-medium backdrop-blur">{{ g }}</span>
            </div>

            <div class="mt-6 flex flex-wrap items-center gap-2">
              <a
                v-if="game.downloadable"
                :href="downloadUrl"
                class="btn-primary !px-5 !py-2.5 text-base"
                download
              >
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </a>
              <span v-else v-tooltip="'This game has no archive to download yet.'" class="btn cursor-not-allowed bg-white/10 !px-5 !py-2.5 text-base text-white/60" tabindex="0">
                Download unavailable
              </span>
              <button v-if="game.trailerYoutubeId" class="btn bg-white/15 !py-2.5 text-white backdrop-blur hover:bg-white/25" @click="watchTrailer">
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" /></svg>
                Watch trailer
              </button>
              <a
                v-tooltip="'Search for trailers and gameplay on YouTube'"
                :href="youtubeSearchUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn bg-white/15 !py-2.5 text-white backdrop-blur hover:bg-white/25"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" /></svg>
                YouTube
              </a>
              <button
                v-if="auth.isAuthenticated"
                v-tooltip="'Edit details, artwork and trailer'"
                class="icon-btn !h-11 !w-11 bg-white/10 !text-white backdrop-blur hover:!bg-white/20"
                aria-label="Edit game"
                @click="editing = true"
              >
                <svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="mt-8 grid gap-8 lg:grid-cols-3">
      <div class="min-w-0 space-y-10 lg:col-span-2">
        <section>
          <h2 class="section-title mb-2">About</h2>
          <p class="whitespace-pre-line leading-relaxed text-gray-700 dark:text-gray-300">
            {{ game.summary || 'No description available.' }}
          </p>
        </section>

        <section v-if="game.trailerYoutubeId" ref="trailerSection">
          <h2 class="section-title mb-3">Trailer</h2>
          <TrailerPlayer
            ref="player"
            :video-id="game.trailerYoutubeId"
            :poster="game.backgroundUrl || game.coverUrl"
            :title="`${game.title} trailer`"
          />
        </section>

        <ScreenshotCarousel :shots="game.screenshots" />
      </div>

      <aside class="card h-fit divide-y divide-gray-100 text-sm dark:divide-shelf-border/70">
        <h2 class="px-5 py-3.5 text-sm font-semibold">Details</h2>
        <dl class="space-y-4 px-5 py-4">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Released</dt>
            <dd class="mt-1">{{ game.releaseYear ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Rating</dt>
            <dd class="mt-1">
              <template v-if="game.rating != null">
                <span class="font-medium">{{ game.rating }}</span><span class="text-gray-400"> / 100</span>
                <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-shelf-elevated">
                  <div class="h-full rounded-full bg-gradient-to-r from-[#e84bd0] to-[#9b5cf6]" :style="{ width: `${game.rating}%` }"></div>
                </div>
              </template>
              <template v-else>—</template>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Platforms</dt>
            <dd class="mt-1.5 flex flex-wrap gap-1.5">
              <span v-for="p in game.platforms" :key="p" class="badge bg-gray-100 font-medium text-gray-700 dark:bg-shelf-elevated dark:text-gray-200">{{ p }}</span>
              <span v-if="!game.platforms?.length">—</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Genres</dt>
            <dd class="mt-1.5 flex flex-wrap gap-1.5">
              <span v-for="g in game.genres" :key="g" class="badge bg-gray-100 font-medium text-gray-700 dark:bg-shelf-elevated dark:text-gray-200">{{ g }}</span>
              <span v-if="!game.genres?.length">—</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Metadata</dt>
            <dd class="mt-1">
              {{ PROVIDER_LABELS[game.provider] ?? 'Unknown' }}<span v-if="game.providerId" class="text-gray-400"> · #{{ game.providerId }}</span>
            </dd>
          </div>
          <div v-if="game.downloadable">
            <dt class="text-xs font-medium uppercase tracking-wide text-gray-400">Download filename</dt>
            <dd class="mt-1 break-all font-mono text-xs text-gray-600 dark:text-gray-300">{{ game.displayName }}.zip</dd>
          </div>
        </dl>
      </aside>
    </div>

    <GameFormModal
      v-if="editing"
      :game="{ igdbId: game.igdbId, title: game.title, status: game.status, custom: game.custom, coverUrl: game.coverUrl }"
      @close="editing = false"
      @saved="onSaved"
    />
  </div>
</template>
