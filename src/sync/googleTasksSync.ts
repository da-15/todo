// Google Tasks との双方向同期。UI から独立し、単体でテストしやすいよう純粋に近い形で書く。
// 安全側の方針: 競合は last-write-wins だが、各操作をログに残し、意図しない消失を検知しやすくする。
import {
  getAllTasksRaw,
  saveAllRaw,
} from "../storage/taskStore";
import { getSyncMeta, setSyncMeta } from "../storage/syncMeta";
import {
  deleteTask as apiDeleteTask,
  getDefaultTaskListId,
  insertTask,
  listTasks,
  patchTask,
  type GoogleTask,
} from "../google/tasksApi";
import type { TodoTask } from "../types";

export interface SyncResult {
  pushedNew: number;
  pushedUpdated: number;
  pushedDeleted: number;
  pulledNew: number;
  pulledUpdated: number;
  pulledDeleted: number;
  errors: string[];
  log: string[];
  finishedAt: string;
}

// ---- 変換 ----
function dueDateToRfc3339(dueDate: string | null): string | undefined {
  if (!dueDate) return undefined;
  // Google Tasks の due は日付のみ有効。UTC 0時で表現する。
  return `${dueDate}T00:00:00.000Z`;
}

function rfc3339ToDueDate(due: string | undefined): string | null {
  if (!due) return null;
  return due.slice(0, 10);
}

function localToGoogleBody(task: TodoTask): Partial<GoogleTask> {
  return {
    title: task.name,
    notes: task.detail || undefined,
    status: task.isCompleted ? "completed" : "needsAction",
    due: dueDateToRfc3339(task.dueDate),
  };
}

function isNewerRemote(local: TodoTask, remote: GoogleTask): boolean {
  const r = remote.updated ? Date.parse(remote.updated) : 0;
  const l = Date.parse(local.updatedAt);
  return r >= l;
}

