-- iPad（anon キー）から reception_visits に INSERT できるよう RLS ポリシーを更新
-- 来訪ログが visitor-log.html に表示されない問題の修正
DROP POLICY IF EXISTS "visits_insert" ON reception_visits;

CREATE POLICY "visits_insert" ON reception_visits
  FOR INSERT WITH CHECK (
    auth.role() IN ('authenticated', 'service_role', 'anon')
  );
