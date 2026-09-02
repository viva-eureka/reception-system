# GitHub Copilot 指示（受付システム）

このリポジトリの保守ガイドは直下の **`AGENTS.md`** に集約しています。作業前に `AGENTS.md` と `docs/maintenance-handover.md` を読んでください。

## これは何か
受付管理システム（ラクネコ代替）。フロント=Vercel+`index.html`（単一ファイル・React+Babel CDN）、API=`api/*.js`（Vercel Functions）、DB=Supabase、連携=Google Apps Script、通知=Google Chat。本番URL: https://reception-eureka.com

## 必ず守る
- 変更は **ブランチ → PR → Vercelプレビュー確認 → main マージ（＝本番反映）**。**CIは無い**ので、プレビューの目視確認が唯一の品質ゲート。
- **秘密情報の値をコミットしない**（`SUPABASE_SERVICE_ROLE_KEY`、OAuth secret、`INVITATION_SECRET` 等）。値はVercel等の管理画面で管理。
- **DBスキーマ変更は `supabase/migrations/` に追加**。ただし本番Supabaseは migrations より進んでいる（drift）。**現行本番が「正」**。破壊的変更はしない。anonで読む画面はRLSの読み取り許可も要確認。
- **Google Apps Script の `RECEPTION_URL` は直URL（`*.vercel.app`）**。独自ドメインはリダイレクトでPOSTが405になる。
- **日付は日本時間（JST）基準**で扱う。

## 参考
- 構成・環境変数・障害対応ランブック: `docs/maintenance-handover.md`
- 経緯・意思決定: `docs/history-and-decisions.md`
- AIエージェントでの保守手順: `docs/ai-agent-maintenance.md`
