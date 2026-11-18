"use strict";

// ---------- Telegram ----------
const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;
if (tg) {
  tg.ready();
  tg.expand();
  if (inTelegram) document.documentElement.classList.add("tg");
  const mobile = ["android", "ios"].includes(tg.platform);
  if (mobile && tg.isVersionAtLeast?.("8.0") && !tg.isFullscreen) {
    try { tg.requestFullscreen(); } catch {}
  }
  const applyInsets = () => {
    const s = tg.safeAreaInset || {};
    const c = tg.contentSafeAreaInset || {};
    const top = (s.top || 0) + (c.top || 0);
    const bottom = (s.bottom || 0) + (c.bottom || 0);
    document.body.style.paddingTop =
      top > 0 ? top + "px" : tg.isFullscreen ? "calc(env(safe-area-inset-top, 44px) + 56px)" : "";
    document.body.style.paddingBottom = 24 + bottom + "px";
  };
  applyInsets();
  ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"].forEach((ev) => {
    try { tg.onEvent(ev, applyInsets); } catch {}
  });
}

// ---------- hằng số ----------
const KIND = {
  dish: { label: "Món ăn" },
  fruit: { label: "Trái cây" },
  drink: { label: "Đồ uống" },
  ingredient: { label: "Nguyên liệu" },
};
const MEALS = [["sang", "Sáng"], ["phu_sang", "Phụ sáng"], ["trua", "Trưa"], ["phu", "Phụ chiều"], ["toi", "Tối"], ["phu_toi", "Phụ tối"]];
const UNITS = [
  "kg", "g", "lạng", "lít", "ml",
  "cái", "ổ", "quả", "trái", "củ", "bó", "cây", "nhánh", "tép", "con", "miếng", "lát", "khứa", "nải", "buồng",
  "hộp", "gói", "bịch", "túi", "chai", "lon", "vỉ", "khay", "hũ", "thùng",
  "chén", "tô", "ly", "muỗng", "thìa", "phần", "suất",
];
const CAT_BUY = ["Rau củ", "Thịt", "Cá & hải sản", "Trứng & sữa", "Đồ khô", "Gia vị", "Trái cây", "Đồ uống", "Khác"];
const CAT_DISH = ["Món mặn", "Canh", "Xào", "Rau", "Ăn sáng", "Món chay", "Lẩu", "Tráng miệng"];
const WEEKDAY = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

// ---------- tiện ích ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const round2 = (n) => Math.round(n * 100) / 100;
const fmtQty = (n) => String(round2(n)).replace(".", ",");
const fmtMoney = (v) =>
  v == null ? "" : Math.abs(v) >= 1e6 ? fmtQty(Math.round(v / 1e4) / 100) + "tr" : fmtQty(Math.round(v / 100) / 10) + "k";
/** "0,5" → 0.5; "" → null */
const parseNum = (s) => {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
/** Nhập theo nghìn đồng: "120" → 120000 */
const parseK = (s) => {
  const n = parseNum(s);
  return n == null || Number.isNaN(n) ? n : Math.round(n * 1000);
};
const toK = (v) => (v == null ? "" : fmtQty(v / 1000));

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (d, n) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const weekStart = (d) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const dayName = (d) => `${WEEKDAY[new Date(d + "T00:00:00Z").getUTCDay()]} · ${dm(d)}`;
const mealLabel = (m) => MEALS.find((x) => x[0] === m)?.[1] ?? m;
const addMonths = (ym, n) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};

const state = {
  foods: [],
  byId: new Map(),
  recipes: new Map(), // dish_id → [{ingredient_id, qty}]
  week: weekStart(todayStr()),
  plan: [],
  shop: [],
  libKind: "all",
  month: todayStr().slice(0, 7),
};

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", "x-telegram-init-data": tg?.initData ?? "", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}
const fail = (e) => toast("⚠️ " + e.message);

function confirmBox(msg) {
  return new Promise((resolve) => {
    if (inTelegram && tg.showConfirm) tg.showConfirm(msg, resolve);
    else resolve(window.confirm(msg));
  });
}

function haptic(type = "success") {
  try { tg?.HapticFeedback?.notificationOccurred(type); } catch {}
}
function tap() {
  try { tg?.HapticFeedback?.selectionChanged(); } catch {}
}

/** Chạy hàm async khi bấm nút, khoá nút trong lúc chờ. */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { fail(e); } finally { if (btn) btn.disabled = false; }
}

