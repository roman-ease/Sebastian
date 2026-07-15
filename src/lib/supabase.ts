import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { executeDb, selectDb } from './db';
import { getSetting, SETTING_KEYS } from './settings';
import { reportSyncOk, reportSyncError } from './syncStatus';

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
  await ensureAuth(_client);
  return _client;
}

// ─── Supabase Auth ────────────────────────────────────────────────────────────
// テーブルは RLS で「authenticated ロールのみ全操作可」に制限しているため、
// anon キーだけではデータに触れない。設定済みのメール/パスワードでセッションを確立してから使う。
// 認証情報が未設定なら従来どおり anon のまま通す（RLS 未設定の環境との互換）。
// セッションは supabase-js が localStorage に永続化・自動リフレッシュするので、
// サインインが走るのは初回と期限切れ時のみ。
let _signInPromise: Promise<void> | null = null;

async function ensureAuth(client: SupabaseClient): Promise<void> {
  const { data: { session } } = await client.auth.getSession();
  if (session) return;
  if (!_signInPromise) {
    _signInPromise = (async () => {
      try {
        const email = await getSetting(SETTING_KEYS.SUPABASE_EMAIL);
        const password = await getSetting(SETTING_KEYS.SUPABASE_PASSWORD);
        if (!email || !password) return;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) console.error('[supabase] サインイン失敗:', error.message);
      } finally {
        _signInPromise = null;
      }
    })();
  }
  await _signInPromise;
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

// ─── タイムスタンプ比較 ───────────────────────────────────────────────────────
// ローカルの updated_at は SQLite CURRENT_TIMESTAMP（UTC の「YYYY-MM-DD HH:MM:SS」・
// タイムゾーン記号なし）で、new Date() はこれをローカル時刻として解釈してしまう
// （JST だと実際より9時間古い扱いになり、直近のローカル編集がリモートに負ける）。
// 素の形式は UTC として解釈して ms に直し、リモートの ISO(Z付き) と正しく比較する。
// ローカル列には pull で書き戻した ISO 文字列も混在するため、形式を見て分岐する。
export function tsToMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const naive = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts);
  const ms = new Date(naive ? ts.replace(' ', 'T') + 'Z' : ts).getTime();
  return Number.isNaN(ms) ? 0 : ms;
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
    // throwOnError: supabase-js は既定でエラーを throw せず戻り値で返すため、
    // 付けないと RLS 拒否等が catch にも掛からず完全に無音で失敗する
    await client.from('daily_memos').upsert({
      id: syncId, date, content, updated_at: new Date().toISOString(),
    }).throwOnError();
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushMemo:', e);
    reportSyncError('pushMemo', e);
  }
}

export async function pushProject(localId: number): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const rows = await selectDb<any>('SELECT * FROM projects WHERE id = ?', [localId]);
    if (!rows.length) return;
    const p = rows[0];
    let syncId = p.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE projects SET sync_id = ? WHERE id = ?', [syncId, localId]);
    }
    await client.from('projects').upsert({
      id: syncId,
      name: p.name, description: p.description, status: p.status,
      start_date: p.start_date, target_date: p.target_date,
      updated_at: new Date().toISOString(),
    }).throwOnError();
    // deleted_at は payload に含めない（tasks と同じ tombstone 保持ルール）
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushProject:', e);
    reportSyncError('pushProject', e);
  }
}

export async function pushProjectDelete(syncId: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const now = new Date().toISOString();
    await client.from('projects').update({ deleted_at: now, updated_at: now }).eq('id', syncId).throwOnError();
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushProjectDelete:', e);
    reportSyncError('pushProjectDelete', e);
  }
}

