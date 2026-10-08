import { useEffect, useState } from 'react';
import { MoreHorizontal, Pencil, Trash2, UserPlus, Lock, Unlock } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { fmtDate, ROLES } from '../utils';
import { UserDialog } from './Dialogs';
import { PageHeader } from './Pages';

export function UsersPage() {
  const app = useApp();
  const [users, setUsers] = useState(null);
  const load = () => api.get('/users').then(setUsers).catch((e) => app.toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.isAdmin) return <div className="page"><div className="empty"><h3>Только для администратора</h3></div></div>;

  const edit = async (user) => {
    if (await app.dialog((close) => <UserDialog user={user} onClose={close} />)) {
      load();
      app.toast(user ? 'Сохранено' : 'Пользователь создан');
    }
  };
  const patch = async (user, body) => {
    try {
      await api.patch(`/users/${user.id}`, body);
      load();
    } catch (e) {
      app.toast(e.message, 'error');
    }
  };
  const remove = async (user) => {
    if (!(await app.confirm({ title: `Удалить ${user.name}?`, text: 'Документы и комментарии пользователя останутся.', ok: 'Удалить', danger: true }))) return;
    try {
      await api.del(`/users/${user.id}`);
      load();
    } catch (e) {
      app.toast(e.message, 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: 'Главная', href: '#/' }]} title="Пользователи"
        subtitle="Редакторы добавляют, изменяют и удаляют. Наблюдатели только смотрят и комментируют.">
        <button className="btn btn-primary" onClick={() => edit(null)}><UserPlus size={16} /> Добавить</button>
      </PageHeader>
      {!users ? <div className="loading">Загрузка…</div> : (
        <div className="list users-list">
          {users.map((u) => (
            <div key={u.id} className={`row user-row ${u.is_active ? '' : 'inactive'}`} onClick={() => edit(u)}>
              <div className="avatar">{u.name[0]}</div>
              <div className="row-name">
                <span className="row-title">{u.name}{u.id === app.user.id && <span className="muted"> · это вы</span>}</span>
                <span className="row-path">{u.username}{u.email ? ` · ${u.email}` : ''}</span>
              </div>
              <div className="row-col"><span className={`role-pill role-${u.role}`}>{ROLES[u.role].label}</span></div>
              <div className="row-col row-date hide-sm">{u.is_active ? (u.last_login ? `Входил ${fmtDate(u.last_login)}` : 'Ещё не входил') : 'Заблокирован'}</div>
              <button className="icon-btn" aria-label="Действия" onClick={(e) => app.showMenu(e, [
                { label: 'Изменить', icon: Pencil, onClick: () => edit(u) },
                ...Object.keys(ROLES).filter((r) => r !== u.role).map((r) => ({ label: `Сделать: ${ROLES[r].label}`, onClick: () => patch(u, { role: r }) })),
                'divider',
                u.is_active
                  ? { label: 'Заблокировать', icon: Lock, hidden: u.id === app.user.id, onClick: () => patch(u, { is_active: false }) }
                  : { label: 'Разблокировать', icon: Unlock, onClick: () => patch(u, { is_active: true }) },
                { label: 'Удалить', icon: Trash2, danger: true, hidden: u.id === app.user.id, onClick: () => remove(u) },
              ], { anchor: true })}>
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
