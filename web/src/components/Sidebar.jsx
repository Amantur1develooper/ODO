import { useEffect } from 'react';
import { ChevronRight, Clock, History, Home, KeyRound, LogOut, Plus, Search, Settings2, Users } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { createFolder, folderMenu } from '../actions';
import { ROLES, useLocalState, useLongPress } from '../utils';
import { KindIcon } from './Items';
import { PasswordDialog } from './Dialogs';

function TreeNode({ folder, depth, activeId, expanded, toggle }) {
  const app = useApp();
  const kids = app.tree.children.get(folder.id) || [];
  const open = expanded.includes(folder.id);
  const menu = (e) => app.showMenu(e, folderMenu(app, folder), { title: folder.name });
  const longPress = useLongPress(menu);
  return (
    <>
      <a href={`#/f/${folder.id}`} className={`tree-row ${activeId === folder.id ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }} onContextMenu={menu} {...longPress}>
        <button className={`disclosure ${open ? 'open' : ''}`} style={{ visibility: kids.length ? 'visible' : 'hidden' }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(folder.id); }} aria-label={open ? 'Свернуть' : 'Развернуть'}>
          <ChevronRight size={12} strokeWidth={2.5} />
        </button>
        <KindIcon kind={folder.kind} size={11} />
        <span className="tree-name">{folder.name}</span>
      </a>
      {open && kids.map((k) => (
        <TreeNode key={k.id} folder={k} depth={depth + 1} activeId={activeId} expanded={expanded} toggle={toggle} />
      ))}
    </>
  );
}

/** Меню профиля: используется и в боковой панели, и во вкладке «Профиль» на телефоне. */
export function useUserMenu() {
  const app = useApp();
  const { isAdmin } = app;
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    app.setUser(null);
  };
  return (e) => app.showMenu(e, [
    { label: 'Пользователи', icon: Users, hidden: !isAdmin, onClick: () => { window.location.hash = '/users'; } },
    { label: 'Журнал действий', icon: History, hidden: !isAdmin, onClick: () => { window.location.hash = '/activity'; } },
    { label: 'Администрирование Django', icon: Settings2, hidden: !isAdmin, onClick: () => window.open('/admin/', '_blank') },
    { label: 'Сменить пароль', icon: KeyRound, onClick: async () => {
      if (await app.dialog((close) => <PasswordDialog onClose={close} />)) app.toast('Пароль изменён');
    } },
    'divider',
    { label: 'Выйти', icon: LogOut, danger: true, onClick: logout },
  ], { anchor: true, title: `${app.user.name} · ${ROLES[app.user.role].label}` });
}

export function Sidebar({ route, onSearch, open, onClose }) {
  const app = useApp();
  const { tree, user, canEdit, isAdmin } = app;
  const userMenu = useUserMenu();
  const [expanded, setExpanded] = useLocalState('odo:expanded', []);
  const activeId = route.name === 'folder' ? route.id : null;
  const roots = tree.children.get('root') || [];

  // Разворачиваем путь до открытой папки.
  useEffect(() => {
    if (!activeId) return;
    const ancestors = app.pathOf(activeId).slice(0, -1).map((f) => f.id);
    if (ancestors.some((id) => !expanded.includes(id))) setExpanded((e) => [...new Set([...e, ...ancestors])]);
  }, [activeId, tree]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));


  return (
    <>
      <div className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={(e) => e.target.closest('a') && onClose()}>
        <div className="sidebar-top">
          <a href="#/" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <div>
              <strong>ОДО</strong>
              <span>Онлайн документооборот</span>
            </div>
          </a>
          <button className="sidebar-search" onClick={onSearch}>
            <Search size={15} />
            <span>Поиск</span>
            <kbd>{navigator.platform?.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        </div>

        <nav className="sidebar-nav">
          <a href="#/" className={`nav-row ${route.name === 'home' ? 'active' : ''}`}><Home size={16} /> Главная</a>
          <a href="#/recent" className={`nav-row ${route.name === 'recent' ? 'active' : ''}`}><Clock size={16} /> Недавние</a>
          {isAdmin && <a href="#/users" className={`nav-row ${route.name === 'users' ? 'active' : ''}`}><Users size={16} /> Пользователи</a>}
          {isAdmin && <a href="#/activity" className={`nav-row ${route.name === 'activity' ? 'active' : ''}`}><History size={16} /> Журнал</a>}

          <div className="sidebar-heading">
            <span>Объекты</span>
            {canEdit && (
              <button className="icon-btn tiny" onClick={() => createFolder(app, null, 'object')} aria-label="Новый объект" title="Новый объект">
                <Plus size={14} />
              </button>
            )}
          </div>
          <div className="tree">
            {roots.map((f) => (
              <TreeNode key={f.id} folder={f} depth={0} activeId={activeId} expanded={expanded} toggle={toggle} />
            ))}
            {tree.loaded && !roots.length && <div className="tree-empty">Пока нет объектов</div>}
          </div>
        </nav>

        <button className="sidebar-user" onClick={userMenu}>
          <div className="avatar">{user.name[0]}</div>
          <div className="sidebar-user-text">
            <strong>{user.name}</strong>
            <span>{ROLES[user.role].label}</span>
          </div>
        </button>
      </aside>
    </>
  );
}
