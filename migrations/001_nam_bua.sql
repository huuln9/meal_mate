CREATE TABLE plan_new (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, meal TEXT NOT NULL CHECK (meal IN ('sang','phu_sang','trua','phu','toi','phu_toi')), food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE, servings REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO plan_new (id, date, meal, food_id, servings, created_at) SELECT id, date, meal, food_id, servings, created_at FROM plan;
DROP TABLE plan;
ALTER TABLE plan_new RENAME TO plan;
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan(date);