// tasks.project_id（ローカル整数 id）→ リモート projects の UUID に変換する。
// プロジェクトがまだ sync_id を持たない場合は先に push して採番する。
async function resolveProjectSyncId(localProjectId: number | null): Promise<string | null> {
  if (localProjectId == null) return null;
  const rows = await selectDb<{ sync_id: string | null }>(
    'SELECT sync_id FROM projects WHERE id = ?', [localProjectId]
  );
  if (!rows.length) return null;
  if (rows[0].sync_id) return rows[0].sync_id;
  await pushProject(localProjectId);
  const after = await selectDb<{ sync_id: string | null }>(
    'SELECT sync_id FROM projects WHERE id = ?', [localProjectId]
  );
  return after[0]?.sync_id ?? null;
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
    const projectSyncId = await resolveProjectSyncId(t.project_id ?? null);
    await client.from('tasks').upsert({
      id: syncId,
      title: t.title, description: t.description, status: t.status,
      priority: t.priority, due_date: t.due_date, category: t.category,
      archived: !!t.archived, pinned: !!t.pinned, notes: t.notes,
      start_date: t.start_date, progress: t.progress,
      project_id: projectSyncId,
      updated_at: new Date().toISOString(),
    }).throwOnError();
    // 注: deleted_at は payload に含めない。tombstone 済みのリモート行を upsert しても
    // ON CONFLICT は指定列のみ更新するため deleted_at は保持される（＝復活しない）。
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushTask:', e);
    reportSyncError('pushTask', e);
  }
}

// ローカルでタスクを削除した際に呼ぶ。hard-delete だと「削除された事実」が他端末へ伝わらず
// （他端末はローカル保持→再 push で復活）ゾンビ化する。deleted_at を立てた tombstone にして、
// 他端末は pull 時にこれを見てローカル削除する。updated_at も進めて差分 pull に乗せる。
export async function pushTaskDelete(syncId: string): Promise<void> {
  try {
    const client = await sb(); if (!client) return;
    const now = new Date().toISOString();
    await client.from('tasks').update({ deleted_at: now, updated_at: now }).eq('id', syncId).throwOnError();
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushTaskDelete:', e);
    reportSyncError('pushTaskDelete', e);
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
    await client.from('task_checklist').delete().eq('task_id', taskSyncId).throwOnError();
    if (items.length > 0) {
      await client.from('task_checklist').insert(
        items.map((item: any) => ({
          id: item.sync_id,
          task_id: taskSyncId,
          text: item.text,
          checked: !!item.checked,
          sort_order: item.sort_order,
        }))
      ).throwOnError();
    }

    // チェックリストだけ変えても他端末の pull で「リモートが新しい」と判定されるよう、
    // 親タスクの updated_at を進める（pull 側はこの値でチェックリスト置換の可否を決める）。
    const now = new Date().toISOString();
    await client.from('tasks').update({ updated_at: now }).eq('id', taskSyncId).throwOnError();
    await executeDb('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [localTaskId]);
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushChecklist:', e);
    reportSyncError('pushChecklist', e);
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
    }).throwOnError();
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushDailyReport:', e);
    reportSyncError('pushDailyReport', e);
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
    }).throwOnError();
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pushWeeklyReport:', e);
    reportSyncError('pushWeeklyReport', e);
  }
}

// ─── 全データ一括 Push（既存 DB のインポート用）──────────────────────────────

export async function pushAllToSupabase(): Promise<void> {
  try {
    // プロジェクトを先に push（tasks.project_id が参照する UUID を確定させる）
    const projects = await selectDb<{ id: number }>('SELECT id FROM projects');
    for (const p of projects) await pushProject(p.id);

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
    // reportSyncOk は呼ばない: 個々の push が成否を報告済みで、ここで ok にすると
    // 内側で握りつぶされた失敗を上書きしてしまう
  } catch (e) {
    console.error('[supabase] pushAllToSupabase:', e);
    reportSyncError('pushAllToSupabase', e);
  }
}

// ─── Pull: Supabase → ローカル（起動時同期）──────────────────────────────────

let _pulling = false;

export async function pullFromSupabase(): Promise<void> {
  if (_pulling) return; // 多重実行ガード（60秒ポーリングが前回分と重ならないように）
  _pulling = true;
  try {
    // projects を先に pull（pullTasks が project_id の UUID→ローカル id 変換に使う）
    await pullProjects();
    await Promise.all([pullMemos(), pullTasks(), pullDailyReports(), pullWeeklyReports()]);
    reportSyncOk();
  } catch (e) {
    console.error('[supabase] pull:', e);
    reportSyncError('pull', e);
  } finally {
    _pulling = false;
  }
}

async function pullMemos(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('daily_memos');
  let q = client.from('daily_memos').select('*');
  if (since) q = q.gte('updated_at', since);
  const { data } = await q.throwOnError();
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
    } else if (tsToMs(row.updated_at) > tsToMs(local[0].updated_at)) {
      await executeDb(
        'UPDATE daily_memos SET content = ?, sync_id = ?, updated_at = ? WHERE date = ?',
        [row.content, row.id, row.updated_at, row.date]
      );
    }
  }
  if (maxTs && !deferred) setLastPull('daily_memos', maxTs);
}

