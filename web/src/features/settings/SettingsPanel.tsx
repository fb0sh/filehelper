import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '../../stores/ui';
import { X, Monitor, Sun, Moon } from 'lucide-react';
import { formatBytes } from '../../lib/bytes';
import styles from './SettingsPanel.module.scss';

const API = '/api/v1';

export function SettingsPanel() {
  const section = useUIStore((s) => s.settingsSection);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const { data: storage } = useQuery({
    queryKey: ['storage'],
    queryFn: async () => {
      const res = await fetch(`${API}/storage`);
      return res.json();
    },
  });

  const { data: info } = useQuery({
    queryKey: ['info'],
    queryFn: async () => {
      const res = await fetch(`${API}/info`);
      return res.json();
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  const handleClearAll = async () => {
    if (!window.confirm('Delete all messages and files? This cannot be undone.')) return;
    setClearing(true);
    try {
      await fetch(`${API}/clear`, {
        method: 'POST',
        headers: { 'X-FileHelper-Request': '1' },
      });
      setCleared(true);
    } finally {
      setClearing(false);
    }
  };

  const themeOptions = [
    { value: 'system' as const, label: 'System', icon: <Monitor size={18} /> },
    { value: 'light' as const, label: 'Light', icon: <Sun size={18} /> },
    { value: 'dark' as const, label: 'Dark', icon: <Moon size={18} /> },
  ];

  return (
    <div className={styles.overlay} onClick={closeSettings}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            {section === 'appearance' ? 'Appearance' : section === 'storage' ? 'Storage' : 'About'}
          </span>
          <button className={styles.closeBtn} onClick={closeSettings} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={styles.body}>
          {section === 'appearance' && (
            <div className={styles.section}>
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.option} ${theme === opt.value ? styles.active : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  {opt.icon}
                  <span>{opt.label} theme</span>
                  {theme === opt.value && <span className={styles.check}>✓</span>}
                </button>
              ))}
            </div>
          )}

          {section === 'storage' && (
            <div className={styles.section}>
              <div className={styles.statRow}>
                <span>Files</span>
                <span>{formatBytes(storage?.files ?? 0)}</span>
              </div>
              <div className={styles.statRow}>
                <span>Images</span>
                <span>{formatBytes(storage?.images ?? 0)}</span>
              </div>
              <div className={styles.statRow}>
                <span>Videos</span>
                <span>{formatBytes(storage?.videos ?? 0)}</span>
              </div>
              <div className={styles.statRow}>
                <span>Audio</span>
                <span>{formatBytes(storage?.audio ?? 0)}</span>
              </div>
              <div className={`${styles.statRow} ${styles.totalRow}`}>
                <span>Total</span>
                <span>{formatBytes(storage?.total ?? 0)}</span>
              </div>
              <button
                className={styles.dangerBtn}
                onClick={handleClearAll}
                disabled={clearing}
              >
                {clearing ? 'Clearing...' : cleared ? 'All data cleared' : 'Clear All Data'}
              </button>
            </div>
          )}

          {section === 'about' && (
            <div className={styles.section}>
              <div className={styles.aboutLogo}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
              </div>
              <div className={styles.aboutName}>{info?.name ?? 'FileHelper'}</div>
              <div className={styles.aboutVersion}>Version {info?.version ?? '0.1.0'}</div>
              <p className={styles.aboutText}>
                A tiny cross-platform file transfer assistant for your local network.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}