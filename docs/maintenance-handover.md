# 受付システム 保守引き継ぎ資料

管理本部・情報システム部での保守運用を前提に、システム構成・運用・障害対応（ランブック）をまとめた資料です。
**まずこの1本を読めば、日常運用と一次対応ができる**ことを目的としています。

- 対象システム: 受付管理システム（ラクネコ代替）
- リポジトリ: `viva-eureka/reception-system`
- 本番URL: `https://reception-eureka.com`（旧URL `https://reception-system-five.vercel.app` も有効）

---

## 1. システム全体構成

| レイヤー | 使用サービス | 役割 |
|---|---|---|
| フロントエンド | **Vercel**（静的ホスティング）+ `index.html`（React + Babel CDN の単一ファイル） | 受付端末（iPad）＆管理コンソール |
| API | **Vercel Serverless Functions**（`api/*.js`, Node.js） | 通知・招待・ログ・会議室同期などのサーバー処理 |
| データベース | **Supabase**（PostgreSQL） | 全データ保存（RLS で保護） |
| 外部連携 | **Google Apps Script**（`gas/reception-calendar.gs`） | カレンダー連携・会議室空き状況の同期（15分ごと） |
| 通知 | **Google Chat**（Incoming Webhook） | 来訪通知・対応/依頼ボタン |
| 認証 | **Google OAuth**（Workspace ドメイン限定） | 対応者/依頼者の本人識別 |
| メール | **Resend**（任意） | PINリセット通知など |
| AI | **Anthropic API**（任意） | 名刺OCR・音声受付の解析 |

データの流れ（例：来訪受付）:
`iPad(index.html) → Supabase(reception_visits) → /api/notify → Google Chat通知 → 「対応」ボタン → /api/handle・/api/auth/callback → reception_responders`

---

## 2. リポジトリ構成

```
index.html               受付端末＋管理コンソール（フロント本体・最大の変更対象）
invite.html              招待表示ページ（QR/会社情報）
visitor-log.html         来訪者ログ／監査ログ閲覧ページ
api/                     Vercel Serverless Functions
  notify.js              来訪通知（グループ＋個別DM）
  handle.js / delegate.js / auth/callback.js   対応・依頼ボタン処理（OAuth）
  chat-events.js         Google Chat アプリイベント受信
  invitation.js          招待の作成/取得/状態更新
  sync-rooms.js          会議室マスタ同期（GASから）
  room-availability.js   会議室空き状況同期（GASから・15分ごと）
  logs.js / audit.js / checkout.js / claude.js
gas/reception-calendar.gs  Google Apps Script（カレンダー連携・会議室同期）
supabase/migrations/     DBスキーマ（※後述の drift 注意）
docs/                    各種ドキュメント（本資料含む）
```

---

## 3. デプロイと環境

### デプロイ方法
- **Vercel が `main` ブランチへの push を検知して自動デプロイ**します。**`main` にマージ＝本番反映**（通常1〜数分）。
- PR ごとに **プレビューURL**（`...-git-<branch>-....vercel.app`）が自動生成され、マージ前の確認に使えます。
- **CI はありません**（GitHub Actions は Issue ラベル起動の `vexa-agent.yml` のみで、PRのテストは走りません）。

### 環境変数（Vercel の Project Settings → Environment Variables）
値そのものは Vercel／各サービスの管理画面で管理。**このリポジトリには秘密情報を置かない**運用です。

| 変数名 | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase プロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバーAPIからのDBアクセス（RLSバイパス） |
| `INVITATION_SECRET` | GAS ↔ API 間の簡易認証キー（**GAS側と一致必須**） |
| `GOOGLE_CHAT_WEBHOOK_URL` | Google Chat グループ通知（設定未登録時のフォールバック） |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | 対応者OAuth認証 |
| `RESEND_API_KEY` | PINリセット等のメール送信（任意） |
| `ANTHROPIC_API_KEY` | 名刺OCR・音声受付の解析（任意） |

> フロント（`index.html`）には Supabase の **URL と anon キー**がハードコードされています（公開前提の匿名キー。RLSで保護）。差し替え時は `index.html` 上部の定数を変更。

---

## 4. データベース（Supabase）

### 主なテーブル
`reception_rooms`（会議室）/ `reception_buttons`（受付ボタン）/ `reception_settings`（KV形式の各種設定）/ `reception_staff`（スタッフ）/ `reception_invitations`（招待）/ `reception_visits`（入退館記録）/ `reception_responders`（対応者）/ `reception_audit_logs`（監査ログ）/ `reception_room_availability`（会議室空き状況）

