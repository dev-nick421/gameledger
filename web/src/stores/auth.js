import { defineStore } from 'pinia';
import client from '../api/client.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('gs_token') || null,
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
  },
  actions: {
    async login(password) {
      const { data } = await client.post('/auth/login', { password });
      this.token = data.token;
      localStorage.setItem('gs_token', data.token);
    },
    logout() {
      this.token = null;
      localStorage.removeItem('gs_token');
    },
  },
});
