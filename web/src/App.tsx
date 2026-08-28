import { useAuthStore } from './stores/auth';
import { LoginPage } from './features/auth/LoginPage';
import { MainLayout } from './features/MainLayout';
import { useEffect, useState } from 'react';

export default function App() {
  const { isAuthenticated, checkSession } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession().finally(() => setLoading(false));
  }, [checkSession]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        background: 'var(--surface-color)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-family)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--primary-color)',
            margin: '0 auto 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>FileHelper</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <MainLayout />;
}