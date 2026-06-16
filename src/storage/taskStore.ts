// localStorage への読み書きを集約するリポジトリ層。
// UI からは直接 localStorage を触らず、このモジュール経由でのみアクセスする。
import { STORAGE_KEYS } from "../config";
import type { TodoTask, TaskType } from "../types";

function readAll(): TodoTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.tasks);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TodoTask[];
  } catch (e) {
    console.error("taskStore: 読み込み失敗", e);
    return [];
  }
}

function writeAll(tasks: TodoTask[]): void {
  localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
}

/** tombstone を除いた表示用タスク一覧 */
export function getVisibleTasks(): TodoTask[] {
  return readAll().filter((t) => !t.isDeleted);
}

/** tombstone を含む全タスク（同期処理用） */
export function getAllTasksRaw(): TodoTask[] {
  return readAll();
}

export function saveAllRaw(tasks: TodoTask[]): void {
  writeAll(tasks);
}

export interface NewTaskInput {
  name: string;
  detail: string;
  type: TaskType;
  dueDate: string | null;
}

export function createTask(input: NewTaskInput): TodoTask {
  const now = new Date().toISOString();
  const task: TodoTask = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    detail: input.detail,
    type: input.type,
    isCompleted: false,
    dueDate: input.type === "scheduled" ? input.dueDate : null,
    googleTaskId: null,
    googleTaskListId: null,
    isDeleted: false,
    syncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = readAll();
  tasks.push(task);
  writeAll(tasks);
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<Omit<TodoTask, "id" | "createdAt">>,
): TodoTask | null {
  const tasks = readAll();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const updated: TodoTask = {
    ...tasks[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  // type と dueDate の整合性を保つ
  if (updated.type === "simple") updated.dueDate = null;
  tasks[idx] = updated;
  writeAll(tasks);
  return updated;
}

export function toggleComplete(id: string): TodoTask | null {
  const task = readAll().find((t) => t.id === id);
  if (!task) return null;
  return updateTask(id, { isCompleted: !task.isCompleted });
}

/**
 * 削除。Google と紐付いていれば tombstone として残し、次回同期で
 * Google 側を delete する。未同期（googleTaskId なし）なら物理削除。
 */
export function deleteTask(id: string): void {
  const tasks = readAll();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const task = tasks[idx];
  if (task.googleTaskId) {
    tasks[idx] = {
      ...task,
      isDeleted: true,
      updatedAt: new Date().toISOString(),
    };
  } else {
    tasks.splice(idx, 1);
  }
  writeAll(tasks);
}

/** 未完了 simple タスクの件数（バッジ用） */
export function countUncompletedSimple(): number {
  return readAll().filter(
    (t) => !t.isDeleted && t.type === "simple" && !t.isCompleted,
  ).length;
}
