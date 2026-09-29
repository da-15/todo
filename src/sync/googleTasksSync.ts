// Google Tasks との双方向同期。UI から独立し、単体でテストしやすいよう純粋に近い形で書く。
// 安全側の方針: 競合は last-write-wins だが、各操作をログに残し、意図しない消失を検知しやすくする。
import {
  getAllTasksRaw,
  saveAllRaw,
  isPendingSync,
} from "../storage/taskStore";
import { getSyncMeta, setSyncMeta } from "../storage/syncMeta";
import {
  deleteTask as apiDeleteTask,
  getDefaultTaskListId,
  insertTask,
  listTasks,
  patchTask,
  TasksApiError,
  type GoogleTask,
} from "../google/tasksApi";
import { isLoggedIn } from "../google/auth";
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
function dueDateToRfc3339(dueDate: string | null): string {
  // 未指定でも空文字を返す。undefined にすると patch でフィールドが省略され、
  // Google 側の既存の日時が消えない（日時クリアが反映されない）。
  if (!dueDate) return "";
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
    // 空文字でも明示的に送る。undefined にすると patch でフィールドが省略され、
    // Google 側の既存メモが消えない（空メモへの更新が反映されない）。
    notes: task.detail ?? "",
    status: task.isCompleted ? "completed" : "needsAction",
    due: dueDateToRfc3339(task.dueDate),
  };
}

function isNewerRemote(local: TodoTask, remote: GoogleTask): boolean {
  const r = remote.updated ? Date.parse(remote.updated) : 0;
  const l = Date.parse(local.updatedAt);
  return r >= l;
}

// 次回の差分取得（updatedMin）の起点を、pull 開始時刻からこれだけ遡らせる。
// 端末と Google の時計のずれや、pull 中に Google 側で行われた変更の取りこぼしを防ぐ。
// 重複して取得しても、同じ内容なら下の突き合わせで何もしないので安全。
const PULL_OVERLAP_MS = 5 * 60_000;

/**
 * 同期中（API 待ちの間）にユーザーが行ったローカル変更を、同期結果に合流させる。
 * 同期は開始時に読んだタスク一覧を最後に丸ごと保存するため、そのままだと
 * 同期中に追加・編集・削除したタスクが上書きされて消えてしまう。
 */
function mergeConcurrentEdits(
  synced: TodoTask[],
  snapshot: Map<string, string>, // 同期開始時の id → updatedAt
): TodoTask[] {
  const current = getAllTasksRaw();
  const currentById = new Map(current.map((t) => [t.id, t]));
  const syncedIds = new Set(synced.map((t) => t.id));
  const now = new Date().toISOString();
  const out: TodoTask[] = [];

  for (const t of synced) {
    // 今回 Google から取り込んだ新規タスク
    if (!snapshot.has(t.id)) {
      out.push(t);
      continue;
    }
    const cur = currentById.get(t.id);
    if (!cur) {
      // 同期中にユーザーが物理削除した（未同期タスクの削除）。
      // この同期で Google に登録済みなら tombstone にして次回 Google 側も消す。
      if (t.googleTaskId) out.push({ ...t, isDeleted: true, updatedAt: now });
      continue;
    }
    if (cur.updatedAt === snapshot.get(t.id)) {
      out.push(t); // 同期中の変更なし
      continue;
    }
    // 同期中に編集・削除された → ユーザーの変更を優先し、同期で得た紐付けだけ引き継ぐ。
    // syncedAt を null にして未同期扱いにし、次回の同期で確実に push させる。
    out.push({
      ...cur,
      googleTaskId: t.googleTaskId ?? cur.googleTaskId,
      googleTaskListId: t.googleTaskListId ?? cur.googleTaskListId,
      syncedAt: null,
    });
  }

  for (const cur of current) {
    if (syncedIds.has(cur.id)) continue;
    if (!snapshot.has(cur.id)) {
      out.push(cur); // 同期中に新規作成された
    } else if (cur.updatedAt !== snapshot.get(cur.id) && !cur.isDeleted) {
      // 同期で除去された（Google 側で削除された等）が、同期中にユーザーが編集した。
      // 最新の編集を失わないよう、紐付けを外して新規タスクとして残す。
      out.push({ ...cur, googleTaskId: null, googleTaskListId: null, syncedAt: null });
    }
  }
  return out;
}

// ---- メイン ----
// 同期の多重実行を防ぐ。実行中に再度呼ばれたら、進行中の同期の結果を返す。
// （一覧画面と設定画面から同時に呼ばれると、互いの保存で上書きし合い、
//   同じタスクが Google に二重登録されうるため）
let inFlight: Promise<SyncResult> | null = null;

