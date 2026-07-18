import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthContext';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!configured) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-900 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-xl space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">設定が必要です</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            <code className="text-xs bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code> と{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
            を環境変数に設定し、再デプロイしてください。
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email.trim(), password);
        if (err) setError(err);
      } else {
        if (password.length < 6) {
          setError('パスワードは6文字以上にしてください');
          return;
        }
        const { error: err } = await signUp(email.trim(), password);
        if (err) {
          setError(err);
        } else {
          setInfo(
            'アカウントを作成しました。メール確認が有効な場合は受信ボックスを確認してください。確認不要設定ならそのままログインできます。'
          );
          setMode('signin');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold text-xl mb-3">
            P
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Pathway</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'signin' ? 'ログインして続きから' : 'アカウントを作成'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {info && (
            <p className="text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '処理中…' : mode === 'signin' ? 'ログイン' : '新規登録'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === 'signin' ? (
            <>
              アカウントがない場合は{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setError(null);
                  setInfo(null);
                }}
                className="text-blue-600 font-medium hover:underline"
              >
                新規登録
              </button>
            </>
          ) : (
            <>
              すでにアカウントがある場合は{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setInfo(null);
                }}
                className="text-blue-600 font-medium hover:underline"
              >
                ログイン
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