// ---- メイン ----
export async function syncWithGoogle(): Promise<SyncResult> {
  const result: SyncResult = {
    pushedNew: 0,
    pushedUpdated: 0,
    pushedDeleted: 0,
    pulledNew: 0,
    pulledUpdated: 0,
    pulledDeleted: 0,
    errors: [],
    log: [],
    finishedAt: "",
  };

  const meta = getSyncMeta();
  const listId = meta.taskListId ?? (await getDefaultTaskListId());
  const lastSync = meta.lastSyncedAt;
  const lastSyncMs = lastSync ? Date.parse(lastSync) : 0;

  let tasks = getAllTasksRaw();
  const pushedGoogleIds = new Set<string>();

  // ===== 1. PUSH: ローカル変更を Google へ =====
  for (const task of tasks) {
    try {
      // 削除 tombstone → Google を delete
      if (task.isDeleted) {
        if (task.googleTaskId) {
          await apiDeleteTask(task.googleTaskListId ?? listId, task.googleTaskId);
          result.pushedDeleted++;
          result.log.push(`delete → Google: ${task.name}`);
        }
        // tombstone は後でローカルからも除去（下のフィルタで）
        continue;
      }

      const changedSinceSync =
        !task.syncedAt || Date.parse(task.updatedAt) > Date.parse(task.syncedAt);

      if (!task.googleTaskId) {
        // 新規 insert
        const created = await insertTask(listId, localToGoogleBody(task));
        task.googleTaskId = created.id;
        task.googleTaskListId = listId;
        task.syncedAt = created.updated ?? new Date().toISOString();
        pushedGoogleIds.add(created.id);
        result.pushedNew++;
        result.log.push(`insert → Google: ${task.name}`);
      } else if (changedSinceSync) {
        // 変更 patch
        const updated = await patchTask(
          task.googleTaskListId ?? listId,
          task.googleTaskId,
          localToGoogleBody(task),
        );
        task.syncedAt = updated.updated ?? new Date().toISOString();
        pushedGoogleIds.add(task.googleTaskId);
        result.pushedUpdated++;
        result.log.push(`patch → Google: ${task.name}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`push 失敗 (${task.name}): ${msg}`);
    }
  }

  // tombstone のうち Google 側削除に成功（または googleTaskId なし）のものをローカルから除去。
  // 削除に失敗したものは tombstone を残し、次回リトライする。
  tasks = tasks.filter((t) => {
    if (!t.isDeleted) return true;
    if (!t.googleTaskId) return false; // 未同期削除は除去
    const failed = result.errors.some((e) => e.includes(`(${t.name})`));
    return failed; // 失敗時のみ残す
  });

  // ===== 2. PULL: Google から差分取得 =====
  let remoteTasks: GoogleTask[] = [];
  try {
    remoteTasks = await listTasks(listId, {
      updatedMin: lastSync ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`pull 失敗: ${msg}`);
  }

  const byGoogleId = new Map<string, TodoTask>();
  for (const t of tasks) {
    if (t.googleTaskId) byGoogleId.set(t.googleTaskId, t);
  }

  for (const remote of remoteTasks) {
    // 今サイクルで push したものは最新なのでスキップ
    if (pushedGoogleIds.has(remote.id)) continue;

    const local = byGoogleId.get(remote.id);

    // Google 側削除 → ローカルからも除去
    if (remote.deleted) {
      if (local) {
        tasks = tasks.filter((t) => t.id !== local.id);
        byGoogleId.delete(remote.id);
        result.pulledDeleted++;
        result.log.push(`delete ← Google: ${local.name}`);
      }
      continue;
    }

    if (!local) {
      // ローカルに存在しない → 新規作成
      // updatedMin より前の古いタスクでも、初回同期では取り込む。
      const now = new Date().toISOString();
      const due = rfc3339ToDueDate(remote.due);
      const newTask: TodoTask = {
        id: crypto.randomUUID(),
        name: remote.title ?? "(無題)",
        detail: remote.notes ?? "",
        type: due ? "scheduled" : "simple",
        isCompleted: remote.status === "completed",
        dueDate: due,
        googleTaskId: remote.id,
        googleTaskListId: listId,
        isDeleted: false,
        syncedAt: remote.updated ?? now,
        createdAt: remote.updated ?? now,
        updatedAt: remote.updated ?? now,
      };
      tasks.push(newTask);
      byGoogleId.set(remote.id, newTask);
      result.pulledNew++;
      result.log.push(`create ← Google: ${newTask.name}`);
      continue;
    }

    // 両方に存在 → last-write-wins
    const localChangedSinceSync =
      !local.syncedAt || Date.parse(local.updatedAt) > Date.parse(local.syncedAt);
    if (localChangedSinceSync && !isNewerRemote(local, remote)) {
      // ローカルが新しい → 既に push 済み想定だが、念のため保持してログ
      result.log.push(`conflict: ローカル優先 (${local.name})`);
      continue;
    }

    // Google が新しい → ローカルへ反映
    const due = rfc3339ToDueDate(remote.due);
    const before = JSON.stringify(local);
    local.name = remote.title ?? local.name;
    local.detail = remote.notes ?? "";
    local.dueDate = due;
    local.type = due ? "scheduled" : "simple";
    local.isCompleted = remote.status === "completed";
    local.syncedAt = remote.updated ?? new Date().toISOString();
    local.updatedAt = remote.updated ?? new Date().toISOString();
    if (JSON.stringify(local) !== before) {
      result.pulledUpdated++;
      result.log.push(`update ← Google: ${local.name}`);
    }
  }

  // ローカル lastSyncMs 参照は将来の最適化用（現状は updatedMin に委譲）
  void lastSyncMs;

  saveAllRaw(tasks);
  const finishedAt = new Date().toISOString();
  setSyncMeta({ lastSyncedAt: finishedAt, taskListId: listId });
  result.finishedAt = finishedAt;

  if (result.log.length) console.info("[sync]", result.log);
  if (result.errors.length) console.warn("[sync errors]", result.errors);

  return result;
}
