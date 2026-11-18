import {
  KINDS,
  MEALS,
  MEAL_LABEL,
  addDays,
  computeNeeds,
  dayLabel,
  defaultCategory,
  diffDays,
  fmtMoney,
  fmtQty,
  subtractBought,
  vnToday,
  type Food,
  type Kind,
} from "./planner";
import { tgCall, verifyInitData, type TgUser } from "./telegram";

// Kiểu tối thiểu cho D1 (đủ dùng, khỏi cài thêm thư viện).
interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T = any>(): Promise<D1Result<T>>;
  first<T = any>(): Promise<T | null>;
  run(): Promise<{ meta: { last_row_id: number; changes: number } }>;
}
interface D1Database {
  prepare(sql: string): D1Stmt;
  batch(stmts: D1Stmt[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(req: Request): Promise<Response> };
  BOT_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  OWNER_IDS?: string; // ID Telegram được dùng app, VD: "123456789" hoặc "123,456"
  DEV_MODE?: string; // "1" chỉ dùng khi chạy local: bỏ qua xác thực
}

// ---------- tiện ích ----------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const owners = (env: Env) => (env.OWNER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function getUser(req: Request, env: Env): Promise<TgUser> {
  if (env.DEV_MODE === "1") return { id: Number(owners(env)[0] ?? 0), first_name: "Dev" };
  const user = await verifyInitData(req.headers.get("x-telegram-init-data") ?? "", env.BOT_TOKEN ?? "");
  if (!user) throw new HttpError(401, "Hãy mở app từ trong Telegram.");
  if (!owners(env).includes(String(user.id))) {
    throw new HttpError(403, `App riêng, bạn chưa có quyền. ID Telegram của bạn: ${user.id}`);
  }
  return user;
}

function str(v: unknown, max: number, label: string, required = false): string | null {
  const s = String(v ?? "").trim();
  if (required && !s) throw new HttpError(400, `Thiếu ${label.toLowerCase()}.`);
  if (s.length > max) throw new HttpError(400, `${label} tối đa ${max} ký tự.`);
  return s || null;
}

