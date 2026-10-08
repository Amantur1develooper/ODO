import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ChevronRight, FolderInput, FolderPlus, FolderUp, LayoutGrid, Link2, List, Plus, Trash2, Upload, X,
  Camera, CloudUpload, Inbox,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { filesFromInput, readDrop, useUploads } from '../uploads';
import { addLink, createFolder, deleteItems, folderMenu, itemMenu, moveItems } from '../actions';
import { fmtSize, isMobile, isTouch, KINDS, NEXT_KIND, plural, sortItems, useLocalState } from '../utils';
import { FolderTile, ItemCard, ItemRow, KindIcon } from './Items';

export function PageHeader({ crumbs = [], title, subtitle, children }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Путь">
            {crumbs.map((c, i) => (
              <span key={c.href || i} className="crumb">
                <a href={c.href}>{c.label}</a>
                <ChevronRight size={13} />
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </header>
  );
}

function ViewToggle({ view, setView }) {
  return (
    <div className="segmented compact" role="radiogroup" aria-label="Вид">
      <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Плитка" title="Плитка"><LayoutGrid size={15} /></button>
      <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="Список" title="Список"><List size={15} /></button>
    </div>
  );
}

const SORTS = { name: 'По названию', date: 'По дате', size: 'По размеру', type: 'По типу' };

function SortButton({ sort, setSort }) {
  const app = useApp();
  return (
    <button className="btn btn-ghost" onClick={(e) => app.showMenu(e, Object.entries(SORTS).map(([k, label]) => ({
      label: (k === sort ? '✓ ' : '   ') + label, onClick: () => setSort(k),
    })), { anchor: true })}>
      <ArrowDownUp size={15} /> <span className="hide-sm">{SORTS[sort]}</span>
    </button>
  );
}

/** Сетка или список документов с выделением (Cmd/Ctrl/Shift + клик или галочка). */
export function ItemsArea({ items, view, selectable = false, selected, setSelected, pathFor }) {
  const app = useApp();
  const anchor = useRef(null);
  const selecting = selected?.size > 0;
  const open = (idx) => app.openViewer(items, idx);
  const toggle = (idx, e) => {
    const next = new Set(selected);
    if (e?.shiftKey && anchor.current != null) {
      const [a, b] = [anchor.current, idx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) next.add(items[i].id);
    } else if (next.has(items[idx].id)) next.delete(items[idx].id);
    else next.add(items[idx].id);
    anchor.current = idx;
    setSelected(next);
  };
  const menu = (item, idx) => (e) => app.showMenu(
    e, itemMenu(app, item, () => open(idx), selectable ? () => toggle(idx) : null), { title: item.title },
  );
  const props = (item, idx) => ({
    key: item.id, item, selectable, selected: selected?.has(item.id),
    // На телефоне в режиме выбора касание отмечает файл, а не открывает его.
    onOpen: () => (selecting && isMobile() ? toggle(idx) : open(idx)),
    onToggle: (e) => toggle(idx, e), onMenu: menu(item, idx),
  });

  if (view === 'list') {
    return (
      <div className={`list ${selecting ? 'selecting' : ''}`}>
        <div className={`list-head ${selectable ? 'with-check' : ''}`}>
          {selectable && <span className="check-spacer" />}
          <span className="row-thumb" />
          <span className="row-name">Название</span>
          <span className="row-col row-type">Тип</span>
          <span className="row-col row-size">Размер</span>
          <span className="row-col row-author">Добавил</span>
          <span className="row-col row-date">Когда</span>
          <span className="row-col row-extra" />
          <span className="row-more-spacer" />
        </div>
        {items.map((item, idx) => <ItemRow {...props(item, idx)} path={pathFor?.(item)} />)}
      </div>
    );
  }
  return <div className={`grid ${selecting ? 'selecting' : ''}`}>{items.map((item, idx) => <ItemCard {...props(item, idx)} />)}</div>;
}

function useFolderItems(folderId) {
  const app = useApp();
  const [items, setItems] = useState(null);
  const timer = useRef(null);
  const load = useCallback(async () => {
    try {
      setItems(await api.get(`/folders/${folderId}/items`));
    } catch (e) {
      if (e.status === 404) setItems([]);
      else app.toast(e.message, 'error');
    }
  }, [folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setItems(null);
    load();
    const onChange = (e) => {
      if (e.detail?.folderId && e.detail.folderId !== folderId) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(load, 400);
    };
    window.addEventListener('odo:changed', onChange);
    return () => {
      window.removeEventListener('odo:changed', onChange);
      clearTimeout(timer.current);
    };
  }, [folderId, load]);

  // Пока файлы обрабатываются на сервере — обновляем статус.
  useEffect(() => {
    if (!items?.some((i) => i.status === 'processing')) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [items, load]);

  return [items, load];
}

export function FolderPage({ id }) {
  const app = useApp();
  const { tree, pathOf, canEdit } = app;
  const { addEntries } = useUploads();
  const folder = tree.byId.get(id);
  const [items] = useFolderItems(id);
  const [view, setView] = useLocalState('odo:view', 'grid');
  const [sort, setSort] = useLocalState('odo:sort', 'name');
  const [selected, setSelected] = useState(new Set());
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef(null);
  const dirInput = useRef(null);
  const cameraInput = useRef(null);

  useEffect(() => {
    setSelected(new Set());
  }, [id]);

  const sorted = useMemo(() => sortItems(items || [], sort), [items, sort]);
  const children = tree.children.get(id) || [];
  const selectedItems = sorted.filter((i) => selected.has(i.id));

  if (!tree.loaded) return <div className="page"><div className="loading">Загрузка…</div></div>;
  if (!folder) {
    return (
      <div className="page">
        <div className="empty"><Inbox size={40} /><h3>Папка не найдена</h3><p>Возможно, её удалили или переместили.</p><a className="btn" href="#/">На главную</a></div>
      </div>
    );
  }

  const path = pathOf(id);
  const crumbs = [{ label: 'Главная', href: '#/' }, ...path.slice(0, -1).map((f) => ({ label: f.name, href: `#/f/${f.id}` }))];
  const next = NEXT_KIND[folder.kind];

  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!canEdit) return;
    readDrop(e.dataTransfer).then((entries) => addEntries(id, entries));
  };
  const dragProps = canEdit ? {
    onDragEnter: (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e) => e.preventDefault(),
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop,
  } : {};

  const newMenu = (e) => app.showMenu(e, [
    ...Object.keys(KINDS).map((k) => ({ label: `${KINDS[k].label}`, icon: () => <KindIcon kind={k} size={11} />, onClick: () => createFolder(app, id, k) })),
    'divider',
    { label: 'Ссылка', icon: Link2, onClick: () => addLink(app, id) },
  ], { anchor: true, title: 'Создать' });

  const uploadMenu = (e) => app.showMenu(e, [
    { label: 'Снять фото или видео', icon: Camera, hidden: !isTouch(), onClick: () => cameraInput.current.click() },
    { label: isTouch() ? 'Выбрать файлы' : 'Файлы…', icon: Upload, onClick: () => fileInput.current.click() },
    { label: 'Папку целиком…', icon: FolderUp, hidden: isTouch(), onClick: () => dirInput.current.click() },
  ], { anchor: true, title: `Загрузить в «${folder.name}»` });

  const empty = items && !items.length && !children.length;
  const totalSize = (items || []).reduce((s, i) => s + (i.size || 0), 0);

  return (
    <div className={`page ${dragging ? 'dragging' : ''}`} {...dragProps}>
      <PageHeader
        crumbs={crumbs}
        title={<><KindIcon kind={folder.kind} size={18} /> {folder.name}</>}
        subtitle={folder.description}
      >
        {canEdit && (
          <>
            <button className="btn" onClick={newMenu}><Plus size={16} /> <span className="hide-sm">Создать</span></button>
            <button className="btn btn-primary" onClick={uploadMenu}><CloudUpload size={16} /> <span className="hide-sm">Загрузить</span></button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addEntries(id, filesFromInput(e.target.files)); e.target.value = ''; }} />
            <input ref={dirInput} type="file" multiple hidden webkitdirectory="" directory=""
              onChange={(e) => { addEntries(id, filesFromInput(e.target.files)); e.target.value = ''; }} />
            <input ref={cameraInput} type="file" accept="image/*,video/*" capture="environment" hidden
              onChange={(e) => { addEntries(id, filesFromInput(e.target.files)); e.target.value = ''; }} />
          </>
        )}
      </PageHeader>

      {children.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Папки</h2><span className="muted">{children.length}</span></div>
          <div className="folder-grid">
            {children.map((f) => (
              <FolderTile key={f.id} folder={f} childCount={(tree.children.get(f.id) || []).length}
                onMenu={(e) => app.showMenu(e, folderMenu(app, f), { title: f.name })} />
            ))}
          </div>
        </section>
      )}

      {items === null ? (
        <div className="loading">Загрузка…</div>
      ) : empty ? (
        <div className="empty dropzone-hint">
          <CloudUpload size={44} strokeWidth={1.5} />
          <h3>Здесь пока пусто</h3>
          {canEdit ? (
            <>
              <p>Перетащите сюда файлы или целые папки — можно сразу сотни документов и видео до 5 ГБ.</p>
              <div className="row-gap">
                <button className="btn btn-primary" onClick={() => fileInput.current.click()}><Upload size={16} /> Выбрать файлы</button>
                <button className="btn" onClick={() => createFolder(app, id, next)}><FolderPlus size={16} /> Новый {KINDS[next].acc}</button>
              </div>
            </>
          ) : <p>В этой папке ещё нет документов.</p>}
        </div>
      ) : items.length > 0 && (
        <section className="section">
          <div className="section-head">
            {selected.size > 0 ? (
              <div className="selection-bar">
                <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Снять выделение"><X size={16} /></button>
                <strong>Выбрано: {selected.size}</strong>
                <button className="btn btn-small" onClick={() => setSelected(new Set(sorted.map((i) => i.id)))}>Выбрать все</button>
                {canEdit && (
                  <>
                    <button className="btn btn-small" onClick={async () => { if (await moveItems(app, selectedItems)) setSelected(new Set()); }}><FolderInput size={14} /> Переместить</button>
                    <button className="btn btn-small btn-danger-ghost" onClick={async () => { if (await deleteItems(app, selectedItems)) setSelected(new Set()); }}><Trash2 size={14} /> Удалить</button>
                  </>
                )}
              </div>
            ) : (
              <>
                <h2>Документы</h2>
                <span className="muted">{items.length} · {fmtSize(totalSize)}</span>
              </>
            )}
            <div className="section-tools">
              <SortButton sort={sort} setSort={setSort} />
              <ViewToggle view={view} setView={setView} />
            </div>
          </div>
          <ItemsArea items={sorted} view={view} selectable={canEdit} selected={selected} setSelected={setSelected} />
        </section>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <CloudUpload size={44} strokeWidth={1.5} />
            <strong>Отпустите, чтобы загрузить</strong>
            <span>в «{folder.name}»</span>
          </div>
        </div>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function useRecent(limit) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const load = () => api.get(`/items/recent?limit=${limit}`).then(setItems).catch(() => setItems([]));
    load();
    let t;
    const onChange = () => { clearTimeout(t); t = setTimeout(load, 600); };
    window.addEventListener('odo:changed', onChange);
    return () => { window.removeEventListener('odo:changed', onChange); clearTimeout(t); };
  }, [limit]);
  return items;
}

