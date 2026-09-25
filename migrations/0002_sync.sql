-- Synced records: one row per uid. `data` is the record as JSON (null once deleted);
-- `seq` is the server-wide change counter at the record's last write, for incremental pulls.
CREATE TABLE records (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq INTEGER NOT NULL
);
CREATE INDEX records_seq ON records (seq);

-- Known words: a union across devices, keeping the earliest first-seen time.
CREATE TABLE words (
  lemma TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX words_seq ON words (seq);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('seq', 0);
