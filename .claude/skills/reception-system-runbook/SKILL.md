---
name: reception-system-runbook
description: 受付システム（reception-system / ラクネコ代替）の障害・不具合の一次対応に使う。会議室の空き状況が「同期データなし」になる、Google Chatの来訪通知が来ない、招待QRが「期限切れ」になる、管理画面のPINを忘れた、対応者のOAuthでエラーが出る、変更が本番に反映されない——といった症状の切り分けと復旧手順をまとめている。受付システムで「動かない/おかしい/エラー」と言われたら、原因を推測する前にこのスキルを使うこと。過去に何度も同じ所（独自ドメインのPOSTが405、タイムゾーン、スキーマdrift）で詰まっているため、勘で対応せず本ランブックに沿って確認する。
---

# 受付システム 障害対応ランブック

受付システム（`viva-eureka/reception-system`）の運用中に出やすい事象の一次対応。まず症状を特定し、該当セクションの手順で切り分ける。背景の詳細は `docs/maintenance-handover.md`（ランブック本体）と `docs/history-and-decisions.md`（なぜそうなるか）にある。

**大原則：** 会議室同期など「外部→API→DB」の不具合は、勘で直そうとせず **どこで失敗しているか（HTTPコード・実行ログ）を先に特定**する。過去の障害はほぼこの確認で即断できた。

---

## 会議室が「同期データなし」

会議室の空き状況が出ない＝`reception_room_availability` に当日の行が無い。同期は Google Apps Script（`syncRoomAvailability`, 15分ごと）が担う。

1. Apps Script（script.google.com の該当プロジェクト）→ 左メニュー **「実行数（Executions）」** で `syncRoomAvailability` を開く。
2. 症状で分岐：
   - **実行が並んでいない** → トリガー停止。`setupTrigger` を1回実行して再登録。
   - **`405`**（ログに `空き状況同期: 405 …`）→ `RECEPTION_URL` が独自ドメイン（`reception-eureka.com`）になっている。**独自ドメインはリダイレクトでPOSTが405になる**ため、`RECEPTION_URL` を**リダイレクトの無いVercel直URL（`*.vercel.app`）**に変更して再実行。`200` になれば成功。
   - **`401`** → `INVITATION_SECRET` が Vercel と GAS で不一致。GASの `setSecretOnce` を Vercel と同じ値で実行。
   - **`500`** → API/DB側。`reception_room_availability` 等のスキーマを確認（コードの担当へ）。
   - **「リソースカレンダーが見つかりません」** → 会議室リソースカレンダーの権限・存在を確認。
3. **朝だけ出ない**場合：フロントは当日を日本時間（JST）で判定する実装になっているか確認（過去、UTC判定でJST午前0〜9時だけ「同期データなし」になる不具合があった）。

## Google Chat の来訪通知が来ない
- 通知先は `reception_settings.google_chat_webhook`（管理画面のWebhook設定）。未設定時は環境変数 `GOOGLE_CHAT_WEBHOOK_URL` にフォールバック。どちらも無ければ通知されない。
- スタッフ個別DMは `reception_staff.notification_webhook`。
- 設定画面で保存したのに反映されない場合、保存先キーが `google_chat_webhook` になっているか（過去、別キー `webhook_url` に保存していて通知に使われない不具合があった）。

## 招待QRが「期限切れ」になる
- 来訪日が**過去日**の招待はQRが無効（仕様）。過去日での招待作成は不可（バリデーション済み）。作り直す場合は当日以降で。

## 管理画面のPINを忘れた
- 管理画面のPINリセット（`/api/audit` の pin_reset）。`admin_email` 宛にメール通知（要 `RESEND_API_KEY`）。

## 対応者のOAuthでエラー
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`、リダイレクトURI（`{RECEPTION_URL}/api/auth/callback`）、Workspaceドメイン制限を確認。

## 変更が本番に反映されない
- 本番は **main へのマージで Vercel が自動デプロイ**（1〜数分）。PRのプレビューURLは別物。マージ済みか確認。
- 反映されているのに古い表示 → ブラウザキャッシュ。強制リロード（`Ctrl/⌘+Shift+R`）。

---

## 迷ったら
- 障害対応の詳細・環境変数・構成 → `docs/maintenance-handover.md`
- なぜこの挙動なのか（設計判断・過去のトラブル） → `docs/history-and-decisions.md`
- 恒久対応が必要なら GitHub Issues / Projectボード（受付システム 保守・改善）に起票。
