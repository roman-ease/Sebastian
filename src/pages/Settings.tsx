import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { FolderOpen, CheckCircle, AlertCircle, Wifi, WifiOff, RefreshCw, Eye, EyeOff, Upload, Download, Clock, FileDown, Pencil, Trash2, Plus, X, Play } from 'lucide-react';
import { getSetting, setSetting, SETTING_KEYS } from '../lib/settings';
import { PageHeader, OrnateCard, CardHeading } from '../components/ClassicUI';
import { registerShortcut } from '../lib/shortcut';
import { checkOllamaConnection, checkGeminiConnection, type OllamaStatus } from '../lib/ai';
import { pushSync, pullSync, getSyncFolderDbMtime } from '../lib/sync';
import { pushAllToSupabase } from '../lib/supabase';
import { SetupGuideModal } from '../components/SetupGuideModal';
import { selectDb, executeDb } from '../lib/db';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

type AiProvider = 'gemini' | 'claude' | 'openai' | 'groq' | 'openrouter' | 'lmstudio' | 'ollama' | 'disabled' | `custom:${string}`;

interface CustomProvider {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  api_key: string | null;
  model: string;
}

interface SettingsForm {
  dailyReportPath: string;
  weeklyReportPath: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  aiProvider: AiProvider;
  geminiApiKey: string;
  geminiModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  claudeApiKey: string;
  claudeModel: string;
  openaiApiKey: string;
  openaiModel: string;
  groqApiKey: string;
  groqModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  lmstudioEndpoint: string;
  lmstudioModel: string;
  reminderEnabled: boolean;
  reminderTime: string;
  reminderWeekdaysOnly: boolean;
  syncFolder: string;
  memoSyncFolder: string;
  supabaseProjectId: string;
  supabaseKey: string;
}

