import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft, ChevronRight, Download, ExternalLink, Eye, History, Info, Loader2, MessageCircle, Pencil, RotateCw, Send,
  MoreHorizontal, Trash2, UploadCloud, X, AlertTriangle,
} from 'lucide-react';
import { api, fileUrl, notifyChanged } from '../api';
import { useApp } from '../store';
import { deleteItems, downloadItem, editItem } from '../actions';
import { BROWSER_VIDEO, CATEGORY_LABEL, fmtDate, fmtDuration, fmtSize, hostOf, isMobile, isTouch, plural, youtubeId } from '../utils';
import { FileIcon } from './Items';
import { PdfView } from './PdfView';

function Processing({ item, text = 'Готовим просмотр…' }) {
  return (
    <div className="stage-message">
      <Loader2 size={34} className="spin" />
      <strong>{text}</strong>
      <span>{item.meta?.progress ? `Конвертация: ${item.meta.progress}%` : 'Это займёт немного времени. Страница обновится сама.'}</span>
    </div>
  );
}

function NoPreview({ item, reason }) {
  return (
    <div className="stage-message">
      <FileIcon ext={item.ext} category={item.category} size={88} />
      <strong>{item.original_name}</strong>
      <span>{reason || 'Предпросмотр для этого формата недоступен'} · {fmtSize(item.size)}</span>
      <button className="btn btn-primary" onClick={() => downloadItem(item)}><Download size={16} /> Скачать</button>
    </div>
  );
}

