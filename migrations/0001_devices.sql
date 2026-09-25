-- Devices allowed to use the API. Each gets a random token once; only its SHA-256 is stored.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Failed setup-code attempts, to slow down guessing.
CREATE TABLE setup_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX setup_attempts_ip_at ON setup_attempts (ip, at);
