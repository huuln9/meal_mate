CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('dish','fruit','drink')), category TEXT, unit TEXT, price INTEGER, place TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_name ON foods(name COLLATE NOCASE, kind);
CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, meal TEXT NOT NULL CHECK (meal IN ('sang','phu_sang','trua','phu','toi','phu_toi')), food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE, servings REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan(date);
CREATE TABLE IF NOT EXISTS shopping (id INTEGER PRIMARY KEY AUTOINCREMENT, food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL, name TEXT NOT NULL, qty REAL, unit TEXT, category TEXT, note TEXT, est INTEGER, price INTEGER, source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('plan','manual')), bought_at TEXT, cleared INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_shopping_open ON shopping(cleared);
CREATE INDEX IF NOT EXISTS idx_shopping_bought ON shopping(bought_at);
CREATE TABLE IF NOT EXISTS food_images (food_id INTEGER PRIMARY KEY REFERENCES foods(id) ON DELETE CASCADE, mime TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