export default function Settings() {
  const [form, setForm] = useState<SettingsForm>({
    dailyReportPath: '',
    weeklyReportPath: '',
    globalShortcut: 'Ctrl+Shift+M',
    autostartEnabled: false,
    aiProvider: 'disabled',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:7b',
    claudeApiKey: '',
    claudeModel: 'claude-haiku-4-5-20251001',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    groqApiKey: '',
    groqModel: 'llama-3.3-70b-versatile',
    openrouterApiKey: '',
    openrouterModel: 'google/gemini-flash-1.5',
    lmstudioEndpoint: 'http://localhost:1234',
    lmstudioModel: 'local-model',
    reminderEnabled: false,
    reminderTime: '18:00',
    reminderWeekdaysOnly: true,
    syncFolder: '',
    memoSyncFolder: '',
    supabaseProjectId: '',
    supabaseKey: '',
  });
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
  const [providerForm, setProviderForm] = useState({ id: '', name: '', type: 'openai', endpoint: '', apiKey: '', model: '' });
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [exportMsg, setExportMsg] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pushing' | 'pulling' | 'done' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncFolderDbTime, setSyncFolderDbTime] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [shortcutStatus, setShortcutStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [shortcutError, setShortcutError] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [testStatus, setTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [supabaseTestStatus, setSupabaseTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [supabaseTesting, setSupabaseTesting] = useState(false);
  const [importStatus, setImportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    async function load() {
      const [daily, weekly, shortcut, autostart, autostartActual,
        provider, gemKey, gemModel, olEndpoint, olModel,
        claudeKey, claudeModel, openaiKey, openaiModel,
        groqKey, groqModel, openrouterKey, openrouterModel,
        lmstudioEndpoint, lmstudioModel,
        reminderEnabled, reminderTime, reminderWeekdaysOnly,
        syncFolderSetting, lastSyncAtSetting, memoSyncFolderSetting,
        supabaseProjectIdSetting, supabaseKeySetting] = await Promise.all([
        getSetting(SETTING_KEYS.DAILY_REPORT_PATH),
        getSetting(SETTING_KEYS.WEEKLY_REPORT_PATH),
        getSetting(SETTING_KEYS.GLOBAL_SHORTCUT),
        getSetting(SETTING_KEYS.AUTOSTART_ENABLED),
        isEnabled().catch(() => false),
        getSetting(SETTING_KEYS.AI_PROVIDER),
        getSetting(SETTING_KEYS.GEMINI_API_KEY),
        getSetting(SETTING_KEYS.GEMINI_MODEL),
        getSetting(SETTING_KEYS.OLLAMA_ENDPOINT),
        getSetting(SETTING_KEYS.OLLAMA_MODEL),
        getSetting(SETTING_KEYS.CLAUDE_API_KEY),
        getSetting(SETTING_KEYS.CLAUDE_MODEL),
        getSetting(SETTING_KEYS.OPENAI_API_KEY),
        getSetting(SETTING_KEYS.OPENAI_MODEL),
        getSetting(SETTING_KEYS.GROQ_API_KEY),
        getSetting(SETTING_KEYS.GROQ_MODEL),
        getSetting(SETTING_KEYS.OPENROUTER_API_KEY),
        getSetting(SETTING_KEYS.OPENROUTER_MODEL),
        getSetting(SETTING_KEYS.LMSTUDIO_ENDPOINT),
        getSetting(SETTING_KEYS.LMSTUDIO_MODEL),
        getSetting(SETTING_KEYS.REMINDER_ENABLED),
        getSetting(SETTING_KEYS.REMINDER_TIME),
        getSetting(SETTING_KEYS.REMINDER_WEEKDAYS_ONLY),
        getSetting(SETTING_KEYS.SYNC_FOLDER),
        getSetting(SETTING_KEYS.LAST_SYNC_AT),
        getSetting(SETTING_KEYS.MEMO_SYNC_FOLDER),
        getSetting(SETTING_KEYS.SUPABASE_PROJECT_ID),
        getSetting(SETTING_KEYS.SUPABASE_KEY),
      ]);
      const syncFolderVal = syncFolderSetting ?? '';
      setLastSyncAt(lastSyncAtSetting ?? null);
      if (syncFolderVal) {
        getSyncFolderDbMtime(syncFolderVal).then(mtime => {
          if (mtime) setSyncFolderDbTime(format(new Date(mtime * 1000), 'M/d HH:mm', { locale: ja }));
        }).catch(() => {});
      }
      const cpRows = await selectDb<CustomProvider>('SELECT * FROM custom_providers ORDER BY created_at ASC');
      setCustomProviders(cpRows);
      setForm({
        dailyReportPath: daily ?? '',
        weeklyReportPath: weekly ?? '',
        globalShortcut: shortcut ?? 'Ctrl+Shift+M',
        autostartEnabled: autostart === 'true' || autostartActual,
        aiProvider: (provider as AiProvider) ?? 'disabled',
        geminiApiKey: gemKey ?? '',
        geminiModel: gemModel ?? 'gemini-2.0-flash',
        ollamaEndpoint: olEndpoint ?? 'http://localhost:11434',
        ollamaModel: olModel ?? 'qwen2.5:7b',
        claudeApiKey: claudeKey ?? '',
        claudeModel: claudeModel ?? 'claude-haiku-4-5-20251001',
        openaiApiKey: openaiKey ?? '',
        openaiModel: openaiModel ?? 'gpt-4o-mini',
        groqApiKey: groqKey ?? '',
        groqModel: groqModel ?? 'llama-3.3-70b-versatile',
        openrouterApiKey: openrouterKey ?? '',
        openrouterModel: openrouterModel ?? 'google/gemini-flash-1.5',
        lmstudioEndpoint: lmstudioEndpoint ?? 'http://localhost:1234',
        lmstudioModel: lmstudioModel ?? 'local-model',
        reminderEnabled: reminderEnabled === 'true',
        reminderTime: reminderTime ?? '18:00',
        reminderWeekdaysOnly: reminderWeekdaysOnly !== 'false',
        syncFolder: syncFolderVal,
        memoSyncFolder: memoSyncFolderSetting ?? '',
        supabaseProjectId: supabaseProjectIdSetting ?? '',
        supabaseKey: supabaseKeySetting ?? '',
      });
    }
    load();
  }, []);

  const pickFolder = async (field: 'dailyReportPath' | 'weeklyReportPath' | 'syncFolder' | 'memoSyncFolder') => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      setForm(f => ({ ...f, [field]: selected }));
      if (field === 'syncFolder') {
        getSyncFolderDbMtime(selected).then(mtime => {
          setSyncFolderDbTime(mtime ? format(new Date(mtime * 1000), 'M/d HH:mm', { locale: ja }) : null);
        }).catch(() => setSyncFolderDbTime(null));
      }
    }
  };

  const handleLaunch = async (server: 'ollama' | 'lmstudio') => {
    setLaunching(true);
    setLaunchMsg(null);
    setTestStatus(null);
    try {
      const msg = await invoke<string>('launch_local_ai', { server });
      setLaunchMsg({ ok: true, msg });
      // サーバー起動を待ってから接続テストを自動実行
      await new Promise(r => setTimeout(r, 3000));
      await handleTest();
    } catch (e) {
      setLaunchMsg({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setLaunching(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      if (form.aiProvider === 'gemini') {
        const result = await checkGeminiConnection(form.geminiApiKey, form.geminiModel);
        setTestStatus(result.connected
          ? { ok: true, msg: '接続成功 — Gemini APIに接続できました' }
          : { ok: false, msg: `接続失敗: ${result.error ?? '不明なエラー'}` }
        );
      } else if (form.aiProvider === 'ollama') {
        const result: OllamaStatus = await checkOllamaConnection(form.ollamaEndpoint);
        setTestStatus(result.connected
          ? { ok: true, msg: `接続成功 — 利用可能なモデル: ${result.models.join(', ') || 'なし'}` }
          : { ok: false, msg: `接続失敗: ${result.error ?? '不明なエラー'}` }
        );
      } else if (form.aiProvider === 'claude') {
        if (!form.claudeApiKey) { setTestStatus({ ok: false, msg: 'APIキーが未入力です' }); return; }
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': form.claudeApiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: form.claudeModel, max_tokens: 10, messages: [{ role: 'user', content: 'test' }] }),
            signal: AbortSignal.timeout(8000),
          });
          setTestStatus({ ok: res.ok || res.status === 400, msg: res.ok || res.status === 400 ? 'Claude に接続できました' : `エラー (${res.status})` });
        } catch (e) {
          setTestStatus({ ok: false, msg: `接続失敗: ${e instanceof Error ? e.message : String(e)}` });
        }
      } else if (form.aiProvider === 'openai') {
        if (!form.openaiApiKey) { setTestStatus({ ok: false, msg: 'APIキーが未入力です' }); return; }
        try {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${form.openaiApiKey}` },
            body: JSON.stringify({ model: form.openaiModel, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
            signal: AbortSignal.timeout(8000),
          });
          setTestStatus({ ok: res.ok || res.status === 400, msg: res.ok || res.status === 400 ? 'OpenAI に接続できました' : `エラー (${res.status})` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTestStatus({ ok: false, msg: `接続失敗: ${msg}` });
        }
      } else if (form.aiProvider === 'groq') {
        if (!form.groqApiKey) { setTestStatus({ ok: false, msg: 'APIキーが未入力です' }); return; }
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${form.groqApiKey}` },
            body: JSON.stringify({ model: form.groqModel, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
            signal: AbortSignal.timeout(8000),
          });
          setTestStatus({ ok: res.ok || res.status === 400, msg: res.ok || res.status === 400 ? 'Groq に接続できました' : `エラー (${res.status})` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTestStatus({ ok: false, msg: `接続失敗: ${msg}` });
        }
      } else if (form.aiProvider === 'openrouter') {
        if (!form.openrouterApiKey) { setTestStatus({ ok: false, msg: 'APIキーが未入力です' }); return; }
        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${form.openrouterApiKey}` },
            body: JSON.stringify({ model: form.openrouterModel, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
            signal: AbortSignal.timeout(8000),
          });
          setTestStatus({ ok: res.ok || res.status === 400, msg: res.ok || res.status === 400 ? 'OpenRouter に接続できました' : `エラー (${res.status})` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTestStatus({ ok: false, msg: `接続失敗: ${msg}` });
        }
      } else if (form.aiProvider === 'lmstudio') {
        try {
          const res = await fetch(`${form.lmstudioEndpoint}/v1/models`, { signal: AbortSignal.timeout(5000) });
          setTestStatus({ ok: res.ok, msg: res.ok ? 'LM Studio に接続できました' : `エラー (${res.status})` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTestStatus({ ok: false, msg: `接続失敗: ${msg}\nLM Studio の「Local Server」が起動しているか確認してください。` });
        }
      } else if (form.aiProvider.startsWith('custom:')) {
        const customId = form.aiProvider.slice('custom:'.length);
        const provider = customProviders.find(p => p.id === customId);
        if (!provider) { setTestStatus({ ok: false, msg: 'カスタムプロバイダーが見つかりません' }); return; }
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (provider.api_key) headers['Authorization'] = `Bearer ${provider.api_key}`;
          let res: Response;
          if (provider.type === 'claude') {
            if (provider.api_key) { delete headers['Authorization']; headers['x-api-key'] = provider.api_key; }
            headers['anthropic-version'] = '2023-06-01';
            res = await fetch(`${provider.endpoint}/v1/messages`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model: provider.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
              signal: AbortSignal.timeout(8000),
            });
          } else {
            res = await fetch(`${provider.endpoint}/v1/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ model: provider.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
              signal: AbortSignal.timeout(8000),
            });
          }
          setTestStatus({ ok: res.ok || res.status === 400, msg: res.ok || res.status === 400 ? `${provider.name} に接続できました` : `エラー (${res.status})` });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setTestStatus({ ok: false, msg: `接続失敗: ${msg}` });
        }
      }
    } finally {
      setTesting(false);
    }
  };

  const saveCustomProvider = async () => {
    const { id, name, type, endpoint, apiKey, model } = providerForm;
    if (!id || !name || !endpoint || !model) return;
    if (editingProvider) {
      await executeDb('UPDATE custom_providers SET name=?, type=?, endpoint=?, api_key=?, model=? WHERE id=?',
        [name, type, endpoint, apiKey || null, model, editingProvider.id]);
    } else {
      await executeDb('INSERT INTO custom_providers (id, name, type, endpoint, api_key, model) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, type, endpoint, apiKey || null, model]);
    }
    const rows = await selectDb<CustomProvider>('SELECT * FROM custom_providers ORDER BY created_at ASC');
    setCustomProviders(rows);
    setShowAddProvider(false);
    setEditingProvider(null);
    setProviderForm({ id: '', name: '', type: 'openai', endpoint: '', apiKey: '', model: '' });
  };

  const deleteCustomProvider = async (id: string) => {
    await executeDb('DELETE FROM custom_providers WHERE id=?', [id]);
    setCustomProviders(prev => prev.filter(p => p.id !== id));
    if (form.aiProvider === `custom:${id}`) {
      setForm(f => ({ ...f, aiProvider: 'disabled' as AiProvider }));
    }
  };

  const handleSave = async () => {
    setSaveStatus('idle');
    setErrorMsg('');
    try {
      await Promise.all([
        setSetting(SETTING_KEYS.DAILY_REPORT_PATH, form.dailyReportPath),
        setSetting(SETTING_KEYS.WEEKLY_REPORT_PATH, form.weeklyReportPath),
        setSetting(SETTING_KEYS.GLOBAL_SHORTCUT, form.globalShortcut),
        setSetting(SETTING_KEYS.AUTOSTART_ENABLED, String(form.autostartEnabled)),
        setSetting(SETTING_KEYS.AI_PROVIDER, form.aiProvider),
        setSetting(SETTING_KEYS.GEMINI_API_KEY, form.geminiApiKey),
        setSetting(SETTING_KEYS.GEMINI_MODEL, form.geminiModel),
        setSetting(SETTING_KEYS.OLLAMA_ENDPOINT, form.ollamaEndpoint),
        setSetting(SETTING_KEYS.OLLAMA_MODEL, form.ollamaModel),
        setSetting(SETTING_KEYS.CLAUDE_API_KEY, form.claudeApiKey),
        setSetting(SETTING_KEYS.CLAUDE_MODEL, form.claudeModel),
        setSetting(SETTING_KEYS.OPENAI_API_KEY, form.openaiApiKey),
        setSetting(SETTING_KEYS.OPENAI_MODEL, form.openaiModel),
        setSetting(SETTING_KEYS.GROQ_API_KEY, form.groqApiKey),
        setSetting(SETTING_KEYS.GROQ_MODEL, form.groqModel),
        setSetting(SETTING_KEYS.OPENROUTER_API_KEY, form.openrouterApiKey),
        setSetting(SETTING_KEYS.OPENROUTER_MODEL, form.openrouterModel),
        setSetting(SETTING_KEYS.LMSTUDIO_ENDPOINT, form.lmstudioEndpoint),
        setSetting(SETTING_KEYS.LMSTUDIO_MODEL, form.lmstudioModel),
        setSetting(SETTING_KEYS.REMINDER_ENABLED, String(form.reminderEnabled)),
        setSetting(SETTING_KEYS.REMINDER_TIME, form.reminderTime),
        setSetting(SETTING_KEYS.REMINDER_WEEKDAYS_ONLY, String(form.reminderWeekdaysOnly)),
        setSetting(SETTING_KEYS.SYNC_FOLDER, form.syncFolder),
        setSetting(SETTING_KEYS.MEMO_SYNC_FOLDER, form.memoSyncFolder),
        setSetting(SETTING_KEYS.SUPABASE_PROJECT_ID, form.supabaseProjectId),
        setSetting(SETTING_KEYS.SUPABASE_KEY, form.supabaseKey),
      ]);

      try {
        if (form.autostartEnabled) { await enable(); } else { await disable(); }
      } catch { /* 開発モードではスキップ */ }

      if (form.globalShortcut) {
        setShortcutStatus('idle');
        setShortcutError('');
        const ok = await registerShortcut(form.globalShortcut, async () => {
          window.dispatchEvent(new CustomEvent('sebastian:open-memo'));
        });
        if (ok) {
          window.dispatchEvent(
            new CustomEvent('sebastian:shortcut-changed', { detail: form.globalShortcut })
          );
          setShortcutStatus('ok');
        } else {
          setShortcutStatus('error');
          setShortcutError(`「${form.globalShortcut}」の登録に失敗しました。キーの形式を確認してください（例: Ctrl+Shift+N、Alt+F2）`);
        }
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(`保存に失敗しました: ${msg}`);
      setSaveStatus('error');
    }
  };

  const handleExportAll = async () => {
    setExportStatus('exporting');
    setExportMsg('');
    let dailyCount = 0;
    let weeklyCount = 0;
    const errors: string[] = [];

    try {
      if (form.dailyReportPath) {
        const rows = await selectDb<{ date: string; content: string }>(
          'SELECT date, content FROM reports_daily ORDER BY date ASC'
        );
        for (const row of rows) {
          try {
            const fileName = `Nippo_${row.date.replace(/-/g, '')}.md`;
            const filePath = `${form.dailyReportPath}/${fileName}`.replace(/\\/g, '/');
            await invoke<void>('write_text_file', { path: filePath, content: row.content });
            dailyCount++;
          } catch {
            errors.push(`日報 ${row.date} の書き出し失敗`);
          }
        }
      }

      if (form.weeklyReportPath) {
        const rows = await selectDb<{ week_start_date: string; content: string }>(
          'SELECT week_start_date, content FROM reports_weekly ORDER BY week_start_date ASC'
        );
        for (const row of rows) {
          try {
            const fileName = `Shuho_${row.week_start_date.replace(/-/g, '')}.md`;
            const filePath = `${form.weeklyReportPath}/${fileName}`.replace(/\\/g, '/');
            await invoke<void>('write_text_file', { path: filePath, content: row.content });
            weeklyCount++;
          } catch {
            errors.push(`週報 ${row.week_start_date} の書き出し失敗`);
          }
        }
      }

      if (errors.length > 0) {
        setExportStatus('error');
        setExportMsg(errors.join(' / '));
      } else {
        setExportStatus('done');
        setExportMsg(`日報 ${dailyCount} 件・週報 ${weeklyCount} 件を書き出しました`);
        setTimeout(() => setExportStatus('idle'), 5000);
      }
    } catch (e: unknown) {
      setExportStatus('error');
      setExportMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePush = async () => {
    if (!form.syncFolder) return;
    setSyncStatus('pushing');
    setSyncMsg('');
    try {
      await pushSync(form.syncFolder);
      const now = new Date().toISOString();
      setLastSyncAt(now);
      setSyncFolderDbTime(format(new Date(), 'M/d HH:mm', { locale: ja }));
      setSyncStatus('done');
      setSyncMsg('同期フォルダに送り出しました');
      setTimeout(() => setSyncStatus('idle'), 4000);
    } catch (e: unknown) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePull = async () => {
    if (!form.syncFolder) return;
    const ok = window.confirm(
      '同期フォルダのDBで現在のデータを上書きします。\n現在のDBは自動的にバックアップされます。\n続けますか？'
    );
    if (!ok) return;
    setSyncStatus('pulling');
    setSyncMsg('');
    try {
      const backupPath = await pullSync(form.syncFolder);
      setSyncStatus('done');
      setSyncMsg(`取り込みました。バックアップ: ${backupPath}`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: unknown) {
      setSyncStatus('error');
      setSyncMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader label="SETTINGS" title="設定" />

      {/* セットアップガイド */}
      <div className="flex justify-end -mt-2">
        <button
          onClick={() => setShowSetupGuide(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-serif rounded-lg transition-colors"
          style={{ background: '#1e2e4a', color: '#c9a456', border: '1px solid #c9a456' }}
        >
          初期セットアップ手順を見る
        </button>
      </div>
      {showSetupGuide && <SetupGuideModal onClose={() => setShowSetupGuide(false)} />}

      {/* AI設定 */}
      <OrnateCard className="p-6">
        <div className="space-y-5">
          <CardHeading>AI設定</CardHeading>

          {/* グローバルプロバイダー ドロップダウン */}
          <div className="space-y-2">
            <label className="block text-sm text-sebastian-gray font-serif">AIプロバイダー（グローバル）</label>
            <select
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-xl px-3 py-2.5 text-sm font-serif text-sebastian-text outline-none focus:border-sebastian-gold/50 transition-colors"
              value={form.aiProvider}
              onChange={e => setForm(f => ({ ...f, aiProvider: e.target.value as AiProvider }))}
            >
              <option value="gemini">Gemini API — 推奨・無料</option>
              <option value="claude">Claude — Anthropic</option>
              <option value="openai">OpenAI — GPT-4o 等</option>
              <option value="groq">Groq — 高速推論</option>
              <option value="openrouter">OpenRouter — 多モデル対応</option>
              {customProviders.map(p => (
                <option key={p.id} value={`custom:${p.id}`}>{p.name} — カスタム</option>
              ))}
              <option value="lmstudio">LM Studio — ローカル</option>
              <option value="ollama">Ollama — ローカル</option>
              <option value="disabled">無効 — AI機能をオフ</option>
            </select>
          </div>

          {/* Gemini設定 */}
          {form.aiProvider === 'gemini' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">APIキー</label>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                    placeholder="AIzaSy..."
                    value={form.geminiApiKey}
                    onChange={e => setForm(f => ({ ...f, geminiApiKey: e.target.value }))}
                  />
                  <button
                    onClick={() => setShowApiKey(v => !v)}
                    className="px-3 text-sebastian-lightgray hover:text-gray-600 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg transition-colors"
                  >
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-sebastian-lightgray">
                  取得先: <span className="font-mono">https://aistudio.google.com/apikey</span>（無料）
                </p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input
                  type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.geminiModel}
                  onChange={e => setForm(f => ({ ...f, geminiModel: e.target.value }))}
                />
                <p className="text-xs text-sebastian-lightgray">
                  推奨: <span className="font-mono">gemini-2.5-flash</span>（無料・高速）
                </p>
              </div>
            </div>
          )}

          {/* Claude設定 */}
          {form.aiProvider === 'claude' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">APIキー</label>
                <div className="flex gap-2">
                  <input type={showApiKey ? 'text' : 'password'}
                    className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                    placeholder="sk-ant-..."
                    value={form.claudeApiKey}
                    onChange={e => setForm(f => ({ ...f, claudeApiKey: e.target.value }))} />
                  <button onClick={() => setShowApiKey(v => !v)} className="px-3 text-sebastian-lightgray bg-sebastian-parchment/50 border border-sebastian-border rounded-lg">
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-sebastian-lightgray">取得先: <span className="font-mono">console.anthropic.com</span>（従量課金）</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.claudeModel}
                  onChange={e => setForm(f => ({ ...f, claudeModel: e.target.value }))} />
                <p className="text-xs text-sebastian-lightgray">推奨: <span className="font-mono">claude-haiku-4-5-20251001</span>（軽量・安価）/ <span className="font-mono">claude-sonnet-4-6</span>（高精度）</p>
              </div>
            </div>
          )}

          {/* OpenAI設定 */}
          {form.aiProvider === 'openai' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">APIキー</label>
                <div className="flex gap-2">
                  <input type={showApiKey ? 'text' : 'password'}
                    className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                    placeholder="sk-..."
                    value={form.openaiApiKey}
                    onChange={e => setForm(f => ({ ...f, openaiApiKey: e.target.value }))} />
                  <button onClick={() => setShowApiKey(v => !v)} className="px-3 text-sebastian-lightgray bg-sebastian-parchment/50 border border-sebastian-border rounded-lg">
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-sebastian-lightgray">取得先: <span className="font-mono">platform.openai.com</span>（従量課金）</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.openaiModel}
                  onChange={e => setForm(f => ({ ...f, openaiModel: e.target.value }))} />
                <p className="text-xs text-sebastian-lightgray">推奨: <span className="font-mono">gpt-4o-mini</span>（安価・高速）/ <span className="font-mono">gpt-4o</span>（高精度）</p>
              </div>
            </div>
          )}

          {/* Groq設定 */}
          {form.aiProvider === 'groq' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">APIキー</label>
                <div className="flex gap-2">
                  <input type={showApiKey ? 'text' : 'password'}
                    className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                    placeholder="gsk_..."
                    value={form.groqApiKey}
                    onChange={e => setForm(f => ({ ...f, groqApiKey: e.target.value }))} />
                  <button onClick={() => setShowApiKey(v => !v)} className="px-3 text-sebastian-lightgray bg-sebastian-parchment/50 border border-sebastian-border rounded-lg">
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-sebastian-lightgray">取得先: <span className="font-mono">console.groq.com</span>（無料枠あり）</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.groqModel}
                  onChange={e => setForm(f => ({ ...f, groqModel: e.target.value }))} />
                <p className="text-xs text-sebastian-lightgray">推奨: <span className="font-mono">llama-3.3-70b-versatile</span>（高速・高精度）</p>
              </div>
            </div>
          )}

          {/* OpenRouter設定 */}
          {form.aiProvider === 'openrouter' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">APIキー</label>
                <div className="flex gap-2">
                  <input type={showApiKey ? 'text' : 'password'}
                    className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                    placeholder="sk-or-..."
                    value={form.openrouterApiKey}
                    onChange={e => setForm(f => ({ ...f, openrouterApiKey: e.target.value }))} />
                  <button onClick={() => setShowApiKey(v => !v)} className="px-3 text-sebastian-lightgray bg-sebastian-parchment/50 border border-sebastian-border rounded-lg">
                    {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-sebastian-lightgray">取得先: <span className="font-mono">openrouter.ai</span>（無料枠あり・多モデル対応）</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.openrouterModel}
                  onChange={e => setForm(f => ({ ...f, openrouterModel: e.target.value }))} />
                <p className="text-xs text-sebastian-lightgray">例: <span className="font-mono">google/gemini-flash-1.5</span> / <span className="font-mono">anthropic/claude-3.5-haiku</span></p>
              </div>
            </div>
          )}

          {/* LM Studio設定 */}
          {form.aiProvider === 'lmstudio' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">エンドポイントURL</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.lmstudioEndpoint}
                  onChange={e => setForm(f => ({ ...f, lmstudioEndpoint: e.target.value }))} />
                <p className="text-xs text-sebastian-lightgray">LM Studio の「Local Server」タブで確認できます（通常 http://localhost:1234）</p>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデルID</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  placeholder="例: local-model"
                  value={form.lmstudioModel}
                  onChange={e => setForm(f => ({ ...f, lmstudioModel: e.target.value }))} />
              </div>
              <button
                onClick={() => handleLaunch('lmstudio')}
                disabled={launching || testing}
                className="flex items-center gap-2 px-4 py-2 bg-sebastian-navy text-white rounded-lg hover:bg-sebastian-dark transition-colors text-sm disabled:opacity-50 font-serif"
              >
                <Play size={13} className={launching ? 'animate-pulse' : ''} />
                {launching ? '起動中...' : 'サーバーを起動する'}
              </button>
            </div>
          )}

          {/* Ollama設定 */}
          {form.aiProvider === 'ollama' && (
            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">エンドポイントURL</label>
                <input
                  type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  value={form.ollamaEndpoint}
                  onChange={e => setForm(f => ({ ...f, ollamaEndpoint: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-sebastian-gray">モデル</label>
                <input
                  type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50 transition-colors"
                  placeholder="例: qwen2.5:3b"
                  value={form.ollamaModel}
                  onChange={e => setForm(f => ({ ...f, ollamaModel: e.target.value }))}
                />
              </div>
              <button
                onClick={() => handleLaunch('ollama')}
                disabled={launching || testing}
                className="flex items-center gap-2 px-4 py-2 bg-sebastian-navy text-white rounded-lg hover:bg-sebastian-dark transition-colors text-sm disabled:opacity-50 font-serif"
              >
                <Play size={13} className={launching ? 'animate-pulse' : ''} />
                {launching ? '起動中...' : 'サーバーを起動する'}
              </button>
            </div>
          )}

          {/* 接続テスト */}
          {form.aiProvider !== 'disabled' && (
            <div className="space-y-2">
              <button
                onClick={handleTest}
                disabled={testing || launching}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-sebastian-text rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
              >
                <RefreshCw size={14} className={testing ? 'animate-spin' : ''} />
                {testing ? '確認中...' : '接続テスト'}
              </button>

              {launchMsg && (
                <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm whitespace-pre-wrap ${
                  launchMsg.ok
                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                    : 'bg-red-50 text-red-700 border border-red-100'
                }`}>
                  {launchMsg.ok
                    ? <Play size={15} className="flex-shrink-0 mt-0.5" />
                    : <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                  }
                  {launchMsg.msg}
                </div>
              )}

              {testStatus && (
                <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
                  testStatus.ok
                    ? 'bg-green-50 text-green-700 border border-green-100'
                    : 'bg-red-50 text-red-700 border border-red-100'
                }`}>
                  {testStatus.ok
                    ? <Wifi size={15} className="flex-shrink-0 mt-0.5" />
                    : <WifiOff size={15} className="flex-shrink-0 mt-0.5" />
                  }
                  {testStatus.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </OrnateCard>

      {/* カスタムプロバイダー */}
      <OrnateCard className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <CardHeading>カスタムプロバイダー</CardHeading>
            <button
              onClick={() => { setShowAddProvider(true); setEditingProvider(null); setProviderForm({ id: '', name: '', type: 'openai', endpoint: '', apiKey: '', model: '' }); }}
              className="flex items-center gap-1.5 text-sm font-serif text-sebastian-gray hover:text-sebastian-navy transition-colors"
            >
              <Plus size={14} />
              追加
            </button>
          </div>
          <p className="text-xs text-sebastian-lightgray font-serif">
            任意のOpenAI互換・Claude互換エンドポイントを登録できます。APIキーは現在平文保存されます。
          </p>

          {customProviders.length === 0 && !showAddProvider && (
            <p className="text-xs text-sebastian-lightgray italic font-serif">登録済みのカスタムプロバイダーはありません</p>
          )}

          <div className="space-y-2">
            {customProviders.map(p => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-sebastian-border/60 px-4 py-3 bg-white/50">
                <div>
                  <p className="text-sm font-serif font-medium text-sebastian-text">{p.name}</p>
                  <p className="text-xs font-mono text-sebastian-lightgray mt-0.5">{p.endpoint}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded border border-sebastian-border/60 text-sebastian-lightgray font-serif">
                    {p.type === 'openai' ? 'OpenAI互換' : 'Claude互換'}
                  </span>
                  <button onClick={() => { setEditingProvider(p); setProviderForm({ id: p.id, name: p.name, type: p.type, endpoint: p.endpoint, apiKey: p.api_key ?? '', model: p.model }); setShowAddProvider(true); }}
                    className="text-sebastian-lightgray hover:text-sebastian-gold transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => deleteCustomProvider(p.id)}
                    className="text-sebastian-lightgray hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>

          {/* Add/Edit form */}
          {showAddProvider && (
            <div className="rounded-xl border border-sebastian-gold/30 p-5 space-y-4" style={{ backgroundColor: 'rgba(201,164,86,0.04)' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-serif text-sebastian-navy">{editingProvider ? 'プロバイダーを編集' : '新しいプロバイダーを追加'}</h3>
                <button onClick={() => { setShowAddProvider(false); setEditingProvider(null); }} className="text-sebastian-lightgray hover:text-sebastian-gray"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-sebastian-gray font-serif">ID（英数字・ハイフン）</label>
                  <input type="text"
                    className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50"
                    placeholder="my-provider"
                    disabled={!!editingProvider}
                    value={providerForm.id}
                    onChange={e => setProviderForm(f => ({ ...f, id: e.target.value.replace(/[^a-z0-9-]/g, '') }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-sebastian-gray font-serif">表示名</label>
                  <input type="text"
                    className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-serif outline-none focus:border-sebastian-gold/50"
                    placeholder="My Custom Provider"
                    value={providerForm.name}
                    onChange={e => setProviderForm(f => ({ ...f, name: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-sebastian-gray font-serif">タイプ</label>
                <select
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-serif outline-none focus:border-sebastian-gold/50"
                  value={providerForm.type}
                  onChange={e => setProviderForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="openai">OpenAI互換（/v1/chat/completions）</option>
                  <option value="claude">Claude互換（/v1/messages）</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-sebastian-gray font-serif">エンドポイントURL</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50"
                  placeholder="https://example.com/api"
                  value={providerForm.endpoint}
                  onChange={e => setProviderForm(f => ({ ...f, endpoint: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-sebastian-gray font-serif">APIキー（省略可）</label>
                <input type="password"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50"
                  placeholder="sk-..."
                  value={providerForm.apiKey}
                  onChange={e => setProviderForm(f => ({ ...f, apiKey: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-sebastian-gray font-serif">モデルID</label>
                <input type="text"
                  className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-sebastian-gold/50"
                  placeholder="model-name-here"
                  value={providerForm.model}
                  onChange={e => setProviderForm(f => ({ ...f, model: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <button onClick={saveCustomProvider}
                  className="px-5 py-2 rounded-lg text-sm font-serif transition-colors"
                  style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}>
                  保存
                </button>
                <button onClick={() => { setShowAddProvider(false); setEditingProvider(null); }}
                  className="px-5 py-2 rounded-lg text-sm font-serif border border-sebastian-border/50 text-sebastian-gray hover:bg-sebastian-border/20 transition-colors">
                  キャンセル
                </button>
              </div>
            </div>
          )}
        </div>
      </OrnateCard>

      {/* レポート保存先 */}
      <OrnateCard className="p-6">
        <div className="space-y-5">
        <CardHeading>レポート保存先</CardHeading>
        {(['dailyReportPath', 'weeklyReportPath'] as const).map(field => (
          <div key={field} className="space-y-2">
            <label className="block text-sm text-sebastian-gray">
              {field === 'dailyReportPath' ? '日報の保存フォルダ' : '週報の保存フォルダ'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm text-sebastian-text outline-none cursor-pointer"
                placeholder="フォルダを選択してください"
                value={form[field]}
                onClick={() => pickFolder(field)}
              />
              <button
                onClick={() => pickFolder(field)}
                className="flex items-center gap-1.5 px-3 py-2 bg-sebastian-border/30 text-sebastian-gray rounded-lg hover:bg-sebastian-border/50 transition-colors text-sm font-serif"
              >
                <FolderOpen size={16} />
                参照
              </button>
            </div>
            {form[field] && (
              <p className="text-xs text-sebastian-lightgray">
                例: {form[field]}/{field === 'dailyReportPath' ? 'Nippo' : 'Shuho'}_20260331.md
              </p>
            )}
          </div>
        ))}
        </div>
      </OrnateCard>

      {/* 操作・起動 */}
      <OrnateCard className="p-6">
        <div className="space-y-5">
        <CardHeading>操作・起動</CardHeading>
        <div className="space-y-2">
          <label className="block text-sm text-sebastian-gray">クイックメモ ショートカットキー</label>
          <input
            type="text"
            className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm outline-none focus:border-sebastian-gold/50 transition-colors"
            placeholder="例: Ctrl+Shift+M"
            value={form.globalShortcut}
            onChange={e => setForm(f => ({ ...f, globalShortcut: e.target.value }))}
          />
          <p className="text-xs text-sebastian-lightgray">キーの組み合わせを入力（例: Ctrl+Shift+M、Alt+F1）</p>
          {shortcutStatus === 'ok' && (
            <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={12} />ショートカットを登録しました</p>
          )}
          {shortcutStatus === 'error' && (
            <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12} />{shortcutError}</p>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-sebastian-text">PC起動時に自動起動</p>
            <p className="text-xs text-sebastian-lightgray mt-0.5">Windowsのスタートアップに登録します</p>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, autostartEnabled: !f.autostartEnabled }))}
            className={`relative w-11 h-6 rounded-full transition-colors overflow-hidden shrink-0 ${form.autostartEnabled ? 'bg-sebastian-gold' : 'bg-sebastian-border/50'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${form.autostartEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        </div>
      </OrnateCard>

      {/* 終業リマインド */}
      <OrnateCard className="p-6">
        <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <CardHeading>終業リマインド</CardHeading>
            <p className="text-xs text-sebastian-lightgray mt-0.5">指定時刻に日報作成を通知します</p>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, reminderEnabled: !f.reminderEnabled }))}
            className={`relative w-11 h-6 rounded-full transition-colors overflow-hidden shrink-0 ${form.reminderEnabled ? 'bg-sebastian-gold' : 'bg-sebastian-border/50'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${form.reminderEnabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        {form.reminderEnabled && (
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <label className="block text-sm text-sebastian-gray">通知時刻</label>
              <input
                type="time"
                className="bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm outline-none focus:border-sebastian-gold/50 transition-colors"
                value={form.reminderTime}
                onChange={e => setForm(f => ({ ...f, reminderTime: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-sebastian-text">平日のみ通知</p>
                <p className="text-xs text-sebastian-lightgray mt-0.5">土日は通知しません</p>
              </div>
              <button
                onClick={() => setForm(f => ({ ...f, reminderWeekdaysOnly: !f.reminderWeekdaysOnly }))}
                className={`relative w-11 h-6 rounded-full transition-colors overflow-hidden shrink-0 ${form.reminderWeekdaysOnly ? 'bg-sebastian-gold' : 'bg-sebastian-border/50'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200 ${form.reminderWeekdaysOnly ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
            <p className="text-xs text-sebastian-lightgray">
              ※ 初回起動時にブラウザの通知許可が求められます。許可してください。
            </p>
          </div>
        )}
        </div>
      </OrnateCard>

      {/* レポートMD一括書き出し */}
      <OrnateCard className="p-6">
        <div className="space-y-4">
          <CardHeading>レポートMD一括書き出し</CardHeading>
          <p className="text-xs text-sebastian-lightgray -mt-2">
            DBに保存されている全ての日報・週報をMarkdownファイルとして書き出します。<br />
            別端末でDB同期後に実行すると、過去分も含めて一括で取り出せます。
          </p>
          <div className="bg-sebastian-parchment/50 rounded-lg px-3 py-2.5 border border-sebastian-border/40 text-xs text-sebastian-lightgray space-y-0.5">
            <p>日報 → {form.dailyReportPath || '（設定から保存先フォルダを指定してください）'}</p>
            <p>週報 → {form.weeklyReportPath || '（設定から保存先フォルダを指定してください）'}</p>
          </div>
          <button
            onClick={handleExportAll}
            disabled={exportStatus === 'exporting' || (!form.dailyReportPath && !form.weeklyReportPath)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-serif transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
          >
            <FileDown size={15} />
            {exportStatus === 'exporting' ? '書き出し中...' : '全レポートをMDで書き出す'}
          </button>
          {exportStatus === 'done' && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2.5 text-sm text-green-700">
              <CheckCircle size={15} />
              {exportMsg}
            </div>
          )}
          {exportStatus === 'error' && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              {exportMsg}
            </div>
          )}
        </div>
      </OrnateCard>

      {/* Quill連携 */}
      <OrnateCard className="p-6">
        <div className="space-y-4">
          <CardHeading>Quill連携</CardHeading>
          <p className="text-xs text-sebastian-lightgray -mt-2">
            指定フォルダに当日のメモを <span className="font-mono">YYYY-MM-DD.md</span> として書き出します。<br />
            QuillでそのファイルをOpenすると双方向リアルタイム同期になります。
          </p>
          <div className="space-y-2">
            <label className="block text-sm text-sebastian-gray">メモ同期フォルダ</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm text-sebastian-text outline-none cursor-pointer"
                placeholder="フォルダを選択してください"
                value={form.memoSyncFolder}
                onClick={() => pickFolder('memoSyncFolder')}
              />
              <button
                onClick={() => pickFolder('memoSyncFolder')}
                className="flex items-center gap-1.5 px-3 py-2 bg-sebastian-border/30 text-sebastian-gray rounded-lg hover:bg-sebastian-border/50 transition-colors text-sm font-serif"
              >
                <FolderOpen size={16} />
                参照
              </button>
            </div>
            {form.memoSyncFolder && (
              <p className="text-xs text-sebastian-lightgray">
                例: {form.memoSyncFolder}/{format(new Date(), 'yyyy-MM-dd')}.md
              </p>
            )}
          </div>
        </div>
      </OrnateCard>

      {/* Supabase 同期 */}
      <OrnateCard className="p-6">
        <div className="space-y-4">
          <CardHeading>クラウド同期（Supabase）</CardHeading>
          <p className="text-xs text-sebastian-lightgray -mt-2">
            マルチデバイス同期に使用します。自分の Supabase プロジェクトの情報を入力してください。
          </p>

          {/* Project ID */}
          <div className="space-y-1.5">
            <label className="block text-sm text-sebastian-gray">Project ID</label>
            <input
              type="text"
              className="w-full bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm text-sebastian-text outline-none focus:border-sebastian-gold/60"
              placeholder="例: txzje...（20文字の小文字英数字）"
              value={form.supabaseProjectId}
              onChange={e => setForm(f => ({ ...f, supabaseProjectId: e.target.value }))}
            />
            {form.supabaseProjectId && (
              <p className="text-xs text-sebastian-lightgray">
                URL: https://{form.supabaseProjectId}.supabase.co
              </p>
            )}
          </div>

          {/* Publishable key */}
          <div className="space-y-1.5">
            <label className="block text-sm text-sebastian-gray">Publishable Key</label>
            <div className="flex gap-2">
              <input
                type={showSupabaseKey ? 'text' : 'password'}
                className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm text-sebastian-text outline-none focus:border-sebastian-gold/60"
                placeholder="sb_pub..."
                value={form.supabaseKey}
                onChange={e => setForm(f => ({ ...f, supabaseKey: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setShowSupabaseKey(v => !v)}
                className="px-3 py-2 bg-sebastian-border/30 text-sebastian-gray rounded-lg hover:bg-sebastian-border/50 transition-colors"
              >
                {showSupabaseKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* 接続テスト */}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (!form.supabaseProjectId || !form.supabaseKey) {
                  setSupabaseTestStatus({ ok: false, msg: 'Project ID と Key を入力してください' });
                  return;
                }
                setSupabaseTesting(true);
                setSupabaseTestStatus(null);
                try {
                  const { createClient } = await import('@supabase/supabase-js');
                  const url = `https://${form.supabaseProjectId}.supabase.co`;
                  const client = createClient(url, form.supabaseKey);
                  const { error } = await client.from('tasks').select('id').limit(1);
                  if (error) throw new Error(error.message);
                  setSupabaseTestStatus({ ok: true, msg: '接続できました' });
                } catch (e) {
                  setSupabaseTestStatus({ ok: false, msg: `接続失敗: ${e instanceof Error ? e.message : String(e)}` });
                } finally {
                  setSupabaseTesting(false);
                }
              }}
              disabled={supabaseTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-serif transition-colors disabled:opacity-50"
              style={{ background: '#1e2e4a', color: '#c9a456', border: '1px solid #c9a456' }}
            >
              <Wifi size={13} />
              {supabaseTesting ? 'テスト中...' : '接続テスト'}
            </button>
            {supabaseTestStatus && (
              <span className={`text-xs flex items-center gap-1 ${supabaseTestStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
                {supabaseTestStatus.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {supabaseTestStatus.msg}
              </span>
            )}
          </div>

          {/* 一括インポート */}
          {form.supabaseProjectId && form.supabaseKey && (
            <div className="border-t border-sebastian-border/30 pt-4 space-y-2">
              <p className="text-xs text-sebastian-lightgray">
                初回セットアップ時にローカルの全データを Supabase へ送信します。
              </p>
              <button
                onClick={async () => {
                  setImporting(true);
                  setImportStatus(null);
                  try {
                    await pushAllToSupabase();
                    setImportStatus({ ok: true, msg: '全データのインポートが完了しました' });
                  } catch (e) {
                    setImportStatus({ ok: false, msg: `失敗: ${e instanceof Error ? e.message : String(e)}` });
                  } finally {
                    setImporting(false);
                  }
                }}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-serif transition-colors disabled:opacity-50"
                style={{ background: '#1e2e4a', color: '#c9a456', border: '1px solid #c9a456' }}
              >
                <Upload size={15} />
                {importing ? 'インポート中...' : 'ローカルDB を Supabase にインポート'}
              </button>
              {importStatus && (
                <p className={`text-xs flex items-center gap-1 ${importStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {importStatus.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                  {importStatus.msg}
                </p>
              )}
            </div>
          )}
        </div>
      </OrnateCard>

      {/* データ同期 */}
      <OrnateCard className="p-6">
        <div className="space-y-5">
        <CardHeading>データ同期</CardHeading>
        <p className="text-xs text-sebastian-lightgray -mt-3">OneDrive・USBなど共有フォルダ経由でPCを切り替えます</p>

        {/* 同期フォルダ */}
        <div className="space-y-2">
          <label className="block text-sm text-sebastian-gray">同期フォルダ</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              className="flex-1 bg-sebastian-parchment/50 border border-sebastian-border rounded-lg px-3 py-2 text-sm text-sebastian-text outline-none cursor-pointer"
              placeholder="フォルダを選択してください（例: OneDrive\Sebastian）"
              value={form.syncFolder}
              onClick={() => pickFolder('syncFolder')}
            />
            <button
              onClick={() => pickFolder('syncFolder')}
              className="flex items-center gap-1.5 px-3 py-2 bg-sebastian-border/30 text-sebastian-gray rounded-lg hover:bg-sebastian-border/50 transition-colors text-sm font-serif"
            >
              <FolderOpen size={16} />
              参照
            </button>
          </div>
          {form.syncFolder && syncFolderDbTime && (
            <p className="text-xs text-sebastian-lightgray flex items-center gap-1">
              <Clock size={11} />
              同期フォルダのDB: {syncFolderDbTime} に更新
            </p>
          )}
          {form.syncFolder && !syncFolderDbTime && (
            <p className="text-xs text-sebastian-lightgray">同期フォルダにDBファイルはまだありません（Push後に作成されます）</p>
          )}
        </div>

        {/* Push / Pull */}
        {form.syncFolder && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handlePush}
                disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-sebastian-navy text-white rounded-lg hover:bg-sebastian-dark transition-colors text-sm font-medium disabled:opacity-50"
              >
                <Upload size={15} />
                {syncStatus === 'pushing' ? '送り出し中...' : 'Push（このPCから送り出す）'}
              </button>
              <button
                onClick={handlePull}
                disabled={syncStatus === 'pushing' || syncStatus === 'pulling' || !syncFolderDbTime}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
              >
                <Download size={15} />
                {syncStatus === 'pulling' ? '取り込み中...' : 'Pull（このPCに取り込む）'}
              </button>
            </div>

            {syncStatus === 'done' && (
              <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2.5 text-sm text-green-700">
                <CheckCircle size={15} className="flex-shrink-0 mt-0.5" />
                {syncMsg}
              </div>
            )}
            {syncStatus === 'error' && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 text-sm text-red-700">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                {syncMsg}
              </div>
            )}

            <div className="bg-sebastian-parchment/50 rounded-lg px-3 py-2.5 space-y-1 border border-sebastian-border/40">
              <p className="text-xs font-medium text-sebastian-gray font-serif">使い方</p>
              <p className="text-xs text-sebastian-lightgray">出発前：メインPCで Push → サブPCで Pull して作業</p>
              <p className="text-xs text-sebastian-lightgray">帰宅後：サブPCで Push → メインPCで Pull して引き継ぎ</p>
              <p className="text-xs text-sebastian-lightgray">Pull 実行時は現在のDBが自動バックアップされます</p>
            </div>

            {lastSyncAt && (
              <p className="text-xs text-sebastian-lightgray flex items-center gap-1">
                <Clock size={11} />
                最終同期: {format(new Date(lastSyncAt), 'M月d日 HH:mm', { locale: ja })}
              </p>
            )}
          </div>
        )}
        </div>
      </OrnateCard>

      {errorMsg && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {errorMsg}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="px-8 py-2.5 rounded-lg text-sm font-serif transition-colors"
          style={{ backgroundColor: '#131929', color: '#d4c9a8', border: '1px solid rgba(201,164,86,0.3)' }}
        >
          設定を保存する
        </button>
        {saveStatus === 'saved' && (
          <div className="flex items-center gap-1.5 text-green-600 text-sm font-serif">
            <CheckCircle size={16} />
            保存しました
          </div>
        )}
      </div>

      <div className="text-xs text-sebastian-lightgray/50 border-t border-sebastian-border/30 pt-4 font-serif">
        Sebastian v1.3.0 — AI Work Supporter
      </div>
    </div>
  );
}
