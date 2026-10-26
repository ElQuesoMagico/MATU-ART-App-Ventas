-- Metadata only. Business catalogue remains in Sheets. No auth data is rewritten.
CREATE TABLE catalog_operations (
 operation_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','conflict')),
 response_json TEXT,
 created_at INTEGER NOT NULL,
 confirmed_at INTEGER
);