function TextStage({ item }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/items/${item.id}/text`).then((d) => alive && setData(d)).catch((e) => alive && setData({ text: e.message }));
    return () => { alive = false; };
  }, [item.id]);
  if (!data) return <div className="stage-message"><Loader2 size={28} className="spin" /></div>;
  return (
    <div className="text-stage">
      <pre>{data.text}</pre>
      {data.truncated && <div className="muted pad">Показаны первые 2 МБ. Скачайте файл целиком.</div>}
    </div>
  );
}

function LinkStage({ item }) {
  const yt = youtubeId(item.url);
  if (yt) {
    return (
      <div className="video-wrap">
        <iframe className="stage-frame" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={item.title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
      </div>
    );
  }
  return (
    <div className="stage-message link-stage">
      <FileIcon category="link" size={88} />
      <strong>{item.title}</strong>
      <span className="link-url">{item.url}</span>
      <a className="btn btn-primary" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Открыть {hostOf(item.url)}</a>
    </div>
  );
}

// На телефонах и планшетах встроенный просмотр PDF ненадёжен — рисуем страницы сами через PDF.js.
const pdfStage = (url, title) => (isTouch() || isMobile()
  ? <PdfView url={url} />
  : <iframe className="stage-frame doc" src={url} title={title} />);

function Stage({ item }) {
  if (item.type === 'link') return <LinkStage item={item} />;
  const raw = fileUrl(item.id, 'raw');
  const preview = fileUrl(item.id, 'preview');
  const busy = item.status === 'processing';

  switch (item.category) {
    case 'image':
      if (busy && !['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(item.ext)) return <Processing item={item} />;
      return <img className="stage-img" src={item.has_preview ? preview : raw} alt={item.title} />;
    case 'video': {
      const playableRaw = BROWSER_VIDEO.has(item.ext);
      if (!item.has_preview && busy && !playableRaw) return <Processing item={item} text="Конвертируем видео для просмотра…" />;
      return (
        <div className="video-wrap">
          {busy && !item.has_preview && <div className="stage-note">Видео ещё оптимизируется — воспроизведение может быть медленнее</div>}
          <video key={item.has_preview ? 'p' : 'r'} className="stage-video" controls autoPlay playsInline preload="metadata"
            poster={item.has_thumb ? fileUrl(item.id, 'thumb') : undefined} src={item.has_preview ? preview : raw} />
        </div>
      );
    }
    case 'audio':
      return (
        <div className="stage-message">
          <FileIcon category="audio" size={96} />
          <strong>{item.title}</strong>
          {busy && !item.has_preview && !['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(item.ext)
            ? <span>Конвертируем…</span>
            : <audio controls autoPlay src={item.has_preview ? preview : raw} />}
        </div>
      );
    case 'pdf':
      return pdfStage(raw, item.title);
    case 'office':
      if (item.has_preview) return pdfStage(preview, item.title);
      if (busy) return <Processing item={item} text="Готовим документ к просмотру…" />;
      return <NoPreview item={item} reason={item.error ? 'Не удалось подготовить просмотр' : undefined} />;
    case 'text':
      return <TextStage item={item} />;
    default:
      return <NoPreview item={item} />;
  }
}

function Comments({ item, onCount }) {
  const app = useApp();
  const [list, setList] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    api.get(`/items/${item.id}/comments`).then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [item.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [list?.length]);

  const send = async (e) => {
    e?.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const c = await api.post(`/items/${item.id}/comments`, { body });
      setList((l) => [...l, c]);
      setBody('');
      onCount(1);
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!(await app.confirm({ title: 'Удалить комментарий?', ok: 'Удалить', danger: true }))) return;
    try {
      await api.del(`/comments/${c.id}`);
      setList((l) => l.filter((x) => x.id !== c.id));
      onCount(-1);
    } catch (err) {
      app.toast(err.message, 'error');
    }
  };

  return (
    <div className="comments">
      <h3>Комментарии {list?.length ? <span className="muted">{list.length}</span> : null}</h3>
      <div className="comment-list">
        {list === null && <div className="muted">Загрузка…</div>}
        {list?.length === 0 && <div className="muted small">Пока нет комментариев. Будьте первым.</div>}
        {list?.map((c) => (
          <div key={c.id} className={`comment ${c.user_id === app.user.id ? 'mine' : ''}`}>
            <div className="avatar small">{(c.user_name || '?')[0]}</div>
            <div className="comment-main">
              <div className="comment-head">
                <strong>{c.user_name}</strong>
                <span className="muted">{fmtDate(c.created_at, true)}</span>
                {c.can_delete && <button className="icon-btn tiny" onClick={() => remove(c)} aria-label="Удалить"><Trash2 size={12} /></button>}
              </div>
              <div className="comment-body">{c.body}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="comment-form" onSubmit={send}>
        <textarea rows={1} placeholder="Написать комментарий…" value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="icon-btn send" disabled={busy || !body.trim()} aria-label="Отправить"><Send size={16} /></button>
      </form>
    </div>
  );
}

const HISTORY_ICON = { download: Download, view: Eye, upload: UploadCloud, comment: MessageCircle };

/** История конкретного документа — видна только администратору. */
function ItemHistory({ item }) {
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/activity?item=${item.id}&limit=50`).then((r) => alive && setRows(r.items)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [item.id]);
  if (!rows) return null;
  const downloads = rows.filter((r) => r.action === 'download').length;
  const views = rows.filter((r) => r.action === 'view').length;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <div className="history">
      <h3>История <span className="muted small">только для администратора</span></h3>
      <div className="history-stats">
        <span><Eye size={13} /> {views} {plural(views, 'просмотр', 'просмотра', 'просмотров')}</span>
        <span><Download size={13} /> {downloads} {plural(downloads, 'скачивание', 'скачивания', 'скачиваний')}</span>
      </div>
      {shown.map((r) => {
        const Icon = HISTORY_ICON[r.action] || History;
        return (
          <div key={r.id} className="history-row">
            <Icon size={13} />
            <span className="ellipsis"><strong>{r.user_name}</strong> {r.action_label.toLowerCase()}</span>
            <span className="muted small nowrap">{fmtDate(r.created_at, true)}</span>
          </div>
        );
      })}
      {rows.length > 5 && <button className="btn btn-small btn-ghost" onClick={() => setAll(!all)}>{all ? 'Свернуть' : `Показать все (${rows.length}${rows.length >= 50 ? '+' : ''})`}</button>}
      <a className="small" href={`#/activity?item=${item.id}`}>Открыть в журнале</a>
    </div>
  );
}

