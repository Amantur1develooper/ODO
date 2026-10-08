import { useMemo, useState } from 'react';
import { Home, Search } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { KINDS, ROLES } from '../utils';
import { FormModal } from './Modal';
import { KindIcon } from './Items';

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function FolderDialog({ folder, parentId, kind: initialKind, onClose }) {
  const [name, setName] = useState(folder?.name || '');
  const [kind, setKind] = useState(folder?.kind || initialKind || 'section');
  const [description, setDescription] = useState(folder?.description || '');
  const isNew = !folder;
  return (
    <FormModal
      title={isNew ? `Новый ${KINDS[kind].label.toLowerCase()}`.replace('Новый группа', 'Новая группа') : 'Изменить'}
      submitLabel={isNew ? 'Создать' : 'Сохранить'}
      onClose={onClose}
      onSubmit={async () => {
        const body = { name, kind, description };
        const res = isNew ? await api.post('/folders', { ...body, parent_id: parentId || null }) : await api.patch(`/folders/${folder.id}`, body);
        onClose(res);
      }}
    >
      <Field label="Тип">
        <Segmented value={kind} onChange={setKind}
          options={Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label, icon: <KindIcon kind={value} size={12} /> }))} />
      </Field>
      <Field label="Название">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, ЖК «Ала-Тоо»" maxLength={255} />
      </Field>
      <Field label="Описание" hint="Необязательно">
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </FormModal>
  );
}

export function LinkDialog({ folderId, onClose }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return (
    <FormModal title="Новая ссылка" submitLabel="Добавить" onClose={onClose}
      onSubmit={async () => onClose(await api.post('/items/link', { folder_id: folderId, url, title, description }))}>
      <Field label="Адрес">
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
      </Field>
      <Field label="Название" hint="Если оставить пустым — возьмём заголовок страницы">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
      </Field>
      <Field label="Описание">
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </FormModal>
  );
}

export function ItemDialog({ item, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [url, setUrl] = useState(item.url);
  return (
    <FormModal title="Изменить" onClose={onClose}
      onSubmit={async () => {
        const body = { title, description, ...(item.type === 'link' ? { url } : {}) };
        onClose(await api.patch(`/items/${item.id}`, body));
      }}>
      <Field label="Название">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
      </Field>
      {item.type === 'link' && (
        <Field label="Адрес"><input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      )}
      <Field label="Описание" hint="Описание тоже участвует в поиске">
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </FormModal>
  );
}

/** Выбор папки для перемещения. exclude — id, куда нельзя (сама папка и вложенные). */
export function MoveDialog({ title, exclude = new Set(), allowRoot = false, currentId, onClose, onSubmit }) {
  const { tree } = useApp();
  const [target, setTarget] = useState(null);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const out = [];
    const walk = (parent, depth) => {
      for (const f of tree.children.get(parent) || []) {
        if (exclude.has(f.id)) continue;
        out.push({ f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk('root', 0);
    const q = filter.trim().toLowerCase();
    return q ? out.filter((r) => r.f.name.toLowerCase().includes(q)).map((r) => ({ ...r, depth: 0 })) : out;
  }, [tree, exclude, filter]);

  return (
    <FormModal title={title} submitLabel="Переместить" onClose={onClose} width={480}
      onSubmit={async () => {
        if (target === null) throw new Error('Выберите, куда переместить');
        await onSubmit(target === 'root' ? null : target);
        onClose(true);
      }}>
      <div className="search-input small">
        <Search size={15} />
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти папку" />
      </div>
      <div className="picker">
        {allowRoot && !filter && (
          <button type="button" className={`picker-row ${target === 'root' ? 'on' : ''}`} onClick={() => setTarget('root')}>
            <span className="kind-icon kind-root"><Home size={14} /></span> Верхний уровень
          </button>
        )}
        {rows.map(({ f, depth }) => (
          <button type="button" key={f.id} disabled={f.id === currentId}
            className={`picker-row ${target === f.id ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 18 }}
            onClick={() => setTarget(f.id)}>
            <KindIcon kind={f.kind} size={12} /> <span className="ellipsis">{f.name}</span>
            {f.id === currentId && <span className="muted small">— сейчас здесь</span>}
          </button>
        ))}
        {!rows.length && <div className="muted pad">Ничего не найдено</div>}
      </div>
    </FormModal>
  );
}

export function PasswordDialog({ onClose }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  return (
    <FormModal title="Сменить пароль" onClose={onClose} width={400}
      onSubmit={async () => {
        await api.post('/auth/password', { old_password: oldPassword, new_password: newPassword });
        onClose(true);
      }}>
      <Field label="Текущий пароль"><input type="password" autoFocus value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="Новый пароль" hint="Не короче 6 символов"><input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" /></Field>
    </FormModal>
  );
}

export function UserDialog({ user, onClose }) {
  const [name, setName] = useState(user?.name || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'viewer');
  const [password, setPassword] = useState('');
  const isNew = !user;
  return (
    <FormModal title={isNew ? 'Новый пользователь' : 'Изменить пользователя'} submitLabel={isNew ? 'Создать' : 'Сохранить'}
      onClose={onClose}
      onSubmit={async () => {
        const body = { name, username, email, role, ...(password ? { password } : {}) };
        onClose(isNew ? await api.post('/users', body) : await api.patch(`/users/${user.id}`, body));
      }}>
      <Field label="Имя"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Логин" hint="Для входа. Латиница, цифры, точка, дефис, подчёркивание">
        <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="off"
          autoCapitalize="none" spellCheck={false} placeholder="например, ivanov" />
      </Field>
      <Field label="Email" hint="Необязательно">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Доступ">
        <div className="role-options">
          {Object.entries(ROLES).map(([value, r]) => (
            <button type="button" key={value} className={`role-option ${role === value ? 'on' : ''}`} onClick={() => setRole(value)}>
              <strong>{r.label}</strong>
              <span>{r.hint}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label={isNew ? 'Пароль' : 'Новый пароль'} hint={isNew ? 'Не короче 6 символов' : 'Оставьте пустым, чтобы не менять'}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
    </FormModal>
  );
}
