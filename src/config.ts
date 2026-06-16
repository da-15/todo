// OAuth クライアント ID は環境変数から取得し、ソースに直書きしない。
// 開発時は .env.local に VITE_GOOGLE_CLIENT_ID を設定する。
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

export const isGoogleConfigured = (): boolean => GOOGLE_CLIENT_ID.length > 0;

// localStorage キー
export const STORAGE_KEYS = {
  tasks: "todo-tasks",
  syncMeta: "todo-sync-meta",
  settings: "todo-settings",
} as const;
