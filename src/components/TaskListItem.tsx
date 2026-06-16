import type { TodoTask } from "../types";

interface Props {
  task: TodoTask;
  onToggle: (id: string) => void;
  onEdit: (task: TodoTask) => void;
  onDelete: (id: string) => void;
}

function formatDue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due + "T00:00:00");
  return d.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

export function TaskListItem({ task, onToggle, onEdit, onDelete }: Props) {
  const overdue =
    task.type === "scheduled" &&
    !task.isCompleted &&
    task.dueDate !== null &&
    task.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <li className={`task-item ${task.isCompleted ? "done" : ""}`}>
      <button
        className={`check ${task.isCompleted ? "checked" : ""}`}
        onClick={() => onToggle(task.id)}
        aria-label={task.isCompleted ? "未完了に戻す" : "完了にする"}
      >
        {task.isCompleted ? "✓" : ""}
      </button>

      <div className="task-body" onClick={() => onEdit(task)}>
        <div className="task-name">{task.name}</div>
        {task.detail && <div className="task-detail">{task.detail}</div>}
        {task.type === "scheduled" && task.dueDate && (
          <div className={`task-due ${overdue ? "overdue" : ""}`}>
            📅 {formatDue(task.dueDate)}
          </div>
        )}
      </div>

      <button
        className="btn-delete"
        onClick={() => onDelete(task.id)}
        aria-label="削除"
      >
        ✕
      </button>
    </li>
  );
}
