// Google Tasks REST API (tasks/v1) の薄いラッパー。
import { getAccessToken } from "./auth";

const BASE = "https://tasks.googleapis.com/tasks/v1";

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

async function api<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(BASE + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Tasks API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
