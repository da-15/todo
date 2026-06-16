interface Props {
  onDismiss: () => void;
}

/** iOS Safari の「ホーム画面に追加」案内。スタンドアロン未起動時に表示する。 */
export function InstallGuide({ onDismiss }: Props) {
  return (
    <div className="install-guide">
      <p>
        📱 <strong>ホーム画面に追加</strong>すると、アプリのように起動でき、
        バッジ表示も使えます。
      </p>
      <ol>
        <li>
          Safari の共有ボタン（
          <svg
            className="inline-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="共有"
            role="img"
          >
            <path d="M12 14V3" />
            <path d="M8 7l4-4 4 4" />
            <path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
          </svg>
          ）をタップ
        </li>
        <li>「ホーム画面に追加」を選択</li>
        <li>追加されたアイコンから起動</li>
      </ol>
      <button className="btn-ghost" onClick={onDismiss} type="button">
        閉じる
      </button>
    </div>
  );
}
