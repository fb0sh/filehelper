import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { messagesApi, messageKeys } from '../../api';
import { useUIStore } from '../../stores/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { decryptedCache } from '../../lib/decryptedCache';
import { imagePreviewCache } from '../../lib/imagePreviewCache';
import { resetHistoryLoader } from '../../lib/searchHistory';
import { X, Monitor, Sun, Moon } from 'lucide-react';
import { formatBytes } from '../../lib/bytes';
import styles from './SettingsPanel.module.scss';

export function SettingsPanel() {
  const section = useUIStore((s) => s.settingsSection);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const queryClient = useQueryClient();

  const { data: storage } = useQuery({
    queryKey: ['storage'],
    queryFn: () => messagesApi.storage(),
  });

  const { data: info } = useQuery({
    queryKey: ['info'],
    queryFn: async () => {
      const res = await fetch('/api/v1/info');
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
    setClearing(true);
    try {
      await messagesApi.clearAll();
      decryptedCache.clear();
      imagePreviewCache.clear();
      resetHistoryLoader();
      queryClient.invalidateQueries({ queryKey: messageKeys.infinite });
      queryClient.invalidateQueries({ queryKey: messageKeys.latest });
      setCleared(true);
    } finally {
      setClearing(false);
      setConfirmClear(false);
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
                <span>Encrypted storage</span>
                <span>{formatBytes(storage?.ciphertextBytes ?? 0)}</span>
              </div>
              <div className={styles.statRow}>
                <span>Messages</span>
                <span>{storage?.messageCount ?? 0}</span>
              </div>
              <div className={styles.statRow}>
                <span>Files</span>
                <span>{storage?.fileCount ?? 0}</span>
              </div>
              <p className={styles.storageNote}>
                These stats cover only this code's space. Other codes are
                never affected.
              </p>
              <button
                className={styles.dangerBtn}
                onClick={() => setConfirmClear(true)}
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
              <div className={styles.aboutVersion}>Version {info?.version ?? '1.0.0'}</div>
              <p className={styles.aboutText}>
                A tiny end-to-end encrypted file transfer assistant for
                your local network.
              </p>
              <div className={styles.securityBox}>
                <div className={styles.securityTitle}>Security</div>
                <ul>
                  <li>Messages and files are encrypted in your browser before upload.</li>
                  <li>The server stores ciphertext only and never sees your code.</li>
                  <li>Anyone with the same code can access the same data — use a long, unique passphrase.</li>
                  <li>Plain HTTP is intended for trusted LANs; HTTP does not prevent an active attacker on your network from tampering with the web client.</li>
                  <li>On untrusted networks use HTTPS, Tailscale, or WireGuard.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all data?"
          message="This permanently deletes every message and file in this space. Other codes are not affected."
          confirmLabel="Clear"
          danger
          onConfirm={() => handleClearAll()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
