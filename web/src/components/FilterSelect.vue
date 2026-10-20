<script setup>
import { computed } from 'vue';

// A filter "pill" backed by a native <select>: it looks like a chip, but
// keyboard handling, screen readers and mobile pickers all come for free.
const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: String, default: '' },
  // [{ value, label }]
  options: { type: Array, required: true },
  // The value that means "not filtering"; anything else highlights the pill.
  defaultValue: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const current = computed(() => props.options.find((o) => o.value === props.modelValue) ?? props.options[0]);
const active = computed(() => props.modelValue !== props.defaultValue);
</script>

<template>
  <label class="chip relative cursor-pointer focus-within:ring-2 focus-within:ring-shelf-accent/40" :class="{ 'chip-active': active }">
    <span :class="active ? 'text-shelf-accent/80' : 'text-gray-500 dark:text-gray-400'">{{ label }}</span>
    <span class="max-w-[10rem] truncate">{{ current?.label }}</span>
    <svg class="h-3.5 w-3.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    <select
      class="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      :value="modelValue"
      :aria-label="label"
      @change="emit('update:modelValue', $event.target.value)"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </label>
</template>
