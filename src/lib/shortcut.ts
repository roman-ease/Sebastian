import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

/** 現在登録中のショートカットキー */
let currentShortcut: string | null = null;

/**
 * ショートカットを登録する。
 * 既存の登録があれば先に解除してから再登録する。
 */
export async function registerShortcut(key: string, callback: () => Promise<void>): Promise<void> {
  if (currentShortcut) {
    try { await unregister(currentShortcut); } catch { /* 未登録なら無視 */ }
    currentShortcut = null;
  }
  if (!key) return;
  try {
    await register(key, callback);
    currentShortcut = key;
  } catch (e) {
    console.warn('ショートカット登録失敗:', e);
  }
}
