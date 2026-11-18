import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  computeNeeds,
  diffDays,
  fmtMoney,
  subtractBought,
  vnToday,
  weekStart,
  type Food,
  type RecipeItem,
} from "../src/planner.ts";

const foods: Food[] = [
  { id: 1, name: "Thịt ba chỉ", kind: "ingredient", unit: "kg", price: 140000, category: "Thịt", servings: 1 },
  { id: 2, name: "Trứng vịt", kind: "ingredient", unit: "quả", price: 4000, category: "Trứng & sữa", servings: 1 },
  { id: 3, name: "Rau muống", kind: "ingredient", unit: "bó", price: 10000, category: "Rau củ", servings: 1 },
  { id: 10, name: "Thịt kho trứng", kind: "dish", servings: 4 },
  { id: 11, name: "Rau muống xào", kind: "dish", servings: 2 },
  { id: 12, name: "Phở (ăn ngoài)", kind: "dish", servings: 1 },
  { id: 20, name: "Cam", kind: "fruit", unit: "kg", price: 40000, servings: 1 },
  { id: 21, name: "Sinh tố bơ", kind: "drink", servings: 2 },
  { id: 4, name: "Bơ", kind: "ingredient", unit: "quả", price: 15000, servings: 1 },
  { id: 22, name: "Trà đá", kind: "drink", servings: 1 },
];
const recipes: RecipeItem[] = [
  { dish_id: 10, ingredient_id: 1, qty: 0.5 },
  { dish_id: 10, ingredient_id: 2, qty: 6 },
  { dish_id: 11, ingredient_id: 3, qty: 1 },
  { dish_id: 21, ingredient_id: 4, qty: 2 },
];

test("nhân định lượng theo khẩu phần và cộng dồn", () => {
  const needs = computeNeeds(foods, recipes, [
    { food_id: 10, servings: 4 },
    { food_id: 10, servings: 2 }, // nửa công thức
    { food_id: 11, servings: 2 },
    { food_id: 11, servings: 2 },
  ]);
  const thit = needs.find((n) => n.food_id === 1)!;
  assert.equal(thit.qty, 0.75);
  assert.equal(thit.est, 105000);
  assert.deepEqual(thit.for, ["Thịt kho trứng"]);
  assert.equal(needs.find((n) => n.food_id === 2)!.qty, 9);
  assert.equal(needs.find((n) => n.food_id === 3)!.qty, 2);
});

test("món không có công thức bị bỏ qua, trái cây có đơn vị thì mua chính nó", () => {
  const needs = computeNeeds(foods, recipes, [
    { food_id: 12, servings: 2 },
    { food_id: 20, servings: 1.5 },
    { food_id: 22, servings: 1 }, // đồ uống không đơn vị, không giá → không mua
  ]);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].name, "Cam");
  assert.equal(needs[0].qty, 1.5);
  assert.equal(needs[0].est, 60000);
  assert.equal(needs[0].category, "Trái cây");
});

test("đồ uống có công thức thì mua nguyên liệu", () => {
  const needs = computeNeeds(foods, recipes, [{ food_id: 21, servings: 1 }]);
  assert.deepEqual(needs.map((n) => [n.name, n.qty]), [["Bơ", 1]]);
});

test("trừ phần đã mua", () => {
  const needs = computeNeeds(foods, recipes, [{ food_id: 10, servings: 4 }]);
  const rest = subtractBought(needs, [
    { food_id: 2, qty: 6 },
    { food_id: 1, qty: 0.2 },
    { food_id: null, qty: 5 },
  ]);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].qty, 0.3);
  assert.equal(rest[0].est, 42000);
});

test("ngày tháng", () => {
  assert.equal(weekStart("2026-11-18"), "2026-11-16"); // Thứ 4 → Thứ 2
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Chủ nhật
  assert.equal(weekStart("2026-11-16"), "2026-11-16");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(diffDays("2026-11-16", "2026-11-23"), 7);
  assert.equal(vnToday(Date.parse("2026-11-18T18:00:00Z")), "2026-11-19");
});

test("định dạng tiền", () => {
  assert.equal(fmtMoney(120000), "120k");
  assert.equal(fmtMoney(1500), "1,5k");
  assert.equal(fmtMoney(1250000), "1,25tr");
  assert.equal(fmtMoney(null), "");
});
