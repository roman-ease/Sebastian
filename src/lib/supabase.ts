import { createClient } from '@supabase/supabase-js';
import { executeDb, selectDb } from './db';

const SUPABASE_URL = 'https://txzjevnratucusimmugg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_cXqzvvxcNa0yiVDVkJS2Mg_dt1y83Mb';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Push: ローカル → Supabase ────────────────────────────────────────────────

export async function pushMemo(date: string, content: string): Promise<void> {
  try {
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM daily_memos WHERE date = ?', [date]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE daily_memos SET sync_id = ? WHERE date = ?', [syncId, date]);
    }
    await supabase.from('daily_memos').upsert({
      id: syncId, date, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushMemo:', e);
  }
}

export async function pushTask(localId: number): Promise<void> {
  try {
    const rows = await selectDb<any>('SELECT * FROM tasks WHERE id = ?', [localId]);
    if (!rows.length) return;
    const t = rows[0];
    let syncId = t.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE tasks SET sync_id = ? WHERE id = ?', [syncId, localId]);
    }
    await supabase.from('tasks').upsert({
      id: syncId,
      title: t.title, description: t.description, status: t.status,
      priority: t.priority, due_date: t.due_date, category: t.category,
      archived: !!t.archived, pinned: !!t.pinned, notes: t.notes,
      start_date: t.start_date, progress: t.progress,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushTask:', e);
  }
}

export async function pushChecklist(localTaskId: number): Promise<void> {
  try {
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
    await supabase.from('task_checklist').delete().eq('task_id', taskSyncId);
    if (items.length > 0) {
      await supabase.from('task_checklist').insert(
        items.map((item: any) => ({
          id: item.sync_id,
          task_id: taskSyncId,
          text: item.text,
          checked: !!item.checked,
          sort_order: item.sort_order,
        }))
      );
    }
  } catch (e) {
    console.error('[supabase] pushChecklist:', e);
  }
}

export async function pushDailyReport(date: string, content: string): Promise<void> {
  try {
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM reports_daily WHERE date = ?', [date]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE reports_daily SET sync_id = ? WHERE date = ?', [syncId, date]);
    }
    await supabase.from('reports_daily').upsert({
      id: syncId, date, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushDailyReport:', e);
  }
}

export async function pushWeeklyReport(weekStartDate: string, content: string): Promise<void> {
  try {
    const rows = await selectDb<{ sync_id: string | null }>(
      'SELECT sync_id FROM reports_weekly WHERE week_start_date = ?', [weekStartDate]
    );
    let syncId = rows[0]?.sync_id;
    if (!syncId) {
      syncId = crypto.randomUUID();
      await executeDb('UPDATE reports_weekly SET sync_id = ? WHERE week_start_date = ?', [syncId, weekStartDate]);
    }
    await supabase.from('reports_weekly').upsert({
      id: syncId, week_start_date: weekStartDate, content, updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[supabase] pushWeeklyReport:', e);
  }
}

// ─── Pull: Supabase → ローカル（起動時同期）──────────────────────────────────

export async function pullFromSupabase(): Promise<void> {
  try {
    await Promise.all([pullMemos(), pullTasks(), pullDailyReports(), pullWeeklyReports()]);
  } catch (e) {
    console.error('[supabase] pull:', e);
  }
}

async function pullMemos(): Promise<void> {
  const { data } = await supabase.from('daily_memos').select('*');
  if (!data) return;
  for (const row of data) {
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
}

async function pullTasks(): Promise<void> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*, task_checklist(*)');
  if (!tasks) return;

  for (const task of tasks) {
    const local = await selectDb<{ id: number; updated_at: string }>(
      'SELECT id, updated_at FROM tasks WHERE sync_id = ?', [task.id]
    );

    let localId: number;
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
    } else {
      localId = local[0].id;
      if (new Date(task.updated_at) > new Date(local[0].updated_at)) {
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

    if (task.task_checklist?.length) {
      await executeDb('DELETE FROM task_checklist WHERE task_id = ?', [localId]);
      for (const item of task.task_checklist) {
        await executeDb(
          'INSERT INTO task_checklist (task_id, text, checked, sort_order, sync_id) VALUES (?, ?, ?, ?, ?)',
          [localId, item.text, item.checked ? 1 : 0, item.sort_order, item.id]
        );
      }
    }
  }
}

async function pullDailyReports(): Promise<void> {
  const { data } = await supabase.from('reports_daily').select('*');
  if (!data) return;
  for (const row of data) {
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
}

async function pullWeeklyReports(): Promise<void> {
  const { data } = await supabase.from('reports_weekly').select('*');
  if (!data) return;
  for (const row of data) {
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
}
