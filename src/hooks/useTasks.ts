import { useCallback, useEffect, useState } from "react";
import {
  createTask,
  deleteTask,
  getVisibleTasks,
  toggleComplete,
  updateTask,
  type NewTaskInput,
} from "../storage/taskStore";
import { updateBadge } from "../badge";
import type { TodoTask } from "../types";

export function useTasks() {
  const [tasks, setTasks] = useState<TodoTask[]>(() => getVisibleTasks());

  const refresh = useCallback(() => {
    setTasks(getVisibleTasks());
    void updateBadge();
  }, []);

  useEffect(() => {
    void updateBadge();
  }, []);

  const add = useCallback(
    (input: NewTaskInput) => {
      createTask(input);
      refresh();
    },
    [refresh],
  );

  const edit = useCallback(
    (id: string, patch: Parameters<typeof updateTask>[1]) => {
      updateTask(id, patch);
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    (id: string) => {
      deleteTask(id);
      refresh();
    },
    [refresh],
  );

  const toggle = useCallback(
    (id: string) => {
      toggleComplete(id);
      refresh();
    },
    [refresh],
  );

  return { tasks, refresh, add, edit, remove, toggle };
}
