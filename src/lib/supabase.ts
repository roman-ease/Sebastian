import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { executeDb, selectDb } from './db';
import { getSetting, SETTING_KEYS } from './settings';

let _client: SupabaseClient | null = null;
let _cachedUrl = '';
let _cachedKey = '';

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  const projectId = await getSetting(SETTING_KEYS.SUPABASE_PROJECT_ID);
  const key = await getSetting(SETTING_KEYS.SUPABASE_KEY);
  if (!projectId || !key) return null;
  const url = `https://${projectId}.supabase.co`;
  if (url !== _cachedUrl || key !== _cachedKey || !_client) {
    _client = createClient(url, key);
    _cachedUrl = url;
    _cachedKey = key;
  }
  return _client;
}

// 後方互換: 直接 supabase を使っている箇所向け（内部用）
async function sb(): Promise<SupabaseClient | null> {
  return getSupabaseClient();
}

// ─── 差分 pull 用の最終取得タイムスタンプ（テーブル別）─────────────────────────
// pull のたびに全行を select('*') すると重い。テーブルごとに「前回取得した最大 updated_at」を
// localStorage に保存し、次回は updated_at >= その値の行だけを取得する。
// 境界の取りこぼしを避けるため gte で再取得（適用は冪等）。
const LAST_PULL_KEY = 'sebastian_supabase_last_pull';

function getLastPull(table: string): string | undefined {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_PULL_KEY) || '{}');
    return typeof m[table] === 'string' ? m[table] : undefined;
  } catch {
    return undefined;
  }
}

function setLastPull(table: string, iso: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_PULL_KEY) || '{}');
    if (!m[table] || iso > m[table]) {
      m[table] = iso;
      localStorage.setItem(LAST_PULL_KEY, JSON.stringify(m));
    }
  } catch {
    /* ignore */
  }
}

// ─── 編集中ガード ─────────────────────────────────────────────────────────────
// メモ等を入力している最中に pull が走ると、未 push のローカル本文が LWW で上書きされ得る。
// 編集中の行（table:key）を登録し、pull はその行をスキップする。
const _editing = new Set<string>();
export function markEditing(table: string, key: string): void {
  _editing.add(`${table}:${key}`);
}
export function clearEditing(table: string, key: string): void {
  _editing.delete(`${table}:${key}`);
}
function isEditing(table: string, key: string): boolean {
  return _editing.has(`${table}:${key}`);
}

// ─── Push: ローカル → Supabase ────────────────────────────────────────────────

export async function pushMemo(date: string, content: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM daily_memos WHERE date = ?', [date]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE daily_memos SET sync_id = ? WHERE date = ?', [syncId, date]);
    }
    await client.from('daily_memos').upsert({
      id: syncId, date, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushMemo:', e);
  }
}

export async function pushTask(localId: number): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const rows = await selectDb<any>('SELECT * FROM tasks WHERE id = ?', [localId]);
    if (!rows.length) return;
    const t = rows[0];
    let syncId = t.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE tasks SET sync_id = ? WHERE id = ?', [syncId, localId]);
    }
    await client.from('tasks').upsert({
      id: syncId,
      title: t.title, description: t.description, status: t.status,
      priority: t.priority, due_date: t.due_date, category: t.category,
      archived: !!t.archived, pinned: !!t.pinned, notes: t.notes,
      start_date: t.start_date, progress: t.progress,
      updated_at: new Date().toISOString(),
    });
    // 注: deleted_at は payload に含めない。tombstone 済みのリモート行を upsert しても
    // ON CONFLICT は指定列のみ更新するため deleted_at は保持される（＝復活しない）。
  } catch (e) {
    console.error('[supabase] pushTask:', e);
  }
}

// ローカルでタスクを削除した際に呼ぶ。hard-delete だと「削除された事実」が他端末へ伝わらず
// （他端末はローカル保持→再 push で復活）ゾンビ化する。deleted_at を立てた tombstone にして、
// 他端末は pull 時にこれを見てローカル削除する。updated_at も進めて差分 pull に乗せる。
export async function pushTaskDelete(syncId: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const now = new Date().toISOString();
    await client.from('tasks').update({ deleted_at: now, updated_at: now }).eq('id', syncId);
  } catch (e) {
    console.error('[supabase] pushTaskDelete:', e);
  }
}

