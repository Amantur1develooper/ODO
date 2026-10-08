import { useState } from 'react';
import { api } from '../api';

export function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.post('/auth/login', { username, password });
      onLogin(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" alt="" width={64} height={64} className="login-logo" />
        <h1>ОДО</h1>
        <p className="muted">Онлайн документооборот</p>
        <input type="text" name="username" placeholder="Логин" value={username} onChange={(e) => setUsername(e.target.value)}
          autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-large" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</button>
      </form>
    </div>
  );
}
