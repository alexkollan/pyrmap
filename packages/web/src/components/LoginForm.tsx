import { useState, type FormEvent } from 'react';
import { login } from '../api/client.js';

export function LoginForm({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    const ok = await login(username, password);
    setSubmitting(false);
    if (ok) {
      onSuccess();
    } else {
      setError(true);
    }
  }

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="login-title">🔥 PyrMap</div>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          autoComplete="username"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        <button type="submit" disabled={submitting || !username || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="login-error">Wrong username or password</div>}
      </form>
    </div>
  );
}
