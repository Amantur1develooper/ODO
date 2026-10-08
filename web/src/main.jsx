import { Component, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft, Clock, FolderTree, Home, Search, UserCircle2 } from 'lucide-react';
import { api } from './api';
import { AppProvider } from './store';
import { UploadProvider } from './uploads';
import { parseRoute } from './utils';
import { Login } from './components/Login';
import { Sidebar, useUserMenu } from './components/Sidebar';
import { useApp } from './store';
import { FolderPage, HomePage, RecentPage } from './components/Pages';
import { SearchPage, Spotlight } from './components/Search';
import { UsersPage } from './components/Users';
import { ActivityPage } from './components/Activity';
import { Viewer } from './components/Viewer';
import './styles.css';

function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

const PAGE_TITLES = { home: 'ОДО', recent: 'Недавние', search: 'Поиск', users: 'Пользователи', activity: 'Журнал' };

/** Верхняя панель на телефоне: «назад» к родительской папке и название текущего экрана. */
function MobileBar({ route }) {
  const { tree } = useApp();
  const folder = route.name === 'folder' ? tree.byId.get(route.id) : null;
  const parent = folder?.parent_id ? tree.byId.get(folder.parent_id) : null;
  const back = route.name === 'home' ? null : folder ? (parent ? `#/f/${parent.id}` : '#/') : '#/';
  return (
    <div className="mobile-bar">
      {back ? (
        <a className="mobile-back" href={back}><ChevronLeft size={22} /> <span>{parent ? parent.name : 'Главная'}</span></a>
      ) : <span className="mobile-back" />}
      <strong className="mobile-title">{folder ? folder.name : PAGE_TITLES[route.name] || 'ОДО'}</strong>
      <span className="mobile-back" />
    </div>
  );
}

/** Нижние вкладки на телефоне, как в приложениях iOS. */
function TabBar({ route, onSearch, onTree }) {
  const userMenu = useUserMenu();
  const tab = (active, icon, label, props) => (
    <button className={`tab ${active ? 'on' : ''}`} {...props}>{icon}<span>{label}</span></button>
  );
  return (
    <nav className="tabbar" aria-label="Навигация">
      {tab(route.name === 'home', <Home size={22} />, 'Главная', { onClick: () => { window.location.hash = '/'; } })}
      {tab(route.name === 'folder', <FolderTree size={22} />, 'Объекты', { onClick: onTree })}
      {tab(route.name === 'search', <Search size={22} />, 'Поиск', { onClick: onSearch })}
      {tab(route.name === 'recent', <Clock size={22} />, 'Недавние', { onClick: () => { window.location.hash = '/recent'; } })}
      {tab(['users', 'activity'].includes(route.name), <UserCircle2 size={22} />, 'Профиль', { onClick: userMenu })}
    </nav>
  );
}

function Shell() {
  const route = useRoute();
  const [spot, setSpot] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpot(true);
      } else if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]')) {
        e.preventDefault();
        setSpot(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.querySelector('.main')?.scrollTo(0, 0);
    setMenuOpen(false);
  }, [route.name, route.id]);

  let page;
  if (route.name === 'folder') page = <FolderPage key={route.id} id={route.id} />;
  else if (route.name === 'search') page = <SearchPage q={route.q} type={route.type} />;
  else if (route.name === 'recent') page = <RecentPage />;
  else if (route.name === 'users') page = <UsersPage />;
  else if (route.name === 'activity') page = <ActivityPage group={route.group} user={route.user} item={route.item} />;
  else page = <HomePage />;

  return (
    <div className="app">
      <Sidebar route={route} onSearch={() => setSpot(true)} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="main">
        <MobileBar route={route} />
        {page}
      </main>
      <TabBar route={route} onSearch={() => setSpot(true)} onTree={() => setMenuOpen(true)} />
      {spot && <Spotlight onClose={() => setSpot(false)} />}
      <Viewer />
    </div>
  );
}

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot">
        <div className="empty crash">
          <h3>Что-то пошло не так</h3>
          <p>{String(this.state.error.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Перезагрузить</button>
        </div>
      </div>
    );
  }
}

function Root() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    const onLogout = () => setUser(null);
    window.addEventListener('odo:logout', onLogout);
    return () => window.removeEventListener('odo:logout', onLogout);
  }, []);

  if (user === undefined) return <div className="boot"><img src="/favicon.svg" alt="" width={56} height={56} /></div>;
  if (!user) {
    return <Login onLogin={(u) => api.get('/auth/me').finally(() => setUser(u))} />;
  }
  return (
    <AppProvider user={user} setUser={setUser}>
      <UploadProvider>
        <Shell />
      </UploadProvider>
    </AppProvider>
  );
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><Root /></ErrorBoundary>);
