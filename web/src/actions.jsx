import { CheckCircle2, Download, ExternalLink, Eye, FolderInput, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, fileUrl, notifyChanged, notifyFolders } from './api';
import { FolderDialog, ItemDialog, LinkDialog, MoveDialog } from './components/Dialogs';
import { go, KINDS, NEXT_KIND, plural } from './utils';

const fail = (app) => (e) => app.toast(e.message, 'error');

export async function createFolder(app, parentId, kind) {
  const created = await app.dialog((close) => <FolderDialog parentId={parentId} kind={kind} onClose={close} />);
  if (created) {
    notifyFolders();
    app.toast(`${KINDS[created.kind].label} «${created.name}» создан${created.kind === 'group' ? 'а' : ''}`);
  }
  return created;
}

export async function editFolder(app, folder) {
  const res = await app.dialog((close) => <FolderDialog folder={folder} onClose={close} />);
  if (res) notifyFolders();
}

function subtree(app, id) {
  const ids = new Set([id]);
  const walk = (pid) => (app.tree.children.get(pid) || []).forEach((c) => { ids.add(c.id); walk(c.id); });
  walk(id);
  return ids;
}

export async function moveFolder(app, folder) {
  await app.dialog((close) => (
    <MoveDialog title={`Переместить «${folder.name}»`} allowRoot exclude={subtree(app, folder.id)} currentId={folder.parent_id}
      onClose={close}
      onSubmit={async (target) => {
        await api.patch(`/folders/${folder.id}`, { parent_id: target });
        notifyFolders();
        app.toast('Перемещено');
      }} />
  ));
}

export async function deleteFolder(app, folder) {
  const ok = await app.confirm({
    title: `Удалить «${folder.name}»?`,
    text: 'Будут удалены все вложенные группы, разделы, файлы и комментарии. Это нельзя отменить.',
    ok: 'Удалить', danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.del(`/folders/${folder.id}`);
    notifyFolders();
    app.toast(`Удалено${res.deleted_items ? `, файлов: ${res.deleted_items}` : ''}`);
    if (window.location.hash.includes(folder.id)) go(folder.parent_id ? `/f/${folder.parent_id}` : '/');
  } catch (e) {
    fail(app)(e);
  }
}

export function folderMenu(app, folder) {
  const next = NEXT_KIND[folder.kind];
  return [
    { label: 'Открыть', icon: Eye, onClick: () => go(`/f/${folder.id}`) },
    'divider',
    { label: `Новый ${KINDS[next].acc} внутри`, icon: Plus, hidden: !app.canEdit, onClick: () => createFolder(app, folder.id, next) },
    { label: 'Изменить', icon: Pencil, hidden: !app.canEdit, onClick: () => editFolder(app, folder) },
    { label: 'Переместить…', icon: FolderInput, hidden: !app.canEdit, onClick: () => moveFolder(app, folder) },
    'divider',
    { label: 'Удалить', icon: Trash2, danger: true, hidden: !app.canEdit, onClick: () => deleteFolder(app, folder) },
  ];
}

export async function addLink(app, folderId) {
  const item = await app.dialog((close) => <LinkDialog folderId={folderId} onClose={close} />);
  if (item) {
    notifyChanged(folderId);
    app.toast('Ссылка добавлена');
  }
}

export async function editItem(app, item) {
  const res = await app.dialog((close) => <ItemDialog item={item} onClose={close} />);
  if (res) notifyChanged(item.folder_id);
  return res;
}

export async function moveItems(app, items) {
  const folderIds = new Set(items.map((i) => i.folder_id));
  return app.dialog((close) => (
    <MoveDialog
      title={items.length === 1 ? `Переместить «${items[0].title}»` : `Переместить ${items.length} ${plural(items.length, 'документ', 'документа', 'документов')}`}
      currentId={folderIds.size === 1 ? items[0].folder_id : null}
      onClose={close}
      onSubmit={async (target) => {
        await api.post('/items/bulk', { action: 'move', ids: items.map((i) => i.id), folder_id: target });
        folderIds.forEach((id) => notifyChanged(id));
        notifyChanged(target);
        notifyFolders();
        app.toast('Перемещено');
      }} />
  ));
}

export async function deleteItems(app, items) {
  const one = items.length === 1;
  const ok = await app.confirm({
    title: one ? `Удалить «${items[0].title}»?` : `Удалить ${items.length} ${plural(items.length, 'документ', 'документа', 'документов')}?`,
    text: 'Файлы и комментарии будут удалены безвозвратно.',
    ok: 'Удалить', danger: true,
  });
  if (!ok) return false;
  try {
    await api.post('/items/bulk', { action: 'delete', ids: items.map((i) => i.id) });
    new Set(items.map((i) => i.folder_id)).forEach((id) => notifyChanged(id));
    notifyFolders();
    app.toast('Удалено');
    return true;
  } catch (e) {
    fail(app)(e);
    return false;
  }
}

export function downloadItem(item) {
  const a = document.createElement('a');
  a.href = fileUrl(item.id, 'raw', true);
  a.download = item.original_name || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function itemMenu(app, item, onOpen, onSelect) {
  return [
    { label: 'Открыть', icon: Eye, onClick: onOpen },
    { label: 'Выбрать', icon: CheckCircle2, hidden: !onSelect, onClick: onSelect },
    { label: 'Открыть ссылку', icon: ExternalLink, hidden: item.type !== 'link', onClick: () => window.open(item.url, '_blank', 'noopener') },
    { label: 'Скачать', icon: Download, hidden: item.type !== 'file', onClick: () => downloadItem(item) },
    'divider',
    { label: 'Изменить', icon: Pencil, hidden: !app.canEdit, onClick: () => editItem(app, item) },
    { label: 'Переместить…', icon: FolderInput, hidden: !app.canEdit, onClick: () => moveItems(app, [item]) },
    'divider',
    { label: 'Удалить', icon: Trash2, danger: true, hidden: !app.canEdit, onClick: () => deleteItems(app, [item]) },
  ];
}
