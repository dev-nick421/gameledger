import axios from 'axios';

// Single axios instance. The admin token (if present) is attached to every
// request; a 401 clears it so the router can bounce to /login.
const client = axios.create({ baseURL: '/api' });

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

client.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('gs_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(err);
  },
);

export default client;