function InfoPanel({ item, path, onCount, isAdmin, onClose }) {
  const rows = [
    ['Тип', item.type === 'link' ? 'Ссылка' : `${CATEGORY_LABEL[item.category]}${item.ext ? ` · ${item.ext.toUpperCase()}` : ''}`],
    item.size != null && ['Размер', fmtSize(item.size)],
    item.meta?.duration > 0 && ['Длительность', fmtDuration(item.meta.duration)],
    item.meta?.width && ['Разрешение', `${item.meta.width}×${item.meta.height}`],
    item.meta?.pages && ['Страниц', item.meta.pages],
    [item.type === 'link' ? 'Добавил' : 'Загрузил', item.created_by_name || '—'],
    ['Когда', fmtDate(item.created_at, true)],
  ].filter(Boolean);
  return (
    <aside className="viewer-side">
      <button className="sheet-handle" onClick={onClose} aria-label="Свернуть"><span /></button>
      <div className="viewer-side-scroll">
        <h2 className="viewer-side-title">{item.title}</h2>
        {item.description && <p className="viewer-desc">{item.description}</p>}
        <dl className="info-list">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          <div>
            <dt>Где</dt>
            <dd>{path.map((f, i) => (
              <span key={f.id}>{i > 0 && ' › '}<a href={`#/f/${f.id}`}>{f.name}</a></span>
            ))}</dd>
          </div>
        </dl>
        {item.error && item.status !== 'ready' && <div className="form-error small"><AlertTriangle size={13} /> {item.error.slice(0, 200)}</div>}
        {isAdmin && <ItemHistory item={item} />}
        <Comments item={item} onCount={onCount} />
      </div>
    </aside>
  );
}

