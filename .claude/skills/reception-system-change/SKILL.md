---
name: reception-system-change
description: 受付システム（reception-system / ラクネコ代替）のコードを変更・機能追加・修正するときに使う。フロントは単一の大きな `index.html`（React+Babel CDN）、APIは `api/*.js`（Vercel Functions）、DBはSupabase、外部連携はGoogle Apps Scriptという構成で、変更にあたって必ず守るべき制約（PR→プレビュー→mainマージで本番反映・CIなし／秘密情報をコミットしない／スキーマ変更はmigrationでdriftに注意／GASのPOST先は直URL）と、どこを触ればよいかの勘所がある。「受付システムに〇〇を追加/修正して」「index.html を変えて」「招待/通知/会議室/入退館ログ/受付画面まわりを直して」と言われたら、着手前にこのスキルで前提と手順を確認すること。
---

# 受付システム 変更ガイド（開発）

`viva-eureka/reception-system` に変更を加えるときの前提・手順・勘所。まず `AGENTS.md`（直下）と `docs/maintenance-handover.md` に目を通すこと。ここはそれを開発作業向けに具体化したもの。

## 変更〜反映のフロー（必ず）
1. **ブランチを切る**（`main` へ直接pushしない）。
2. 変更 → **PR作成**。PRごとに **VercelプレビューURL** が出る。
3. **プレビューで実機確認**（このリポジトリは PRのCIが無い。プレビュー目視が唯一の品質ゲート）。
4. **main マージ ＝ 本番反映**（1〜数分）。
5. 反映確認（古い表示は強制リロード `Ctrl/⌘+Shift+R`）。

## 必ず守る制約（過去に事故った所）
- **秘密情報の値をコミット・チャットに出さない**：`SUPABASE_SERVICE_ROLE_KEY`、OAuth secret、`INVITATION_SECRET` 等。値はVercel等の管理画面で管理。フロントの anon キーは公開前提（RLSで保護）。
- **DBスキーマ変更は `supabase/migrations/` に追加**。ただし**本番Supabaseは migrations より進んでいる（drift）**。**現行本番が「正」**なので、既存カラム/テーブルの有無は本番基準で判断し、再構築前提の破壊的変更はしない。anonで読む画面なら**RLSの読み取り許可**も必要（例：`reception_responders` は anon 不可なので `/api/logs`(service_role) 経由で取得している）。
- **Google Apps Script の `RECEPTION_URL` は直URL（`*.vercel.app`）**。独自ドメインはリダイレクトでサーバー間POSTが405になる。
- **日付は日本時間（JST）基準**で扱う（当日判定・過去日ガードなど）。UTCで判定するとJST午前帯でズレる。

## どこを触るか（勘所）
- **フロント全体**：`index.html`（単一ファイル・数千行）。React コンポーネントを Babel でブラウザ変換。主要な入口は `loadFromSupabase()`（Supabaseから設定・招待・来訪・会議室などをまとめて読む）。
- **設定値**：`reception_settings` は「キー=値(JSONB)」のKV。フロントは `loadFromSupabase` 内で `settings` オブジェクトに読み、まとめて upsert して保存。新しい設定を足すなら「読み込み・保存・UIの3箇所」を対で追加する。
- **入退館記録／来訪ログの表示**：`index.html` の Logs コンポーネント（列定義 `ALL_COLUMNS`、表示状態は localStorage 永続）。来訪ログ閲覧ページは `visitor-log.html`。
- **通知・招待・ログ・会議室同期のサーバー処理**：`api/notify.js` / `api/invitation.js` / `api/logs.js` / `api/room-availability.js` / `api/sync-rooms.js` など。CORS許可リストに本番ドメインとvercel直URLがある。
- **カレンダー連携・会議室同期**：`gas/reception-calendar.gs`（GAS。各自のGoogleアカウントで設定）。

## 変更後の確認観点
- プレビューで該当画面を実際に操作して確認（CIが無い前提）。
- 外部連携（会議室同期・通知・OAuth）を触った場合は、失敗時のHTTPコードで切り分け（→ `reception-system-runbook` スキル）。
- スキーマを触ったら migration を追加し、anonアクセス経路ならRLSも確認。

## 参考
- 制約の要約：`AGENTS.md` / `CLAUDE.md`（直下）
- 構成・環境変数・障害対応：`docs/maintenance-handover.md`
- 経緯・意思決定：`docs/history-and-decisions.md`
- AI保守の進め方：`docs/ai-agent-maintenance.md`