- **RLS 有効**。ブラウザは anon キー、サーバーAPIは service_role キーでアクセス。
- `reception_settings` は「キー=値(JSONB)」のKV設計（会社名・テーマ・お知らせ・Webhook・自動退館時間・PIN 等）。

### ⚠️ 重要：スキーマの drift（コードとmigrationの乖離）
**本番Supabaseのスキーマは、`supabase/migrations/` の内容より進んでいます**（一部の列・テーブルは管理画面で直接適用されたため、migrationファイルに含まれていません）。
- 例：`reception_rooms.calendar_id`、`reception_room_availability`、`reception_staff.notification_webhook`、`reception_audit_logs.actor_name`、`reception_invitations.purpose/room`、`reception_visits.visit_purpose` など。
- **影響**：`migrations/` だけから新環境を再構築すると動きません。**現行の本番Supabaseが実質的なスキーマの正**です。移設・再構築時は本番スキーマをダンプして使ってください。

---

## 5. 外部連携（Google Apps Script）の運用

`gas/reception-calendar.gs` を各Googleアカウントの Apps Script（script.google.com）に配置して運用します。主な関数:

| 関数 | 役割 | 実行 |
|---|---|---|
| `onCalendarEventUpdated` | 自分のカレンダーに社外ゲスト招待→招待状自動作成＋QRメール送信 | トリガー（**各自のアカウントで設定必須**） |
| `syncRoomAvailability` | 会議室の空き状況を15分ごとに同期 | 時間トリガー（**誰か1人でOK**＝全員に反映） |
| `syncRoomsToReception` | 会議室マスタ（リソースカレンダー）を初回同期 | 手動1回 |
| `setupTrigger` | 上記トリガーを一括登録 | 手動1回 |
| `setSecretOnce` | `INVITATION_SECRET` をスクリプトプロパティに保存 | 手動1回 |

### 運用上の依存・注意（重要）
1. **`RECEPTION_URL` はリダイレクトの無い直URL（`*.vercel.app`）を使うこと。** 独自ドメイン `reception-eureka.com` はリダイレクト設定によりサーバー間POSTが405で失敗します（会議室同期が止まる原因になります）。
2. **`syncRoomAvailability` は設定した1名のアカウントで動作**します。その人が会議室カレンダーにアクセスできなくなる（退職・権限変更等）と同期が止まります。→ 別の担当者で再設定してください。
3. **`INVITATION_SECRET` は Vercel と GAS で一致**している必要があります。Vercel側で変更したら GAS の `setSecretOnce` も更新。
4. Google は連続失敗が続くとトリガーを**自動無効化**することがあります。→ `setupTrigger` 再実行で復活。

---

## 6. 障害対応ランブック（よくある事象と一次対応）

### 会議室が「同期データなし」
1. Apps Script → 左メニュー **「実行数」** で `syncRoomAvailability` を確認。
2. 症状別:
   - **実行が並んでいない** → トリガー停止。`setupTrigger` を再実行。
   - **`405`** → `RECEPTION_URL` が独自ドメインになっている。直URL（`*.vercel.app`）に修正。
   - **`401`** → `INVITATION_SECRET` 不一致。Vercelと一致させる（`setSecretOnce`）。
   - **`500`** → API/DB側。`reception_room_availability` 等スキーマを確認（開発担当へ）。
   - **「リソースカレンダーが見つかりません」** → 会議室リソースの権限/存在を確認。
3. 補足：空き状況は日本時間（JST）基準で当日分を保持。表示は本番デプロイ済みのフロントで JST 判定。

### Google Chat の通知が来ない
- `reception_settings.google_chat_webhook`（管理画面のWebhook設定）を確認。未設定時は環境変数 `GOOGLE_CHAT_WEBHOOK_URL` にフォールバック。
- スタッフ個別DMは `reception_staff.notification_webhook`。

### 管理画面PINを忘れた
- 管理画面のPINリセット（`/api/audit` の pin_reset）。`admin_email` 宛にメール通知（要 `RESEND_API_KEY`）。

### 招待QRが「期限切れ」になる
- 来訪日が過去日だと無効（仕様）。過去日での招待作成は不可（バリデーション実装済み）。

### 対応者OAuthでエラー
- `GOOGLE_OAUTH_CLIENT_ID/SECRET`、リダイレクトURI（`{RECEPTION_URL}/api/auth/callback`）、Workspaceドメイン制限を確認。

---