// ---------- sheet (bảng trượt từ dưới lên) ----------
function openSheet(html) {
  $("#sheet").innerHTML = html;
  $("#sheet-bg").hidden = false;
  document.body.classList.add("noscroll");
  try { tg?.BackButton?.show(); } catch {}
  return $("#sheet");
}
function closeSheet() {
  $("#sheet-bg").hidden = true;
  $("#sheet").innerHTML = "";
  document.body.classList.remove("noscroll");
  try { tg?.BackButton?.hide(); } catch {}
}
$("#sheet-bg").addEventListener("click", (e) => {
  if (e.target.id === "sheet-bg" || e.target.closest("[data-close]")) closeSheet();
});
try { tg?.BackButton?.onClick(closeSheet); } catch {}
const sheetHead = (title) => `<div class="sh-h"><b>${title}</b><button type="button" class="x" data-close>✕</button></div>`;

// ---------- thư viện (dữ liệu dùng chung) ----------
async function loadFoods() {
  const { foods, recipes } = await api("/api/foods");
  state.foods = foods;
  state.byId = new Map(foods.map((f) => [f.id, f]));
  state.recipes = new Map();
  for (const r of recipes) {
    if (!state.recipes.has(r.dish_id)) state.recipes.set(r.dish_id, []);
    state.recipes.get(r.dish_id).push(r);
  }
  const opts = (arr) => arr.map((v) => `<option value="${esc(v)}">`).join("");
  const cats = (kinds, base) =>
    [...new Set([...base, ...foods.filter((f) => kinds.includes(f.kind) && f.category).map((f) => f.category)])];
  $("#dl-units").innerHTML = opts([...new Set([...UNITS, ...foods.map((f) => f.unit).filter(Boolean)])]);
  $("#dl-cat-buy").innerHTML = opts(cats(["ingredient", "fruit", "drink"], CAT_BUY));
  $("#dl-cat-dish").innerHTML = opts(cats(["dish"], CAT_DISH));
  $("#dl-ing").innerHTML = opts(foods.filter((f) => f.kind !== "dish").map((f) => f.name));
  $("#dl-buy").innerHTML = $("#dl-ing").innerHTML;
}
/** Ảnh của món, chưa có ảnh thì hiện chữ cái đầu trên nền màu theo loại. */
const initial = (name) => ([...String(name ?? "").trim()][0] ?? "?").toUpperCase();
const imgUrl = (f) => `/api/img/${f.id}?v=${encodeURIComponent(f.img_v)}`;
function foodIcon(f) {
  if (!f) return "";
  return f.img_v
    ? `<img class="fi" src="${imgUrl(f)}" alt="" loading="lazy" />`
    : `<span class="fi fl k-${f.kind}">${esc(initial(f.name))}</span>`;
}

/** Cắt ảnh vuông ở giữa, thu nhỏ còn size×size, nén JPEG. */
async function resizeImage(file, size = 320) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Không đọc được ảnh này."));
      i.src = url;
    });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- tabs ----------
let currentTab = "plan";
function showTab(name) {
  currentTab = name;
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $$("main > section").forEach((s) => (s.hidden = s.id !== "tab-" + name));
  if (name === "plan") loadPlan().catch(fail);
  if (name === "shop") loadShop().catch(fail);
  if (name === "lib") renderLib();
  if (name === "stats") loadStats().catch(fail);
}
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) showTab(b.dataset.tab);
});
const rerender = () => showTab(currentTab);

// =====================================================================
// THỰC ĐƠN
// =====================================================================
async function loadPlan() {
  state.plan = await api(`/api/plan?from=${state.week}&to=${addDays(state.week, 6)}`);
  renderPlan();
}

function planChip(p) {
  const f = state.byId.get(p.food_id);
  if (!f) return "";
  const extra =
    f.kind === "dish"
      ? p.servings !== f.servings ? ` <small>×${fmtQty(p.servings)}</small>` : ""
      : ` <small>${fmtQty(p.servings)}${f.unit ? " " + esc(f.unit) : ""}</small>`;
  return `<button class="chip k-${f.kind}" data-plan="${p.id}">${foodIcon(f)}${esc(f.name)}${extra}</button>`;
}

function renderPlan() {
  const today = todayStr();
  const isThisWeek = state.week === weekStart(today);
  $("#w-label").textContent = `${isThisWeek ? "Tuần này" : "Tuần"} ${dm(state.week)} – ${dm(addDays(state.week, 6))}`;
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(state.week, i);
    const items = state.plan.filter((p) => p.date === d);
    html += `<div class="day${d === today ? " today" : ""}${d < today ? " past" : ""}">
      <div class="day-h">${dayName(d)}${d === today ? ' <span class="tag">Hôm nay</span>' : ""}</div>`;
    for (const [m, label] of MEALS) {
      const es = items.filter((p) => p.meal === m);
      html += `<div class="meal"><span class="ml">${label}</span><div class="chips">${es.map(planChip).join("")}
        <button class="add" data-date="${d}" data-meal="${m}" aria-label="Thêm món">+</button></div></div>`;
    }
    html += "</div>";
  }
  $("#days").innerHTML = html;
}

