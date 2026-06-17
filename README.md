# ToDo PWA

iPhone のホーム画面に追加して使う個人用 ToDo 管理 PWA。
シンプル型（未完了件数をアイコンのバッジに表示）と予定日型（完了予定日付き）の
2 種類のタスクを管理し、**Google Tasks と双方向同期**する。

公開 URL: https://da-15.github.io/todo/

## 技術スタック

- Vite + React + TypeScript
- vite-plugin-pwa（manifest / Service Worker 自動生成）
- データ永続化: localStorage（リポジトリ層 `src/storage/` に集約）
- バッジ: Badging API
- 外部連携: Google Tasks API + Google Identity Services（OAuth 2.0 トークンフロー）
- ホスティング: GitHub Pages（公開 root は `docs/`）

## 開発

```bash
npm install
cp .env.example .env.local   # VITE_GOOGLE_CLIENT_ID を設定（Google 連携を使う場合）
npm run dev                  # http://localhost:5173/todo/
```

## ビルド / デプロイ

```bash
npm run gen:icons            # アイコン PNG を再生成（必要なときだけ）
npm run build                # 型チェック（tsc -b）→ docs/ へ出力
git add docs && git commit && git push
```

GitHub Pages の設定で「Branch: main / Folder: /docs」を選択する。
`base` は `/todo/`（`vite.config.ts`）。リポジトリ名を変えた場合は合わせて変更する。

## Google Tasks 連携の設定

1. Google Cloud Console で OAuth クライアント（ウェブアプリケーション）を作成。
2. 承認済み JavaScript 生成元に以下を登録:
   - `http://localhost:5173`（開発）
   - `https://da-15.github.io`（本番）
3. スコープ: `https://www.googleapis.com/auth/tasks`
4. 取得したクライアント ID を `.env.local` の `VITE_GOOGLE_CLIENT_ID` に設定。

> クライアント ID は環境変数で管理し、ソースに直書きしない。
> アクセストークンはメモリ保持で、localStorage には保存しない。

## 同期の仕様

- トリガー: 一覧画面の「**同期**」ボタンを押したときのみ（自動同期はしない）。
- 流れ: ローカル変更を push（insert / patch / delete）→ `updatedMin` で差分 pull → 突き合わせ。
- 同一判定: `googleTaskId` / `googleTaskListId`。
- 競合: last-write-wins（`updatedAt` ↔ Google `updated`）。
- 削除: ローカル削除は tombstone として保持し、次回同期で Google を delete。
  Google 側削除はローカルからも除去。失敗した push は tombstone を残し次回リトライ。
- 未ログイン時はローカルのみで動作。同期操作時にログインを促す。

## 設計方針

- 同期先は **Google Tasks に一本化**し、Google Calendar API は直接連携しない。
  予定日型は `due` 付きで同期すれば Google カレンダーにも自動表示されるため、
  連携先を1つに保ち競合・二重管理を避ける。
- データ本体は端末の localStorage に保持し、独自サーバー/クラウド DB は持たない
  （Google Tasks が実質的なバックアップ兼同期先になる）。

### スコープ外

複数ユーザー/共有、プッシュ通知サーバー、予定日の事前リマインダー通知、
Google Calendar への予定枠イベント登録、App Store 配布。

## iOS での利用

Safari で開き「共有 → ホーム画面に追加」でインストールするとスタンドアロン起動し、
バッジ（未完了シンプルタスク数）が有効になる（iOS 16.4 以降、通知許可が前提）。

## ディレクトリ

```
src/
  storage/      localStorage リポジトリ層（taskStore / syncMeta / settings）
  google/       auth（GIS OAuth）/ tasksApi（REST）
  sync/         googleTasksSync（双方向同期。UI 非依存）
  components/   UI コンポーネント
  hooks/        useTasks
  badge.ts      Badging API / 通知許可
scripts/
  gen-icons.mjs 依存なしの PNG アイコン生成
docs/           ビルド成果物（GitHub Pages 公開 root）
```
