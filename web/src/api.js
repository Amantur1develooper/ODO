export function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opts.headers['X-CSRFToken'] = csrfToken();
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + url, opts);
  } catch {
    throw new Error('Нет связи с сервером');
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
  if (res.status === 401 && url !== '/auth/login') window.dispatchEvent(new Event('odo:logout'));
  if (!res.ok) {
    const err = new Error(data?.error || `Ошибка сервера (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

export const fileUrl = (id, kind = 'raw', download = false) => `/api/items/${id}/${kind}${download ? '?download=1' : ''}`;

export const notifyChanged = (folderId) => window.dispatchEvent(new CustomEvent('odo:changed', { detail: { folderId } }));
export const notifyFolders = () => window.dispatchEvent(new Event('odo:folders'));
