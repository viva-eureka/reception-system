-- ============================================================
-- 受付システム 初期データ投入
-- migration: 003_seed_data
-- ============================================================

-- ─────────────────────────────────────────────
-- 会議室（モックのDEMO_BOOKINGSに合わせた初期値）
-- ─────────────────────────────────────────────
insert into reception_rooms (name, capacity, location, sort_order) values
  ('会議室A', 6, '2F', 1),
  ('会議室B', 4, '2F', 2),
  ('会議室C', 10, '3F', 3)
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 受付ボタン（モックのDEFAULT_BUTTONSに合わせた初期値）
-- ─────────────────────────────────────────────
insert into reception_buttons (label, emoji, color, type, sort_order) values
  ('ご予約・招待の方',   '📅', 'blue',   'visitor',  1),
  ('アポなしの方',       '🚶', 'green',  'visitor',  2),
  ('配送業者の方',       '📦', 'orange', 'delivery', 3)
on conflict do nothing;

-- ─────────────────────────────────────────────
-- アプリ設定 初期値
-- ─────────────────────────────────────────────
insert into reception_settings (key, value, description) values
  (
    'business_hours',
    '[
      {"day": 0, "label": "月", "open": true,  "start": "09:00", "end": "18:00"},
      {"day": 1, "label": "火", "open": true,  "start": "09:00", "end": "18:00"},
      {"day": 2, "label": "水", "open": true,  "start": "09:00", "end": "18:00"},
      {"day": 3, "label": "木", "open": true,  "start": "09:00", "end": "18:00"},
      {"day": 4, "label": "金", "open": true,  "start": "09:00", "end": "18:00"},
      {"day": 5, "label": "土", "open": false, "start": "10:00", "end": "17:00"},
      {"day": 6, "label": "日", "open": false, "start": "10:00", "end": "17:00"}
    ]'::jsonb,
    '営業時間設定（曜日別）'
  ),
  (
    'allow_outside_hours',
    'false'::jsonb,
    '営業時間外でも受付を許可するか'
  ),
  (
    'privacy_mode',
    '"normal"'::jsonb,
    '受付完了画面の表示モード: normal | privacy'
  ),
  (
    'theme',
    '"midnight"'::jsonb,
    '待ち受けテーマ'
  ),
  (
    'company_name',
    '"株式会社ユリーカ"'::jsonb,
    '会社名（受付画面に表示）'
  ),
  (
    'google_chat_webhook',
    'null'::jsonb,
    'Google Chat Webhook URL'
  ),
  (
    'auto_checkout_time',
    '"23:59"'::jsonb,
    '自動退館処理を行う時刻'
  )
on conflict (key) do nothing;

-- ─────────────────────────────────────────────
-- スタッフ（ユリーカ 青山代表）
-- ─────────────────────────────────────────────
insert into reception_staff (name, email, department) values
  ('青山 雅司', 'aoyama.masashi@viva-eureka.co.jp', '代表')
on conflict (email) do nothing;