$("#days").addEventListener("click", (e) => {
  const add = e.target.closest(".add");
  if (add) return openPicker(add.dataset.date, add.dataset.meal);
  const chip = e.target.closest("[data-plan]");
  if (chip) openPlanEntry(Number(chip.dataset.plan));
});
$("#w-prev").onclick = () => { state.week = addDays(state.week, -7); loadPlan().catch(fail); };
$("#w-next").onclick = () => { state.week = addDays(state.week, 7); loadPlan().catch(fail); };
$("#w-label").onclick = () => { state.week = weekStart(todayStr()); loadPlan().catch(fail); };
$("#w-copy").onclick = async (e) => {
  const from = addDays(state.week, -7);
  const note = state.plan.length ? `\nTuần này đã có ${state.plan.length} món, sẽ được thêm vào chứ không thay thế.` : "";
  if (!(await confirmBox(`Chép thực đơn tuần ${dm(from)} – ${dm(addDays(from, 6))} sang tuần này?${note}`))) return;
  busy(e.currentTarget, async () => {
    const r = await api("/api/plan/copy", { method: "POST", body: { from, to: state.week, days: 7 } });
    haptic();
    toast(r.copied ? `Đã chép ${r.copied} món.` : "Tuần trước chưa có món nào.");
    await loadPlan();
  });
};
$("#w-shop").onclick = (e) => {
  const today = todayStr();
  const end = addDays(state.week, 6);
  const from = state.week < today && today <= end ? today : state.week;
  generateShop(from, end, e.currentTarget);
};

// Chọn món cho 1 bữa
function openPicker(date, meal) {
  let kind = "dish";
  const sh = openSheet(`${sheetHead(`${dayName(date)} · ${mealLabel(meal)}`)}
    <input type="search" id="pk-q" placeholder="Tìm món..." />
    <div class="filter" id="pk-k">${["all", "dish", "fruit", "drink", "ingredient"]
      .map((k) => `<button data-k="${k}" class="${k === kind ? "on" : ""}">${k === "all" ? "Tất cả" : KIND[k].label}</button>`)
      .join("")}</div>
    <div class="sug" id="pk-sug"></div>
    <div class="list" id="pk-list"></div>
    <div class="actions"><button class="ghost sm" id="pk-new">+ Tạo món mới</button></div>`);
  const render = () => {
    const q = norm($("#pk-q", sh).value);
    const list = state.foods.filter((f) => (kind === "all" || f.kind === kind) && (!q || norm(f.name).includes(q)));
    $("#pk-list", sh).innerHTML =
      list.map((f) => `<button class="item" data-id="${f.id}"><span class="emo">${foodIcon(f)}</span>
        <span class="nm">${esc(f.name)}<span class="hint">${esc(foodSub(f))}</span></span></button>`).join("") ||
      `<p class="hint empty">Chưa có mục nào${q ? " khớp" : ""}. Bấm "Tạo món mới".</p>`;
  };
  render();
  $("#pk-q", sh).oninput = render;
  $("#pk-k", sh).onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    kind = b.dataset.k;
    $$("#pk-k button", sh).forEach((x) => x.classList.toggle("on", x === b));
    render();
  };
  const pick = (e) => {
    const b = e.target.closest("[data-id]");
    if (b) busy(b, () => addPlan(date, meal, Number(b.dataset.id)));
  };
  $("#pk-list", sh).onclick = pick;
  $("#pk-sug", sh).onclick = pick;
  $("#pk-new", sh).onclick = () =>
    openFoodEditor(null, { kind: kind === "all" ? "dish" : kind, afterSave: (f) => addPlan(date, meal, f.id) });
  api(`/api/suggest?date=${date}`)
    .then((ids) => {
      const fs = ids.map((id) => state.byId.get(id)).filter(Boolean);
      if (fs.length && $("#pk-sug", sh)) {
        $("#pk-sug", sh).innerHTML = `<span class="hint">🎲 Gợi ý:</span>` +
          fs.map((f) => `<button class="chip k-dish" data-id="${f.id}">${foodIcon(f)}${esc(f.name)}</button>`).join("");
      }
    })
    .catch(() => {});
}

