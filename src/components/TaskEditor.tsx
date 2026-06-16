import { useEffect, useState } from "react";
import type { TodoTask } from "../types";
import type { NewTaskInput } from "../storage/taskStore";

interface Props {
  initial?: TodoTask | null;
  onSave: (input: NewTaskInput) => void;
  onCancel: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TaskEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [hasDue, setHasDue] = useState(false);
  const [dueDate, setDueDate] = useState<string>(todayStr());

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setDetail(initial.detail);
      setHasDue(initial.dueDate !== null);
      setDueDate(initial.dueDate ?? todayStr());
    }
  }, [initial]);

  const canSave = name.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({
      name,
      detail,
      dueDate: hasDue ? dueDate : null,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? "タスクを編集" : "新しいタスク"}</h2>

        <label className="field">
          <span>タスク名</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="例: 牛乳を買う"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span>詳細</span>
          <textarea
            value={detail}
            rows={3}
            placeholder="メモ（任意）"
            onChange={(e) => setDetail(e.target.value)}
          />
        </label>

        <div className="field">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={hasDue}
              onChange={(e) => setHasDue(e.target.checked)}
            />
            <span>完了予定日を設定する</span>
          </label>
          {hasDue && (
            <input
              type="date"
              className="due-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel} type="button">
            キャンセル
          </button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!canSave}
            type="button"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
