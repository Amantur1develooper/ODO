import { useEffect, useMemo, useState } from 'react';
import {
  Download, Eye, FolderInput, FolderPlus, History, KeyRound, Link2, LogIn, MessageCircle, Pencil, Search, Trash2,
  UploadCloud, UserCog, X,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { fmtSize, go } from '../utils';
import { PageHeader } from './Pages';

const GROUPS = [
  ['', 'Все'], ['downloads', 'Скачивания'], ['views', 'Просмотры'], ['uploads', 'Загрузки'],
  ['changes', 'Изменения'], ['deletes', 'Удаления'], ['logins', 'Входы'], ['users', 'Пользователи'],
];

const ICONS = {
  login: [LogIn, '#8e8e93'], upload: [UploadCloud, 'var(--accent)'], view: [Eye, '#2f7cf6'], download: [Download, '#8e5cf7'],
  link_create: [Link2, 'var(--accent)'], item_edit: [Pencil, '#f2711c'], item_move: [FolderInput, '#f2711c'],
  item_delete: [Trash2, 'var(--danger)'], folder_create: [FolderPlus, 'var(--accent)'], folder_edit: [Pencil, '#f2711c'],
  folder_move: [FolderInput, '#f2711c'], folder_delete: [Trash2, 'var(--danger)'], comment: [MessageCircle, '#12a5c9'],
  user_create: [UserCog, '#7c3aed'], user_edit: [UserCog, '#7c3aed'], user_delete: [UserCog, 'var(--danger)'],
};

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
}

function detailsText(r) {
  const d = r.details || {};
  if (r.action === 'download' || r.action === 'upload') return d.size != null ? fmtSize(d.size) : '';
  if (r.action === 'item_move' || r.action === 'folder_move') return d.from_path ? `из «${d.from_path}»` : '';
  if (r.action === 'comment') return d.text ? `«${d.text}»` : '';
  if (r.action === 'folder_delete' && d.files) return `файлов: ${d.files}`;
  if (r.action === 'user_edit' && d.fields?.length) return `поля: ${d.fields.join(', ')}`;
  return '';
}

export function ActivityPage({ group, user, item }) {
  const app = useApp();
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (app.isAdmin) api.get('/users').then(setUsers).catch(() => {});
  }, [app.isAdmin]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (group) p.set('group', group);
    if (user) p.set('user', user);
    if (item) p.set('item', item);
    if (query.trim()) p.set('q', query.trim());
    return p;
  }, [group, user, item, query]);

  useEffect(() => {
    if (!app.isAdmin) return;
    let alive = true;
    setRows(null);
    api.get(`/activity?${params}&limit=100`).then((r) => {
      if (!alive) return;
      setRows(r.items);
      setHasMore(r.has_more);
    }).catch((e) => alive && (setRows([]), app.toast(e.message, 'error')));
    return () => { alive = false; };
  }, [params, app.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.isAdmin) return <div className="page"><div className="empty"><KeyRound size={36} /><h3>Журнал доступен только администратору</h3></div></div>;

  const setFilter = (patch) => {
    const p = new URLSearchParams();
    const next = { group, user, item, ...patch };
    Object.entries(next).forEach(([k, v]) => v && p.set(k, v));
    go(`/activity${p.toString() ? `?${p}` : ''}`);
  };

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await api.get(`/activity?${params}&limit=100&before=${rows[rows.length - 1].id}`);
      setRows([...rows, ...r.items]);
      setHasMore(r.has_more);
    } catch (e) {
      app.toast(e.message, 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = async (r) => {
    try {
      app.openViewer([await api.get(`/items/${r.item_id}`)], 0);
    } catch {
      app.toast('Документ уже удалён', 'error');
    }
  };

  // Группировка по дням.
  const days = [];
  for (const r of rows || []) {
    const label = dayLabel(r.created_at);
    if (!days.length || days[days.length - 1].label !== label) days.push({ label, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  const itemName = item && rows?.find((r) => r.item_id === item)?.target;

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Главная', href: '#/' }]} title={<><History size={24} /> Журнал действий</>}
        subtitle="Кто что загрузил, открыл, скачал, изменил и удалил. Видно только администратору." />

      <div className="activity-filters">
        <div className="search-input small grow">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени файла, папке или человеку" />
          {q && <button className="icon-btn tiny" onClick={() => setQ('')} aria-label="Очистить"><X size={13} /></button>}
        </div>
        <select className="select" value={user} onChange={(e) => setFilter({ user: e.target.value })}>
          <option value="">Все пользователи</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
        </select>
      </div>
      <div className="chips">
        {GROUPS.map(([value, label]) => (
          <button key={value} className={`chip ${group === value ? 'on' : ''}`} onClick={() => setFilter({ group: value })}>{label}</button>
        ))}
      </div>
      {item && (
        <div className="filter-banner">
          Только документ{itemName ? <> «<strong>{itemName}</strong>»</> : ''}
          <button className="btn btn-small" onClick={() => setFilter({ item: '' })}><X size={13} /> Сбросить</button>
        </div>
      )}

      {rows === null ? <div className="loading">Загрузка…</div> : rows.length === 0 ? (
        <div className="empty"><History size={36} strokeWidth={1.5} /><h3>Записей нет</h3><p>Попробуйте изменить фильтры.</p></div>
      ) : (
        <>
          {days.map((day) => (
            <section key={day.label} className="section">
              <div className="section-head"><h2 className="day-label">{day.label}</h2><span className="muted">{day.rows.length}</span></div>
              <div className="list activity-list">
                {day.rows.map((r) => {
                  const [Icon, color] = ICONS[r.action] || [History, '#8e8e93'];
                  const extra = detailsText(r);
                  return (
                    <div key={r.id} className="activity-row">
                      <span className="activity-time">{new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="type-square" style={{ width: 30, height: 30, '--c': color }}><Icon size={15} /></span>
                      <div className="activity-main">
                        <div className="activity-line">
                          <button className="link-btn strong" onClick={() => r.user_id && setFilter({ user: r.user_id })}>{r.user_name}</button>
                          <span className="muted">{r.action_label.toLowerCase()}</span>
                          {r.action !== 'login' && r.target && (
                            r.item_id ? <button className="link-btn" onClick={() => openItem(r)}>{r.target}</button>
                              : r.folder_id && r.action.startsWith('folder') ? <a href={`#/f/${r.folder_id}`}>{r.target}</a>
                              : <span className="strike-maybe">{r.target}</span>
                          )}
                        </div>
                        <div className="activity-sub">
                          {r.path && <span>{r.path}</span>}
                          {extra && <span>{extra}</span>}
                          {r.item_id && !item && <button className="link-btn" onClick={() => setFilter({ item: r.item_id })}>история файла</button>}
                        </div>
                      </div>
                      <span className="activity-ip hide-sm">{r.ip || ''}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMore && (
            <div className="row-gap" style={{ marginTop: 18 }}>
              <button className="btn" onClick={more} disabled={loadingMore}>{loadingMore ? 'Загрузка…' : 'Показать ещё'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
