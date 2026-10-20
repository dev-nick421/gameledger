import { defineStore } from 'pinia';

// Dark mode is the default. The choice persists in localStorage and toggles the
// `dark` class on <html> (Tailwind's class strategy).
export const useThemeStore = defineStore('theme', {
  state: () => ({
    mode: localStorage.getItem('gs_theme') || 'dark',
  }),
  actions: {
    apply() {
      const root = document.documentElement;
      if (this.mode === 'dark') root.classList.add('dark');
      else root.classList.remove('dark');
    },
    toggle() {
      this.mode = this.mode === 'dark' ? 'light' : 'dark';
      localStorage.setItem('gs_theme', this.mode);
      this.apply();
    },
  },
});
