<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import client from '../api/client.js';

const props = defineProps({
  game: { type: Object, default: null },
});
const emit = defineEmits(['close', 'saved']);

const isEdit = !!props.game;
const isUnmatched = props.game?.status === 'Unmatched';
const saving = ref(false);
const error = ref(null);

const step = ref(isEdit ? 2 : 1);
const sourcesLoading = ref(false);
const sources = ref([]);
const selectedSource = ref(null);

const form = reactive({
  title: '',
  releaseYear: '',
  summary: '',
  genres: '',
  platforms: '',
  rating: '',
});

const cover = ref(null);
const background = ref(null);
const screenshots = ref([]);
const removeScreenshots = ref(false);
const existingCover = ref(props.game?.coverUrl ?? null);

function onFile(target, event) {
  const files = event.target.files;
  if (target === 'screenshots') screenshots.value = Array.from(files);
  else if (target === 'cover') cover.value = files[0] ?? null;
  else background.value = files[0] ?? null;
}

function cleanName(name) {
  return name
    .replace(/\.zip$/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function selectSource(src) {
  selectedSource.value = src;
  form.title = cleanName(src.name);
  step.value = 2;
}

const title = computed(() => {
  if (isEdit) return 'Edit game';
  if (step.value === 1) return 'Select folder';
  return `Add game ${selectedSource.value?.name ?? ''}`;
});

onMounted(async () => {
  if (isEdit) {
    try {
      const { data } = await client.get(`/games/${props.game.igdbId}`);
      form.title = data.title ?? '';
      form.releaseYear = data.releaseYear ?? '';
      form.summary = data.summary ?? '';
      form.genres = (data.genres ?? []).join(', ');
      form.platforms = (data.platforms ?? []).join(', ');
      form.rating = data.rating ?? '';
      existingCover.value = data.coverUrl;
    } catch {
      error.value = 'Failed to load game details.';
    }
  } else {
    sourcesLoading.value = true;
    try {
      const { data } = await client.get('/games/unprocessed-sources');
      sources.value = data.sources ?? [];
    } catch {
      error.value = 'Failed to load library folders.';
    } finally {
      sourcesLoading.value = false;
    }
  }
});

async function submit() {
  if (!form.title.trim()) {
    error.value = 'Title is required.';
    return;
  }
  saving.value = true;
  error.value = null;

  const fd = new FormData();
  fd.append('title', form.title.trim());
  fd.append('releaseYear', form.releaseYear === '' ? '' : String(form.releaseYear));
  fd.append('summary', form.summary);
  fd.append('genres', form.genres);
  fd.append('platforms', form.platforms);
  fd.append('rating', form.rating === '' ? '' : String(form.rating));
  if (cover.value) fd.append('cover', cover.value);
  if (background.value) fd.append('background', background.value);
  for (const s of screenshots.value) fd.append('screenshots', s);
  if (removeScreenshots.value) fd.append('removeScreenshots', 'true');

  try {
    if (isEdit) {
      await client.put(`/games/${props.game.igdbId}`, fd);
    } else {
      fd.append('sourcePath', selectedSource.value.path);
      fd.append('libraryPath', selectedSource.value.libraryPath);
      await client.post('/games/process-custom', fd);
    }
    emit('saved');
  } catch (err) {
    error.value = err.response?.data?.error || 'Failed to save game.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" @click.self="emit('close')">
    <div class="card my-8 w-full max-w-2xl p-6">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ title }}</h2>
        <button class="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-shelf-elevated" @click="emit('close')">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <p v-if="error" class="mb-3 rounded-lg bg-red-100 p-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>

      <!-- Step 1: folder picker (create only) -->
      <template v-if="step === 1">
        <p class="mb-3 text-sm text-gray-500">
          Select an unrecognised folder from your library. Its contents will be compressed and catalogued exactly like a scanned game.
        </p>

        <div v-if="sourcesLoading" class="py-10 text-center text-sm text-gray-400">Loading library folders…</div>

        <div v-else-if="!sources.length" class="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400 dark:border-shelf-border">
          No unrecognised folders found in your library paths.
          <br />
          <span class="text-xs">Add a library path in Settings → Paths, or drop a folder there first.</span>
        </div>

        <ul v-else class="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100 dark:divide-shelf-border dark:border-shelf-border">
          <li
            v-for="src in sources"
            :key="src.path"
            class="flex items-center gap-3 px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-shelf-elevated"
          >
            <svg class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ src.name }}</p>
              <p class="truncate text-xs text-gray-400">{{ src.libraryPath }}</p>
            </div>
            <button
              class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-shelf-accent transition hover:bg-shelf-accent/10"
              @click="selectSource(src)"
            >
              Select
            </button>
          </li>
        </ul>

        <div class="mt-5 flex justify-end">
          <button class="btn-ghost" @click="emit('close')">Cancel</button>
        </div>
      </template>

      <!-- Step 2: metadata form -->
      <template v-else>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm text-gray-500">Title <span class="text-red-500">*</span></label>
            <input v-model="form.title" class="input" placeholder="Game title" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Release year</label>
              <input v-model="form.releaseYear" type="number" class="input" placeholder="2024" />
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-500">Rating (0–100)</label>
              <input v-model="form.rating" type="number" min="0" max="100" class="input" placeholder="—" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Summary</label>
            <textarea v-model="form.summary" rows="3" class="input" placeholder="Short description…"></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Genres</label>
              <input v-model="form.genres" class="input" placeholder="Action, RPG" />
              <p class="mt-1 text-xs text-gray-400">Comma-separated</p>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-500">Platforms</label>
              <input v-model="form.platforms" class="input" placeholder="PC, PS5" />
              <p class="mt-1 text-xs text-gray-400">Comma-separated</p>
            </div>
          </div>

          <!-- Artwork -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Cover image</label>
              <div class="flex items-center gap-2">
                <img v-if="existingCover" :src="existingCover" class="h-16 w-12 rounded object-cover" />
                <input type="file" accept="image/*" class="text-xs" @change="onFile('cover', $event)" />
              </div>
            </div>
            <div>
              <label class="mb-1 block text-sm text-gray-500">Background image</label>
              <input type="file" accept="image/*" class="text-xs" @change="onFile('background', $event)" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Screenshots</label>
            <input type="file" accept="image/*" multiple class="text-xs" @change="onFile('screenshots', $event)" />
            <label v-if="isEdit" class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-500">
              <input v-model="removeScreenshots" type="checkbox" class="h-4 w-4 rounded" />
              Remove all existing screenshots
            </label>
            <p class="mt-1 text-xs text-gray-400">
              {{ isEdit ? 'Uploading new screenshots replaces the existing set.' : 'Select one or more images.' }}
            </p>
          </div>
        </div>

        <div class="mt-5 flex justify-end gap-3">
          <button v-if="!isEdit" class="btn-ghost" @click="step = 1">Back</button>
          <button class="btn-ghost" @click="emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="saving" @click="submit">
            {{ saving
              ? (isUnmatched ? 'Processing…' : isEdit ? 'Saving…' : 'Processing…')
              : (isUnmatched ? 'Save & process' : isEdit ? 'Save changes' : 'Add game') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
