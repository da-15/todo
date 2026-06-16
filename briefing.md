# Briefing: ToDo管理 PWA（iPhone想定 / Google Tasks 双方向同期）

Claude Code 向け開発ブリーフィング。本ドキュメントは実装の出発点となる仕様書です。

---

## 1. プロジェクト概要

iPhone のホーム画面に追加して使う、個人用 ToDo 管理アプリを **PWA（Progressive Web App）** として開発する。App Store には出さず、開発者本人および身内での利用を想定する。Web 技術で構築し、GitHub Pages（HTTPS）で配信する。Mac も Apple Developer Program（99ドル/年）も不要。

ToDo は2種類の管理方法を持つ:

1. **シンプル型 (simple)** — 未完了 / 完了の2状態のみを管理する。未完了タスクの件数をホーム画面アイコンのバッジに表示する。
2. **予定日型 (scheduled)** — 完了予定日を指定する。

さらに、**Google ToDo リスト（Google Tasks）と双方向同期する**。同期はユーザーがアプリを開いてプルダウン（下スワイプ）したときのみ行う。

すべての ToDo は **タスク名** と **タスク詳細** を入力できる。

---

## 2. 技術スタック / 前提環境

| 項目 | 採用 |
|------|------|
| ビルドツール | Vite |
| UI | React + TypeScript |
| PWA化 | vite-plugin-pwa（manifest と Service Worker を自動生成） |
| データ永続化 | localStorage（JSON シリアライズ）。将来必要なら IndexedDB へ移行可 |
| バッジ | Badging API（`navigator.setAppBadge` / `clearAppBadge`） |
| 外部連携 | Google Tasks API + Google Identity Services（OAuth 2.0 トークンフロー） |
| ホスティング | GitHub Pages（HTTPS 必須・静的配信） |
| 開発環境 | 任意の OS（Mac 不要） |

### PWA / iOS の前提と制約

- iOS でバッジ・スタンドアロン表示を使うには、ユーザーが **Safari の「共有 → ホーム画面に追加」** でインストールする必要がある。Safari のタブ内では機能しない。
- バッジ表示には **Service Worker の登録** と **通知許可** が前提となる（iOS 16.4 以降）。
- iOS の PWA は App Store 配布・バックグラウンド同期に非対応だが、本アプリの用途では問題にならない。プルダウン同期という設計はこの制約と整合する。

### Google 連携の方針（カレンダーについて）

- ToDo の同期先は **Google Tasks に一本化**する。Google Calendar API の直接連携は初版では行わない。
- 理由: Google Tasks の期限付きタスクは Google カレンダー上にも自動表示されるため、scheduled 型を Google Tasks に `due` 付きで同期すれば、別途カレンダーへイベントを作らなくてもカレンダーに現れる。連携先を1つに保つことで競合・二重管理を避けられる。
- 認証は Google Identity Services（GIS）の OAuth 2.0 トークンモデル（SPA 向け）を使う。スコープは `https://www.googleapis.com/auth/tasks`。
- Google Cloud Console で OAuth クライアント（ウェブアプリケーション）を作成し、承認済み JavaScript 生成元・リダイレクト URI に GitHub Pages の URL を登録する。開発者は BigQuery MCP で同種の OAuth 設定経験があるため手順は応用できる。
- **オプション（初版スコープ外）**: 予定日をカレンダーの「タスク」ではなく「イベント（予定枠）」として登録したい場合は、別途 Google Calendar API 連携を追加する。

---

## 3. 機能要件

### 3.1 タスクの基本

- タスクの新規作成・編集・削除ができる。
- 各タスクは以下を持つ: タスク名（必須）、タスク詳細（任意・複数行）、管理タイプ（simple / scheduled）、完了状態。
- 一覧で完了 / 未完了をワンタップで切り替えられる。

### 3.2 シンプル型 (simple)

