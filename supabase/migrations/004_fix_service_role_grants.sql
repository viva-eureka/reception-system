-- service_role に reception_settings への DML 権限を付与
-- api/audit.js の pin_reset などサーバーサイドからの書き込みに必要
GRANT SELECT, INSERT, UPDATE, DELETE ON reception_settings TO service_role;
