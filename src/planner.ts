// Logic thuần (không đụng DB): tính danh sách đi chợ từ thực đơn, ngày tháng, định dạng.

/** Loại món do người dùng tự quản lý (bảng kinds). Đây là bộ mặc định khi chưa chạy migration 008. */
export interface KindDef { key: string; label: string; color: string | null }
export const DEFAULT_KINDS: KindDef[] = [
  { key: "dish", label: "Đồ ăn", color: "#e8833a" },
  { key: "veg", label: "Rau củ", color: "#2f9e44" },
  { key: "fruit", label: "Trái cây", color: "#d9480f" },
  { key: "drink", label: "Đồ uống", color: "#1c7ed6" },
  { key: "sweet", label: "Đồ ngọt", color: "#d6336c" },
  { key: "ingredient", label: "Nguyên liệu", color: "#8d6e63" },
];

export const MEALS = ["sang", "phu_sang", "trua", "phu", "toi", "phu_toi"] as const;
export type Meal = (typeof MEALS)[number];
export const MEAL_LABEL: Record<Meal, string> = {
  sang: "Sáng", phu_sang: "Phụ sáng", trua: "Trưa", phu: "Phụ chiều", toi: "Tối", phu_toi: "Phụ tối",
};

export interface Food {
  id: number;
  name: string;
  kind: string;
  category?: string | null;
  unit?: string | null;
  price?: number | null;
}
/** Thành phần: 1 đơn vị của food_id gồm qty đơn vị của part_id. Món nào cũng có thể là thành phần của món khác. */
export interface Part { food_id: number; part_id: number; qty: number }
export interface PlanEntry { food_id: number; servings: number }
export interface Need {
  food_id: number;
  name: string;
  unit: string | null;
  category: string;
  qty: number;
  est: number | null;
  for: string[]; // cần cho những món nào trong thực đơn (khi được tách từ món có thành phần)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nhóm mặc định (khi món chưa có Nhóm) = tên loại. */
export function defaultCategory(kind: string, kinds: KindDef[] = DEFAULT_KINDS): string {
  return kinds.find((k) => k.key === kind)?.label ?? "Khác";
}

const MAX_DEPTH = 8;

function groupParts(parts: Part[]): Map<number, Part[]> {
  const m = new Map<number, Part[]>();
  for (const p of parts) m.set(p.food_id, [...(m.get(p.food_id) ?? []), p]);
  return m;
}

/**
 * Cộng dồn những thứ cần mua cho các bữa trong thực đơn.
 * - Món có thành phần: tách ra mua các thành phần (nhân theo số lượng), tách tiếp tới món không còn thành phần.
 * - Món không có thành phần: mua chính nó, số lượng = servings.
 */
export function computeNeeds(foods: Food[], parts: Part[], plan: PlanEntry[], kinds: KindDef[] = DEFAULT_KINDS): Need[] {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const partsOf = groupParts(parts.filter((p) => byId.has(p.part_id) && p.qty > 0));
  const acc = new Map<number, { qty: number; for: Set<string> }>();
  const expand = (id: number, qty: number, root: string, path: number[]) => {
    const ps = partsOf.get(id);
    if (ps?.length && !path.includes(id) && path.length < MAX_DEPTH) {
      for (const p of ps) expand(p.part_id, qty * p.qty, root, [...path, id]);
      return;
    }
    const a = acc.get(id) ?? { qty: 0, for: new Set<string>() };
    a.qty += qty;
    if (path.length) a.for.add(root);
    acc.set(id, a);
  };
  for (const p of plan) {
    const f = byId.get(p.food_id);
    if (f && p.servings > 0) expand(f.id, p.servings, f.name, []);
  }
  const out: Need[] = [];
  for (const [id, a] of acc) {
    const f = byId.get(id)!;
    const qty = round2(a.qty);
    if (!(qty > 0)) continue;
    out.push({
      food_id: id,
      name: f.name,
      unit: f.unit ?? null,
      category: f.category || defaultCategory(f.kind, kinds),
      qty,
      est: f.price != null ? Math.round(f.price * qty) : null,
      for: [...a.for],
    });
  }
  return out.sort((x, y) => x.category.localeCompare(y.category, "vi") || x.name.localeCompare(y.name, "vi"));
}

/** Gán thành phần newParts cho món id có tạo vòng lặp không (VD: A gồm B, B lại gồm A). */
export function makesCycle(parts: Part[], id: number, newParts: number[]): boolean {
  const partsOf = groupParts(parts.filter((p) => p.food_id !== id));
  const seen = new Set<number>();
  const stack = [...newParts];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === id) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const p of partsOf.get(x) ?? []) stack.push(p.part_id);
  }
  return false;
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

/** Hiện đúng số đồng, không làm tròn: 12345 → "12.345đ". */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "";
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ";
}
