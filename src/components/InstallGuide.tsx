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
        <li>Safari の共有ボタン（□↑）をタップ</li>
        <li>「ホーム画面に追加」を選択</li>
        <li>追加されたアイコンから起動</li>
      </ol>
      <button className="btn-ghost" onClick={onDismiss} type="button">
        閉じる
      </button>
    </div>
  );
}
