import { useState } from 'react';
import { X, Copy, CheckCircle } from 'lucide-react';

const SETUP_SQL = `CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT DEFAULT 'none',
  due_date TEXT,
  category TEXT,
  archived BOOLEAN DEFAULT FALSE,
  pinned BOOLEAN DEFAULT FALSE,
  notes TEXT,
  start_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reports_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reports_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start_date TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`;

type Tab = 'ai' | 'local_llm' | 'supabase';

interface Props {
  onClose: () => void;
}

export function SetupGuideModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('ai');
  const [copied, setCopied] = useState(false);

  const copySQL = () => {
    navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="relative rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ backgroundColor: '#faf7f0', border: '1px solid #d5c9a8' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 角飾り */}
        <span className="absolute top-2.5 left-2.5 w-4 h-4 border-t border-l border-sebastian-gold/30 pointer-events-none rounded-tl-sm" />
        <span className="absolute top-2.5 right-2.5 w-4 h-4 border-t border-r border-sebastian-gold/30 pointer-events-none rounded-tr-sm" />
        <span className="absolute bottom-2.5 left-2.5 w-4 h-4 border-b border-l border-sebastian-gold/30 pointer-events-none rounded-bl-sm" />
        <span className="absolute bottom-2.5 right-2.5 w-4 h-4 border-b border-r border-sebastian-gold/30 pointer-events-none rounded-br-sm" />

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-sebastian-border/40 shrink-0">
          <div>
            <p className="text-xs text-sebastian-lightgray font-serif tracking-widest uppercase">Setup Guide</p>
            <h2 className="text-lg font-semibold text-sebastian-text font-serif">初期セットアップ手順</h2>
          </div>
          <button onClick={onClose} className="text-sebastian-lightgray hover:text-sebastian-text transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b border-sebastian-border/40 shrink-0 px-6">
          {([
            { key: 'ai', label: 'AI プロバイダー' },
            { key: 'local_llm', label: 'ローカル LLM' },
            { key: 'supabase', label: 'クラウド同期' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-serif border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-sebastian-gold text-sebastian-text'
                  : 'border-transparent text-sebastian-lightgray hover:text-sebastian-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* コンテンツ */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5 text-sm text-sebastian-text">

          {/* ── AI プロバイダー ── */}
          {tab === 'ai' && (
            <div className="space-y-5">
              <p className="text-sebastian-lightgray text-xs">
                設定画面の「AI プロバイダー」から使用するサービスを選択し、API キーを入力してください。
              </p>

              {[
                {
                  name: 'Gemini（推奨・無料枠あり）',
                  steps: [
                    'Google アカウントで aistudio.google.com にアクセス',
                    '「Get API key」→「Create API key」で発行',
                    '設定画面でプロバイダーを「Gemini」に設定し、API キーを入力',
                  ],
                },
                {
                  name: 'Groq（無料・高速）',
                  steps: [
                    'console.groq.com でアカウント作成',
                    '「API Keys」→「Create API Key」で発行',
                    '設定画面でプロバイダーを「Groq」に設定し、API キーを入力',
                  ],
                },
                {
                  name: 'Claude（Anthropic）',
                  steps: [
                    'console.anthropic.com でアカウント作成（クレジットカード必要）',
                    '「API Keys」→「Create Key」で発行',
                    '設定画面でプロバイダーを「Claude」に設定し、API キーを入力',
                  ],
                },
                {
                  name: 'OpenAI',
                  steps: [
                    'platform.openai.com でアカウント作成（クレジットカード必要）',
                    '「API keys」→「Create new secret key」で発行',
                    '設定画面でプロバイダーを「OpenAI」に設定し、API キーを入力',
                  ],
                },
              ].map(provider => (
                <div key={provider.name} className="space-y-2">
                  <h3 className="font-semibold text-sebastian-text font-serif">{provider.name}</h3>
                  <ol className="space-y-1 pl-4">
                    {provider.steps.map((step, i) => (
                      <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                        <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {/* ── ローカル LLM ── */}
          {tab === 'local_llm' && (
            <div className="space-y-5">
              <p className="text-sebastian-lightgray text-xs">
                インターネット不要でローカルで AI を動かすオプションです。PC のスペックが必要です。
              </p>

              <div className="space-y-2">
                <h3 className="font-semibold font-serif">Ollama</h3>
                <ol className="space-y-1 pl-4">
                  {[
                    'ollama.com からインストーラーをダウンロードしてインストール',
                    'ターミナルで ollama pull qwen2.5:7b を実行（モデルをダウンロード）',
                    '設定画面でプロバイダーを「Ollama」に設定',
                    '設定画面の「Ollama を起動」ボタンでサーバーを起動',
                  ].map((step, i) => (
                    <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                      <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold font-serif">LM Studio</h3>
                <ol className="space-y-1 pl-4">
                  {[
                    'lmstudio.ai からインストーラーをダウンロードしてインストール',
                    'アプリを起動し「Discover」タブからモデルをダウンロード（例: Qwen 2.5 7B）',
                    '「Local Server」タブで「Start Server」をクリック',
                    '設定画面でプロバイダーを「LM Studio」に設定',
                    '設定画面の「LM Studio を起動」ボタンでアプリを起動可能',
                  ].map((step, i) => (
                    <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                      <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-sebastian-border/20 rounded-lg p-3 text-xs text-sebastian-gray">
                推奨スペック: RAM 16GB 以上、ストレージ空き 10GB 以上
              </div>
            </div>
          )}

          {/* ── Supabase ── */}
          {tab === 'supabase' && (
            <div className="space-y-5">
              <p className="text-sebastian-lightgray text-xs">
                複数デバイスでデータを同期するための設定です。無料アカウントで利用できます。
              </p>

              <div className="space-y-2">
                <h3 className="font-semibold font-serif">1. アカウント作成とプロジェクト作成</h3>
                <ol className="space-y-1 pl-4">
                  {[
                    'supabase.com にアクセスし、GitHub アカウントでサインイン',
                    '「New project」をクリック',
                    'Name: Sebastian（任意）、Region: Northeast Asia (Tokyo) を選択して作成',
                  ].map((step, i) => (
                    <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                      <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold font-serif">2. テーブルを作成</h3>
                <ol className="space-y-1 pl-4 mb-3">
                  {[
                    'ダッシュボード左メニューの「SQL Editor」を開く',
                    '下の SQL をコピーして貼り付け、「Run」を実行',
                  ].map((step, i) => (
                    <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                      <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
                <div className="relative">
                  <pre className="bg-sebastian-border/20 rounded-lg p-3 text-xs text-sebastian-gray overflow-x-auto font-mono leading-relaxed">
                    {SETUP_SQL}
                  </pre>
                  <button
                    onClick={copySQL}
                    className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
                    style={{ background: '#1e2e4a', color: copied ? '#6fcf97' : '#c9a456' }}
                  >
                    {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
                    {copied ? 'コピー済み' : 'コピー'}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold font-serif">3. Project ID と Publishable Key を取得</h3>
                <ol className="space-y-1 pl-4">
                  {[
                    'ダッシュボード左下の「Settings」→「General」を開き Project ID をコピー',
                    '「Settings」→「API Keys」を開き Publishable key をコピー',
                    'Sebastian の設定画面「クラウド同期（Supabase）」に入力して保存',
                    '「接続テスト」で確認後、「ローカルDB を Supabase にインポート」を実行',
                  ].map((step, i) => (
                    <li key={i} className="text-sebastian-gray text-xs flex gap-2">
                      <span className="text-sebastian-gold shrink-0">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="bg-sebastian-border/20 rounded-lg p-3 text-xs text-sebastian-gray space-y-1">
                <p className="font-semibold text-sebastian-text">無料プランの注意点</p>
                <p>• 2週間アクセスなしでプロジェクトが停止します（毎日使っていれば問題なし）</p>
                <p>• DB 容量 500MB まで無料（個人用途では数十年分）</p>
              </div>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-6 py-4 border-t border-sebastian-border/40 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-serif rounded-lg transition-colors"
            style={{ background: '#1e2e4a', color: '#c9a456', border: '1px solid #c9a456' }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
