import { useState, FormEvent } from 'react';
import { useAuthStore } from '../../stores/auth';
import { codeStrength, hasEdgeWhitespace, STRENGTH_LABEL } from '../../lib/codeStrength';
import { Eye, EyeOff } from 'lucide-react';
import styles from './LoginPage.module.scss';

export function LoginPage() {
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(false);
  const { phase, loginError, unlock, needsCreate, confirmCreate, cancelCreate } =
    useAuthStore();

  const loading = phase === 'unlocking' || phase === 'creating';
  const strength = code.length > 0 ? codeStrength(code) : null;
  const edgeSpace = hasEdgeWhitespace(code);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code || loading) return;
    // NFC is the only normalization; never trim, never case-fold.
    await unlock(code.normalize('NFC'));
  };

  if (needsCreate) {
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
          <p className={styles.createText}>
            No existing FileHelper data was found for this code.
            <br />
            Create it?
          </p>
          <div className={styles.createActions}>
            <button
              className={styles.secondaryBtn}
              onClick={cancelCreate}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={styles.createBtn}
              onClick={() => confirmCreate()}
              disabled={loading}
            >
              {phase === 'creating' ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <p className={styles.subtitle}>Enter code</p>
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={`${styles.inputGroup} ${focused || code ? styles.focused : ''}`}>
            <label className={styles.label}>Code</label>
            <div className={styles.inputRow}>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="••••••••••••••"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className={styles.input}
                autoFocus
                disabled={loading}
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide code' : 'Show code'}
                tabIndex={-1}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {edgeSpace && (
            <p className={styles.warning}>This code starts or ends with a space.</p>
          )}
          {strength && !edgeSpace && (
            <p className={styles.strengthHint}>
              <span className={styles[`strength-${strength}`]}>
                {STRENGTH_LABEL[strength]}
              </span>
              {strength === 'weak' && ' — use a long, unique code. 12+ characters recommended.'}
            </p>
          )}

          {loginError && <p className={styles.error}>{loginError}</p>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? (phase === 'creating' ? 'Creating…' : 'Deriving keys…') : 'Continue'}
          </button>
        </form>
        <p className={styles.footerHint}>
          Use the same code on another device
          <br />
          to access the same files and messages.
        </p>
      </div>
    </div>
  );
}
