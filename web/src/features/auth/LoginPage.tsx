import { useState, useRef, FormEvent } from 'react';
import { useAuthStore } from '../../stores/auth';
import styles from './LoginPage.module.scss';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState(false);
  const { login, loginError } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    await login(password);
    setLoading(false);
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.logo}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </div>
        <h1 className={styles.title}>FileHelper</h1>
        <p className={styles.subtitle}>Enter your password to continue</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={`${styles.inputGroup} ${focused || password ? styles.focused : ''}`}>
            <label className={styles.label}>Password</label>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className={styles.input}
              autoFocus
            />
          </div>
          {loginError && <p className={styles.error}>{loginError}</p>}
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? '...' : 'Next'}
          </button>
        </form>
      </div>
    </div>
  );
}