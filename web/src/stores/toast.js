import { defineStore } from 'pinia';

let nextId = 1;

// App-wide toasts: notifications that need to show up regardless of which page
// the user is on (e.g. a scan finishing while they're looking at the Library).
// kind: 'ok' | 'info' | 'warn' | 'error'
export const useToastStore = defineStore('toast', {
  state: () => ({ toasts: [] }),
  actions: {
    push(text, kind = 'info', timeout = 5000) {
      const id = nextId++;
      this.toasts.push({ id, text, kind });
      setTimeout(() => this.dismiss(id), timeout);
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});