export function syncWithGoogle(): Promise<SyncResult> {
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** 同期が実行中か。 */
export function isSyncing(): boolean {
  return inFlight !== null;
}

/**
 * 実行中の同期があれば終わるまで待つ（成否は問わない）。
 * ローカル初期化・同期状態リセットの前に呼ぶ。同期中に消去すると、同期の最後の
 * 合流処理が「ユーザーが削除した」と判断して tombstone を作り、次回の同期で
 * Google 側のタスクまで削除してしまうため。
 */
export async function waitForSyncIdle(): Promise<void> {
  while (inFlight) {
    await inFlight.catch(() => {});
  }
}

async function runSync(): Promise<SyncResult> {
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
  // lastSyncedAt が null（初回・設定画面からのリセット後）なら全件取得する。
  // pullCursor が無い旧データは lastSyncedAt をそのまま起点にする。
  const lastSync = meta.lastSyncedAt ? (meta.pullCursor ?? meta.lastSyncedAt) : null;

  let tasks = getAllTasksRaw();
  const snapshot = new Map(tasks.map((t) => [t.id, t.updatedAt]));
  const pushedGoogleIds = new Set<string>();

  // Google 側に既に存在しない（404/410）= 削除済みとみなして成功扱いにする。
  const isGone = (e: unknown): boolean =>
    e instanceof TasksApiError && (e.status === 404 || e.status === 410);

  // Google 側の削除まで完了した tombstone のローカル ID。これだけをローカルから除去し、
  // 失敗・未処理（途中で中断した）ものは残して次回リトライする。
  const deletedIds = new Set<string>();

  // 認証が切れた（401・サイレント再取得の失敗）ら push を中断する。続行すると残りの
  // タスクごとにサイレント再認証を試み、その都度待たされて同期が長時間固まるため。
  let authLost = false;

  // ===== 1. PUSH: ローカル変更を Google へ =====
  for (const task of tasks) {
    if (authLost) break;
    try {
      // 削除 tombstone → Google を delete
      if (task.isDeleted) {
        if (task.googleTaskId) {
          try {
            await apiDeleteTask(task.googleTaskListId ?? listId, task.googleTaskId);
            result.pushedDeleted++;
            result.log.push(`delete → Google: ${task.name}`);
          } catch (e) {
            if (isGone(e)) {
              // 既に Google 側に無い → 削除完了とみなす
              result.log.push(`delete → Google(既に削除済): ${task.name}`);
            } else {
              throw e;
            }
          }
        }
        // tombstone は後でローカルからも除去（下のフィルタで）
        deletedIds.add(task.id);
        continue;
      }

      const changedSinceSync = isPendingSync(task);

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
        try {
          const updated = await patchTask(
            task.googleTaskListId ?? listId,
            task.googleTaskId,
            localToGoogleBody(task),
          );
          task.syncedAt = updated.updated ?? new Date().toISOString();
          pushedGoogleIds.add(task.googleTaskId);
          result.pushedUpdated++;
          result.log.push(`patch → Google: ${task.name}`);
        } catch (e) {
          if (isGone(e)) {
            // 対象が Google 側に無い → 紐付けを解除して新規として登録し直す
            task.googleTaskId = null;
            task.googleTaskListId = null;
            task.syncedAt = null;
            const created = await insertTask(listId, localToGoogleBody(task));
            task.googleTaskId = created.id;
            task.googleTaskListId = listId;
            task.syncedAt = created.updated ?? new Date().toISOString();
            pushedGoogleIds.add(created.id);
            result.pushedNew++;
            result.log.push(`再登録 → Google: ${task.name}`);
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`push 失敗 (${task.name}): ${msg}`);
      if (!isLoggedIn()) authLost = true;
    }
  }
  if (authLost) {
    result.errors.push("認証が切れたため同期を中断しました。もう一度同期してください");
  }

  // tombstone をローカルから除去。削除に失敗・未処理のものは残し次回リトライする。
  tasks = tasks.filter((t) => !t.isDeleted || !deletedIds.has(t.id));

  // ===== 2. PULL: Google から差分取得 =====
  // lastSync が無い場合は全件取得（completed/deleted 込み）。これを prune の根拠に使う。
  const isFullPull = !lastSync;
  let remoteTasks: GoogleTask[] = [];
  let pullOk = false;
  const nextSyncFrom = new Date(Date.now() - PULL_OVERLAP_MS).toISOString();
  try {
    if (authLost) throw new Error("認証切れのため中止");
    remoteTasks = await listTasks(listId, {
      updatedMin: lastSync ?? undefined,
    });
    pullOk = true;
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
    const localChangedSinceSync = isPendingSync(local);

    // 前回同期で反映済みの版と同じ（差分取得の重複分）→ 何もしない
    if (
      !localChangedSinceSync &&
      remote.updated &&
      local.syncedAt &&
      Date.parse(remote.updated) === Date.parse(local.syncedAt)
    ) {
      continue;
    }
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

  // ===== 3. PRUNE: 全件取得が成功したときのみ、Google 側に存在しない
  // 同期済みローカルタスクを掃除する（別リストへの移動・アプリ外削除の取り残し対策）。
  // 差分取得時は実行しない（返ってこない=削除ではないため誤削除になる）。
  if (isFullPull && pullOk) {
    const remoteIds = new Set(remoteTasks.map((r) => r.id));
    const before = tasks.length;
    tasks = tasks.filter((t) => {
      // 未同期（googleTaskId なし）・他リスト紐付け・今サイクル push 済みは残す。
      if (!t.googleTaskId) return true;
      if (t.googleTaskListId && t.googleTaskListId !== listId) return true;
      if (pushedGoogleIds.has(t.googleTaskId)) return true;
      // 同期対象リストに属するのに Google 側に無い → 取り残しとして除去。
      const exists = remoteIds.has(t.googleTaskId);
      if (!exists) result.log.push(`prune(Google に無し): ${t.name}`);
      return exists;
    });
    result.pulledDeleted += before - tasks.length;
  }

  saveAllRaw(mergeConcurrentEdits(tasks, snapshot));
  // pull に失敗したときは lastSyncedAt を進めない。進めてしまうと、その間に
  // Google 側で行われた変更が次回以降の差分取得から永久に漏れる。
  const finishedAt = new Date().toISOString();
  setSyncMeta(
    pullOk
      ? { lastSyncedAt: finishedAt, pullCursor: nextSyncFrom, taskListId: listId }
      : { taskListId: listId },
  );
  result.finishedAt = finishedAt;

  if (result.log.length) console.info("[sync]", result.log);
  if (result.errors.length) console.warn("[sync errors]", result.errors);

  return result;
}