export async function pushChecklist(localTaskId: number): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const taskRows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM tasks WHERE id = ?', [localTaskId]
    );
    const taskSyncId = taskRows[0]?.sync_id;
    if (!taskSyncId) return;

    const items = await selectDb<any>(
      'SELECT * FROM task_checklist WHERE task_id = ? ORDER BY sort_order', [localTaskId]
    );

    // sync_id 未付与のアイテムに UUID を振る
    for (const item of items) {
      if (!item.sync_id) {
        item.sync_id = crypto.randomUUID();
        await executeDb('UPDATE task_checklist SET sync_id = ? WHERE id = ?', [item.sync_id, item.id]);
      }
    }

    // Supabase 側をまるごと差し替え
    await client.from('task_checklist').delete().eq('task_id', taskSyncId);
    if (items.length > 0) {
      await client.from('task_checklist').insert(
        items.map((item: any) => ({
          id: item.sync_id,
          task_id: taskSyncId,
          text: item.text,
          checked: !!item.checked,
          sort_order: item.sort_order,
        }))
      );
    }

    // チェックリストだけ変えても他端末の pull で「リモートが新しい」と判定されるよう、
    // 親タスクの updated_at を進める（pull 側はこの値でチェックリスト置換の可否を決める）。
    const now = new Date().toISOString();
    await client.from('tasks').update({ updated_at: now }).eq('id', taskSyncId);
    await executeDb('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [localTaskId]);
  } catch (e) {
    console.error('[supabase] pushChecklist:', e);
  }
}

export async function pushDailyReport(date: string, content: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM reports_daily WHERE date = ?', [date]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE reports_daily SET sync_id = ? WHERE date = ?', [syncId, date]);
    }
    await client.from('reports_daily').upsert({
      id: syncId, date, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushDailyReport:', e);
  }
}

export async function pushWeeklyReport(weekStartDate: string, content: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM reports_weekly WHERE week_start_date = ?', [weekStartDate]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE reports_weekly SET sync_id = ? WHERE week_start_date = ?', [syncId, weekStartDate]);
    }
    await client.from('reports_weekly').upsert({
      id: syncId, week_start_date: weekStartDate, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushWeeklyReport:', e);
  }
}

// ─── 全データ一括 Push（既存 DB のインポート用）──────────────────────────────

export async function pushAllToSupabase(): Promise<void> {
  try {
    const tasks = await selectDb<{ id: number }>('SELECT id FROM tasks');
    for (const t of tasks) {
      await pushTask(t.id);
      await pushChecklist(t.id);
    }
    const memos = await selectDb<{ date: string; content: string }>('SELECT date, content FROM daily_memos');
    for (const m of memos) await pushMemo(m.date, m.content);

    const daily = await selectDb<{ date: string; content: string }>('SELECT date, content FROM reports_daily');
    for (const r of daily) await pushDailyReport(r.date, r.content);

    const weekly = await selectDb<{ week_start_date: string; content: string }>('SELECT week_start_date, content FROM reports_weekly');
    for (const r of weekly) await pushWeeklyReport(r.week_start_date, r.content);
  } catch (e) {
    console.error('[supabase] pushAllToSupabase:', e);
  }
}

// ─── Pull: Supabase → ローカル（起動時同期）──────────────────────────────────

let _pulling = false;

export async function pullFromSupabase(): Promise<void> {
  if (_pulling) return; // 多重実行ガード（60秒ポーリングが前回分と重ならないように）
  _pulling = true;
  try {
    await Promise.all([pullMemos(), pullTasks(), pullDailyReports(), pullWeeklyReports()]);
  } catch (e) {
    console.error('[supabase] pull:', e);
  } finally {
    _pulling = false;
  }
}

async function pullMemos(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('daily_memos');
  let q = client.from('daily_memos').select('*');
  if (since) q = q.gte('updated_at', since);
  const { data } = await q;
  if (!data) return;
  let maxTs = since ?? '';
  let deferred = false; // 編集中で飛ばした行がある間は lastPull を進めない
  for (const row of data) {
    if (isEditing('daily_memos', row.date)) { deferred = true; continue; }
    if (typeof row.updated_at === 'string' && row.updated_at > maxTs) maxTs = row.updated_at;
    const local = await selectDb<{ updated_at: string }>(
      'SELECT updated_at FROM daily_memos WHERE date = ?', [row.date]
    );
    if (!local.length) {
      await executeDb(
        'INSERT INTO daily_memos (date, content, sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [row.date, row.content, row.id, row.created_at, row.updated_at]
      );
    } else if (new Date(row.updated_at) > new Date(local[0].updated_at)) {
      await executeDb(
        'UPDATE daily_memos SET content = ?, sync_id = ?, updated_at = ? WHERE date = ?',
        [row.content, row.id, row.updated_at, row.date]
      );
    }
  }
  if (maxTs && !deferred) setLastPull('daily_memos', maxTs);
}

