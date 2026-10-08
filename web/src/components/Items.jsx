import { useState } from 'react';
import {
  Building2, Check, Film, Folder, Image as ImageIcon, Layers, Link2, Loader2, MessageCircle, MoreHorizontal, Music, Play,
} from 'lucide-react';
import { fileUrl } from '../api';
import { CATEGORY_LABEL, fmtDate, fmtDuration, fmtSize, hostOf, KINDS, plural, useLongPress } from '../utils';

const EXT_COLORS = [
  [['pdf'], '#e5484d'],
  [['doc', 'docx', 'docm', 'odt', 'rtf', 'pages'], '#2f7cf6'],
  [['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'], '#1f9d55'],
  [['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key'], '#f2711c'],
  [['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'], '#8d8d93'],
  [['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml'], '#636366'],
];
const extColor = (ext) => EXT_COLORS.find(([list]) => list.includes(ext))?.[1] || '#8e8e93';

const CATEGORY_ICON = {
  video: [Film, '#8e5cf7'],
  audio: [Music, '#e93d82'],
  image: [ImageIcon, '#12a5c9'],
  link: [Link2, 'var(--accent)'],
};

/** Иконка файла: «листок» с цветной меткой расширения либо значок для медиа. */
export function FileIcon({ ext = '', category, size = 40 }) {
  if (CATEGORY_ICON[category]) {
    const [Icon, color] = CATEGORY_ICON[category];
    return (
      <span className="type-square" style={{ width: size, height: size, '--c': color }}>
        <Icon size={Math.round(size * 0.5)} strokeWidth={1.8} />
      </span>
    );
  }
  const label = (ext || 'FILE').slice(0, 4).toUpperCase();
  return (
    <svg className="file-icon" width={size * 0.84} height={size} viewBox="0 0 40 48" aria-hidden="true">
      <path d="M7 1.5h19.5L37 12v32.5a2.5 2.5 0 0 1-2.5 2.5h-27A2.5 2.5 0 0 1 5 44.5v-40A3 3 0 0 1 7 1.5z" className="file-page" />
      <path d="M26.5 1.5V9a3 3 0 0 0 3 3H37" className="file-fold" />
      <rect x="8" y="27" width="24" height="11" rx="3" fill={extColor(ext)} />
      <text x="20" y="35" textAnchor="middle" fontSize={label.length > 3 ? 7 : 8} fontWeight="700" fill="#fff"
        fontFamily="-apple-system, system-ui, sans-serif">{label}</text>
    </svg>
  );
}

const KIND_ICON = { object: Building2, group: Layers, section: Folder };

export function KindIcon({ kind, size = 18 }) {
  const Icon = KIND_ICON[kind] || Folder;
  return (
    <span className={`kind-icon kind-${kind}`} style={{ width: size + 10, height: size + 10 }}>
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}

export function Thumb({ item, size = 56 }) {
  const [failed, setFailed] = useState(false);
  const isSvg = item.category === 'image' && item.ext === 'svg';
  if ((item.has_thumb || isSvg) && !failed) {
    return (
      <img className="thumb-img" src={fileUrl(item.id, isSvg ? 'raw' : 'thumb')} alt="" loading="lazy" decoding="async"
        draggable={false} onError={() => setFailed(true)} />
    );
  }
  return <FileIcon ext={item.ext} category={item.type === 'link' ? 'link' : item.category} size={size} />;
}

function metaLine(item) {
  if (item.type === 'link') return hostOf(item.url);
  const parts = [];
  parts.push(item.ext ? item.ext.toUpperCase() : CATEGORY_LABEL[item.category]);
  if (item.size != null) parts.push(fmtSize(item.size));
  return parts.join(' · ');
}

function StatusBadge({ item }) {
  if (item.status === 'processing') {
    const p = item.meta?.progress;
    return (
      <span className="badge badge-processing">
        <Loader2 size={12} className="spin" /> {p ? `${p}%` : 'Обработка'}
      </span>
    );
  }
  if (item.status === 'failed') return <span className="badge badge-failed">Ошибка</span>;
  return null;
}

export function ItemCard({ item, selected, selectable, onOpen, onToggle, onMenu }) {
  const longPress = useLongPress(onMenu);
  return (
    <div
      {...longPress}
      className={`card ${selected ? 'selected' : ''}`}
      onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey) && selectable ? onToggle(e) : onOpen()}
      onContextMenu={onMenu}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={`card-thumb ${item.has_thumb ? 'has-img' : ''}`}>
        <Thumb item={item} size={64} />
        {item.category === 'video' && item.has_thumb && <span className="play-badge"><Play size={16} fill="currentColor" /></span>}
        {item.meta?.duration > 0 && <span className="badge badge-duration">{fmtDuration(item.meta.duration)}</span>}
        <StatusBadge item={item} />
        {selectable && (
          <button className={`check ${selected ? 'on' : ''}`} aria-label="Выбрать"
            onClick={(e) => { e.stopPropagation(); onToggle(e); }}>
            <Check size={13} strokeWidth={3} />
          </button>
        )}
        <button className="card-more" aria-label="Действия" onClick={(e) => { e.stopPropagation(); onMenu(e); }}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="card-title" title={item.title}>{item.title}</div>
      <div className="card-meta">
        {metaLine(item)}
        {item.comment_count > 0 && <span className="comment-pill"><MessageCircle size={11} /> {item.comment_count}</span>}
      </div>
      {item.created_by_name && (
        <div className="card-author" title={`Добавил: ${item.created_by_name}, ${fmtDate(item.created_at, true)}`}>
          <span className="avatar tiny">{item.created_by_name[0]}</span>
          <span className="ellipsis">{item.created_by_name}</span>
        </div>
      )}
    </div>
  );
}

