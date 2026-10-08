import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search as SearchIcon, X } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { CATEGORY_LABEL, fmtDate, fmtSize, go, KINDS } from '../utils';
import { KindIcon, Thumb } from './Items';
import { PageHeader } from './Pages';

/** ts_headline помечает совпадения как [[[…]]] — превращаем в <mark> без HTML-инъекций. */
export function Snippet({ text }) {
  if (!text) return null;
  const parts = text.split(/(\[\[\[.*?\]\]\])/g);
  return (
    <span className="snippet">
      {parts.map((p, i) => (p.startsWith('[[[') ? <mark key={i}>{p.slice(3, -3)}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}

function Highlight({ text, q }) {
  const terms = (q.match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

function useSearch(q, type, limit) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) {
      setRes(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`)
        .then((r) => alive && setRes(r))
        .catch(() => alive && setRes({ folders: [], items: [] }))
        .finally(() => alive && setLoading(false));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, type, limit]);
  return [res, loading];
}

export function Spotlight({ onClose }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [res, loading] = useSearch(q, '', 8);
  const listRef = useRef(null);

  const rows = [
    ...(res?.folders || []).slice(0, 5).map((f) => ({ kind: 'folder', f })),
    ...(res?.items || []).map((item) => ({ kind: 'item', item })),
    ...(q.trim() ? [{ kind: 'all' }] : []),
  ];

  useEffect(() => {
    setActive(0);
  }, [res]);
  useEffect(() => {
    listRef.current?.querySelector('.spot-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (row) => {
    onClose();
    if (row.kind === 'folder') go(`/f/${row.f.id}`);
    else if (row.kind === 'item') app.openViewer(res.items, res.items.indexOf(row.item));
    else go(`/search?q=${encodeURIComponent(q)}`);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]); }
  };

  return createPortal(
    <div className="spot-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="spot" role="dialog" aria-label="Поиск">
        <div className="spot-input">
          <SearchIcon size={20} />
          <input autoFocus placeholder="Поиск по всем документам, видео, ссылкам и комментариям" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          {loading && <span className="spinner-dot" />}
          <kbd>esc</kbd>
        </div>
        {q.trim() && (
          <div className="spot-list" ref={listRef}>
            {rows.map((row, i) => {
              const props = { key: i, className: `spot-row ${i === active ? 'active' : ''}`, onMouseMove: () => setActive(i), onClick: () => choose(row) };
              if (row.kind === 'folder') {
                return (
                  <div {...props}>
                    <KindIcon kind={row.f.kind} size={14} />
                    <div className="spot-text">
                      <strong><Highlight text={row.f.name} q={q} /></strong>
                      <span>{KINDS[row.f.kind].label} · {app.pathOf(row.f.parent_id).map((p) => p.name).join(' › ') || 'Верхний уровень'}</span>
                    </div>
                  </div>
                );
              }
              if (row.kind === 'item') {
                return (
                  <div {...props}>
                    <span className="spot-thumb"><Thumb item={row.item} size={30} /></span>
                    <div className="spot-text">
                      <strong><Highlight text={row.item.title} q={q} /></strong>
                      <span>{app.pathOf(row.item.folder_id).map((p) => p.name).join(' › ')}</span>
                    </div>
                    {i === active && <CornerDownLeft size={14} className="muted" />}
                  </div>
                );
              }
              return (
                <div {...props}>
                  <span className="spot-thumb"><SearchIcon size={16} /></span>
                  <div className="spot-text"><strong>Показать все результаты для «{q}»</strong></div>
                </div>
              );
            })}
            {res && !res.folders.length && !res.items.length && <div className="spot-empty">Ничего не найдено</div>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const TYPES = [['', 'Все'], ['docs', 'Документы'], ['media', 'Видео и аудио'], ['images', 'Изображения'], ['links', 'Ссылки']];

export function SearchPage({ q: initialQ, type }) {
  const app = useApp();
  const [q, setQ] = useState(initialQ);
  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);
  const [res, loading] = useSearch(q, type, 100);

  const update = (nq, nt = type) => {
    const p = new URLSearchParams();
    if (nq) p.set('q', nq);
    if (nt) p.set('type', nt);
    window.history.replaceState(null, '', `#/search?${p}`);
  };

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Главная', href: '#/' }]} title="Поиск" />
      <div className="search-input large">
        <SearchIcon size={20} />
        <input autoFocus value={q} placeholder="Название, текст внутри документа, комментарий…"
          onChange={(e) => { setQ(e.target.value); update(e.target.value); }} />
        {q && <button className="icon-btn" onClick={() => { setQ(''); update(''); }} aria-label="Очистить"><X size={16} /></button>}
      </div>
      <div className="chips">
        {TYPES.map(([value, label]) => (
          <button key={value} className={`chip ${type === value ? 'on' : ''}`} onClick={() => go(`/search?q=${encodeURIComponent(q)}${value ? `&type=${value}` : ''}`)}>{label}</button>
        ))}
      </div>

      {!q.trim() ? (
        <div className="empty"><SearchIcon size={40} strokeWidth={1.5} /><h3>Ищите по всему ОДО</h3><p>Поиск идёт по названиям, описаниям, тексту внутри PDF и Office-документов, ссылкам и комментариям.</p></div>
      ) : !res ? (
        <div className="loading">{loading ? 'Ищу…' : ''}</div>
      ) : (
        <>
          {res.folders.length > 0 && (
            <section className="section">
              <div className="section-head"><h2>Папки</h2><span className="muted">{res.folders.length}</span></div>
              <div className="folder-chips">
                {res.folders.map((f) => (
                  <a key={f.id} className="folder-chip" href={`#/f/${f.id}`}><KindIcon kind={f.kind} size={12} /> <Highlight text={f.name} q={q} /></a>
                ))}
              </div>
            </section>
          )}
          <section className="section">
            <div className="section-head"><h2>Документы</h2><span className="muted">{res.items.length}{res.items.length >= 100 ? '+' : ''}</span></div>
            {res.items.length === 0 ? <div className="muted pad">Ничего не найдено. Попробуйте другое слово или уберите фильтр.</div> : (
              <div className="results">
                {res.items.map((item, idx) => (
                  <div key={item.id} className="result" onClick={() => app.openViewer(res.items, idx)} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && app.openViewer(res.items, idx)}>
                    <div className="result-thumb"><Thumb item={item} size={40} /></div>
                    <div className="result-main">
                      <div className="result-title"><Highlight text={item.title} q={q} /></div>
                      <div className="result-path">
                        {app.pathOf(item.folder_id).map((f) => f.name).join(' › ')} · {item.type === 'link' ? 'Ссылка' : CATEGORY_LABEL[item.category]}
                        {item.size != null && ` · ${fmtSize(item.size)}`} · {item.created_by_name ? `${item.created_by_name}, ` : ''}{fmtDate(item.created_at)}
                      </div>
                      <Snippet text={item.snippet} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
