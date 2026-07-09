// API キー等の機密値を OS キーチェーン（Windows 資格情報マネージャー / macOS Keychain）へ
// 保存・取得する薄いブリッジ。Rust 側の set_secret / get_secret / delete_secret を呼ぶ。
// 平文 SQLite に置かないための窓口。Tauri 外（テスト等）では invoke が失敗するので null/no-op で握る。
import { invoke } from '@tauri-apps/api/core';

export async function getSecret(key: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>('get_secret', { key });
    return v ?? null;
  } catch (e) {
    console.error('[secrets] get failed:', key, e);
    return null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  try {
    // 空文字はクリア（Rust 側で delete 扱い）
    await invoke('set_secret', { key, value });
  } catch (e) {
    console.error('[secrets] set failed:', key, e);
  }
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    await invoke('delete_secret', { key });
  } catch (e) {
    console.error('[secrets] delete failed:', key, e);
  }
}
