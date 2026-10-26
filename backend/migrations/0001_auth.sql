PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('administrator','manager','seller')),
 disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
 created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX attempts_expiry ON attempts(expires_at);
