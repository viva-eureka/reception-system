-- ============================================================
-- 受付システム フェーズ1 RLSポリシー
-- migration: 002_rls_policies
-- ISO27001準拠: 全テーブルにRLS有効化
-- ============================================================

-- ─────────────────────────────────────────────
-- RLS 有効化
-- ─────────────────────────────────────────────
alter table reception_rooms        enable row level security;
alter table reception_buttons      enable row level security;
alter table reception_settings     enable row level security;
alter table reception_staff        enable row level security;
alter table reception_invitations  enable row level security;
alter table reception_visits       enable row level security;
alter table reception_responders   enable row level security;
alter table reception_audit_logs   enable row level security;

-- ─────────────────────────────────────────────
-- 共通ヘルパー関数: 認証済みユーザーか
-- ─────────────────────────────────────────────
create or replace function reception_is_authenticated()
returns boolean language sql security definer as $$
  select auth.role() = 'authenticated';
$$;

-- ─────────────────────────────────────────────
-- reception_rooms ポリシー
-- ─────────────────────────────────────────────
-- 読み取り: 認証済み + サービスロール（iPad端末用APIキー）
create policy "rooms_read" on reception_rooms
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

-- 書き込み: 認証済みのみ
create policy "rooms_write" on reception_rooms
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- reception_buttons ポリシー
-- ─────────────────────────────────────────────
create policy "buttons_read" on reception_buttons
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

create policy "buttons_write" on reception_buttons
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- reception_settings ポリシー
-- ─────────────────────────────────────────────
create policy "settings_read" on reception_settings
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

create policy "settings_write" on reception_settings
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- reception_staff ポリシー
-- ─────────────────────────────────────────────
create policy "staff_read" on reception_staff
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

create policy "staff_write" on reception_staff
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────
-- reception_invitations ポリシー
-- ─────────────────────────────────────────────
-- iPad（service_role）は全件参照可（QRスキャン時に招待検索）
create policy "invitations_read" on reception_invitations
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

-- 書き込み: 認証済み（管理者）またはサービスロール（到着時ステータス更新）
create policy "invitations_write" on reception_invitations
  for all using (
    auth.role() in ('authenticated', 'service_role')
  )
  with check (
    auth.role() in ('authenticated', 'service_role')
  );

-- ─────────────────────────────────────────────
-- reception_visits ポリシー
-- ─────────────────────────────────────────────
create policy "visits_read" on reception_visits
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

create policy "visits_insert" on reception_visits
  for insert with check (
    auth.role() in ('authenticated', 'service_role')
  );

create policy "visits_update" on reception_visits
  for update using (
    auth.role() in ('authenticated', 'service_role')
  );

-- ─────────────────────────────────────────────
-- reception_responders ポリシー
-- ─────────────────────────────────────────────
create policy "responders_read" on reception_responders
  for select using (
    auth.role() in ('authenticated', 'service_role')
  );

-- Google Chat App（service_role）が書き込む
create policy "responders_insert" on reception_responders
  for insert with check (
    auth.role() in ('authenticated', 'service_role')
  );

-- ─────────────────────────────────────────────
-- reception_audit_logs ポリシー
-- ─────────────────────────────────────────────
-- 書き込み: サービスロールのみ（アプリが自動記録）
create policy "audit_insert" on reception_audit_logs
  for insert with check (
    auth.role() in ('authenticated', 'service_role')
  );

-- 読み取り: 認証済みのみ（監査担当者）
create policy "audit_read" on reception_audit_logs
  for select using (auth.role() = 'authenticated');

-- 削除不可（監査ログは変更・削除禁止）
-- ※ DELETE/UPDATE ポリシーを作らないことで実質禁止
