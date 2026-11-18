-- Chạy 1 lần khi tạo database (dán vào tab Console của D1 trên Cloudflare).

-- Thư viện: món ăn, trái cây, đồ uống, nguyên liệu.
CREATE TABLE IF NOT EXISTS foods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('dish', 'fruit', 'drink', 'ingredient')),
  emoji      TEXT,
  category   TEXT,                       -- nhóm: Rau củ, Thịt... hoặc Canh, Xào...
  unit       TEXT,                       -- đơn vị khi mua: kg, bó, quả...
  price      INTEGER,                    -- giá tham khảo (đồng / 1 đơn vị), tự cập nhật theo lần mua gần nhất
  servings   INTEGER NOT NULL DEFAULT 1, -- công thức này cho bao nhiêu khẩu phần
  place      TEXT,                       -- nơi hay mua
  note       TEXT,                       -- ghi chú / cách làm
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_name ON foods(name COLLATE NOCASE, kind);

-- Công thức: món (hoặc đồ uống tự pha) gồm những nguyên liệu nào, bao nhiêu.
CREATE TABLE IF NOT EXISTS recipe_items (
  dish_id       INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES foods(id),
  qty           REAL NOT NULL CHECK (qty >= 0), -- theo đơn vị của nguyên liệu
  PRIMARY KEY (dish_id, ingredient_id)
);

-- Thực đơn: ngày nào, bữa nào, ăn gì.
CREATE TABLE IF NOT EXISTS plan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,                              -- YYYY-MM-DD
  meal       TEXT NOT NULL CHECK (meal IN ('sang', 'trua', 'toi', 'phu')),
  food_id    INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  servings   REAL NOT NULL DEFAULT 1,                    -- món: số khẩu phần; còn lại: số lượng theo đơn vị
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan(date);

-- Danh sách đi chợ. Món đã mua giữ lại (cleared = 1 sau khi dọn) để thống kê chi tiêu.
CREATE TABLE IF NOT EXISTS shopping (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id    INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  qty        REAL,
  unit       TEXT,
  category   TEXT,
  note       TEXT,                       -- dùng cho món nào
  est        INTEGER,                    -- tiền ước tính
  price      INTEGER,                    -- tiền thực trả
  source     TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('plan', 'manual')),
  bought_at  TEXT,                       -- NULL = chưa mua
  cleared    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shopping_open ON shopping(cleared);
CREATE INDEX IF NOT EXISTS idx_shopping_bought ON shopping(bought_at);
