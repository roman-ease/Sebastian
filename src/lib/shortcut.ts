import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

/** 現在登録中のショートカットキー */
let currentShortcut: string | null = null;

/**
 * ショートカットを登録する。
 * 既存の登録があれば先に解除してから再登録する。
 */
export async function registerShortcut(key: string, callback: () => Promise<void>): Promise<boolean> {
  if (currentShortcut) {
    try { await unregister(currentShortcut); } catch { /* 未登録なら無視 */ }
    currentShortcut = null;
  }
  if (!key) return false;
  try {
    await register(key, (event: { state: string }) => {
      if (event.state === 'Pressed') {
        callback().catch(console.warn);
      }
    });
    currentShortcut = key;
    console.log('[Sebastian] ショートカット登録成功:', key);
    return true;
  } catch (e) {
    console.error('[Sebastian] ショートカット登録失敗:', key, e);
    return false;
  }
}
