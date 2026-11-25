import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, computeNeeds, diffDays, fmtMoney, makesCycle, subtractBought, vnToday, weekStart, type Food, type Part } from "../src/planner.ts";

const foods: Food[] = [
  { id: 1, name: "Bánh mì", kind: "dish", unit: "ổ", price: 15000, category: "Ăn sáng" },
  { id: 2, name: "Xôi gà", kind: "dish", unit: "gói", price: 25000 },
  { id: 3, name: "Cam", kind: "fruit", unit: "kg", price: 40000 },
  { id: 4, name: "Sữa chua", kind: "drink", unit: "hũ", price: 7000 },
  { id: 5, name: "Cơm quán", kind: "dish" },
];

test("cộng dồn số lượng, tính tiền ước tính", () => {
  const needs = computeNeeds(foods, [], [
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
  const [n] = computeNeeds(foods, [], [{ food_id: 5, servings: 1 }]);
  assert.equal(n.est, null);
  assert.equal(n.category, "Đồ ăn");
});

test("trừ phần đã mua", () => {
  const needs = computeNeeds(foods, [], [{ food_id: 1, servings: 3 }, { food_id: 2, servings: 1 }]);
  const rest = subtractBought(needs, [{ food_id: 2, qty: 1 }, { food_id: 1, qty: 1 }, { food_id: null, qty: 5 }]);
  assert.deepEqual(rest.map((n) => [n.name, n.qty, n.est]), [["Bánh mì", 2, 30000]]);
});

test("món có thành phần: tách ra mua thành phần, tách nhiều tầng", () => {
  const fs: Food[] = [
    { id: 10, name: "Phở bò", kind: "dish", unit: "tô" },
    { id: 11, name: "Bánh phở", kind: "dish", unit: "kg", price: 20000 },
    { id: 12, name: "Thịt bò", kind: "dish", unit: "kg", price: 300000 },
    { id: 13, name: "Nước dùng", kind: "dish", unit: "lít" },
    { id: 14, name: "Xương", kind: "dish", unit: "kg", price: 80000 },
    { id: 15, name: "Bò kho", kind: "dish", unit: "phần" },
  ];
  const parts: Part[] = [
    { food_id: 10, part_id: 11, qty: 0.2 },
    { food_id: 10, part_id: 12, qty: 0.1 },
    { food_id: 10, part_id: 13, qty: 0.5 },
    { food_id: 13, part_id: 14, qty: 0.4 },
    { food_id: 15, part_id: 12, qty: 0.2 },
  ];
  const needs = computeNeeds(fs, parts, [
    { food_id: 10, servings: 2 },
    { food_id: 15, servings: 1 },
    { food_id: 12, servings: 0.5 }, // mua thẳng thịt bò
  ]);
  const by = (id: number) => needs.find((n) => n.food_id === id)!;
  assert.equal(needs.find((n) => n.food_id === 10), undefined);
  assert.equal(needs.find((n) => n.food_id === 13), undefined);
  assert.equal(by(11).qty, 0.4);
  assert.equal(by(12).qty, 0.9);
  assert.equal(by(12).est, 270000);
  assert.deepEqual(by(12).for.sort(), ["Bò kho", "Phở bò"]);
  assert.equal(by(14).qty, 0.4);
});

test("vòng lặp thành phần không treo, phát hiện được khi lưu", () => {
  const fs: Food[] = [{ id: 1, name: "A", kind: "dish" }, { id: 2, name: "B", kind: "dish" }];
  const parts: Part[] = [{ food_id: 1, part_id: 2, qty: 1 }, { food_id: 2, part_id: 1, qty: 1 }];
  assert.ok(computeNeeds(fs, parts, [{ food_id: 1, servings: 1 }]).length > 0);
  const p: Part[] = [{ food_id: 2, part_id: 3, qty: 1 }];
  assert.equal(makesCycle(p, 1, [2]), false);
  assert.equal(makesCycle([...p, { food_id: 3, part_id: 1, qty: 1 }], 1, [2]), true);
  assert.equal(makesCycle([], 1, [1]), true);
});

test("ngày tháng", () => {
  assert.equal(weekStart("2026-11-18"), "2026-11-16");
  assert.equal(weekStart("2026-11-22"), "2026-11-16");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(diffDays("2026-11-16", "2026-11-23"), 7);
  assert.equal(vnToday(Date.parse("2026-11-18T18:00:00Z")), "2026-11-19");
});

test("định dạng tiền", () => {
  assert.equal(fmtMoney(120000), "120.000đ");
  assert.equal(fmtMoney(1550), "1.550đ");
  assert.equal(fmtMoney(1234567), "1.234.567đ");
});
