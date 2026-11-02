-- Схема D1. Та же форма, что у локального SQLite в server/store.mjs.
-- Применить: npx wrangler d1 execute blind-witness --remote --file=db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,
  pass TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats (
  user_id INTEGER PRIMARY KEY,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);

-- Своё лицо: картинка до 200 КБ рядом с аккаунтом, отдаётся по имени.
CREATE TABLE IF NOT EXISTS avatars (
  user_id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated INTEGER NOT NULL
);
