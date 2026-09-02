# AGENTS.md — 受付システム（AIエージェント向けガイド）

このリポジトリをAIエージェント（Claude Code / Cursor / Copilot / Windsurf など）で保守する際の共通ルール。**作業前に必ず `docs/` の該当資料を読むこと。**

## これは何か
受付管理システム（ラクネコ代替）。
- フロント：Vercel + `index.html`（単一ファイル・React + Babel CDN。受付端末＆管理コンソール）
- API：Vercel Serverless Functions（`api/*.js`）
- DB：Supabase（PostgreSQL・RLS）
- 連携：Google Apps Script（`gas/reception-calendar.gs`）／通知：Google Chat／認証：Google OAuth
- 本番URL：https://reception-eureka.com

## まず読む
- `docs/maintenance-handover.md` — 構成・環境変数・**障害対応ランブック**
- `docs/history-and-decisions.md` — 経緯・意思決定（なぜ今こうか）
- `docs/ai-agent-maintenance.md` — 保守の進め方（セットアップ〜確認）

## 変更の進め方
- `main` へ直接 push しない。**必ずブランチ → PR**。
- PRごとに **Vercelプレビュー**が出る。動作確認してからマージ。
- **main マージ ＝ 本番反映**（CIは無い。プレビュー目視が品質ゲート）。

## 必ず守る（ガードレール）
- **秘密情報をコード/コミット/チャットに出さない**：`SUPABASE_SERVICE_ROLE_KEY`、OAuth secret、`INVITATION_SECRET` 等の**値**。値はVercel等の管理画面で管理。
- **DBスキーマ変更は `supabase/migrations/` に追加**。※本番スキーマは migrations より進んでいる（drift）。**現行本番が正**で、再構築は本番ダンプから。
- **破壊的なDB操作は事前確認**（削除・全更新）。
- **GASの `RECEPTION_URL` は直URL（`*.vercel.app`）**。独自ドメインはPOSTがリダイレクトで405になる。

## 主要パス
- `index.html` … フロント本体（受付端末＋管理コンソール）
- `api/*.js` … サーバー処理（notify / invitation / logs / room-availability など）
- `gas/reception-calendar.gs` … カレンダー連携・会議室同期
- `supabase/migrations/` … スキーマ
- `docs/` … ドキュメント（`docs/README.md` が索引）

## Claude Code を使う場合
`.claude/skills/` にプロジェクトスキルを同梱している（他エージェントでは無視されるが、内容は各SKILL.mdとして読める）。
- `reception-system-runbook` … 障害・不具合の一次対応（会議室同期・通知・PIN 等）
- `reception-system-change` … コード変更・機能追加の前提と手順