export function Viewer() {
  const app = useApp();
  const { viewer, setViewer, canEdit } = app;
  const [mobile] = useState(isMobile);
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 900);
  const swipe = useRef(null);
  const [item, setItem] = useState(null);
  const index = viewer?.index ?? 0;
  const items = viewer?.items || [];
  const base = items[index];

  useEffect(() => {
    setItem(base || null);
    // Отмечаем просмотр для журнала (сервер не дублирует повторные открытия в течение 10 минут).
    if (base) api.post(`/items/${base.id}/viewed`).catch(() => {});
  }, [base]);

  // Пока файл обрабатывается — опрашиваем сервер.
  useEffect(() => {
    if (!item || item.status !== 'processing') return;
    const t = setTimeout(() => api.get(`/items/${item.id}`).then(setItem).catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, [item]);

  const close = () => setViewer(null);
  const goTo = (i) => items.length && setViewer({ items, index: (i + items.length) % items.length });

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]') || document.querySelector('.modal-backdrop')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  });

  if (!viewer || !item) return null;
  const path = app.pathOf(item.folder_id);

  const onCount = (d) => setItem((it) => ({ ...it, comment_count: (it.comment_count || 0) + d }));

  const edit = async () => {
    const res = await editItem(app, item);
    if (res) setItem((it) => ({ ...it, ...res }));
  };
  const reprocess = async () => {
    await api.post(`/items/${item.id}/reprocess`);
    setItem(await api.get(`/items/${item.id}`));
    notifyChanged(item.folder_id);
  };
  const remove = async () => {
    if (!(await deleteItems(app, [item]))) return;
    const rest = items.filter((x) => x.id !== item.id);
    setViewer(rest.length ? { items: rest, index: Math.min(index, rest.length - 1) } : null);
  };
  const openUrl = fileUrl(item.id, item.has_preview && item.category === 'office' ? 'preview' : 'raw');
  const moreMenu = (e) => app.showMenu(e, [
    { label: 'Открыть в новой вкладке', icon: ExternalLink, hidden: item.type !== 'file', onClick: () => window.open(openUrl, '_blank') },
    { label: 'Открыть ссылку', icon: ExternalLink, hidden: item.type !== 'link', onClick: () => window.open(item.url, '_blank', 'noopener') },
    'divider',
    { label: 'Изменить', icon: Pencil, hidden: !canEdit, onClick: edit },
    { label: 'Обработать заново', icon: RotateCw, hidden: !canEdit || item.type !== 'file' || item.status === 'processing', onClick: reprocess },
    'divider',
    { label: 'Удалить', icon: Trash2, danger: true, hidden: !canEdit, onClick: remove },
  ], { anchor: true, title: item.title });

  // Свайп влево/вправо — следующий/предыдущий документ.
  const swipeProps = items.length > 1 ? {
    onTouchStart: (e) => { swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; },
    onTouchEnd: (e) => {
      if (!swipe.current) return;
      const dx = e.changedTouches[0].clientX - swipe.current.x;
      const dy = e.changedTouches[0].clientY - swipe.current.y;
      swipe.current = null;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50) goTo(index + (dx < 0 ? 1 : -1));
    },
  } : {};

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item.title}>
      <div className="viewer-bar">
        <button className="icon-btn light" onClick={close} aria-label="Закрыть (Esc)"><X size={18} /></button>
        <div className="viewer-title">
          <strong>{item.title}</strong>
          {items.length > 1 && <span>{index + 1} из {items.length}</span>}
        </div>
        {mobile ? (
          <div className="viewer-actions">
            {item.type === 'file' && <button className="icon-btn light" onClick={() => downloadItem(item)} aria-label="Скачать"><Download size={19} /></button>}
            <button className="icon-btn light" onClick={moreMenu} aria-label="Ещё"><MoreHorizontal size={20} /></button>
          </div>
        ) : (
        <div className="viewer-actions">
          {item.type === 'file' && (
            <>
              <a className="icon-btn light" href={openUrl} target="_blank" rel="noreferrer" title="Открыть в новой вкладке"><ExternalLink size={17} /></a>
              <button className="icon-btn light" onClick={() => downloadItem(item)} title="Скачать"><Download size={17} /></button>
            </>
          )}
          {canEdit && (
            <>
              <button className="icon-btn light" title="Изменить" onClick={edit}><Pencil size={16} /></button>
              {item.type === 'file' && item.status !== 'processing' && (
                <button className="icon-btn light" title="Обработать заново" onClick={reprocess}><RotateCw size={16} /></button>
              )}
              <button className="icon-btn light" title="Удалить" onClick={remove}><Trash2 size={16} /></button>
            </>
          )}
          <button className={`icon-btn light ${showInfo ? 'on' : ''}`} onClick={() => setShowInfo(!showInfo)} title="Информация и комментарии">
            <Info size={17} />
          </button>
        </div>
        )}
      </div>
      <div className="viewer-body">
        <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && close()} {...swipeProps}>
          {items.length > 1 && <button className="nav-btn prev" onClick={() => goTo(index - 1)} aria-label="Предыдущий"><ChevronLeft size={22} /></button>}
          <Stage key={item.id} item={item} />
          {items.length > 1 && <button className="nav-btn next" onClick={() => goTo(index + 1)} aria-label="Следующий"><ChevronRight size={22} /></button>}
        </div>
        {showInfo && <InfoPanel item={item} path={path} onCount={onCount} isAdmin={app.isAdmin} onClose={() => setShowInfo(false)} />}
        {mobile && !showInfo && (
          <button className="viewer-pill" onClick={() => setShowInfo(true)}>
            <Info size={15} /> Информация
            <span className="viewer-pill-sep" />
            <MessageCircle size={15} /> {item.comment_count || 0}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
