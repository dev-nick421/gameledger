import { defineStore } from 'pinia';

// Cross-component UI state for "arrange" mode
// Kept tiny and separate from persisted settings.
export const useLayoutStore = defineStore('layout', {
  state: () => ({
    arranging: false,
  }),
  actions: {
    toggleArranging() {
      this.arranging = !this.arranging;
    },
    stopArranging() {
      this.arranging = false;
    },
  },
});
