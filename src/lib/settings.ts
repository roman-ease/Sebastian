import { selectDb, executeDb } from './db';
import { getSecret, setSecret } from './secrets';

// カスタムプロバイダーの API キーは custom_providers.api_key（平文列）ではなく
// OS キーチェーンに置く。行との対応はこのキー名で取る。
export function customProviderSecretKey(id: string): string {
  return `custom_provider_api_key_${id}`;
}

export const SETTING_KEYS = {
  DAILY_REPORT_PATH: 'daily_report_path',
  WEEKLY_REPORT_PATH: 'weekly_report_path',
  GLOBAL_SHORTCUT: 'global_shortcut',
  AUTOSTART_ENABLED: 'autostart_enabled',
  AI_PROVIDER: 'ai_provider',       // 'gemini'|'claude'|'openai'|'groq'|'openrouter'|'lmstudio'|'ollama'|'disabled'|'custom:ID'
  OLLAMA_ENDPOINT: 'ollama_endpoint',
  OLLAMA_MODEL: 'ollama_model',
  GEMINI_API_KEY: 'gemini_api_key',
  GEMINI_MODEL: 'gemini_model',
  CLAUDE_API_KEY: 'claude_api_key',
  CLAUDE_MODEL: 'claude_model',
  OPENAI_API_KEY: 'openai_api_key',
  OPENAI_MODEL: 'openai_model',
  GROQ_API_KEY: 'groq_api_key',
  GROQ_MODEL: 'groq_model',
  OPENROUTER_API_KEY: 'openrouter_api_key',
  OPENROUTER_MODEL: 'openrouter_model',
  LMSTUDIO_ENDPOINT: 'lmstudio_endpoint',
  LMSTUDIO_MODEL: 'lmstudio_model',
  REMINDER_ENABLED: 'reminder_enabled',
  REMINDER_TIME: 'reminder_time',
  REMINDER_WEEKDAYS_ONLY: 'reminder_weekdays_only',
  LAST_BRIEFING_DATE: 'last_briefing_date',
  BUTLER_BRIEFING: 'butler_briefing',
  THEME: 'theme',
  SYNC_FOLDER: 'sync_folder',
  LAST_SYNC_AT: 'last_sync_at',
  MEMO_SYNC_FOLDER: 'memo_sync_folder',
  SUPABASE_PROJECT_ID: 'supabase_project_id',
  SUPABASE_KEY: 'supabase_key',
  SUPABASE_EMAIL: 'supabase_email',
  SUPABASE_PASSWORD: 'supabase_password',
} as const;

// 機密値（API キー・Supabase 匿名キー）は平文 SQLite ではなく OS キーチェーンに置く。
// getSetting / setSetting がこの集合のキーをキーチェーンへ透過的に振り分けるため、
// 呼び出し側（ai.ts / Settings.tsx / supabase.ts）は無改修で機密がキーチェーン管理になる。
export const SECRET_KEYS: ReadonlySet<string> = new Set<string>([
  SETTING_KEYS.GEMINI_API_KEY,
  SETTING_KEYS.CLAUDE_API_KEY,
  SETTING_KEYS.OPENAI_API_KEY,
  SETTING_KEYS.GROQ_API_KEY,
  SETTING_KEYS.OPENROUTER_API_KEY,
  SETTING_KEYS.SUPABASE_KEY,
  SETTING_KEYS.SUPABASE_PASSWORD,
]);

export async function getSetting(key: string): Promise<string | null> {
  if (SECRET_KEYS.has(key)) return getSecret(key);
  try {
    const rows = await selectDb<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (SECRET_KEYS.has(key)) {
    await setSecret(key, value);
    // 旧バージョンが平文で書いた行が残っていれば除去
    try { await executeDb('DELETE FROM settings WHERE key = ?', [key]); } catch { /* ignore */ }
    return;
  }
  await executeDb(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

// 既存ユーザーの平文キーを起動時に一度だけキーチェーンへ移送し、DB から消す。
// 値が空でも DB 行があれば掃除する。getSetting がキーチェーンを見るようになるので、
// 移送後はそちらが正となる（pull で supabase_key を読む前に呼ぶこと）。
export async function migrateSecretsToKeychain(): Promise<void> {
  for (const key of SECRET_KEYS) {
    try {
      const rows = await selectDb<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      if (!rows.length) continue;
      if (rows[0].value) await setSecret(key, rows[0].value);
      await executeDb('DELETE FROM settings WHERE key = ?', [key]);
    } catch (e) {
      console.error('[secrets] migrate failed:', key, e);
    }
  }
  // custom_providers.api_key の平文もキーチェーンへ移送して列を空にする
  try {
    const rows = await selectDb<{ id: string; api_key: string | null }>(
      'SELECT id, api_key FROM custom_providers WHERE api_key IS NOT NULL'
    );
    for (const r of rows) {
      if (r.api_key) await setSecret(customProviderSecretKey(r.id), r.api_key);
      await executeDb('UPDATE custom_providers SET api_key = NULL WHERE id = ?', [r.id]);
    }
  } catch (e) {
    console.error('[secrets] custom provider migrate failed:', e);
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await selectDb<{ key: string; value: string }>('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
