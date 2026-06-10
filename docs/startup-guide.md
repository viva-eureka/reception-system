# 受付システム スタートアップガイド

> 対象読者: システム管理者・初期セットアップ担当者  
> 所要時間: 約60〜90分

---

## 目次

1. [システム構成の概要](#1-システム構成の概要)
2. [前提条件の確認](#2-前提条件の確認)
3. [Supabase のセットアップ](#3-supabase-のセットアップ)
4. [Vercel へのデプロイ](#4-vercel-へのデプロイ)
5. [Google Apps Script のセットアップ](#5-google-apps-script-のセットアップ)
6. [管理画面の初期設定](#6-管理画面の初期設定)
7. [iPad のキオスク設定](#7-ipad-のキオスク設定)
8. [動作確認チェックリスト](#8-動作確認チェックリスト)

---

## 1. システム構成の概要

```
iPad（受付端末）
    ↕ QRスキャン / 音声受付
Vercel（フロントエンド + API）
    ↕ データ保存・取得
Supabase（データベース）
    ↕ 会議室同期 / 招待状自動作成
Google Apps Script（カレンダー連携）
    ↕ 通知
Google Chat（スタッフへのアラート）
```

| サービス | 役割 | 費用目安 |
|---------|------|---------|
| Vercel | ホスティング・API | 無料プランで運用可能 |
| Supabase | データベース | 無料プランで運用可能 |
| Google Apps Script | カレンダー自動連携 | 無料 |
| Google Chat | スタッフ通知 | 無料（Google Workspace に含む） |

---

## 2. 前提条件の確認

以下のアカウントが必要です。

- [ ] **GitHub アカウント**（リポジトリのフォーク用）
- [ ] **Vercel アカウント**（GitHub アカウントでサインアップ可）
- [ ] **Supabase アカウント**（無料）
- [ ] **Google Workspace アカウント**（Google Calendar・Chat・Apps Script）
- [ ] **iPad**（iOS 16 以上推奨）

---

## 3. Supabase のセットアップ

### 3-1. プロジェクト作成

1. [supabase.com](https://supabase.com) にログイン
2. **New project** をクリック
3. プロジェクト名・パスワード・リージョン（Northeast Asia – Tokyo 推奨）を入力

### 3-2. データベーススキーマの適用

Supabase ダッシュボード → **SQL Editor** を開き、`supabase/migrations/` 内のファイルを順番に実行：

```
001_initial_schema.sql  → テーブル作成
002_rls_policies.sql    → セキュリティポリシー設定
```

### 3-3. API キーの取得

**Settings → API** から以下をメモしておく：

| キー | 用途 |
|-----|-----|
| `Project URL` | `SUPABASE_URL` に使用 |
| `anon (public)` | フロントエンド用（index.html に記載） |
| `service_role` | サーバー API 用（Vercel 環境変数に設定） |

> ⚠️ `service_role` キーは絶対に公開しないでください。Vercel の環境変数にのみ設定します。

---

## 4. Vercel へのデプロイ

### 4-1. リポジトリの準備

```bash
# リポジトリをクローン（または GitHub でフォーク）
git clone https://github.com/viva-eureka/reception-system.git
cd reception-system
```

### 4-2. Vercel プロジェクト作成

1. [vercel.com](https://vercel.com) → **New Project**
2. GitHub リポジトリを選択してインポート
3. **Deploy** をクリック（まず一度デプロイ）

### 4-3. 環境変数の設定

Vercel ダッシュボード → **Settings → Environment Variables** に以下を追加：

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase service_role キー |
| `INVITATION_SECRET` | 任意の文字列（例: `your-secret-key-2024`） | Apps Script との認証キー |
| `GOOGLE_CHAT_WEBHOOK_URL` | `https://chat.googleapis.com/...` | Google Chat Webhook（任意） |

> 環境変数を追加したら **Redeploy** が必要です（Vercel ダッシュボード → Deployments → 最新 → Redeploy）。

### 4-4. index.html の Supabase キー更新

`index.html` の以下の箇所を実際の値に更新してコミット：

```javascript
// index.html 内の初期化部分
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...your-anon-key...";
```

---

## 5. Google Apps Script のセットアップ

Apps Script は **1つのプロジェクト** に以下の機能をすべてまとめています。

| 関数 | 役割 | トリガー |
|------|------|---------|
| `onCalendarEventUpdated` | 外部ゲスト招待を検知 → 招待状自動作成 + ゲストへQRメール送信 | カレンダー更新時 |
| `syncRoomAvailability` | 会議室の空き状況を同期 | 15分ごと（自動） |
| `syncRoomsToReception` | 会議室マスタを初回登録 | 手動実行（1回のみ） |

### 5-1. プロジェクトの作成とコード設定

1. [script.google.com](https://script.google.com) → **新しいプロジェクト**
2. `gas/reception-calendar.gs` の内容をまるごと貼り付け
3. 左メニュー **サービス** → **Google Calendar API** を追加
4. `RECEPTION_URL` と `COMPANY_DOMAIN` を自社のものに変更

```javascript
const RECEPTION_URL  = "https://your-project.vercel.app";
const COMPANY_DOMAIN = "your-company.co.jp";
```

### 5-2. シークレットの設定（1回だけ）

1. `setSecretOnce()` 関数内の `"ここに入力"` を Vercel の `INVITATION_SECRET` と同じ値に書き換え
2. `setSecretOnce()` を**一度だけ手動実行**
3. 実行後、`"ここに入力"` の文字列を削除して保存（コードにシークレットを残さない）

### 5-3. トリガーの一括登録（1回だけ）

`setupTrigger()` を**一度だけ手動実行**すると、以下の2つのトリガーが自動で登録されます。

| トリガー | 種別 |
|---------|------|
| `onCalendarEventUpdated` | カレンダー - 変更済み |
| `syncRoomAvailability` | 時間ベース - 15分ごと |

### 5-4. 会議室マスタの初回同期（1回だけ）

`syncRoomsToReception()` を**一度だけ手動実行**します。  
リソースカレンダーの会議室情報が Supabase に登録されます。

---

## 6. 管理画面の初期設定

`https://your-project.vercel.app` にアクセスし、画面右下の **⚙ 管理** をタップして管理画面へ。

初期 PIN は `1234` です。**必ず最初に変更してください。**

### 設定タブで行う設定

#### 基本情報
- **会社名**：来訪者向けページに表示されます
- **会社ロゴ**：招待状ページに表示（240×120px 推奨）
- **住所・電話番号**：招待状ページに表示

#### 通知設定
- **Google Chat Webhook URL**：スタッフへの来訪通知先
  - Google Chat → スペース → Webhook を追加 → URL をコピー

#### 受付設定
- **営業時間**：時間外は「営業時間外」表示に切り替わります
- **受付ボタン**：受付方法のボタンラベルをカスタマイズ可能

#### 管理 PIN
- 4桁の数字に変更してください（デフォルト `1234` から必ず変更）

---

## 7. iPad のキオスク設定

iPad を専用の受付端末として固定するには **Guided Access（アクセスガイド）** を使用します。

### 7-1. Guided Access の有効化

**設定 → アクセシビリティ → アクセスガイド**
- アクセスガイド: ON
- パスコード設定: 管理者だけが知るパスコードを設定

### 7-2. キオスクモードの開始

1. Safari で `https://your-project.vercel.app` を開く
2. **ホームボタンを3回押す**（または サイドボタン3回）
3. 「アクセスガイドを開始」をタップ
4. これで Safari のアドレスバーや他のアプリにアクセスできなくなります

### 7-3. 推奨設定

| 設定 | 推奨値 | 場所 |
|-----|--------|------|
| 自動ロック | なし | 設定 → 画面表示と明るさ |
| 画面の明るさ | 70〜80% | 設定 → 画面表示と明るさ |
| 音量 | 適度に設定 | サイドボタン |
| Wi-Fi | 社内 Wi-Fi に固定 | 設定 → Wi-Fi |

> **充電**: iPad は常時充電しながら使用することを推奨します。スタンドに固定し、ケーブルを目立たない場所に通してください。

---

## 8. 動作確認チェックリスト

セットアップ完了後、以下を順番に確認してください。

### 基本動作
- [ ] `https://your-project.vercel.app` にアクセスして受付画面が表示される
- [ ] 画面右下の **⚙ 管理** から管理画面に入れる（初期 PIN: `1234` → 必ず変更）
- [ ] 管理画面 → 会議室タブ → 本日のスケジュールが表示されている

### 招待状フロー
- [ ] 管理画面 → 招待管理 → テスト招待を作成
- [ ] 発行された URL にアクセスし、来訪者ページ（QR コード）が表示される

### Google Calendar 連携
- [ ] 外部ゲストを含む予定を Google カレンダーに作成
- [ ] 数分後に Google Chat に通知が届く
- [ ] 招待されたゲストに QR コード付きメールが届く
- [ ] 管理画面 → 招待管理 に招待が追加されている

### 会議室同期
- [ ] 管理画面 → 会議室 → スケジュールが正しく表示されている
- [ ] 予約名・予約者名が表示されている

### 受付フロー（iPad で確認）
- [ ] QR コードをカメラにかざすと受付完了画面が表示される
- [ ] Google Chat にスタッフ通知が届く

### ログ確認
- [ ] 管理画面サイドバー → **🔍 来訪・監査ログ** → 来訪ログに記録が表示される
- [ ] 監査ログタブ → 管理操作（ログイン・設定変更等）が記録されている
