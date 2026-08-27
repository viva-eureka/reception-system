# 受付システム ドキュメント（Wiki）

受付管理システム（ラクネコ代替）のドキュメント一覧です。運用・保守・仕様・経緯をこの `docs/` で一元管理しています（コードと同じGitでバージョン管理）。

## 目的別インデックス

### 🛠 保守・運用（管理本部／情報システム部）
- **[保守引き継ぎ資料](./maintenance-handover.md)** — 構成・環境変数・障害対応ランブック・アクセス移管チェックリスト（**まずここ**）
- [リリースノート（変更履歴）](./changelog.md)
- [経緯・意思決定記録](./history-and-decisions.md) — なぜ今こうなっているか（設計判断・トラブル対応の記録）

### 🚀 導入・セットアップ
- [スタートアップガイド（管理者向け・IT）](./startup-guide-admin.md)
- [スタートアップガイド（利用者向け・カレンダー連携）](./startup-guide-user.md)
- [スタートアップガイド（統合版）](./startup-guide.md)

### 📋 仕様・テスト
- [要件定義](./requirements.md)
- [受け入れテスト結果（ラクネコ比較）](./acceptance-test.md) — 比較表・完了条件・判定
- [受付システム比較表（Excel）](./受付システム比較表.xlsx) — テスト用チェックリスト原本
- [入退館記録「メモ」列について](./入退館記録-メモ列について.md)

### 💁 利用・サポート
- [利用シナリオ](./user-scenarios.md)
- [ヘルプ・Q&A・Tips](./help-qa-tips.md)

## システム概要（要約）
- フロント: Vercel + `index.html`（受付端末＆管理コンソール）
- API: Vercel Serverless Functions（`api/*.js`）
- DB: Supabase（PostgreSQL・RLS）
- 連携: Google Apps Script（カレンダー・会議室同期）／Google Chat（通知）／Google OAuth（対応者識別）
- 本番URL: `https://reception-eureka.com`

詳細は各ドキュメントを参照してください。構成・障害対応は[保守引き継ぎ資料](./maintenance-handover.md)が入り口です。

---
*このページはドキュメントの目次です。ドキュメントを追加したらここにもリンクを追記してください。*
