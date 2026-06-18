import { useEffect, useState } from "react";
import type { TodoTask } from "../types";
import type { NewTaskInput } from "../storage/taskStore";
import { todayLocal } from "../dateUtils";

interface Props {
  initial?: TodoTask | null;
  onSave: (input: NewTaskInput) => void;
  onCancel: () => void;
}

export function TaskEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [hasDue, setHasDue] = useState(false);
  const [dueDate, setDueDate] = useState<string>(todayLocal());

  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setDetail(initial.detail);
      setHasDue(initial.dueDate !== null);
      setDueDate(initial.dueDate ?? todayLocal());
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

  // タイトル入力中の Enter で保存。IME 変換確定の Enter は isComposing で無視する。
  const onNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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

        <label className="field">
          <input
            type="text"
            value={name}
            autoFocus
            enterKeyHint="done"
            placeholder="タスク名（例: 牛乳を買う）"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onNameKeyDown}
          />
        </label>

        <label className="field">
          <textarea
            value={detail}
            rows={3}
            placeholder="詳細（任意）"
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
      </div>
    </div>
  );
}
