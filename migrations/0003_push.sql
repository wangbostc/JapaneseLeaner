-- Web Push subscriptions, one per browser that turned reminders on.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Which (lesson, round) reminders have gone out, so each due review is pushed once.
CREATE TABLE push_sent (
  lesson_uid TEXT NOT NULL,
  round INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (lesson_uid, round)
);
