import { get, post, put, del } from './request'

export const authApi = {
  login: (data) => post('/auth/login', data),
  register: (data) => post('/auth/register', data),
  me: () => get('/auth/me'),
  logout: () => post('/auth/logout'),
  password: (data) => post('/auth/password', data),
}

export const dashboardApi = {
  stats: () => get('/dashboard/stats'),
  trend: (days = 7) => get('/dashboard/trend', { days }),
}

export const deviceApi = {
  list: (params) => get('/devices', params),
  detail: (id) => get(`/devices/${id}`),
  metrics: (id, range = '1h') => get(`/devices/${id}/metrics`, { range }),
  commands: (id, params) => get(`/devices/${id}/commands`, params),
  command: (id, data) => post(`/devices/${id}/command`, data),
  shadow: (id) => get(`/devices/${id}/shadow`),
  setDesired: (id, data) => put(`/devices/${id}/shadow/desired`, data),
  groups: () => get('/device-groups'),
}

export const alertApi = {
  list: (params) => get('/alerts', params),
  stats: () => get('/alerts/stats'),
  handle: (id, data) => post(`/alerts/${id}/handle`, data),
}
