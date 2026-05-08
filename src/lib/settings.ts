import { selectDb, executeDb } from './db';

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
} as const;

export async function getSetting(key: string): Promise<string | null> {
  try {
    const rows = await selectDb<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await executeDb(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await selectDb<{ key: string; value: string }>('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
