import { useEffect, useRef, useState } from 'react';

export function fmtSize(bytes) {
  if (bytes == null) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i && n < 10 ? n.toFixed(1).replace('.', ',') : Math.round(n)} ${units[i]}`;
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Сегодня, ${time}`;
  if (yesterday) return `Вчера, ${time}`;
  const date = d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return withTime ? `${date}, ${time}` : date;
}

export function fmtDuration(sec) {
  if (!sec) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export const KINDS = {
  object: { label: 'Объект', plural: 'Объекты', acc: 'объект' },
  group: { label: 'Группа', plural: 'Группы', acc: 'группу' },
  section: { label: 'Раздел', plural: 'Разделы', acc: 'раздел' },
};
export const KIND_ORDER = { object: 0, group: 1, section: 2 };
export const NEXT_KIND = { object: 'group', group: 'section', section: 'section' };

export const ROLES = {
  admin: { label: 'Администратор', hint: 'Всё, включая пользователей' },
  editor: { label: 'Редактор', hint: 'Добавляет, изменяет и удаляет' },
  viewer: { label: 'Наблюдатель', hint: 'Смотрит и комментирует' },
};

export const CATEGORY_LABEL = {
  pdf: 'PDF', office: 'Документ', text: 'Текст', image: 'Изображение', video: 'Видео',
  audio: 'Аудио', archive: 'Архив', other: 'Файл', link: 'Ссылка',
};

export function sortFolders(list) {
  return [...list].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'ru', { numeric: true }));
}

export function sortItems(list, sort) {
  const arr = [...list];
  const byName = (a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true });
  if (sort === 'date') arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else if (sort === 'size') arr.sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (sort === 'type') arr.sort((a, b) => a.category.localeCompare(b.category) || byName(a, b));
  else arr.sort(byName);
  return arr;
}

export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* приватный режим */
    }
  }, [key, value]);
  return [value, setValue];
}

export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const BROWSER_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv']);

export function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'f' && parts[1]) return { name: 'folder', id: parts[1] };
  if (parts[0] === 'search') return { name: 'search', q: params.get('q') || '', type: params.get('type') || '' };
  if (parts[0] === 'recent') return { name: 'recent' };
  if (parts[0] === 'users') return { name: 'users' };
  if (parts[0] === 'activity') {
    return { name: 'activity', group: params.get('group') || '', user: params.get('user') || '', item: params.get('item') || '' };
  }
  return { name: 'home' };
}

export const go = (path) => {
  window.location.hash = path;
};

export const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches;
export const isMobile = () => window.matchMedia?.('(max-width: 760px)').matches;

/** Долгое нажатие на сенсорном экране — аналог правого клика. */
export function useLongPress(callback, ms = 480) {
  const timer = useRef(null);
  const fired = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const cancel = () => clearTimeout(timer.current);
  return {
    onTouchStart: (e) => {
      fired.current = false;
      const t = e.touches[0];
      const target = e.currentTarget;
      start.current = { x: t.clientX, y: t.clientY };
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(8);
        callback({ preventDefault() {}, stopPropagation() {}, clientX: t.clientX, clientY: t.clientY, currentTarget: target });
      }, ms);
    },
    onTouchMove: (e) => {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 10) cancel();
    },
    onTouchEnd: (e) => {
      cancel();
      if (fired.current) e.preventDefault(); // не даём долгому нажатию превратиться в обычный клик
    },
    onTouchCancel: cancel,
  };
}
