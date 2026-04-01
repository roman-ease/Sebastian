import Database from '@tauri-apps/plugin-sql';
import { isDemoMode, selectDemo } from './demoMode';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:sebastian.db');
  }
  return dbInstance;
}

export async function executeDb(query: string, bindValues?: unknown[]): Promise<any> {
  // デモモードでも settings テーブルへの書き込みは通す
  if (isDemoMode() && !query.toLowerCase().includes('settings')) {
    return { lastInsertId: 0, changes: 0 };
  }
  const db = await getDb();
  return await db.execute(query, bindValues);
}

export async function selectDb<T>(query: string, bindValues?: unknown[]): Promise<T[]> {
  // デモモードでも settings テーブルの読み込みは実DBから取得
  if (isDemoMode() && !query.toLowerCase().includes('from settings')) {
    return selectDemo<T>(query, bindValues ?? []);
  }
  const db = await getDb();
  return await db.select<T[]>(query, bindValues);
}

export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
