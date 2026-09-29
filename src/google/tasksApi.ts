// Google Tasks REST API (tasks/v1) の薄いラッパー。
import { getAccessToken, invalidateToken } from "./auth";

const BASE = "https://tasks.googleapis.com/tasks/v1";

export class TasksApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TasksApiError";
    this.status = status;
  }
}

export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  due?: string; // RFC 3339
  updated?: string; // RFC 3339
  deleted?: boolean;
  hidden?: boolean;
}

export interface GoogleTaskList {
  id: string;
  title: string;
}

// 一時的なエラー（レート制限・サーバー側の一時障害）は指数バックオフで再試行する。
// Google Tasks API はタスク件数ぶん連続でリクエストすると 429 / 403(rateLimitExceeded)
// や 5xx をときどき返すため、再試行しないと「数回に一回失敗」になる。
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(status: number, body: string): boolean {
  return status === 429 || (status === 403 && /rateLimitExceeded/i.test(body));
}

async function api<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(BASE + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  // POST(insert) はサーバー側で処理済みの可能性がある失敗（5xx・通信断）を再試行すると
  // タスクが重複するため、確実に未処理なレート制限のときだけ再試行する。
  const idempotent = (init.method ?? "GET").toUpperCase() !== "POST";

  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < MAX_RETRIES;
    const backoff = () => sleep(BASE_DELAY_MS * 2 ** attempt + Math.random() * 250);

    const token = await getAccessToken();
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      // 通信エラー（圏外・復帰直後など）
      if (idempotent && canRetry) {
        await backoff();
        continue;
      }
      throw e;
    }

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    const text = await res.text();
    if (res.status === 401) {
      // トークンが無効（失効・取り消し）。次回の同期で対話ログインし直させる。
      invalidateToken();
    } else if (
      canRetry &&
      (isRateLimited(res.status, text) || (idempotent && res.status >= 500))
    ) {
      await backoff();
      continue;
    }
    throw new TasksApiError(res.status, `Google Tasks API ${res.status}: ${text}`);
  }
}

export async function listTaskLists(): Promise<GoogleTaskList[]> {
  const data = await api<{ items?: GoogleTaskList[] }>("/users/@me/lists");
  return data.items ?? [];
}

/** 既定リストの ID を返す（@default を解決）。 */
export async function getDefaultTaskListId(): Promise<string> {
  const data = await api<{ id: string }>("/users/@me/lists/@default");
  return data.id;
}

export async function listTasks(
  listId: string,
  opts: { updatedMin?: string } = {},
): Promise<GoogleTask[]> {
  const items: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const data = await api<{ items?: GoogleTask[]; nextPageToken?: string }>(
      `/lists/${encodeURIComponent(listId)}/tasks`,
      {
        query: {
          showDeleted: "true",
          showCompleted: "true",
          showHidden: "true",
          maxResults: "100",
          updatedMin: opts.updatedMin,
          pageToken,
        },
      },
    );
    if (data.items) items.push(...data.items);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export function insertTask(
  listId: string,
  body: Partial<GoogleTask>,
): Promise<GoogleTask> {
  return api<GoogleTask>(`/lists/${encodeURIComponent(listId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchTask(
  listId: string,
  taskId: string,
  body: Partial<GoogleTask>,
): Promise<GoogleTask> {
  return api<GoogleTask>(
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function deleteTask(
  listId: string,
  taskId: string,
): Promise<void> {
  await api<void>(
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
  );
}