export function ItemRow({ item, selected, selectable, onOpen, onToggle, onMenu, path }) {
  const longPress = useLongPress(onMenu);
  return (
    <div
      {...longPress}
      className={`row ${selected ? 'selected' : ''}`}
      onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey) && selectable ? onToggle(e) : onOpen()}
      onContextMenu={onMenu}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      {selectable && (
        <button className={`check inline ${selected ? 'on' : ''}`} aria-label="Выбрать"
          onClick={(e) => { e.stopPropagation(); onToggle(e); }}>
          <Check size={12} strokeWidth={3} />
        </button>
      )}
      <div className="row-thumb"><Thumb item={item} size={30} /></div>
      <div className="row-name">
        <span className="row-title">{item.title}</span>
        {path && <span className="row-path">{path}</span>}
        <span className="row-meta-mobile">
          {[metaLine(item), item.created_by_name, fmtDate(item.created_at)].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="row-col row-type">{item.type === 'link' ? hostOf(item.url) : CATEGORY_LABEL[item.category]}</div>
      <div className="row-col row-size">{item.size != null ? fmtSize(item.size) : '—'}</div>
      <div className="row-col row-author" title={item.created_by_name || ''}>{item.created_by_name || '—'}</div>
      <div className="row-col row-date">{fmtDate(item.created_at)}</div>
      <div className="row-col row-extra">
        <StatusBadge item={item} />
        {item.comment_count > 0 && <span className="comment-pill"><MessageCircle size={11} /> {item.comment_count}</span>}
      </div>
      <button className="icon-btn row-more" aria-label="Действия" onClick={(e) => { e.stopPropagation(); onMenu(e); }}>
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

export function FolderTile({ folder, childCount, onMenu }) {
  const longPress = useLongPress(onMenu);
  const parts = [];
  if (childCount) parts.push(`${childCount} ${plural(childCount, 'папка', 'папки', 'папок')}`);
  if (folder.item_count) parts.push(`${folder.item_count} ${plural(folder.item_count, 'файл', 'файла', 'файлов')}`);
  return (
    <a className="folder-tile" href={`#/f/${folder.id}`} onContextMenu={onMenu} {...longPress}>
      <KindIcon kind={folder.kind} size={20} />
      <div className="folder-tile-text">
        <div className="folder-tile-name" title={folder.name}>{folder.name}</div>
        <div className="folder-tile-meta">{KINDS[folder.kind].label}{parts.length ? ' · ' + parts.join(', ') : ' · пусто'}</div>
      </div>
      <button className="icon-btn folder-more" aria-label="Действия" onClick={(e) => { e.preventDefault(); onMenu(e); }}>
        <MoreHorizontal size={16} />
      </button>
    </a>
  );
}