async function addPlan(date, meal, food_id) {
  await api("/api/plan", { method: "POST", body: { date, meal, food_id } });
  haptic();
  closeSheet();
  state.week = weekStart(date);
  if (currentTab !== "plan") showTab("plan");
  else await loadPlan();
}

function openPlanEntry(id) {
  const p = state.plan.find((x) => x.id === id);
  const f = p && state.byId.get(p.food_id);
  if (!f) return;
  const isDish = f.kind === "dish";
  const sh = openSheet(`${sheetHead(`${foodIcon(f)} ${esc(f.name)}`)}
    <form id="pe" class="form">
      <div class="f2">
        <label>${isDish ? `Khẩu phần <span class="hint">(công thức: ${f.servings})</span>` : `Số lượng${f.unit ? " (" + esc(f.unit) + ")" : ""}`}
          <input name="servings" inputmode="decimal" value="${fmtQty(p.servings)}" required /></label>
        <label>Bữa<select name="meal">${MEALS.map(([m, l]) => `<option value="${m}"${m === p.meal ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <label>Ngày<input type="date" name="date" value="${p.date}" required /></label>
      ${recipeSummary(f, p.servings)}
      <div class="actions">
        <button type="button" class="ghost danger" id="pe-del">Bỏ khỏi thực đơn</button>
        <button type="button" class="ghost" id="pe-open">Sửa món</button>
        <button class="primary">Lưu</button>
      </div>
    </form>`);
  $("#pe", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const servings = parseNum(fd.get("servings"));
    if (!(servings > 0)) return toast("Số lượng không hợp lệ.");
    busy(e.submitter, async () => {
      await api(`/api/plan/${id}`, { method: "PUT", body: { servings, meal: fd.get("meal"), date: fd.get("date") } });
      haptic();
      closeSheet();
      await loadPlan();
    });
  };
  $("#pe-del", sh).onclick = (e) =>
    busy(e.currentTarget, async () => {
      await api(`/api/plan/${id}`, { method: "DELETE" });
      haptic("warning");
      closeSheet();
      await loadPlan();
    });
  $("#pe-open", sh).onclick = () => openFoodEditor(f.id);
}

/** Liệt kê nguyên liệu đã nhân theo khẩu phần. */
function recipeSummary(f, servings) {
  const rs = state.recipes.get(f.id) ?? [];
  if (!rs.length) return f.note ? `<div class="note">${esc(f.note)}</div>` : "";
  const k = servings / (f.servings || 1);
  const items = rs.map((r) => {
    const i = state.byId.get(r.ingredient_id);
    return `<li>${esc(i?.name)} — ${fmtQty(r.qty * k)}${i?.unit ? " " + esc(i.unit) : ""}</li>`;
  });
  return `<div class="note"><b>Nguyên liệu</b><ul>${items.join("")}</ul>${f.note ? esc(f.note) : ""}</div>`;
}

// =====================================================================
// ĐI CHỢ
// =====================================================================
function initShopRange() {
  if ($("#s-from").value) return;
  const today = todayStr();
  $("#s-from").value = today;
  $("#s-to").value = addDays(weekStart(today), 6);
}

async function loadShop() {
  initShopRange();
  state.shop = await api("/api/shopping");
  renderShop();
}

function updateBadge() {
  const n = state.shop.filter((r) => !r.bought_at).length;
  $("#shop-badge").hidden = !n;
  $("#shop-badge").textContent = n;
}

function shopRow(r) {
  const b = !!r.bought_at;
  const q = r.qty ? `${fmtQty(r.qty)}${r.unit ? " " + esc(r.unit) : ""}` : "";
  const sub = [q, r.note ? "cho " + esc(r.note) : ""].filter(Boolean).join(" · ");
  return `<div class="srow${b ? " done" : ""}" data-id="${r.id}">
    <button class="ck" aria-label="Đã mua">${b ? "✓" : ""}</button>
    <div class="sn">${esc(r.name)}${sub ? `<span class="hint">${sub}</span>` : ""}</div>
    <input class="sp" inputmode="decimal" value="${b ? toK(r.price) : ""}" placeholder="${r.est ? "~" + toK(r.est) : "giá"}" />
    <button class="del" aria-label="Xoá">✕</button>
  </div>`;
}

function renderShop() {
  updateBadge();
  const todo = state.shop.filter((r) => !r.bought_at);
  const done = state.shop.filter((r) => r.bought_at);
  const est = todo.reduce((s, r) => s + (r.est ?? 0), 0);
  const paid = done.reduce((s, r) => s + (r.price ?? 0), 0);
  $("#s-sum").textContent = state.shop.length
    ? `Còn ${todo.length} món${est ? ` · ước tính ~${fmtMoney(est)}` : ""}${done.length ? ` · đã mua ${done.length}, chi ${fmtMoney(paid) || "0k"}` : ""}`
    : "Danh sách trống. Tạo từ thực đơn hoặc thêm tay ở dưới.";
  const groups = new Map();
  for (const r of todo) {
    const c = r.category || "Khác";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(r);
  }
  let html = "";
  for (const [c, list] of groups) html += `<h3>${esc(c)}</h3>${list.map(shopRow).join("")}`;
  if (done.length) html += `<h3>Đã mua (${done.length})</h3>${done.map(shopRow).join("")}`;
  $("#shop-list").innerHTML = html;
}

async function generateShop(from, to, btn) {
  if (!from || !to || to < from) return toast("Chọn khoảng ngày hợp lệ.");
  await busy(btn, async () => {
    const r = await api("/api/shopping/generate", { method: "POST", body: { from, to } });
    haptic();
    $("#s-from").value = from;
    $("#s-to").value = to;
    toast(r.planned ? `Đã tính từ ${r.planned} món trong thực đơn → ${r.added} thứ cần mua.` : "Khoảng ngày này chưa có thực đơn.");
    showTab("shop");
  });
}
$("#s-gen").onclick = (e) => generateShop($("#s-from").value, $("#s-to").value, e.currentTarget);

$("#shop-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".srow");
  if (!row) return;
  const id = Number(row.dataset.id);
  const r = state.shop.find((x) => x.id === id);
  if (e.target.closest(".ck")) {
    tap();
    const bought = !r.bought_at;
    busy(null, async () => {
      await api(`/api/shopping/${id}`, { method: "PUT", body: { bought } });
      await loadShop();
    });
  } else if (e.target.closest(".del")) {
    busy(null, async () => {
      await api(`/api/shopping/${id}`, { method: "DELETE" });
      await loadShop();
    });
  }
});
$("#shop-list").addEventListener("change", (e) => {
  if (!e.target.classList.contains("sp")) return;
  const id = Number(e.target.closest(".srow").dataset.id);
  const price = parseK(e.target.value);
  if (Number.isNaN(price)) return toast("Giá không hợp lệ.");
  // Nhập giá = coi như đã mua.
  busy(null, async () => {
    await api(`/api/shopping/${id}`, { method: "PUT", body: { price, bought: price != null ? true : undefined } });
    haptic();
    await Promise.all([loadShop(), loadFoods()]);
  });
});
$("#s-name").addEventListener("change", () => {
  const f = state.foods.find((x) => x.kind !== "dish" && norm(x.name) === norm($("#s-name").value));
  if (f?.unit && !$("#s-unit").value) $("#s-unit").value = f.unit;
});
$("#s-add").onsubmit = (e) => {
  e.preventDefault();
  busy(e.submitter, async () => {
    await api("/api/shopping", {
      method: "POST",
      body: { name: $("#s-name").value, qty: $("#s-qty").value, unit: $("#s-unit").value },
    });
    e.target.reset();
    haptic();
    await loadShop();
    $("#s-name").focus();
  });
};
$("#s-send").onclick = (e) =>
  busy(e.currentTarget, async () => {
    await api("/api/shopping/send", { method: "POST" });
    haptic();
    toast("Đã gửi danh sách vào chat với bot.");
  });
$("#s-clear").onclick = async (e) => {
  if (!(await confirmBox("Dọn các món đã mua khỏi danh sách? (vẫn giữ trong thống kê chi tiêu)"))) return;
  busy(e.currentTarget, async () => {
    await api("/api/shopping/clear", { method: "POST" });
    await loadShop();
  });
};
$("#s-reset").onclick = async (e) => {
  if (!(await confirmBox("Xoá tất cả món CHƯA mua?"))) return;
  busy(e.currentTarget, async () => {
    await api("/api/shopping/reset", { method: "POST" });
    haptic("warning");
    await loadShop();
  });
};

// =====================================================================
// THƯ VIỆN
// =====================================================================
function foodSub(f) {
  if (f.kind === "dish") {
    const n = state.recipes.get(f.id)?.length ?? 0;
    return [f.category, n ? `${n} nguyên liệu` : "chưa có công thức", `${f.servings} phần`].filter(Boolean).join(" · ");
  }
  const price = f.price != null ? `${fmtMoney(f.price)}${f.unit ? "/" + f.unit : ""}` : f.unit;
  const n = state.recipes.get(f.id)?.length;
  return [f.kind !== "ingredient" ? KIND[f.kind].label : f.category, price, n ? `${n} nguyên liệu` : ""]
    .filter(Boolean).join(" · ");
}

function renderLib() {
  const counts = { all: state.foods.length };
  for (const f of state.foods) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  $("#l-kinds").innerHTML = ["all", "dish", "fruit", "drink", "ingredient"]
    .map((k) => `<button data-k="${k}" class="${k === state.libKind ? "on" : ""}">${k === "all" ? "Tất cả" : KIND[k].label} <small>${counts[k] ?? 0}</small></button>`)
    .join("");
  const q = norm($("#l-q").value);
  const list = state.foods.filter((f) => (state.libKind === "all" || f.kind === state.libKind) && (!q || norm(f.name).includes(q)));
  $("#lib-list").innerHTML =
    list.map((f) => `<button class="item" data-id="${f.id}"><span class="emo">${foodIcon(f)}</span>
      <span class="nm">${esc(f.name)}<span class="hint">${esc(foodSub(f))}</span></span></button>`).join("") ||
    `<p class="hint empty">${state.foods.length ? "Không tìm thấy." : "Thư viện trống. Bấm “+ Thêm” để tạo món đầu tiên."}</p>`;
}
$("#l-q").oninput = renderLib;
$("#l-kinds").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.libKind = b.dataset.k;
  renderLib();
};
$("#lib-list").onclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) openFoodEditor(Number(b.dataset.id));
};
$("#l-add").onclick = () => openFoodEditor(null, { kind: state.libKind === "all" ? "dish" : state.libKind });

// Thêm / sửa món
function recipeRow(r = {}) {
  return `<div class="rrow">
    <input class="rn" list="dl-ing" placeholder="Nguyên liệu" value="${esc(r.name)}" maxlength="60" />
    <input class="rq" inputmode="decimal" placeholder="SL" value="${r.qty != null ? fmtQty(r.qty) : ""}" />
    <input class="ru" list="dl-units" placeholder="ĐV" value="${esc(r.unit)}" maxlength="15" />
    <button type="button" class="del" aria-label="Xoá dòng">✕</button>
  </div>`;
}

function openFoodEditor(id, opts = {}) {
  const f = id ? state.byId.get(id) : { kind: opts.kind || "dish", servings: 1 };
  if (!f) return;
  const rec = (id ? state.recipes.get(id) ?? [] : []).map((r) => {
    const i = state.byId.get(r.ingredient_id);
    return { name: i?.name, qty: r.qty, unit: i?.unit };
  });
  const sh = openSheet(`${sheetHead(id ? "Sửa" : "Thêm vào thư viện")}
    <form id="fe" class="form" autocomplete="off">
      <div class="seg" id="fe-kind">${Object.entries(KIND)
        .map(([k, v]) => `<button type="button" data-k="${k}" class="${k === f.kind ? "on" : ""}">${v.label}</button>`)
        .join("")}</div>
      <div class="f-name">
        <label class="photo" title="Chọn ảnh"><span id="fe-pv"></span><input type="file" accept="image/*" id="fe-photo" hidden /></label>
        <div class="f-col">
          <input name="name" maxlength="60" placeholder="Tên" value="${esc(f.name)}" required />
          <div class="photo-act"><span class="hint">Bấm ô vuông để chọn ảnh</span>
            <button type="button" class="link danger" id="fe-photo-del" hidden>Bỏ ảnh</button></div>
        </div>
      </div>
      <div class="f2">
        <label class="w-recipe">Khẩu phần<input name="servings" type="number" min="1" max="50" value="${f.servings ?? 1}" /></label>
        <label>Nhóm<input name="category" maxlength="30" value="${esc(f.category)}" /></label>
      </div>
      <div class="f2 w-buy">
        <label>Đơn vị mua<input name="unit" list="dl-units" maxlength="15" value="${esc(f.unit)}" /></label>
        <label>Giá / đơn vị (nghìn đ)<input name="price" inputmode="decimal" value="${toK(f.price)}" /></label>
      </div>
      <label class="w-buy">Nơi hay mua<input name="place" maxlength="60" value="${esc(f.place)}" /></label>
      <div class="w-recipe">
        <h3>Nguyên liệu <span class="hint">cho số khẩu phần ở trên</span></h3>
        <div id="fe-rec">${rec.map(recipeRow).join("")}</div>
        <button type="button" class="ghost sm" id="fe-addrow">+ Nguyên liệu</button>
        <p class="hint">Gõ tên chưa có trong thư viện sẽ tự tạo nguyên liệu mới.</p>
      </div>
      <label>Ghi chú / cách làm<textarea name="note" rows="4" maxlength="3000">${esc(f.note)}</textarea></label>
      <p class="err" id="fe-err"></p>
      <div class="actions">
        ${id ? '<button type="button" class="ghost danger" id="fe-del">Xoá</button>' : ""}
        <button class="primary">Lưu</button>
      </div>
    </form>`);
  let kind = f.kind;
  const applyKind = () => {
    const recipeOn = kind === "dish" || kind === "drink";
    $$(".w-recipe", sh).forEach((el) => (el.hidden = !recipeOn));
    $$(".w-buy", sh).forEach((el) => (el.hidden = kind === "dish"));
    $('[name="category"]', sh).setAttribute("list", kind === "dish" ? "dl-cat-dish" : "dl-cat-buy");
    renderPhoto();
  };
  // Ảnh: undefined = giữ nguyên, chuỗi dataURL = ảnh mới, null = bỏ ảnh.
  let photo;
  const renderPhoto = () => {
    const name = $('[name="name"]', sh).value;
    const src = photo ?? (photo === undefined && f.img_v ? imgUrl(f) : null);
    $("#fe-pv", sh).innerHTML = src
      ? `<img src="${src}" alt="" />`
      : `<span class="fi fl k-${kind}">${esc(initial(name))}</span>`;
    $("#fe-photo-del", sh).hidden = !src;
  };
  applyKind();
  $('[name="name"]', sh).addEventListener("input", renderPhoto);
  $("#fe-photo", sh).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      photo = await resizeImage(file);
      renderPhoto();
    } catch (err) {
      $("#fe-err", sh).textContent = err.message;
    }
  };
  $("#fe-photo-del", sh).onclick = () => {
    photo = null;
    renderPhoto();
  };
  $("#fe-kind", sh).onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    kind = b.dataset.k;
    $$("#fe-kind button", sh).forEach((x) => x.classList.toggle("on", x === b));
    applyKind();
  };
  const addRow = () => {
    $("#fe-rec", sh).insertAdjacentHTML("beforeend", recipeRow());
    $("#fe-rec .rrow:last-child .rn", sh).focus();
  };
  $("#fe-addrow", sh).onclick = addRow;
  if (!id && kind === "dish") $("#fe-rec", sh).insertAdjacentHTML("beforeend", recipeRow());
  $("#fe-rec", sh).addEventListener("click", (e) => {
    if (e.target.closest(".del")) e.target.closest(".rrow").remove();
  });
  $("#fe-rec", sh).addEventListener("change", (e) => {
    if (!e.target.classList.contains("rn")) return;
    const i = state.foods.find((x) => x.kind !== "dish" && norm(x.name) === norm(e.target.value));
    const u = e.target.closest(".rrow").querySelector(".ru");
    if (i?.unit) u.value = i.unit;
  });

  $("#fe", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const price = parseK(fd.get("price"));
    if (Number.isNaN(price)) return ($("#fe-err", sh).textContent = "Giá không hợp lệ.");
    const recipe = $$(".rrow", sh)
      .map((r) => ({ name: $(".rn", r).value.trim(), qty: parseNum($(".rq", r).value), unit: $(".ru", r).value.trim() }))
      .filter((r) => r.name);
    const bad = recipe.find((r) => r.qty == null || Number.isNaN(r.qty));
    if (bad) return ($("#fe-err", sh).textContent = `Nhập số lượng cho "${bad.name}".`);
    const body = {
      kind,
      name: fd.get("name"),
      category: fd.get("category"),
      servings: kind === "dish" || kind === "drink" ? fd.get("servings") : 1,
      unit: kind === "dish" ? "" : fd.get("unit"),
      price: kind === "dish" ? null : price,
      place: kind === "dish" ? "" : fd.get("place"),
      note: fd.get("note"),
      recipe,
    };
    busy(e.submitter, async () => {
      try {
        const saved = await api(id ? `/api/foods/${id}` : "/api/foods", { method: id ? "PUT" : "POST", body });
        if (photo) await api(`/api/foods/${saved.id}/image`, { method: "POST", body: { data: photo } });
        else if (photo === null) await api(`/api/foods/${saved.id}/image`, { method: "DELETE" });
        haptic();
        await loadFoods();
        closeSheet();
        if (opts.afterSave) await opts.afterSave(saved);
        else rerender();
      } catch (err) {
        $("#fe-err", sh).textContent = err.message;
        haptic("error");
      }
    });
  };
  if (id) {
    $("#fe-del", sh).onclick = async (e) => {
      if (!(await confirmBox(`Xoá "${f.name}"? Các bữa trong thực đơn có món này cũng bị xoá.`))) return;
      busy(e.currentTarget, async () => {
        try {
          await api(`/api/foods/${id}`, { method: "DELETE" });
          haptic("warning");
          await loadFoods();
          closeSheet();
          rerender();
        } catch (err) {
          $("#fe-err", sh).textContent = err.message;
        }
      });
    };
  }
}

// =====================================================================
// CHI TIÊU
// =====================================================================
function bars(rows, label, value, fmt = fmtMoney) {
  const max = Math.max(...rows.map(value), 1);
  return `<div class="bars">${rows
    .map((r) => `<div class="bar-row"><span class="bl">${label(r)}</span>
      <span class="bt"><i style="width:${Math.max(2, (value(r) / max) * 100)}%"></i></span>
      <span class="bv">${fmt(value(r))}</span></div>`)
    .join("")}</div>`;
}

async function loadStats() {
  const m = state.month;
  $("#m-label").textContent = `Tháng ${m.slice(5)}/${m.slice(0, 4)}`;
  const s = await api(`/api/stats?month=${m}`);
  const cur = s.months.find((x) => x.month === m);
  const total = cur?.total ?? 0;
  const today = todayStr();
  const [y, mo] = m.split("-").map(Number);
  const days = today.startsWith(m) ? Number(today.slice(8)) : new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let html = `<div class="kpi">
    <div><b>${fmtMoney(total) || "0k"}</b><span>tổng chi</span></div>
    <div><b>${cur?.n ?? 0}</b><span>lần mua</span></div>
    <div><b>${fmtMoney(total / days) || "0k"}</b><span>trung bình/ngày</span></div>
  </div>`;
  if (!total) html += `<p class="hint empty">Tháng này chưa có khoản chi nào. Nhập giá khi tick món đã mua ở tab Đi chợ.</p>`;
  if (s.categories.length) html += `<h2>Theo nhóm</h2>` + bars(s.categories, (r) => esc(r.category), (r) => r.total);
  if (s.top.length) {
    html += `<h2>Tốn nhiều nhất</h2>` + bars(
      s.top,
      (r) => `${esc(r.name)}${r.qty ? ` <small>${fmtQty(r.qty)}${r.unit ? " " + esc(r.unit) : ""}</small>` : ""}`,
      (r) => r.total,
    );
  }
  if (s.months.length > 1) {
    html += `<h2>Các tháng</h2>` + bars([...s.months].reverse(), (r) => `${r.month.slice(5)}/${r.month.slice(2, 4)}`, (r) => r.total);
  }
  $("#stats").innerHTML = html;
}
$("#m-prev").onclick = () => { state.month = addMonths(state.month, -1); loadStats().catch(fail); };
$("#m-next").onclick = () => { state.month = addMonths(state.month, 1); loadStats().catch(fail); };

$("#b-export").onclick = (e) =>
  busy(e.currentTarget, async () => {
    await api("/api/export/send", { method: "POST" });
    haptic();
    toast("Đã gửi file sao lưu vào chat với bot.");
  });
$("#b-import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast("File không phải JSON hợp lệ.");
  }
  if (data.app !== "meal-mate") return toast("Đây không phải file sao lưu của Meal Mate.");
  const ok = await confirmBox(
    `Khôi phục ${data.foods?.length ?? 0} món, ${data.plan?.length ?? 0} bữa từ file ngày ${String(data.exported_at).slice(0, 10)}?\nToàn bộ dữ liệu hiện tại sẽ bị thay thế.`,
  );
  if (!ok) return;
  busy(null, async () => {
    await api("/api/import", { method: "POST", body: data });
    haptic();
    toast("Đã khôi phục.");
    await loadFoods();
    rerender();
  });
};

// ---------- khởi động ----------
(async () => {
  try {
    const me = await api("/api/me");
    $("#who").textContent = me.user?.first_name ?? "";
    await loadFoods();
    showTab("plan");
    api("/api/shopping").then((rows) => { state.shop = rows; updateBadge(); }).catch(() => {});
  } catch (e) {
    $("#main").hidden = true;
    $("#tabs").hidden = true;
    $("#blocker").hidden = false;
    $("#blocker").innerHTML = e.status === 401
      ? "🍽️<p>Hãy mở Meal Mate từ bot trên Telegram.</p>"
      : `🔒<p>${esc(e.message)}</p>`;
  }
})();
