// Logic thuần (không đụng DB): tính danh sách đi chợ từ thực đơn, ngày tháng, định dạng.

export const KINDS = ["dish", "fruit", "drink", "ingredient"] as const;
export type Kind = (typeof KINDS)[number];

export const MEALS = ["sang", "trua", "toi", "phu"] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABEL: Record<Meal, string> = { sang: "Sáng", trua: "Trưa", toi: "Tối", phu: "Phụ" };

export interface Food {
  id: number;
  name: string;
  kind: Kind;
  emoji?: string | null;
  category?: string | null;
  unit?: string | null;
  price?: number | null;
  servings: number;
}
export interface RecipeItem { dish_id: number; ingredient_id: number; qty: number }
export interface PlanEntry { food_id: number; servings: number }
export interface Need {
  food_id: number;
  name: string;
  unit: string | null;
  category: string;
  qty: number;
  est: number | null;
  for: string[]; // dùng cho những món nào
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function defaultCategory(kind: Kind): string {
  return kind === "fruit" ? "Trái cây" : kind === "drink" ? "Đồ uống" : "Khác";
}

/**
 * Cộng dồn nguyên liệu cần mua cho các bữa trong thực đơn.
 * - Món có công thức: nhân định lượng theo (khẩu phần trong thực đơn / khẩu phần của công thức).
 * - Nguyên liệu, hoặc trái cây / đồ uống có đơn vị hay giá, không có công thức: mua chính nó, số lượng = servings.
 * - Món ăn không có công thức (VD: ăn ngoài): bỏ qua.
 */
export function computeNeeds(foods: Food[], recipes: RecipeItem[], plan: PlanEntry[]): Need[] {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const rec = new Map<number, RecipeItem[]>();
  for (const r of recipes) {
    const list = rec.get(r.dish_id) ?? [];
    list.push(r);
    rec.set(r.dish_id, list);
  }
  const acc = new Map<number, { qty: number; for: Set<string> }>();
  const add = (id: number, qty: number, dish?: string) => {
    if (!(qty > 0)) return;
    const a = acc.get(id) ?? { qty: 0, for: new Set<string>() };
    a.qty += qty;
    if (dish) a.for.add(dish);
    acc.set(id, a);
  };
  for (const p of plan) {
    const f = byId.get(p.food_id);
    if (!f) continue;
    const rs = rec.get(f.id) ?? [];
    if (rs.length) {
      const k = p.servings / (f.servings || 1);
      for (const r of rs) add(r.ingredient_id, r.qty * k, f.name);
    } else if (f.kind === "ingredient" || (f.kind !== "dish" && (f.unit || f.price != null))) {
      // Trái cây / đồ uống chỉ mua khi đã khai báo đơn vị hoặc giá (VD: "Trà đá" thì không).
      add(f.id, p.servings);
    }
  }
  const out: Need[] = [];
  for (const [id, a] of acc) {
    const f = byId.get(id);
    if (!f) continue;
    const qty = round2(a.qty);
    out.push({
      food_id: id,
      name: f.name,
      unit: f.unit ?? null,
      category: f.category || defaultCategory(f.kind),
      qty,
      est: f.price != null ? Math.round(f.price * qty) : null,
      for: [...a.for],
    });
  }
  return out.sort((x, y) => x.category.localeCompare(y.category, "vi") || x.name.localeCompare(y.name, "vi"));
}

/** Trừ đi phần đã mua (chưa dọn) để tạo lại danh sách không bị mua trùng. */
export function subtractBought(needs: Need[], bought: { food_id: number | null; qty: number | null }[]): Need[] {
  const have = new Map<number, number>();
  for (const b of bought) {
    if (b.food_id == null || !b.qty) continue;
    have.set(b.food_id, (have.get(b.food_id) ?? 0) + b.qty);
  }
  const out: Need[] = [];
  for (const n of needs) {
    const h = have.get(n.food_id) ?? 0;
    if (!h) {
      out.push(n);
      continue;
    }
    const qty = round2(n.qty - h);
    if (qty <= 0) continue;
    out.push({ ...n, qty, est: n.est != null && n.qty ? Math.round((n.est * qty) / n.qty) : n.est });
  }
  return out;
}

// ---------- ngày tháng (giờ Việt Nam) ----------
export const vnToday = (now = Date.now()) => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);

export function addDays(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const diffDays = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

/** Thứ Hai của tuần chứa ngày d. */
export function weekStart(d: string): string {
  const day = new Date(d + "T00:00:00Z").getUTCDay();
  return addDays(d, -((day + 6) % 7));
}

const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
export function dayLabel(d: string): string {
  const t = new Date(d + "T00:00:00Z");
  return `${WEEKDAY[t.getUTCDay()]} ${d.slice(8)}/${d.slice(5, 7)}`;
}

// ---------- định dạng ----------
export const fmtQty = (n: number) => String(round2(n)).replace(".", ",");

/** 120000 → "120k", 1250000 → "1,25tr". */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "";
  if (Math.abs(v) >= 1e6) return fmtQty(Math.round(v / 1e4) / 100) + "tr";
  return fmtQty(Math.round(v / 100) / 10) + "k";
}
