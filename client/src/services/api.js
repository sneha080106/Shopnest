import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('shopnest_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('shopnest_token');
    }
    return Promise.reject(err);
  }
);

export function getErrorMessage(err) {
  return err?.response?.data?.message || 'Something went wrong. Please try again.';
}

export default api;
