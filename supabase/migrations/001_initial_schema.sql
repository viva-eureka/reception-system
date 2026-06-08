-- ============================================================
-- 受付システム フェーズ1 初期スキーマ
-- migration: 001_initial_schema
-- ============================================================

-- ─────────────────────────────────────────────
-- 拡張機能
-- ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. 会議室
-- ─────────────────────────────────────────────
create table if not exists reception_rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  capacity    int,
  location    text,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 2. 受付ボタン設定
-- ─────────────────────────────────────────────
create table if not exists reception_buttons (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  emoji       text,
  color       text not null default 'blue',
  type        text not null check (type in ('visitor','delivery','other')),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 3. アプリ設定（KV形式）
-- ─────────────────────────────────────────────
create table if not exists reception_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 4. スタッフ（受付・ホスト）
-- ─────────────────────────────────────────────
create table if not exists reception_staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  department  text,
  is_active   boolean not null default true,
  auth_user_id uuid,                    -- Supabase Auth ユーザーID（管理者のみ）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 5. 招待
-- ─────────────────────────────────────────────
create table if not exists reception_invitations (
  id              uuid primary key default gen_random_uuid(),
  visitor_name    text not null,
  company_name    text,                 -- 任意
  email           text,                 -- 任意
  host_name       text not null,
  host_staff_id   uuid references reception_staff(id) on delete set null,
  visit_date      date not null,
  visit_time      time,
  room_id         uuid references reception_rooms(id) on delete set null,
  qr_token        text unique not null default encode(gen_random_bytes(12), 'hex'),
  status          text not null default 'pending'
                    check (status in ('pending','arrived','no_show','cancelled')),
  send_method     text check (send_method in ('email','copy','unsent')),
  sent_at         timestamptz,
  arrived_at      timestamptz,
  notes           text,
  created_by      uuid references reception_staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 6. 来訪記録（ログ）
-- ─────────────────────────────────────────────
create table if not exists reception_visits (
  id              uuid primary key default gen_random_uuid(),
  invitation_id   uuid references reception_invitations(id) on delete set null,
  visitor_name    text not null,
  company_name    text,
  visit_type      text not null check (visit_type in ('invited','walkin','delivery','voice')),
  button_id       uuid references reception_buttons(id) on delete set null,
  host_name       text,
  host_staff_id   uuid references reception_staff(id) on delete set null,
  person_count    int not null default 1,
  checked_in_at   timestamptz not null default now(),
  checked_out_at  timestamptz,          -- null = 在館中
  auto_checkout   boolean not null default false,
  notes           text,
  chat_message_id text,                 -- Google Chat スレッドID（対応済みボタン更新用）
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 7. 対応者記録（誰がChat「✋対応する」を押したか）
-- ─────────────────────────────────────────────
create table if not exists reception_responders (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references reception_visits(id) on delete cascade,
  responder_name  text not null,
  responder_email text,
  response_type   text not null check (response_type in ('handling','on_my_way','wait_please')),
  responded_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 8. 監査ログ（ISO27001対応・10年保持）
-- ─────────────────────────────────────────────
create table if not exists reception_audit_logs (
  id          bigserial primary key,
  action      text not null,            -- INSERT / UPDATE / DELETE / LOGIN / EXPORT 等
  table_name  text,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  user_id     uuid,
  user_email  text,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- インデックス
-- ─────────────────────────────────────────────
create index on reception_invitations (visit_date);
create index on reception_invitations (qr_token);
create index on reception_invitations (status);
create index on reception_visits (checked_in_at desc);
create index on reception_visits (invitation_id);
create index on reception_audit_logs (created_at desc);
create index on reception_audit_logs (table_name, record_id);

-- ─────────────────────────────────────────────
-- updated_at 自動更新トリガー
-- ─────────────────────────────────────────────
create or replace function reception_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_rooms_updated_at
  before update on reception_rooms
  for each row execute function reception_set_updated_at();

create trigger trg_buttons_updated_at
  before update on reception_buttons
  for each row execute function reception_set_updated_at();

create trigger trg_settings_updated_at
  before update on reception_settings
  for each row execute function reception_set_updated_at();

create trigger trg_staff_updated_at
  before update on reception_staff
  for each row execute function reception_set_updated_at();

create trigger trg_invitations_updated_at
  before update on reception_invitations
  for each row execute function reception_set_updated_at();
