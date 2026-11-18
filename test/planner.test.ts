import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, computeNeeds, diffDays, fmtMoney, subtractBought, vnToday, weekStart, type Food } from "../src/planner.ts";

const foods: Food[] = [
  { id: 1, name: "Bánh mì", kind: "dish", unit: "ổ", price: 15000, category: "Ăn sáng" },
  { id: 2, name: "Xôi gà", kind: "dish", unit: "gói", price: 25000 },
  { id: 3, name: "Cam", kind: "fruit", unit: "kg", price: 40000 },
  { id: 4, name: "Sữa chua", kind: "drink", unit: "hũ", price: 7000 },
  { id: 5, name: "Cơm quán", kind: "dish" },
];

test("cộng dồn số lượng, tính tiền ước tính", () => {
  const needs = computeNeeds(foods, [
    { food_id: 1, servings: 1 },
    { food_id: 1, servings: 2 },
    { food_id: 3, servings: 1.5 },
    { food_id: 4, servings: 2 },
    { food_id: 99, servings: 1 }, // món đã xoá
  ]);
  const banhMi = needs.find((n) => n.food_id === 1)!;
  assert.equal(banhMi.qty, 3);
  assert.equal(banhMi.est, 45000);
  assert.equal(banhMi.category, "Ăn sáng");
  assert.equal(needs.find((n) => n.food_id === 3)!.est, 60000);
  assert.equal(needs.find((n) => n.food_id === 4)!.category, "Đồ uống");
  assert.equal(needs.length, 3);
});

test("món không giá vẫn vào danh sách, nhóm mặc định theo loại", () => {
  const [n] = computeNeeds(foods, [{ food_id: 5, servings: 1 }]);
  assert.equal(n.est, null);
  assert.equal(n.category, "Đồ ăn");
});

test("trừ phần đã mua", () => {
  const needs = computeNeeds(foods, [{ food_id: 1, servings: 3 }, { food_id: 2, servings: 1 }]);
  const rest = subtractBought(needs, [{ food_id: 2, qty: 1 }, { food_id: 1, qty: 1 }, { food_id: null, qty: 5 }]);
  assert.deepEqual(rest.map((n) => [n.name, n.qty, n.est]), [["Bánh mì", 2, 30000]]);
});

test("ngày tháng", () => {
  assert.equal(weekStart("2026-11-18"), "2026-11-16");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(diffDays("2026-11-16", "2026-11-23"), 7);
  assert.equal(vnToday(Date.parse("2026-11-18T18:00:00Z")), "2026-11-19");
});

test("định dạng tiền", () => {
  assert.equal(fmtMoney(120000), "120k");
  assert.equal(fmtMoney(1500), "1,5k");
  assert.equal(fmtMoney(1250000), "1,25tr");
});
