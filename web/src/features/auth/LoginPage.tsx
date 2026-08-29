import { useState, FormEvent } from 'react';
import { useAuthStore } from '../../stores/auth';
import styles from './LoginPage.module.scss';

export function LoginPage() {
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const { login, loginError } = useAuthStore();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setLoading(true);
    await login(code.trim());
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
        <p className={styles.subtitle}>Enter access code</p>
        <p className={styles.hint}>
          Enter the access code shown in the FileHelper terminal.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={`${styles.inputGroup} ${focused || code ? styles.focused : ''}`}>
            <label className={styles.label}>Access code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Access code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className={styles.input}
              autoFocus
            />
          </div>
          {loginError && <p className={styles.error}>{loginError}</p>}
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? '...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}