function num(
  v: unknown,
  label: string,
  o: { min?: number; max?: number; int?: boolean; required?: boolean } = {},
): number | null {
  if (v === null || v === undefined || v === "") {
    if (o.required) throw new HttpError(400, `Thiếu ${label.toLowerCase()}.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < (o.min ?? 0) || n > (o.max ?? 1e9) || (o.int && !Number.isInteger(n))) {
    throw new HttpError(400, `${label} không hợp lệ.`);
  }
  return n;
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function dateRange(from: unknown, to: unknown, maxDays = 62): [string, string] {
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, "Ngày không hợp lệ (YYYY-MM-DD).");
  const d = diffDays(from, to);
  if (d < 0 || d > maxDays) throw new HttpError(400, `Khoảng ngày phải từ 1 đến ${maxDays + 1} ngày.`);
  return [from, to];
}

const FOOD_COLS = "id, name, kind, category, unit, price, place, note";

async function loadFoods(db: D1Database) {
  const f = await db.prepare(`SELECT ${FOOD_COLS} FROM foods ORDER BY name`).all<Food & { place: string; note: string }>();
  // "ingredient" là loại cũ (trước khi đơn giản hoá), coi như Đồ ăn.
  return { foods: f.results.map((x) => (x.kind === "ingredient" ? { ...x, kind: "dish" } : x)) };
}

/** Phiên bản ảnh của từng món: { food_id: updated_at }. Trống nếu chưa chạy migration 002. */
async function imageVersions(db: D1Database): Promise<Record<number, string>> {
  try {
    const r = await db.prepare("SELECT food_id, updated_at FROM food_images").all<{ food_id: number; updated_at: string }>();
    return Object.fromEntries(r.results.map((x) => [x.food_id, x.updated_at]));
  } catch {
    return {};
  }
}

const IMG_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMG_MAX_BYTES = 300 * 1024;

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ảnh món ăn: không cần đăng nhập (thẻ <img> không gửi kèm header được), cache lâu vì URL có ?v=. */
async function serveImage(db: D1Database, id: number): Promise<Response> {
  let row: { mime: string; data: string } | null = null;
  try {
    row = await db.prepare("SELECT mime, data FROM food_images WHERE food_id = ?").bind(id).first();
  } catch {}
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(b64ToBytes(row.data), {
    headers: { "content-type": row.mime, "cache-control": "public, max-age=31536000, immutable" },
  });
}

// ---------- thư viện món ----------
async function saveFood(db: D1Database, body: any, id: number | null) {
  const kind = body?.kind as Kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, "Loại không hợp lệ.");
  const f = {
    name: str(body.name, 60, "Tên", true)!,
    category: str(body.category, 30, "Nhóm"),
    unit: str(body.unit, 15, "Đơn vị"),
    price: num(body.price, "Giá", { max: 1e8, int: true }),
    place: str(body.place, 60, "Nơi mua"),
    note: str(body.note, 1000, "Ghi chú"),
  };
  const dup = await db
    .prepare("SELECT id FROM foods WHERE name = ? COLLATE NOCASE AND kind = ? AND id <> ?")
    .bind(f.name, kind, id ?? 0)
    .first();
  if (dup) throw new HttpError(409, `Đã có "${f.name}" trong thư viện.`);

  if (id) {
    const r = await db
      .prepare("UPDATE foods SET name = ?, kind = ?, category = ?, unit = ?, price = ?, place = ?, note = ? WHERE id = ?")
      .bind(f.name, kind, f.category, f.unit, f.price, f.place, f.note, id)
      .run();
    if (!r.meta.changes) throw new HttpError(404, "Không tìm thấy.");
  } else {
    const r = await db
      .prepare("INSERT INTO foods (name, kind, category, unit, price, place, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(f.name, kind, f.category, f.unit, f.price, f.place, f.note)
      .run();
    id = r.meta.last_row_id;
  }
  return db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE id = ?`).bind(id).first();
}

// ---------- đi chợ ----------
interface ShopRow {
  id: number; food_id: number | null; name: string; qty: number | null; unit: string | null; category: string | null;
  note: string | null; est: number | null; price: number | null; source: string; bought_at: string | null;
}
const openShopping = (db: D1Database) =>
  db
    .prepare(
      "SELECT id, food_id, name, qty, unit, category, note, est, price, source, bought_at FROM shopping " +
        "WHERE cleared = 0 ORDER BY bought_at IS NOT NULL, category, name",
    )
    .all<ShopRow>()
    .then((r) => r.results);

async function generateShopping(db: D1Database, from: string, to: string) {
  const [{ foods }, plan, bought] = await Promise.all([
    loadFoods(db),
    db.prepare("SELECT food_id, servings FROM plan WHERE date BETWEEN ? AND ?").bind(from, to).all<any>(),
    db
      .prepare("SELECT food_id, qty FROM shopping WHERE cleared = 0 AND bought_at IS NOT NULL AND source = 'plan'")
      .all<any>(),
  ]);
  const needs = subtractBought(computeNeeds(foods, plan.results), bought.results);
  const rows = needs.map((n) => ({
    f: n.food_id, n: n.name, q: n.qty, u: n.unit, c: n.category, o: null, e: n.est,
  }));
  await db.batch([
    db.prepare("DELETE FROM shopping WHERE cleared = 0 AND bought_at IS NULL AND source = 'plan'"),
    db
      .prepare(
        "INSERT INTO shopping (food_id, name, qty, unit, category, note, est, source) SELECT " +
          "json_extract(value, '$.f'), json_extract(value, '$.n'), json_extract(value, '$.q'), json_extract(value, '$.u'), " +
          "json_extract(value, '$.c'), json_extract(value, '$.o'), json_extract(value, '$.e'), 'plan' FROM json_each(?)",
      )
      .bind(JSON.stringify(rows)),
  ]);
  return { added: rows.length, planned: plan.results.length };
}

// ---------- tin nhắn bot ----------
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function menuText(db: D1Database, date: string, title: string): Promise<string> {
  const rows = (
    await db
      .prepare(
        "SELECT p.meal, p.servings, f.name, f.unit FROM plan p " +
          "JOIN foods f ON f.id = p.food_id WHERE p.date = ? ORDER BY p.id",
      )
      .bind(date)
      .all<any>()
  ).results;
  const head = `🍽 <b>${title}</b> (${dayLabel(date)})`;
  if (!rows.length) return `${head}\nChưa lên thực đơn.`;
  const lines = MEALS.filter((m) => rows.some((r) => r.meal === m)).map((m) => {
    const items = rows
      .filter((r) => r.meal === m)
      .map((r) => {
        const extra = r.unit || r.servings !== 1 ? ` ${fmtQty(r.servings)}${r.unit ? " " + r.unit : ""}` : "";
        return `${escapeHtml(r.name)}${extra}`;
      });
    return `<b>${MEAL_LABEL[m as keyof typeof MEAL_LABEL]}:</b> ${items.join(", ")}`;
  });
  return [head, ...lines].join("\n");
}

async function shoppingText(db: D1Database): Promise<string> {
  const rows = await openShopping(db);
  const todo = rows.filter((r) => !r.bought_at);
  if (!todo.length) return rows.length ? "🛒 Đã mua đủ hết rồi!" : "🛒 Danh sách đi chợ đang trống.";
  const groups = new Map<string, ShopRow[]>();
  for (const r of todo) {
    const c = r.category || "Khác";
    groups.set(c, [...(groups.get(c) ?? []), r]);
  }
  const est = todo.reduce((s, r) => s + (r.est ?? 0), 0);
  const lines = [`🛒 <b>ĐI CHỢ</b> — ${todo.length} món${est ? `, ước tính ~${fmtMoney(est)}` : ""}`];
  for (const [c, list] of groups) {
    lines.push("", `<b>${escapeHtml(c)}</b>`);
    for (const r of list) {
      const q = r.qty ? ` — ${fmtQty(r.qty)}${r.unit ? " " + escapeHtml(r.unit) : ""}` : "";
      lines.push(`☐ ${escapeHtml(r.name)}${q}${r.est ? ` (~${fmtMoney(r.est)})` : ""}`);
    }
  }
  const done = rows.length - todo.length;
  if (done) lines.push("", `✅ Đã mua ${done} món`);
  return lines.join("\n");
}

const openAppButton = (origin: string, text = "Mở Meal Mate") => ({
  inline_keyboard: [[{ text, web_app: { url: origin + "/" } }]],
});

// ---------- API ----------
async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  const user = await getUser(req, env);
  const db = env.DB;
  const body = method === "POST" || method === "PUT" ? await req.json().catch(() => ({})) : null;
  const q = url.searchParams;
  let m: RegExpMatchArray | null;

  if (path === "/api/me" && method === "GET") return json({ user, today: vnToday() });

  // --- thư viện ---
  if (path === "/api/foods" && method === "GET") {
    const [data, img] = await Promise.all([loadFoods(db), imageVersions(db)]);
    return json({ ...data, foods: data.foods.map((f) => ({ ...f, img_v: img[f.id] ?? null })) });
  }
  if ((m = path.match(/^\/api\/foods\/(\d+)\/image$/))) {
    const id = Number(m[1]);
    const exists = await db.prepare("SELECT id FROM foods WHERE id = ?").bind(id).first();
    if (!exists) throw new HttpError(404, "Không tìm thấy món.");
    if (method === "POST") {
      const match = String(body?.data ?? "").match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || !IMG_TYPES.includes(match[1])) throw new HttpError(400, "Ảnh phải là JPG, PNG hoặc WebP.");
      if (match[2].length * 0.75 > IMG_MAX_BYTES) throw new HttpError(400, "Ảnh quá lớn (tối đa 300 KB).");
      try {
        await db
          .prepare(
            "INSERT INTO food_images (food_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now')) " +
              "ON CONFLICT(food_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
          )
          .bind(id, match[1], match[2])
          .run();
      } catch (e) {
        if (String(e).includes("no such table")) {
          throw new HttpError(500, "Chưa tạo bảng food_images. Chạy migrations/002_anh_mon.sql trên D1 trước.");
        }
        throw e;
      }
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM food_images WHERE food_id = ?").bind(id).run().catch(() => {});
      return json({ ok: true });
    }
  }
  if (path === "/api/foods" && method === "POST") return json(await saveFood(db, body, null), 201);
  if ((m = path.match(/^\/api\/foods\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "PUT") return json(await saveFood(db, body, id));
    if (method === "DELETE") {
      await db.prepare("DELETE FROM foods WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // --- thực đơn ---
  if (path === "/api/plan" && method === "GET") {
    const [from, to] = dateRange(q.get("from"), q.get("to"));
    const r = await db
      .prepare("SELECT id, date, meal, food_id, servings FROM plan WHERE date BETWEEN ? AND ? ORDER BY date, id")
      .bind(from, to)
      .all();
    return json(r.results);
  }
  if (path === "/api/plan" && method === "POST") {
    if (!isDate(body?.date)) throw new HttpError(400, "Ngày không hợp lệ.");
    if (!MEALS.includes(body.meal)) throw new HttpError(400, "Bữa không hợp lệ.");
    const food = await db.prepare("SELECT id FROM foods WHERE id = ?").bind(body.food_id).first();
    if (!food) throw new HttpError(404, "Không tìm thấy món.");
    const servings = num(body.servings, "Số lượng", { min: 0.01, max: 1000 }) ?? 1;
    const r = await db
      .prepare("INSERT INTO plan (date, meal, food_id, servings) VALUES (?, ?, ?, ?)")
      .bind(body.date, body.meal, body.food_id, servings)
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (path === "/api/plan/copy" && method === "POST") {
    // Chép các bữa trong [from, from + days - 1] sang ngày bắt đầu `to`.
    const days = num(body?.days, "Số ngày", { min: 1, max: 31, int: true, required: true })!;
    if (!isDate(body.from) || !isDate(body.to)) throw new HttpError(400, "Ngày không hợp lệ.");
    const offset = diffDays(body.from, body.to);
    if (!offset) throw new HttpError(400, "Ngày nguồn và đích trùng nhau.");
    const r = await db
      .prepare(
        "INSERT INTO plan (date, meal, food_id, servings) " +
          "SELECT date(date, ?), meal, food_id, servings FROM plan WHERE date BETWEEN ? AND ? ORDER BY date, id",
      )
      .bind(`${offset >= 0 ? "+" : ""}${offset} days`, body.from, addDays(body.from, days - 1))
      .run();
    return json({ copied: r.meta.changes });
  }
  if ((m = path.match(/^\/api\/plan\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "PUT") {
      const servings = num(body?.servings, "Số lượng", { min: 0.01, max: 1000, required: true });
      if (body.meal != null && !MEALS.includes(body.meal)) throw new HttpError(400, "Bữa không hợp lệ.");
      if (body.date != null && !isDate(body.date)) throw new HttpError(400, "Ngày không hợp lệ.");
      await db
        .prepare("UPDATE plan SET servings = ?, meal = COALESCE(?, meal), date = COALESCE(?, date) WHERE id = ?")
        .bind(servings, body.meal ?? null, body.date ?? null, id)
        .run();
      return json({ id });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM plan WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }
  if (path === "/api/suggest" && method === "GET") {
    // Món chưa ăn trong khoảng ±3 ngày, chọn ngẫu nhiên.
    const date = isDate(q.get("date")) ? q.get("date")! : vnToday();
    const r = await db
      .prepare(
        "SELECT id FROM foods WHERE id NOT IN " +
          "(SELECT food_id FROM plan WHERE date BETWEEN ? AND ?) ORDER BY random() LIMIT 4",
      )
      .bind(addDays(date, -3), addDays(date, 3))
      .all<{ id: number }>();
    return json(r.results.map((x) => x.id));
  }

  // --- đi chợ ---
  if (path === "/api/shopping" && method === "GET") return json(await openShopping(db));
  if (path === "/api/shopping/generate" && method === "POST") {
    const [from, to] = dateRange(body?.from, body?.to, 30);
    return json(await generateShopping(db, from, to));
  }
  if (path === "/api/shopping" && method === "POST") {
    const name = str(body?.name, 60, "Tên", true)!;
    const qty = num(String(body?.qty ?? "").replace(",", "."), "Số lượng", { max: 100000 });
    const food = await db
      .prepare(
        "SELECT id, kind, unit, category, price FROM foods WHERE name = ? COLLATE NOCASE LIMIT 1",
      )
      .bind(name)
      .first<Food>();
    const unit = str(body?.unit, 15, "Đơn vị") ?? food?.unit ?? null;
    const est = food?.price != null && qty ? Math.round(food.price * qty) : null;
    const r = await db
      .prepare("INSERT INTO shopping (food_id, name, qty, unit, category, est, source) VALUES (?, ?, ?, ?, ?, ?, 'manual')")
      .bind(food?.id ?? null, name, qty, unit, food ? food.category || defaultCategory(food.kind) : null, est)
      .run();
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (path === "/api/shopping/clear" && method === "POST") {
    const r = await db.prepare("UPDATE shopping SET cleared = 1 WHERE cleared = 0 AND bought_at IS NOT NULL").run();
    return json({ cleared: r.meta.changes });
  }
  if (path === "/api/shopping/reset" && method === "POST") {
    const r = await db.prepare("DELETE FROM shopping WHERE cleared = 0 AND bought_at IS NULL").run();
    return json({ deleted: r.meta.changes });
  }
  if (path === "/api/shopping/send" && method === "POST") {
    if (!env.BOT_TOKEN) throw new HttpError(500, "Thiếu BOT_TOKEN.");
    const res = await tgCall(env.BOT_TOKEN, "sendMessage", {
      chat_id: user.id, parse_mode: "HTML", text: await shoppingText(db),
    });
    if (!res.ok) throw new HttpError(502, "Bot chưa gửi được: " + (res.description ?? ""));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/shopping\/(\d+)$/))) {
    const id = Number(m[1]);
    const row = await db.prepare("SELECT food_id, qty, est, price FROM shopping WHERE id = ?").bind(id).first<ShopRow>();
    if (!row) throw new HttpError(404, "Không tìm thấy.");
    if (method === "PUT") {
      const qty = body?.qty !== undefined ? num(String(body.qty ?? "").replace(",", "."), "Số lượng", { max: 100000 }) : row.qty;
      let price = body?.price !== undefined ? num(body.price, "Giá", { max: 1e9, int: true }) : row.price;
      let boughtSql = "bought_at";
      if (body?.bought === true) {
        boughtSql = "COALESCE(bought_at, datetime('now'))";
        price ??= row.est;
      } else if (body?.bought === false) {
        boughtSql = "NULL";
      }
      await db
        .prepare(`UPDATE shopping SET qty = ?, price = ?, bought_at = ${boughtSql} WHERE id = ?`)
        .bind(qty, price, id)
        .run();
      // Giá tham khảo của món tự cập nhật theo giá mua thực tế.
      if (body?.price != null && price && qty && row.food_id) {
        await db.prepare("UPDATE foods SET price = ? WHERE id = ?").bind(Math.round(price / qty), row.food_id).run();
      }
      return json({ id });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM shopping WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  // --- chi tiêu ---
  if (path === "/api/stats" && method === "GET") {
    const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : vnToday().slice(0, 7);
    const vn = "substr(datetime(bought_at, '+7 hours'), 1, 7)";
    const paid = "bought_at IS NOT NULL AND price IS NOT NULL";
    const [months, cats, top] = await Promise.all([
      db.prepare(`SELECT ${vn} AS month, SUM(price) AS total, COUNT(*) AS n FROM shopping WHERE ${paid} GROUP BY month ORDER BY month DESC LIMIT 12`).all(),
      db.prepare(`SELECT COALESCE(category, 'Khác') AS category, SUM(price) AS total FROM shopping WHERE ${paid} AND ${vn} = ? GROUP BY 1 ORDER BY 2 DESC`).bind(month).all(),
      db.prepare(`SELECT name, unit, SUM(qty) AS qty, SUM(price) AS total, COUNT(*) AS n FROM shopping WHERE ${paid} AND ${vn} = ? GROUP BY name, unit ORDER BY total DESC LIMIT 10`).bind(month).all(),
    ]);
    return json({ month, months: months.results, categories: cats.results, top: top.results });
  }

  // --- sao lưu ---
  if (path === "/api/export" && method === "GET") return json(await exportAll(db));
  if (path === "/api/export/send" && method === "POST") {
    if (!env.BOT_TOKEN) throw new HttpError(500, "Thiếu BOT_TOKEN.");
    const data = await exportAll(db);
    const form = new FormData();
    form.append("chat_id", String(user.id));
    form.append("caption", `📦 Sao lưu Meal Mate — ${data.foods.length} món, ${data.plan.length} bữa`);
    form.append(
      "document",
      new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }),
      `meal-mate-${vnToday()}.json`,
    );
    const res: any = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`, {
      method: "POST", body: form,
    }).then((r) => r.json());
    if (!res.ok) throw new HttpError(502, "Bot chưa gửi được: " + (res.description ?? ""));
    return json({ ok: true });
  }
  if (path === "/api/import" && method === "POST") {
    const arr = (k: string) => {
      if (!Array.isArray(body?.[k])) throw new HttpError(400, `File sao lưu thiếu "${k}".`);
      return JSON.stringify(body[k]);
    };
    const [foods, plan, shopping] = [arr("foods"), arr("plan"), arr("shopping")];
    const x = (f: string) => `json_extract(value, '$.${f}')`;
    await db.batch([
      db.prepare("DELETE FROM shopping"),
      db.prepare("DELETE FROM plan"),
      db.prepare("DELETE FROM foods"),
      db.prepare(
        "INSERT INTO foods (id, name, kind, category, unit, price, place, note) SELECT " +
          `${x("id")}, ${x("name")}, CASE ${x("kind")} WHEN 'ingredient' THEN 'dish' ELSE ${x("kind")} END, ` +
          ["category", "unit", "price", "place", "note"].map(x).join(", ") + " FROM json_each(?)",
      ).bind(foods),
      db.prepare(
        `INSERT INTO plan (id, date, meal, food_id, servings) SELECT ${["id", "date", "meal", "food_id", "servings"].map(x).join(", ")} FROM json_each(?)`,
      ).bind(plan),
      db.prepare(
        "INSERT INTO shopping (id, food_id, name, qty, unit, category, note, est, price, source, bought_at, cleared, created_at) SELECT " +
          ["id", "food_id", "name", "qty", "unit", "category", "note", "est", "price", "source", "bought_at", "cleared"].map(x).join(", ") +
          `, COALESCE(${x("created_at")}, datetime('now')) FROM json_each(?)`,
      ).bind(shopping),
    ]);
    return json({ ok: true, foods: body.foods.length, plan: body.plan.length });
  }

  throw new HttpError(404, "Không có API này.");
}

async function exportAll(db: D1Database) {
  const [{ foods }, plan, shopping] = await Promise.all([
    loadFoods(db),
    db.prepare("SELECT id, date, meal, food_id, servings FROM plan ORDER BY date, id").all(),
    db.prepare("SELECT * FROM shopping ORDER BY id").all(),
  ]);
  return { app: "meal-mate", exported_at: new Date().toISOString(), foods, plan: plan.results, shopping: shopping.results };
}

// ---------- bot ----------
async function bot(req: Request, env: Env, url: URL): Promise<Response> {
  const token = env.BOT_TOKEN;
  if (!token) return new Response("Thiếu BOT_TOKEN", { status: 500 });

  // Mở 1 lần trên trình duyệt: https://<worker>/bot/setup?key=<WEBHOOK_SECRET>
  if (url.pathname === "/bot/setup") {
    if (!env.WEBHOOK_SECRET || url.searchParams.get("key") !== env.WEBHOOK_SECRET) {
      return new Response("Sai key", { status: 403 });
    }
    return json({
      setWebhook: await tgCall(token, "setWebhook", {
        url: url.origin + "/bot/webhook", secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message"],
      }),
      setChatMenuButton: await tgCall(token, "setChatMenuButton", {
        menu_button: { type: "web_app", text: "Meal Mate", web_app: { url: url.origin + "/" } },
      }),
      setMyCommands: await tgCall(token, "setMyCommands", {
        commands: [
          { command: "homnay", description: "Thực đơn hôm nay" },
          { command: "mai", description: "Thực đơn ngày mai" },
          { command: "dicho", description: "Danh sách đi chợ" },
          { command: "start", description: "Mở app" },
        ],
      }),
    });
  }

  if (url.pathname === "/bot/webhook" && req.method === "POST") {
    if (req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update: any = await req.json().catch(() => ({}));
    const msg = update.message;
    const chatId = msg?.chat?.id;
    const fromId = String(msg?.from?.id ?? "");
    if (!chatId || msg.chat.type !== "private") return new Response("ok");
    const send = (text: string, extra: object = {}) =>
      tgCall(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text, ...extra });

    if (!owners(env).includes(fromId)) {
      await send(`Đây là app riêng. ID Telegram của bạn: <code>${fromId}</code>`);
      return new Response("ok");
    }
    const cmd = String(msg.text ?? "").split(/[\s@]/)[0];
    const today = vnToday();
    if (cmd === "/homnay") await send(await menuText(env.DB, today, "Hôm nay"));
    else if (cmd === "/mai") await send(await menuText(env.DB, addDays(today, 1), "Ngày mai"));
    else if (cmd === "/dicho") await send(await shoppingText(env.DB), { reply_markup: openAppButton(url.origin, "Mở danh sách") });
    else await send("🍽 <b>Meal Mate</b>\n/homnay · /mai · /dicho", { reply_markup: openAppButton(url.origin) });
    return new Response("ok");
  }

  return new Response("Not found", { status: 404 });
}

/** Chạy theo lịch (wrangler.toml → triggers.crons): nhắc thực đơn ngày mai. */
async function remind(env: Env) {
  if (!env.BOT_TOKEN) return;
  const tomorrow = addDays(vnToday(), 1);
  let text = await menuText(env.DB, tomorrow, "Ngày mai ăn gì");
  const todo = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM shopping WHERE cleared = 0 AND bought_at IS NULL")
    .first<{ n: number }>();
  if (todo?.n) text += `\n\n🛒 Còn ${todo.n} món chưa mua — /dicho`;
  for (const id of owners(env)) {
    await tgCall(env.BOT_TOKEN, "sendMessage", { chat_id: id, parse_mode: "HTML", text });
  }
}

// ---------- entry ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      const img = url.pathname.match(/^\/api\/img\/(\d+)$/);
      if (img && req.method === "GET") return await serveImage(env.DB, Number(img[1]));
      if (url.pathname.startsWith("/api/")) return await api(req, env, url);
      if (url.pathname.startsWith("/bot/")) return await bot(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = String((e as Error).message ?? e);
      if (msg.includes("FOREIGN KEY")) return json({ error: "Dữ liệu đang được dùng ở chỗ khác." }, 409);
      if (msg.includes("UNIQUE")) return json({ error: "Bị trùng tên." }, 409);
      console.error(e);
      return json({ error: "Lỗi máy chủ: " + msg }, 500);
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await remind(env);
  },
};