- 完了予定日を持たない。
- **未完了の simple タスクの総数**をホーム画面アイコンのバッジに表示する。
- バッジは操作時（追加・完了切替・削除・起動・フォアグラウンド復帰・同期完了後）に `navigator.setAppBadge(count)` で更新する。
- バッジ件数の変化は常にユーザー操作か同期によって起きるため、プッシュ通知サーバーは不要。
- 初回に通知許可をリクエストする。

### 3.3 予定日型 (scheduled)

- 完了予定日（日付）を指定する。
- Google Tasks 同期時、`due` フィールドに予定日を入れて同期する。これにより Google カレンダー上にもタスクとして表示される。

### 3.4 Google Tasks 双方向同期

- トリガー: アプリ一覧画面での **プルダウン（pull-to-refresh）** のときのみ実行する。自動・定期同期は行わない。
- 同期対象は対象タスクリスト（既定は Google の既定リスト。設定で選択可能にしてもよい）。
- 同期の流れ（プルダウン1回あたり）:
  1. 前回同期時刻以降にローカルで変更されたタスクを Google Tasks へ push（新規=insert / 変更=patch / 削除=delete）。
  2. Google Tasks から `updatedMin`（前回同期時刻）と `showDeleted=true`・`showCompleted=true` で差分を取得。
  3. 取得した各タスクについて、ローカルと突き合わせて反映する。
- マッピング:
  - タスク名 ↔ `title`
  - タスク詳細 ↔ `notes`
  - 完了予定日 ↔ `due`（RFC 3339。`due` 有り = scheduled、無し = simple として扱う）
  - 完了状態 ↔ `status`（`needsAction` / `completed`）
- 同一タスクの判定: ローカルタスクに `googleTaskId`（および `googleTaskListId`）を保持して対応づける。
- 競合解決: 両側で変更があった場合は **更新時刻が新しい方を採用（last-write-wins）**。比較にはローカル `updatedAt` と Google の `updated` を用いる。
- 削除の伝播: ローカル削除は tombstone（削除マーカー）として保持し、次回同期で Google 側を delete。Google 側削除（`deleted=true`）はローカルからも除去する。
- 同期は失敗しても部分的にリトライ可能にする。未ログイン時はローカルのみで動作し、ログイン後の初回プルダウンで同期する。

---

## 4. データモデル

localStorage に JSON 配列として保存する。

```typescript
type TaskType = "simple" | "scheduled";

interface TodoTask {
  id: string;                 // ローカル ID。crypto.randomUUID()
  name: string;               // タスク名（必須）
  detail: string;             // タスク詳細（任意）
  type: TaskType;             // due の有無と連動
  isCompleted: boolean;
  dueDate: string | null;     // ISO 8601。scheduled のときのみ

  // --- Google Tasks 同期用 ---
  googleTaskId: string | null;     // 対応する Google タスク ID
  googleTaskListId: string | null; // 対応するリスト ID
  isDeleted: boolean;              // tombstone（削除同期用）
  syncedAt: string | null;         // 最終同期時刻

  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601（競合解決に使用）
}
```

- localStorage キー例: `todo-tasks`、`todo-sync-meta`（前回同期時刻など）、`todo-settings`。
- 読み書きは専用リポジトリ層（例: `taskStore.ts`）に集約し、UI から直接 localStorage を触らない。

---

## 5. 画面構成

1. **タスク一覧画面**
   - simple / scheduled をセグメントまたはタブで切り替えて表示。
   - 各行: 完了チェック（タップで切替）、タスク名、scheduled は予定日も表示。
   - **プルダウンで Google Tasks と同期**。同期中インジケーターと最終同期時刻を表示する。
   - 新規作成ボタン。

2. **タスク作成 / 編集画面**
   - タスク名、タスク詳細、管理タイプ選択。scheduled 選択時のみ予定日ピッカー。
   - 保存 / キャンセル。

3. **設定画面**
   - Google アカウント連携（ログイン / ログアウト、連携状態）。
   - 同期対象リストの選択（任意）。
   - 通知許可の状態表示とリクエスト。
   - iOS 向け「ホーム画面に追加」手順の案内。

---

## 6. システム連携の実装メモ

