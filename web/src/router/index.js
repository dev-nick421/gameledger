import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  { path: '/', name: 'library', component: () => import('../views/LibraryView.vue') },
  { path: '/game/:igdbId', name: 'game', component: () => import('../views/GameDetailView.vue') },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('../views/SettingsView.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: { name: 'settings-scanning' } },
      {
        path: 'scanning',
        name: 'settings-scanning',
        component: () => import('../views/settings/ScanningSettings.vue'),
      },
      {
        path: 'providers',
        name: 'settings-providers',
        component: () => import('../views/settings/ProvidersSettings.vue'),
      },
      // Old bookmarks/links to the pre-#8 IGDB-only settings page.
      { path: 'igdb', redirect: { name: 'settings-providers' } },
      {
        path: 'library',
        name: 'settings-library',
        component: () => import('../views/settings/LibraryOptions.vue'),
      },
      {
        path: 'games',
        name: 'settings-games',
        component: () => import('../views/settings/GameManagement.vue'),
      },
      {
        path: 'paths',
        name: 'settings-paths',
        component: () => import('../views/settings/LibraryPaths.vue'),
      },
      {
        path: 'scheduler',
        name: 'settings-scheduler',
        component: () => import('../views/settings/SchedulerSettings.vue'),
      },
      {
        path: 'logs',
        name: 'settings-logs',
        component: () => import('../views/settings/LogsSettings.vue'),
      },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Admin routes require a token; bounce to login and remember where we came from.
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});

export default router;
