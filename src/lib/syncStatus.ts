// Supabase 同期の成否をアプリ内に知らせる小さなステータスバス。
// push/pull の失敗は console.error だけだと DevTools を開かない限り気づけず、
// 過去に push が1ヶ月無音で失敗していた（RLS 401）ため、UI へも必ず伝える。
export interface SyncStatusInfo {
  state: 'unknown' | 'ok' | 'error';
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export const SYNC_STATUS_EVENT = 'sebastian:sync-status';

const _status: SyncStatusInfo = {
  state: 'unknown',
  lastOkAt: null,
  lastError: null,
  lastErrorAt: null,
};

export function getSyncStatus(): SyncStatusInfo {
  return { ..._status };
}

function emit(): void {
  window.dispatchEvent(new CustomEvent<SyncStatusInfo>(SYNC_STATUS_EVENT, { detail: getSyncStatus() }));
}

export function reportSyncOk(): void {
  const changed = _status.state !== 'ok';
  _status.state = 'ok';
  _status.lastOkAt = new Date();
  if (changed) emit(); // ok→ok の連続は通知しない（60秒ポーリングでのイベント洪水防止）
}

export function reportSyncError(context: string, e: unknown): void {
  _status.state = 'error';
  _status.lastError = `${context}: ${e instanceof Error ? e.message : String(e)}`;
  _status.lastErrorAt = new Date();
  emit(); // エラーは内容が変わり得るため毎回通知
}