### Service Worker / PWA manifest
- `vite-plugin-pwa` で manifest（`display: standalone`、アイコン一式、apple-touch-icon 180x180）と Service Worker を生成する。
- Service Worker はアプリシェルのキャッシュ（オフライン起動）を担当し、バッジ利用の前提（登録済み状態）も満たす。

### バッジ（Badging API）
```typescript
async function updateBadge(uncompletedSimpleCount: number) {
  if ("setAppBadge" in navigator) {
    uncompletedSimpleCount > 0
      ? await navigator.setAppBadge(uncompletedSimpleCount)
      : await navigator.clearAppBadge();
  }
}
```
- 状態変化時・起動時・`visibilitychange`・同期完了後に未完了 simple 件数を集計して呼ぶ。

### Google Tasks（OAuth + REST）
- GIS のトークンクライアントでアクセストークンを取得し、`https://tasks.googleapis.com/tasks/v1/` を `fetch` で叩く（GET / POST / PATCH / DELETE）。
- アクセストークンは原則メモリ保持。永続化する場合は localStorage 保存のセキュリティ上の留意を明記する。
- 差分取得は `tasks.list` の `updatedMin` / `showDeleted` / `showCompleted` を活用する。

---

## 7. デプロイ（GitHub Pages）
- Vite の `base` をリポジトリのパスに合わせる（プロジェクトページの場合）。
- `vite build` の成果物（`dist`）を GitHub Pages で配信。HTTPS は自動で満たされる。
- 既存の licodeenar.github.io のツール群と並べて配置可能。

---

## 8. 開発マイルストーン

1. **基盤** — Vite + React + TS、データモデルと localStorage リポジトリ、一覧 / 追加 / 編集 / 削除、完了トグル。
2. **PWA化** — vite-plugin-pwa、manifest・アイコン・Service Worker、ホーム画面追加でスタンドアロン起動を確認。
3. **バッジ** — 通知許可取得、未完了 simple 件数のバッジ反映。
4. **Google ログイン** — GIS による OAuth、tasks スコープでアクセストークン取得、ログイン / ログアウト UI。
5. **双方向同期** — プルダウン更新、push / pull、IDマッピング、last-write-wins、tombstone による削除伝播。
6. **仕上げ** — 競合・未ログイン・権限拒否時のフォールバック、iOS 実機確認、GitHub Pages へデプロイ。

---

## 9. スコープ外（初版では作らない）
- クラウド DB / 独自サーバー（同期は Google Tasks が担うため不要）
- 複数ユーザー / 共有
- プッシュ通知サーバー（バッジはローカル更新で完結）
- リマインダー通知（予定日の事前アラート）※必要なら次フェーズ
- Google Calendar API の直接連携（予定枠イベントが必要になった場合のオプション）
- App Store 配布（PWA のため対象外）

---

## 10. Claude Code への依頼事項
- マイルストーン1から順に着手し、各段階で動作確認できる状態にすること。
- 外部依存ライブラリは最小限に（React / vite-plugin-pwa 以外は原則追加しない。必要時は理由を添えて提案）。
- localStorage アクセスはリポジトリ層に集約すること。
- 同期ロジックは UI から独立したモジュール（例: `googleTasksSync.ts`）に分離し、単体でテストしやすくすること。
- 競合解決・削除伝播は意図しないデータ消失を防ぐため、まず安全側（消す前に確認できる、ログを残す等）で実装すること。
- OAuth のクライアント ID・リダイレクト URI は設定ファイル / 環境変数に切り出し、直書きしないこと。
- 権限拒否時（通知）・未ログイン時のフォールバックを必ず実装すること。
- iOS Safari の「ホーム画面に追加」を前提に、初回案内 UI を用意すること。

---

## 補足: データの所在まとめ
- タスク本体はユーザー端末の **localStorage** に保存（端末ローカル・サーバー不要）。
- Google Tasks と双方向同期することで、結果的に Google アカウントがバックアップ兼同期先になる。
- scheduled 型は Google Tasks の `due` を通じて Google カレンダーにも表示される。