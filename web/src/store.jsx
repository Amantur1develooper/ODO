import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { sortFolders } from './utils';
import { ConfirmDialog } from './components/Modal';
import { ContextMenu } from './components/Menu';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ user, setUser, children }) {
  const [folders, setFolders] = useState(null);
  const [dialogs, setDialogs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [menu, setMenu] = useState(null);
  const [viewer, setViewer] = useState(null);
  const seq = useRef(0);

  const reloadFolders = useCallback(async () => {
    setFolders(await api.get('/folders'));
  }, []);

  useEffect(() => {
    reloadFolders().catch(() => setFolders([]));
    const onChange = () => reloadFolders().catch(() => {});
    window.addEventListener('odo:folders', onChange);
    return () => window.removeEventListener('odo:folders', onChange);
  }, [reloadFolders]);

  const tree = useMemo(() => {
    const byId = new Map();
    const children = new Map();
    for (const f of folders || []) {
      byId.set(f.id, f);
      const key = f.parent_id || 'root';
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(f);
    }
    for (const [k, list] of children) children.set(k, sortFolders(list));
    return { byId, children, loaded: folders !== null };
  }, [folders]);

  const pathOf = useCallback(
    (id) => {
      const out = [];
      let cur = tree.byId.get(id);
      for (let guard = 0; cur && guard < 100; guard++) {
        out.unshift(cur);
        cur = tree.byId.get(cur.parent_id);
      }
      return out;
    },
    [tree],
  );

  const toast = useCallback((text, kind = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3000);
  }, []);

  const dialog = useCallback(
    (render) =>
      new Promise((resolve) => {
        const id = ++seq.current;
        const close = (value) => {
          setDialogs((d) => d.filter((x) => x.id !== id));
          resolve(value);
        };
        setDialogs((d) => [...d, { id, node: render(close) }]);
      }),
    [],
  );

  const confirm = useCallback((opts) => dialog((close) => <ConfirmDialog {...opts} onClose={close} />), [dialog]);

  const showMenu = useCallback((e, items, { anchor = false, title } = {}) => {
    e.preventDefault();
    e.stopPropagation();
    let x = e.clientX;
    let y = e.clientY;
    if ((anchor || (!x && !y)) && e.currentTarget?.getBoundingClientRect) {
      const r = e.currentTarget.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 4;
    }
    setMenu({ x, y, items, title });
  }, []);

  const openViewer = useCallback((items, index = 0) => setViewer({ items, index }), []);

  const value = {
    user, setUser, canEdit: !!user?.can_edit, isAdmin: user?.role === 'admin',
    folders: folders || [], tree, pathOf, reloadFolders,
    toast, dialog, confirm, showMenu, viewer, setViewer, openViewer,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      {dialogs.map((d) => (
        <div key={d.id}>{d.node}</div>
      ))}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