async function pullProjects(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('projects');
  let q = client.from('projects').select('*');
  if (since) q = q.gte('updated_at', since);
  const { data } = await q.throwOnError();
  if (!data) return;
  let maxTs = since ?? '';

  for (const p of data) {
    if (typeof p.updated_at === 'string' && p.updated_at > maxTs) maxTs = p.updated_at;

    const local = await selectDb<{ id: number; updated_at: string }>(
      'SELECT id, updated_at FROM projects WHERE sync_id = ?', [p.id]
    );

    // tombstone: 削除済みはローカルも削除し、所属タスクは未割当に戻す
    if (p.deleted_at) {
      if (local.length) {
        await executeDb('UPDATE tasks SET project_id = NULL WHERE project_id = ?', [local[0].id]);
        await executeDb('DELETE FROM projects WHERE id = ?', [local[0].id]);
      }
      continue;
    }

    if (!local.length) {
      await executeDb(
        `INSERT INTO projects (name, description, status, start_date, target_date, sync_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.name, p.description, p.status, p.start_date, p.target_date, p.id, p.created_at, p.updated_at]
      );
    } else if (tsToMs(p.updated_at) > tsToMs(local[0].updated_at)) {
      await executeDb(
        `UPDATE projects SET name=?, description=?, status=?, start_date=?, target_date=?, updated_at=? WHERE id=?`,
        [p.name, p.description, p.status, p.start_date, p.target_date, p.updated_at, local[0].id]
      );
    }
  }

  if (maxTs) setLastPull('projects', maxTs);
}

// リモート tasks.project_id（UUID）→ ローカル projects.id。見つからなければ null。
async function localProjectIdFor(projectSyncId: string | null): Promise<number | null> {
  if (!projectSyncId) return null;
  const rows = await selectDb<{ id: number }>(
    'SELECT id FROM projects WHERE sync_id = ?', [projectSyncId]
  );
  return rows[0]?.id ?? null;
}

async function pullTasks(): Promise<void> {
  const client = await sb(); if (!client) return;
  const since = getLastPull('tasks');
  let q = client.from('tasks').select('*, task_checklist(*)');
  if (since) q = q.gte('updated_at', since);
  const { data: tasks } = await q.throwOnError();
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
    const localProjectId = await localProjectIdFor(task.project_id ?? null);
    if (!local.length) {
      const res = await executeDb(
        `INSERT INTO tasks
          (title, description, status, priority, due_date, category,
           archived, pinned, notes, start_date, progress, project_id, sync_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [task.title, task.description, task.status, task.priority, task.due_date,
         task.category, task.archived ? 1 : 0, task.pinned ? 1 : 0, task.notes,
         task.start_date, task.progress, localProjectId, task.id, task.created_at, task.updated_at]
      );
      localId = res.lastInsertId;
      remoteNewer = true;
    } else {
      localId = local[0].id;
      remoteNewer = tsToMs(task.updated_at) > tsToMs(local[0].updated_at);
      if (remoteNewer) {
        await executeDb(
          `UPDATE tasks SET
            title=?, description=?, status=?, priority=?, due_date=?, category=?,
            archived=?, pinned=?, notes=?, start_date=?, progress=?, project_id=?, updated_at=?
           WHERE id=?`,
          [task.title, task.description, task.status, task.priority, task.due_date,
           task.category, task.archived ? 1 : 0, task.pinned ? 1 : 0, task.notes,
           task.start_date, task.progress, localProjectId, task.updated_at, localId]
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
  const { data } = await q.throwOnError();
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
    } else if (tsToMs(row.updated_at) > tsToMs(local[0].updated_at)) {
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
  const { data } = await q.throwOnError();
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
    } else if (tsToMs(row.updated_at) > tsToMs(local[0].updated_at)) {
      await executeDb(
        'UPDATE reports_weekly SET content = ?, sync_id = ?, updated_at = ? WHERE week_start_date = ?',
        [row.content, row.id, row.updated_at, row.week_start_date]
      );
    }
  }
  if (maxTs && !deferred) setLastPull('reports_weekly', maxTs);
}
