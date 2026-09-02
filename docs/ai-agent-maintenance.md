# AIエージェントによる保守ガイド

引き継ぎ後、各メンバーが**好みのAIエージェント**（Claude Code / Cursor / GitHub Copilot / Windsurf など）でこのシステムを保守するための手順です。「セットアップ → 指示 → 確認」の流れをまとめます。

> 共通の前提・ルールはリポジトリ直下の **`AGENTS.md`**（および `CLAUDE.md`）に集約しています。まずエージェントにそれと `docs/` を読ませてください。

---

## 0. 事前準備（共通）
- **GitHub** リポジトリへのアクセス（clone / PR 作成権限）
- 保守内容に応じて **Vercel / Supabase / Google Apps Script** のアクセス
- **環境変数の値**は各サービスの管理画面で確認（コード・チャットに貼らない）

---

## 1. セットアップ（エージェント別）

| エージェント | セットアップ | 参照される設定 |
|---|---|---|
| **Claude Code**（Web/CLI/IDE） | Webは claude.ai/code でリポジトリ選択、CLIはプロジェクトで起動 | `CLAUDE.md` / `AGENTS.md` を自動読込 |
| **Cursor / Windsurf** | リポジトリを開く | `AGENTS.md`（必要なら `.cursorrules`） |
| **GitHub Copilot / Chat** | リポジトリを開き Chat で docs を参照 | `AGENTS.md`（手動で読ませる） |

**ツール別の自動読込ファイル**（前提・制約をエージェントが自動で拾う入口。中身は `AGENTS.md`／`docs/` に集約）：
- GitHub Copilot … `.github/copilot-instructions.md`
- Cursor … `.cursor/rules/reception-system.mdc`（`AGENTS.md` も参照）
- Windsurf … `.windsurfrules`
- Claude Code … `CLAUDE.md` / `AGENTS.md` / `.claude/skills/`

**共通の最初の一手（プロンプト）：**
> このリポジトリは受付システム。まず `AGENTS.md` と `docs/maintenance-handover.md`、`docs/history-and-decisions.md` を読んで、概要と注意点を要約して。

> 💡 **まず一度やってみたい人へ**：[ハンズオン＆実演ガイド](./ai-agent-hands-on.md) に、本番へ影響を与えずに（プレビューまでで止める）1つの変更を最後まで通す実演シナリオと、実際の変更例をまとめています。引き継ぎ会での実演にも使えます。

---

## 2. 指示の出し方（プロンプトの型）

```
# 前提
このリポジトリは受付システム（ラクネコ代替）。
docs/maintenance-handover.md と docs/history-and-decisions.md を読んでから作業して。

# タスク
<やりたいことを具体的に>

# 制約
- 変更はブランチを切って PR にする（main へ直接 push しない）
- 環境変数の値・APIキーはコードに書かない
- スキーマ変更が必要なら supabase/migrations/ に追加する
- 影響範囲と確認手順を説明して
```

- **良い指示**＝目的・対象ファイル・期待結果・制約を明示
- 一度に大きく変えない。**小さいPR**に分割する

---

## 3. 変更〜反映のフロー
1. **ブランチ作成** → 変更
2. **PR作成** → Vercel の**プレビューURL**で動作確認
3. **レビュー**（大きな変更は人間が確認）
4. **main マージ ＝ 本番反映**（1〜数分）
5. 本番確認（表示が古い時は強制リロード `Ctrl/⌘+Shift+R`）

> このリポジトリは **PRのCIが無い**ため、「**プレビューの目視確認**」が品質ゲートです。マージ前に必ず確認。

---

## 4. 確認・検証のポイント
- **会議室同期**など外部連携の不具合は `docs/maintenance-handover.md` のランブックで切り分け（405/401/500/トリガー停止）
- **スキーマ変更**は必ず `supabase/migrations/` に追加（drift を増やさない）
- **破壊的なDB操作**（削除・全更新）は事前バックアップ・確認
- 通知・OAuth・GAS は本番影響が大きいので慎重に

---

## 5. ガードレール（AIに任せる時の注意）
- **秘密情報を出さない**：`SUPABASE_SERVICE_ROLE_KEY`、OAuth secret、`INVITATION_SECRET` の値などをチャット・コミットに出さない
- **鵜呑みにしない**：AIの提案は必ずプレビュー／テストで検証してからマージ
- **本番DBへの直接実行は避ける**：まずプレビュー・検証で確認
- **大きな設計変更・外部連携変更は人間が最終判断**
- 生成物（PR）は**必ずレビューしてからマージ**

---

## 6. 困ったとき
- 障害対応 → `docs/maintenance-handover.md`（ランブック）
- 経緯・背景 → `docs/history-and-decisions.md`
- 今後のタスク → GitHub **Issues** / **Projectボード**（受付システム 保守・改善）

---
*最終更新: 2026-08-27*