## 7. 変更・リリースの進め方（保守担当向け）
1. 作業ブランチを作成し変更（フロントは基本 `index.html`）。
2. push → **プレビューURL**で確認。
3. PR を作成しレビュー。
4. `main` にマージ → 自動デプロイで本番反映。
5. 反映確認（キャッシュが残る場合はスーパーリロード `Ctrl/⌘+Shift+R`）。

---

## 8. 引き継ぎチェックリスト（アクセス移管）

- [ ] **Vercel** プロジェクトのメンバー追加（デプロイ・環境変数管理）
- [ ] **Supabase** プロジェクトのメンバー追加（DB・RLS・バックアップ）
- [ ] **GitHub** リポジトリ `viva-eureka/reception-system` の権限付与
- [ ] **Google Apps Script** プロジェクトの共有／トリガー実行者の引き継ぎ（`syncRoomAvailability` を保守担当のアカウントで再設定）
- [ ] **Google Chat** Webhook / スペースの管理権限
- [ ] **Google OAuth**（Cloud Console）クライアントの管理権限
- [ ] **Resend / Anthropic** のAPIキー管理（利用している場合）
- [ ] 独自ドメイン `reception-eureka.com` のDNS/Vercelドメイン設定の管理
- [ ] 本番Supabaseスキーマのダンプを保管（drift対策・再構築用）

---

## 9. アクセス方針とコスト管理（席課金を増やさない）

Vercel（Pro）は**メンバー追加ごとに席課金**（1名あたり月額課金）が発生します。Supabase も同様に有料メンバーはコスト増になります。**保守メンバーが増えても固定費を積み上げない**ための方針です。

### 基本の考え方
- **管理画面（Vercel/Supabase のダッシュボード）に入る必要がある人は少数**です。日常の保守はほぼ **GitHub（PR）＋Vercelプレビュー** で完結します。
- したがって、有料シートは**「本当に管理画面が要る人」だけ**に絞ります。

### 役割別に必要なアクセス

| やること | 必要なアクセス | 有料シート |
|---|---|---|
| コード変更・機能追加・バグ修正（AIエージェント含む） | **GitHub のPR権限のみ**（変更はPR→プレビュー→mainマージ） | **不要** |
| 本番反映（デプロイ） | 不要（`main` マージで自動デプロイ） | **不要** |
| 環境変数の変更・Vercel設定・ドメイン | Vercel メンバー | 要（**1〜2名**） |
| DB調査・RLS・バックアップ確認 | Supabase メンバー | 要（**1〜2名**） |

→ **大多数のメンバーは GitHub 権限だけでOK**。Vercel/Supabase の有料シートは運用管理担当の**1〜2名**に限定するのが、コストと安全のバランスが最適です。

### 「完全無料化」を安易に狙わない理由
- **Vercel の無料（Hobby）は非商用・個人利用が前提** … 会社の受付システム＝商用利用は規約上グレー〜不可。
- **Supabase の無料枠はリスク大** … 一定期間アクセスが無いと**プロジェクト自動停止**（受付停止）、**自動バックアップが弱い/無い**、容量・帯域の上限も低い。本番の来客データを無料枠に置くのは非推奨。
- → **Pro のベース料金は「可用性・バックアップ・規約順守の保険」**として払う価値がある。削るべきは基本料ではなく、**席の追加課金**。

### どうしてもアカウントを共有する場合
- **メーリングリストを登録メールにするのは避ける**（リストの誰でもパスワードリセット/マジックリンクを受け取れてしまう＝実質誰でも入れる穴）。
- 共有するなら、**運用専用アカウントを1つ作り、認証情報とTOTP（2FA）をパスワードマネージャの共有Vault（1Password / Bitwarden 等）で配布**する。メンバーの出入りはVaultの共有解除で管理でき、退職時のパスワード再共有を避けられる。
- ただし「1アカウントを複数人で使う」構図は**監査（誰が何をしたか）が効かない**弱点が残る点は理解のうえで運用する。

---

## 10. 参考ドキュメント（同 `docs/`）
- `startup-guide-admin.md` … 管理者向け初期セットアップ
- `startup-guide-user.md` … 利用者向けカレンダー連携設定
- `requirements.md` … 要件
- `help-qa-tips.md` … よくある質問
- `user-scenarios.md` … 利用シナリオ
- `入退館記録-メモ列について.md` … 仕様補足

---

*最終更新: 2026-09-15 ／ 本資料は保守運用の一次リファレンスです。手順や構成に変更があれば更新してください。*