async function pullTasks(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('tasks');
  let q = client.from('tasks').select('*, task_checklist(*)');
  if (since) q = q.gte('updated_at', since);
  const { data: tasks } = await q;
  if (!tasks) return;
  let maxTs = since ?? '';

  for (const task of tasks) {
    if (typeof task.updated_at === 'string' && task.updated_at > maxTs) maxTs = task.updated_at;

    const local = await selectDb<{ id: number; updated_at: string }>(
      'SELECT id, updated_at FROM tasks WHERE sync_id = ?', [task.id]
    );

    // tombstone: 削除済みはローカルからも削除（ゾンビ復活防止）
    if (task.deleted_at) {
      if (local.length) {
        await executeDb('DELETE FROM task_checklist WHERE task_id = ?', [local[0].id]);
        await executeDb('DELETE FROM tasks WHERE id = ?', [local[0].id]);
      }
      continue;
    }

    let localId: number;
    let remoteNewer = false;
    if (!local.length) {
      const res = await executeDb(
        `INSERT INTO tasks
          (title, description, status, priority, due_date, category,
           archived, pinned, notes, start_date, progress, sync_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [task.title, task.description, task.status, task.priority, task.due_date,
         task.category, task.archived ? 1 : 0, task.pinned ? 1 : 0, task.notes,
         task.start_date, task.progress, task.id, task.created_at, task.updated_at]
      );
      localId = res.lastInsertId;
      remoteNewer = true;
    } else {
      localId = local[0].id;
      remoteNewer = new Date(task.updated_at) > new Date(local[0].updated_at);
      if (remoteNewer) {
        await executeDb(
          `UPDATE tasks SET
            title=?, description=?, status=?, priority=?, due_date=?, category=?,
            archived=?, pinned=?, notes=?, start_date=?, progress=?, updated_at=?
           WHERE id=?`,
          [task.title, task.description, task.status, task.priority, task.due_date,
           task.category, task.archived ? 1 : 0, task.pinned ? 1 : 0, task.notes,
           task.start_date, task.progress, task.updated_at, localId]
        );
      }
    }

    // チェックリストはリモートが新しい時だけ置き換える。
    // 無条件 DELETE→再INSERT すると未 push のローカルチェックが消えるため。
    if (remoteNewer) {
      await executeDb('DELETE FROM task_checklist WHERE task_id = ?', [localId]);
      if (task.task_checklist?.length) {
        for (const item of task.task_checklist) {
          await executeDb(
            'INSERT INTO task_checklist (task_id, text, checked, sort_order, sync_id) VALUES (?, ?, ?, ?, ?)',
            [localId, item.text, item.checked ? 1 : 0, item.sort_order, item.id]
          );
        }
      }
    }
  }

  if (maxTs) setLastPull('tasks', maxTs);
}

async function pullDailyReports(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('reports_daily');
  let q = client.from('reports_daily').select('*');
  if (since) q = q.gte('updated_at', since);
  const { data } = await q;
  if (!data) return;
  let maxTs = since ?? '';
  let deferred = false;
  for (const row of data) {
    if (isEditing('reports_daily', row.date)) { deferred = true; continue; }
    if (typeof row.updated_at === 'string' && row.updated_at > maxTs) maxTs = row.updated_at;
    const local = await selectDb<{ updated_at: string }>(
      'SELECT updated_at FROM reports_daily WHERE date = ?', [row.date]
    );
    if (!local.length) {
      await executeDb(
        'INSERT INTO reports_daily (date, content, sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [row.date, row.content, row.id, row.created_at, row.updated_at]
      );
    } else if (new Date(row.updated_at) > new Date(local[0].updated_at)) {
      await executeDb(
        'UPDATE reports_daily SET content = ?, sync_id = ?, updated_at = ? WHERE date = ?',
        [row.content, row.id, row.updated_at, row.date]
      );
    }
  }
  if (maxTs && !deferred) setLastPull('reports_daily', maxTs);
}

async function pullWeeklyReports(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('reports_weekly');
  let q = client.from('reports_weekly').select('*');
  if (since) q = q.gte('updated_at', since);
  const { data } = await q;
  if (!data) return;
  let maxTs = since ?? '';
  let deferred = false;
  for (const row of data) {
    if (isEditing('reports_weekly', row.week_start_date)) { deferred = true; continue; }
    if (typeof row.updated_at === 'string' && row.updated_at > maxTs) maxTs = row.updated_at;
    const local = await selectDb<{ updated_at: string }>(
      'SELECT updated_at FROM reports_weekly WHERE week_start_date = ?', [row.week_start_date]
    );
    if (!local.length) {
      await executeDb(
        'INSERT INTO reports_weekly (week_start_date, content, sync_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [row.week_start_date, row.content, row.id, row.created_at, row.updated_at]
      );
    } else if (new Date(row.updated_at) > new Date(local[0].updated_at)) {
      await executeDb(
        'UPDATE reports_weekly SET content = ?, sync_id = ?, updated_at = ? WHERE week_start_date = ?',
        [row.content, row.id, row.updated_at, row.week_start_date]
      );
    }
  }
  if (maxTs && !deferred) setLastPull('reports_weekly', maxTs);
}
