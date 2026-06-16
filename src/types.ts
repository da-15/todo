export type TaskType = "simple" | "scheduled";

export interface TodoTask {
  id: string; // ローカル ID。crypto.randomUUID()
  name: string; // タスク名（必須）
  detail: string; // タスク詳細（任意）
  type: TaskType; // due の有無と連動
  isCompleted: boolean;
  dueDate: string | null; // ISO 8601（YYYY-MM-DD）。scheduled のときのみ

  // --- Google Tasks 同期用 ---
  googleTaskId: string | null; // 対応する Google タスク ID
  googleTaskListId: string | null; // 対応するリスト ID
  isDeleted: boolean; // tombstone（削除同期用）
  syncedAt: string | null; // 最終同期時刻

  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601（競合解決に使用）
}

export interface SyncMeta {
  lastSyncedAt: string | null; // 前回同期時刻（updatedMin に使用）
  taskListId: string | null; // 同期対象リスト
}

export interface Settings {
  notificationRequested: boolean; // 通知許可を一度でもリクエストしたか
  installGuideDismissed: boolean; // ホーム画面追加案内を閉じたか
}
