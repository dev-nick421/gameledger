import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import { useAuthStore } from './stores/auth.js';
import { useThemeStore } from './stores/theme.js';
import { setUnauthorizedHandler } from './api/client.js';
import './style.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// Apply persisted theme before mount to avoid a flash.
const theme = useThemeStore(pinia);
theme.apply();

// A 401 anywhere clears the session and redirects to login.
const auth = useAuthStore(pinia);
setUnauthorizedHandler(() => {
  auth.logout();
  if (router.currentRoute.value.meta.requiresAuth) router.push({ name: 'login' });
});

app.mount('#app');