export function HomePage() {
  const app = useApp();
  const { tree, canEdit, user } = app;
  const roots = tree.children.get('root') || [];
  const recent = useRecent(12);
  const [view, setView] = useLocalState('odo:view', 'grid');
  const first = user.name.split(' ')[0];

  return (
    <div className="page">
      <PageHeader title={`${greeting()}, ${first}`} subtitle="Все объекты, документы и видео — в одном месте.">
        {canEdit && <button className="btn btn-primary" onClick={() => createFolder(app, null, 'object')}><Plus size={16} /> Новый объект</button>}
      </PageHeader>

      <section className="section">
        <div className="section-head"><h2>Объекты</h2><span className="muted">{roots.length}</span></div>
        {!tree.loaded ? <div className="loading">Загрузка…</div> : roots.length ? (
          <div className="folder-grid large">
            {roots.map((f) => (
              <FolderTile key={f.id} folder={f} childCount={(tree.children.get(f.id) || []).length}
                onMenu={(e) => app.showMenu(e, folderMenu(app, f), { title: f.name })} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <KindIcon kind="object" size={28} />
            <h3>Создайте первый объект</h3>
            <p>Объекты содержат группы, группы — разделы, а в разделах лежат документы. Вкладывать можно как папки на компьютере.</p>
            {canEdit && <button className="btn btn-primary" onClick={() => createFolder(app, null, 'object')}><Plus size={16} /> Новый объект</button>}
          </div>
        )}
      </section>

      {recent?.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Недавние</h2>
            <a className="link-more" href="#/recent">Все <ChevronRight size={14} /></a>
            <div className="section-tools"><ViewToggle view={view} setView={setView} /></div>
          </div>
          <ItemsArea items={recent} view={view} pathFor={(i) => app.pathOf(i.folder_id).map((f) => f.name).join(' › ')} />
        </section>
      )}
    </div>
  );
}

export function RecentPage() {
  const app = useApp();
  const recent = useRecent(100);
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Главная', href: '#/' }]} title="Недавние"
        subtitle={recent ? `${recent.length} ${plural(recent.length, 'документ', 'документа', 'документов')}` : ''} />
      {recent === null ? <div className="loading">Загрузка…</div> : (
        <ItemsArea items={recent} view="list" pathFor={(i) => app.pathOf(i.folder_id).map((f) => f.name).join(' › ')} />
      )}
    </div>
  );
}
