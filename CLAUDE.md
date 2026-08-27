# CLAUDE.md

このリポジトリの保守ガイドは **[`AGENTS.md`](./AGENTS.md)** に集約しています。まずそれを読んでください。

要点：
- 受付管理システム（ラクネコ代替）。フロント=Vercel+`index.html`、API=`api/*.js`、DB=Supabase、連携=Google Apps Script、通知=Google Chat。
- 変更は **ブランチ → PR → Vercelプレビュー確認 → main マージ（＝本番反映）**。CIは無い。
- **秘密情報の値をコミットしない**。**スキーマ変更は `supabase/migrations/`**（本番はdrift、現行本番が正）。**GASの `RECEPTION_URL` は直URL**（独自ドメインはPOSTが405）。

詳細・障害対応は `docs/maintenance-handover.md`、経緯は `docs/history-and-decisions.md`、AI保守手順は `docs/ai-agent-maintenance.md`。
