import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AuthPage from './auth/AuthPage';
import { isSupabaseConfigured } from './lib/supabase';

function Root() {
  const { session, loading, configured } = useAuth();

  // Supabase 未設定時は localStorage モード（ログイン不要）
  if (!configured || !isSupabaseConfigured) {
    return <App />;
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-900 text-gray-300">
        読み込み中…
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>
);
