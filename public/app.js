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
const MEALS = [["sang", "Sáng"], ["phu_sang", "Phụ sáng"], ["trua", "Trưa"], ["phu", "Phụ chiều"], ["toi", "Tối"], ["phu_toi", "Phụ tối"]];
const UNITS = [
  "kg", "g", "lạng", "lít", "ml",
  "cái", "ổ", "quả", "trái", "củ", "bó", "cây", "nhánh", "tép", "con", "miếng", "lát", "khứa", "nải", "buồng",
  "hộp", "gói", "bịch", "túi", "chai", "lon", "vỉ", "khay", "hũ", "thùng",
  "chén", "tô", "ly", "muỗng", "thìa", "phần", "suất",
];
const CATS = ["Ăn sáng", "Cơm", "Bún / phở", "Bánh", "Ăn vặt", "Rau củ", "Trái cây", "Sữa", "Nước", "Khác"];
const WEEKDAY = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

// ---------- tiện ích ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const round2 = (n) => Math.round(n * 100) / 100;
const fmtQty = (n) => String(round2(n)).replace(".", ",");
/** Hiện đúng số đồng, không làm tròn: 12345 → "12.345đ" */
const fmtMoney = (v) => (v == null ? "" : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ");
/** "0,5" → 0.5; "" → null */
const parseNum = (s) => {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
/** Nhập thẳng bằng đồng, bỏ dấu chấm/phẩy/khoảng trắng: "12.500" → 12500 */
const parseK = (s) => {
  const t = String(s ?? "").replace(/[.,\s]/g, "");
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
};
/** Hiện giá bằng đồng: 12500 → "12.500" */
const toK = (v) => (v == null ? "" : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, "."));

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
  kinds: [], // [{ key, label, color }] theo thứ tự, quản lý ở Menu → Loại
  stock: [],
  stockBy: new Map(), // food_id → "3 kg" / "hết"
  byId: new Map(),
  parts: new Map(), // food_id → [{ part_id, qty }]
  usedIn: new Map(), // part_id → [food_id]
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
/** modal = true: form thêm/sửa, chỉ đóng bằng nút ✕ (bấm ra ngoài không mất dữ liệu đang nhập). */
let sheetModal = false;
function openSheet(html, { modal = false } = {}) {
  sheetModal = modal;
  $("#sheet").innerHTML = html;
  $("#sheet-bg").hidden = false;
  document.body.classList.add("noscroll");
  try { modal ? tg?.BackButton?.hide() : tg?.BackButton?.show(); } catch {}
  return $("#sheet");
}
function closeSheet() {
  $("#sheet-bg").hidden = true;
  $("#sheet").innerHTML = "";
  document.body.classList.remove("noscroll");
  try { tg?.BackButton?.hide(); } catch {}
}
$("#sheet-bg").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || (e.target.id === "sheet-bg" && !sheetModal)) closeSheet();
});
try { tg?.BackButton?.onClick(() => { if (!sheetModal) closeSheet(); }); } catch {}
const sheetHead = (title) => `<div class="sh-h"><b>${title}</b><button type="button" class="x" data-close>✕</button></div>`;

// ---------- menu (dữ liệu dùng chung) ----------
async function loadFoods() {
  const { foods, parts = [], kinds = [] } = await api("/api/foods");
  state.foods = foods;
  state.kinds = kinds;
  state.byId = new Map(foods.map((f) => [f.id, f]));
  state.parts = new Map();
  state.usedIn = new Map();
  for (const p of parts) {
    if (!state.parts.has(p.food_id)) state.parts.set(p.food_id, []);
    state.parts.get(p.food_id).push(p);
    if (!state.usedIn.has(p.part_id)) state.usedIn.set(p.part_id, []);
    state.usedIn.get(p.part_id).push(p.food_id);
  }
  const opts = (arr) => arr.map((v) => `<option value="${esc(v)}">`).join("");
  $("#dl-units").innerHTML = opts([...new Set([...UNITS, ...foods.map((f) => f.unit).filter(Boolean)])]);
  $("#dl-cats").innerHTML = opts([...new Set([...CATS, ...foods.map((f) => f.category).filter(Boolean)])]);
  $("#dl-buy").innerHTML = opts(foods.map((f) => f.name));
}
const kindOf = (key) => state.kinds.find((k) => k.key === key);
const kindLabel = (key) => kindOf(key)?.label ?? "Khác";
const firstKind = () => state.kinds[0]?.key ?? "dish";
/** Màu của loại, gắn vào phần tử qua biến CSS --kc. */
const kc = (key) => {
  const c = kindOf(key)?.color;
  return c ? ` style="--kc:${esc(c)}"` : "";
};
const kindButtons = (active, withAll, counts) =>
  [...(withAll ? [{ key: "all", label: "Tất cả" }] : []), ...state.kinds]
    .map((k) => `<button type="button" data-k="${esc(k.key)}" class="${k.key === active ? "on" : ""}">${esc(k.label)}${counts ? ` <small>${counts[k.key] ?? 0}</small>` : ""}</button>`)
    .join("");

/** Ảnh của món, chưa có ảnh thì hiện chữ cái đầu trên nền màu theo loại. */
const initial = (name) => ([...String(name ?? "").trim()][0] ?? "?").toUpperCase();
const imgUrl = (f) => `/api/img/${f.id}?v=${encodeURIComponent(f.img_v)}`;
function foodIcon(f) {
  if (!f) return "";
  return f.img_v
    ? `<img class="fi" src="${imgUrl(f)}" alt="" loading="lazy" />`
    : `<span class="fi fl"${kc(f.kind)}>${esc(initial(f.name))}</span>`;
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
  if (name === "lib") {
    renderLib();
    refreshStock().then(renderLib); // để hiện "Kho: ..." cạnh từng món
  }
  if (name === "stock") loadStock().catch(fail);
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
  [state.plan] = await Promise.all([api(`/api/plan?from=${state.week}&to=${addDays(state.week, 6)}`), refreshStock()]);
  renderPlan();
}

function planChip(p) {
  const f = state.byId.get(p.food_id);
  if (!f) return "";
  const extra =
    f.unit || p.servings !== 1 ? ` <small>${fmtQty(p.servings)}${f.unit ? " " + esc(f.unit) : ""}</small>` : "";
  const note = p.note ? `<small class="pn">📝 ${esc(p.note)}</small>` : "";
  const have = stockOf(f.id);
  const box = have && have !== "hết" ? `<small title="Kho: ${esc(have)}">📦</small>` : "";
  return `<button class="chip"${kc(f.kind)} data-plan="${p.id}">${foodIcon(f)}${esc(f.name)}${extra}${box}${note}</button>`;
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
$("#w-clear").onclick = async (e) => {
  if (!state.plan.length) return toast("Tuần này chưa có món nào.");
  const range = `${dm(state.week)} – ${dm(addDays(state.week, 6))}`;
  if (!(await confirmBox(`Xoá hết ${state.plan.length} món trong thực đơn tuần ${range}?\nMenu và Kho vẫn giữ nguyên.`))) return;
  busy(e.currentTarget, async () => {
    const r = await api("/api/plan/clear", { method: "POST", body: { from: state.week, to: addDays(state.week, 6) } });
    haptic("warning");
    toast(`Đã xoá ${r.deleted} món.`);
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
  let kind = "all";
  const sh = openSheet(`${sheetHead(`${dayName(date)} · ${mealLabel(meal)}`)}
    <input type="search" id="pk-q" placeholder="Tìm món..." />
    <div class="filter" id="pk-k">${kindButtons(kind, true)}</div>
    <div class="sug" id="pk-stock"></div>
    <div class="sug" id="pk-sug"></div>
    <div class="list" id="pk-list"></div>
    <div class="actions"><button class="ghost sm" id="pk-new">+ Tạo món mới</button></div>`);
  const render = () => {
    const q = norm($("#pk-q", sh).value);
    const list = state.foods.filter((f) => (kind === "all" || f.kind === kind) && (!q || norm(f.name).includes(q)));
    $("#pk-list", sh).innerHTML =
      list.map((f) => {
        const have = stockOf(f.id);
        return `<button class="item" data-id="${f.id}"><span class="emo">${foodIcon(f)}</span>
        <span class="nm">${esc(f.name)}<span class="hint">${esc(foodSub(f))}</span>${have ? `<span class="instock${have === "hết" ? " out" : ""}">📦 Kho: ${esc(have)}</span>` : ""}</span></button>`;
      }).join("") ||
      `<p class="hint empty">Chưa có mục nào${q ? " khớp" : ""}. Bấm "Tạo món mới".</p>`;
  };
  render();
  // Những thứ đang có trong kho: bấm để thêm nhanh vào bữa này.
  const inStock = state.stock.filter((r) => r.qty == null || r.qty > 0);
  if (inStock.length) {
    $("#pk-stock", sh).innerHTML = `<span class="hint">📦 Đang có trong kho:</span>` +
      inStock.map((r) => {
        const f = r.food_id ? state.byId.get(r.food_id) : null;
        const q = r.qty != null ? ` <small>${fmtQty(r.qty)}${r.unit ? " " + esc(r.unit) : ""}</small>` : "";
        return `<button class="chip"${f ? kc(f.kind) : ""} data-stock-id="${r.id}">${f ? foodIcon(f) : ""}${esc(r.name)}${q}</button>`;
      }).join("");
  }
  $("#pk-stock", sh).onclick = (e) => {
    const b = e.target.closest("[data-stock-id]");
    if (!b) return;
    const r = state.stock.find((x) => x.id === Number(b.dataset.stockId));
    busy(b, async () => addPlan(date, meal, await foodIdOfStock(r)));
  };
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
    openFoodEditor(null, { kind: kind === "all" ? firstKind() : kind, afterSave: (f) => addPlan(date, meal, f.id) });
  api(`/api/suggest?date=${date}`)
    .then((ids) => {
      const fs = ids.map((id) => state.byId.get(id)).filter(Boolean);
      if (fs.length && $("#pk-sug", sh)) {
        $("#pk-sug", sh).innerHTML = `<span class="hint">🎲 Gợi ý:</span>` +
          fs.map((f) => `<button class="chip"${kc(f.kind)} data-id="${f.id}">${foodIcon(f)}${esc(f.name)}</button>`).join("");
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
  const sh = openSheet(`${sheetHead(`${foodIcon(f)} ${esc(f.name)}`)}
    <form id="pe" class="form">
      <div class="f2">
        <label>Số lượng${f.unit ? " (" + esc(f.unit) + ")" : ""}
          <input name="servings" inputmode="decimal" value="${fmtQty(p.servings)}" required /></label>
        <label>Bữa<select name="meal">${MEALS.map(([m, l]) => `<option value="${m}"${m === p.meal ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <label>Ngày<input type="date" name="date" value="${p.date}" required /></label>
      <label>Ghi chú<input name="note" maxlength="200" placeholder="VD: ăn ở quán, mua cho con..." value="${esc(p.note)}" /></label>
      ${partsSummary(f, p.servings)}
      ${f.note ? `<div class="note">${esc(f.note)}</div>` : ""}
      <div class="actions">
        <button type="button" class="ghost danger" id="pe-del">Bỏ khỏi thực đơn</button>
        <button type="button" class="ghost" id="pe-open">Sửa món</button>
        <button class="primary">Lưu</button>
      </div>
    </form>`, { modal: true });
  $("#pe", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const servings = parseNum(fd.get("servings"));
    if (!(servings > 0)) return toast("Số lượng không hợp lệ.");
    busy(e.submitter, async () => {
      await api(`/api/plan/${id}`, { method: "PUT", body: { servings, meal: fd.get("meal"), date: fd.get("date"), note: fd.get("note") } });
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

/** Liệt kê thành phần đã nhân theo số lượng trong bữa. */
function partsSummary(f, servings) {
  const ps = state.parts.get(f.id) ?? [];
  if (!ps.length) return "";
  const items = ps.map((p) => {
    const x = state.byId.get(p.part_id);
    return `<li>${esc(x?.name)} — ${fmtQty(p.qty * servings)}${x?.unit ? " " + esc(x.unit) : ""}</li>`;
  });
  return `<div class="note"><b>Gồm</b><ul>${items.join("")}</ul></div>`;
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
    <input class="sp" inputmode="numeric" value="${b ? toK(r.price) : ""}" placeholder="${r.est ? "~" + toK(r.est) : "giá"}" />
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
    ? `Còn ${todo.length} món${est ? ` · ước tính ~${fmtMoney(est)}` : ""}${done.length ? ` · đã mua ${done.length}, chi ${fmtMoney(paid) || "0đ"}` : ""}`
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
  const f = state.foods.find((x) => norm(x.name) === norm($("#s-name").value));
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
// MENU
// =====================================================================
function foodSub(f) {
  const price = f.price != null ? `${fmtMoney(f.price)}${f.unit ? "/" + f.unit : ""}` : f.unit;
  const kind = kindLabel(f.kind);
  const n = state.parts.get(f.id)?.length;
  return [kind, f.category !== kind ? f.category : "", n ? `gồm ${n} món` : "", price, f.place].filter(Boolean).join(" · ");
}

function renderLib() {
  const counts = { all: state.foods.length };
  for (const f of state.foods) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  if (state.libKind !== "all" && !kindOf(state.libKind)) state.libKind = "all";
  $("#l-kinds").innerHTML = kindButtons(state.libKind, true, counts);
  const q = norm($("#l-q").value);
  const list = state.foods.filter((f) => (state.libKind === "all" || f.kind === state.libKind) && (!q || norm(f.name).includes(q)));
  $("#lib-list").innerHTML =
    list.map((f) => {
      const have = stockOf(f.id);
      return `<div class="lrow"><button class="item" data-id="${f.id}"><span class="emo">${foodIcon(f)}</span>
      <span class="nm">${esc(f.name)}<span class="hint">${esc(foodSub(f))}</span>${have ? `<span class="instock">📦 ${esc(have)}</span>` : ""}</span></button>
      <button class="tostock" data-stock="${f.id}" aria-label="Thêm vào kho">+ Kho</button></div>`;
    }).join("") ||
    `<p class="hint empty">${state.foods.length ? "Không tìm thấy." : "Menu trống. Bấm “+ Thêm” để tạo món đầu tiên."}</p>`;
}
$("#l-q").oninput = renderLib;
$("#l-kinds").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.libKind = b.dataset.k;
  renderLib();
};
$("#lib-list").onclick = (e) => {
  const s = e.target.closest("[data-stock]");
  if (s) return openAddStock(state.byId.get(Number(s.dataset.stock)), renderLib);
  const b = e.target.closest("[data-id]");
  if (b) openFoodEditor(Number(b.dataset.id));
};
$("#l-add").onclick = () => openFoodEditor(null, { kind: state.libKind === "all" ? firstKind() : state.libKind });
$("#l-kinds-edit").onclick = () => openKindsEditor();

// Quản lý loại: thêm / đổi tên / đổi màu / sắp xếp / xoá
const PALETTE = ["#e8833a", "#2f9e44", "#d9480f", "#1c7ed6", "#d6336c", "#8d6e63", "#7048e8", "#0c8599", "#f59f00", "#495057"];
function kindRow(k = {}, count = 0) {
  const color = k.color || (k.key ? "#868e96" : PALETTE[Math.floor(Math.random() * PALETTE.length)]);
  return `<div class="krow" data-key="${esc(k.key ?? "")}" data-count="${count}">
    <input type="color" class="kc-c" value="${esc(color)}" aria-label="Màu" />
    <input class="kc-l" maxlength="20" placeholder="Tên loại" value="${esc(k.label)}" />
    <span class="hint">${count ? count + " món" : ""}</span>
    <button type="button" class="mv up" aria-label="Lên trên">▲</button>
    <button type="button" class="mv down" aria-label="Xuống dưới">▼</button>
    <button type="button" class="del" aria-label="Xoá loại">✕</button>
  </div>`;
}
function openKindsEditor() {
  const counts = {};
  for (const f of state.foods) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  const sh = openSheet(`${sheetHead("Loại món")}
    <form id="ke" class="form" autocomplete="off">
      <div id="ke-list">${state.kinds.map((k) => kindRow(k, counts[k.key])).join("")}</div>
      <button type="button" class="ghost sm" id="ke-add">+ Thêm loại</button>
      <p class="hint">Bấm ô màu để đổi màu, ▲▼ để sắp xếp. Loại còn món thì phải chuyển món sang loại khác rồi mới xoá được.</p>
      <p class="err" id="ke-err"></p>
      <div class="actions"><button class="primary">Lưu</button></div>
    </form>`, { modal: true });
  $("#ke-add", sh).onclick = () => {
    $("#ke-list", sh).insertAdjacentHTML("beforeend", kindRow());
    $("#ke-list .krow:last-child .kc-l", sh).focus();
  };
  $("#ke-list", sh).addEventListener("click", (e) => {
    const row = e.target.closest(".krow");
    if (!row) return;
    if (e.target.closest(".del")) {
      const n = Number(row.dataset.count);
      if (n) return ($("#ke-err", sh).textContent = `Loại "${$(".kc-l", row).value}" còn ${n} món, chưa xoá được.`);
      row.remove();
    } else if (e.target.closest(".up") && row.previousElementSibling) row.previousElementSibling.before(row);
    else if (e.target.closest(".down") && row.nextElementSibling) row.nextElementSibling.after(row);
    else return;
    tap();
  });
  $("#ke", sh).onsubmit = (e) => {
    e.preventDefault();
    const kinds = $$(".krow", sh)
      .map((r) => ({ key: r.dataset.key || undefined, label: $(".kc-l", r).value.trim(), color: $(".kc-c", r).value }))
      .filter((k) => k.label || k.key);
    const empty = kinds.find((k) => !k.label);
    if (empty) return ($("#ke-err", sh).textContent = "Có loại chưa đặt tên.");
    if (!kinds.length) return ($("#ke-err", sh).textContent = "Cần ít nhất 1 loại.");
    busy(e.submitter, async () => {
      try {
        await api("/api/kinds", { method: "PUT", body: { kinds } });
        haptic();
        await loadFoods();
        closeSheet();
        rerender();
      } catch (err) {
        $("#ke-err", sh).textContent = err.message;
        haptic("error");
      }
    });
  };
}

// Thêm / sửa món
function partRow(r = {}) {
  return `<div class="prow">
    <input class="pa-n" list="dl-buy" placeholder="Tên món" value="${esc(r.name)}" maxlength="60" />
    <input class="pa-q" inputmode="decimal" placeholder="SL" value="${r.qty != null ? fmtQty(r.qty) : ""}" />
    <input class="pa-u" list="dl-units" placeholder="ĐV" value="${esc(r.unit)}" maxlength="15" />
    <button type="button" class="mv up" aria-label="Lên trên">▲</button>
    <button type="button" class="mv down" aria-label="Xuống dưới">▼</button>
    <button type="button" class="del" aria-label="Xoá dòng">✕</button>
  </div>`;
}

function openFoodEditor(id, opts = {}) {
  const f = id ? state.byId.get(id) : { kind: opts.kind || firstKind() };
  if (!f) return;
  const partRows = (id ? state.parts.get(id) ?? [] : []).map((p) => {
    const x = state.byId.get(p.part_id);
    return { name: x?.name, qty: p.qty, unit: x?.unit };
  });
  const usedIn = (id ? state.usedIn.get(id) ?? [] : []).map((x) => state.byId.get(x)?.name).filter(Boolean);
  const sh = openSheet(`${sheetHead(id ? "Sửa" : "Thêm vào menu")}
    <form id="fe" class="form" autocomplete="off">
      <div class="seg" id="fe-kind">${kindButtons(f.kind, false)}</div>
      <div class="f-name">
        <label class="photo" title="Chọn ảnh"><span id="fe-pv"></span><input type="file" accept="image/*" id="fe-photo" hidden /></label>
        <div class="f-col">
          <input name="name" maxlength="60" placeholder="Tên" value="${esc(f.name)}" required />
          <div class="photo-act"><span class="hint">Bấm ô vuông để chọn ảnh</span>
            <button type="button" class="link danger" id="fe-photo-del" hidden>Bỏ ảnh</button></div>
        </div>
      </div>
      <div class="f2">
        <label>Đơn vị<input name="unit" list="dl-units" maxlength="15" placeholder="ổ, hộp, kg..." value="${esc(f.unit)}" /></label>
        <label>Giá / đơn vị (đ)<input name="price" inputmode="numeric" value="${toK(f.price)}" /></label>
      </div>
      <div class="f2">
        <label>Nhóm<input name="category" list="dl-cats" maxlength="30" value="${esc(f.category)}" /></label>
        <label>Nơi mua<input name="place" maxlength="60" value="${esc(f.place)}" /></label>
      </div>
      <div class="parts">
        <h3>Gồm các món <span class="hint" id="fe-per"></span></h3>
        <div id="fe-parts">${partRows.map(partRow).join("")}</div>
        <button type="button" class="ghost sm" id="fe-addpart">+ Thành phần</button>
        <p class="hint">Chọn món có sẵn hoặc gõ tên mới (tự thêm vào menu, loại Nguyên liệu). Món có thành phần thì đi chợ sẽ mua các thành phần thay cho nó.</p>
        ${usedIn.length ? `<p class="hint">Đang là thành phần của: ${usedIn.map(esc).join(", ")}</p>` : ""}
      </div>
      <label>Ghi chú<textarea name="note" rows="2" maxlength="1000">${esc(f.note)}</textarea></label>
      ${id ? `<div class="bar"><span class="hint">📦 Trong kho: ${esc(stockOf(id) || "chưa có")}</span>
        <button type="button" class="ghost sm" id="fe-stock">+ Vào kho</button></div>` : ""}
      <p class="err" id="fe-err"></p>
      <div class="actions">
        ${id ? '<button type="button" class="ghost danger" id="fe-del">Xoá</button>' : ""}
        <button class="primary">Lưu</button>
      </div>
    </form>`, { modal: true });
  let kind = f.kind;
  const applyKind = () => renderPhoto();
  // Ảnh: undefined = giữ nguyên, chuỗi dataURL = ảnh mới, null = bỏ ảnh.
  let photo;
  const renderPhoto = () => {
    const name = $('[name="name"]', sh).value;
    const src = photo ?? (photo === undefined && f.img_v ? imgUrl(f) : null);
    $("#fe-pv", sh).innerHTML = src
      ? `<img src="${src}" alt="" />`
      : `<span class="fi fl"${kc(kind)}>${esc(initial(name))}</span>`;
    $("#fe-photo-del", sh).hidden = !src;
  };
  applyKind();
  $('[name="name"]', sh).addEventListener("input", renderPhoto);
  const renderPer = () => {
    const u = $('[name="unit"]', sh).value.trim();
    $("#fe-per", sh).textContent = `· số lượng cho 1 ${u || "phần"}`;
  };
  renderPer();
  $('[name="unit"]', sh).addEventListener("input", renderPer);
  $("#fe-addpart", sh).onclick = () => {
    $("#fe-parts", sh).insertAdjacentHTML("beforeend", partRow());
    $("#fe-parts .prow:last-child .pa-n", sh).focus();
  };
  $("#fe-parts", sh).addEventListener("click", (e) => {
    const row = e.target.closest(".prow");
    if (!row) return;
    if (e.target.closest(".del")) row.remove();
    else if (e.target.closest(".up") && row.previousElementSibling) row.previousElementSibling.before(row);
    else if (e.target.closest(".down") && row.nextElementSibling) row.nextElementSibling.after(row);
    else return;
    tap();
  });
  $("#fe-parts", sh).addEventListener("change", (e) => {
    if (!e.target.classList.contains("pa-n")) return;
    const row = e.target.closest(".prow");
    const x = state.foods.find((y) => norm(y.name) === norm(e.target.value));
    if (x?.unit && !$(".pa-u", row).value) $(".pa-u", row).value = x.unit;
  });
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

  $("#fe", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const price = parseK(fd.get("price"));
    if (Number.isNaN(price)) return ($("#fe-err", sh).textContent = "Giá không hợp lệ.");
    const parts = $$(".prow", sh)
      .map((r) => ({ name: $(".pa-n", r).value.trim(), qty: parseNum($(".pa-q", r).value), unit: $(".pa-u", r).value.trim() }))
      .filter((r) => r.name);
    const bad = parts.find((r) => !(r.qty > 0));
    if (bad) return ($("#fe-err", sh).textContent = `Nhập số lượng cho "${bad.name}".`);
    const body = {
      parts,
      kind,
      name: fd.get("name"),
      category: fd.get("category"),
      unit: fd.get("unit"),
      price,
      place: fd.get("place"),
      note: fd.get("note"),
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
    $("#fe-stock", sh).onclick = () => openAddStock(f, rerender);
    $("#fe-del", sh).onclick = async (e) => {
      if (usedIn.length) return ($("#fe-err", sh).textContent = `Đang là thành phần của: ${usedIn.join(", ")}. Gỡ ra trước.`);
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
// KHO (những thứ đang có ở nhà)
// =====================================================================
/** Tải kho, lỗi thì bỏ qua (dùng ở Menu, không làm phiền nếu chưa chạy migration 009). */
/** Gửi số lượng mới của 1 dòng kho; bấm liên tục thì gộp lại, chỉ gửi bản cuối. */
const stockPending = new Map(); // id → { timer, r }
const putStockQty = (r) => api(`/api/stock/${r.id}`, { method: "PUT", body: { qty: r.qty, unit: r.unit, note: r.note } });
function saveStockQty(r) {
  clearTimeout(stockPending.get(r.id)?.timer);
  const timer = setTimeout(() => {
    stockPending.delete(r.id);
    putStockQty(r).catch((e) => {
      fail(e);
      loadStock().catch(() => {});
    });
  }, 400);
  stockPending.set(r.id, { timer, r });
}
/** Gửi ngay các thay đổi đang chờ (trước khi tải lại kho, để không bị số cũ đè lên). */
async function flushStock() {
  const list = [...stockPending.values()];
  stockPending.clear();
  list.forEach((p) => clearTimeout(p.timer));
  await Promise.all(list.map((p) => putStockQty(p.r).catch(fail)));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushStock();
});

const refreshStock = () => flushStock().then(() => api("/api/stock")).then(setStock).catch(() => {});

/** Lưu kho vào state, kèm bảng tra food_id → số lượng hiển thị (khỏi lọc lại cả kho cho từng món). */
function setStock(rows) {
  state.stock = rows;
  const by = new Map();
  for (const r of rows) {
    if (!r.food_id) continue;
    if (!by.has(r.food_id)) by.set(r.food_id, []);
    by.get(r.food_id).push(r.qty == null ? r.unit || "có" : r.qty <= 0 ? "" : `${fmtQty(r.qty)}${r.unit ? " " + r.unit : ""}`);
  }
  state.stockBy = new Map([...by].map(([id, parts]) => [id, parts.filter(Boolean).join(", ") || "hết"]));
}

/** food_id của 1 dòng kho; thứ gõ tay chưa có trong Menu thì tạo món trong Menu rồi nối vào. */
async function foodIdOfStock(r) {
  if (r.food_id) return r.food_id;
  const { food_id } = await api(`/api/stock/${r.id}/link`, { method: "POST" });
  r.food_id = food_id;
  await loadFoods();
  return food_id;
}

/** Bữa gợi ý theo giờ hiện tại. */
function mealNow() {
  const h = new Date().getHours();
  return h < 9 ? "sang" : h < 11 ? "phu_sang" : h < 14 ? "trua" : h < 17 ? "phu" : h < 20 ? "toi" : "phu_toi";
}

/** Thêm 1 thứ trong kho vào thực đơn (chọn ngày, bữa, số lượng). */
function openStockToPlan(r) {
  const today = todayStr();
  const sh = openSheet(`${sheetHead("Thêm vào thực đơn")}
    <form id="sp" class="form" autocomplete="off">
      <b>${esc(r.name)}</b>${r.qty != null ? `<span class="hint">Kho đang có: ${fmtQty(r.qty)}${r.unit ? " " + esc(r.unit) : ""}</span>` : ""}
      <div class="f2">
        <label>Ngày<input type="date" name="date" value="${today}" required /></label>
        <label>Bữa<select name="meal">${MEALS.map(([m, l]) => `<option value="${m}"${m === mealNow() ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <label>Số lượng${r.unit ? " (" + esc(r.unit) + ")" : ""}<input name="servings" inputmode="decimal" value="1" /></label>
      <div class="actions"><button class="primary">Thêm vào thực đơn</button></div>
    </form>`, { modal: true });
  $("#sp", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const servings = parseNum(fd.get("servings"));
    if (!(servings > 0)) return toast("Số lượng không hợp lệ.");
    busy(e.submitter, async () => {
      const food_id = await foodIdOfStock(r);
      await api("/api/plan", { method: "POST", body: { date: fd.get("date"), meal: fd.get("meal"), food_id, servings } });
      haptic();
      closeSheet();
      toast(`Đã thêm ${r.name} vào ${mealLabel(fd.get("meal"))} ${dm(fd.get("date"))}.`);
      await loadStock();
    });
  };
}

/** Số lượng đang có trong kho của 1 món Menu, VD "3 kg" / "hết" / "" (không có). */
const stockOf = (foodId) => state.stockBy.get(foodId) ?? "";

/** Thêm 1 món từ Menu vào Kho. */
function openAddStock(f, after) {
  const have = stockOf(f.id);
  const sh = openSheet(`${sheetHead(`${foodIcon(f)} Thêm vào kho`)}
    <form id="as" class="form" autocomplete="off">
      <b>${esc(f.name)}</b>${have ? `<span class="hint">Đang có: ${esc(have)}</span>` : ""}
      <div class="f2">
        <label>Số lượng<input name="qty" inputmode="decimal" value="1" /></label>
        <label>Đơn vị<input name="unit" list="dl-units" maxlength="15" value="${esc(f.unit)}" /></label>
      </div>
      <label>Ghi chú<input name="note" maxlength="200" placeholder="VD: hạn dùng, để ở tủ đông..." /></label>
      <div class="actions"><button class="primary">Thêm vào kho</button></div>
    </form>`, { modal: true });
  const qi = $('[name="qty"]', sh);
  qi.focus();
  qi.select();
  $("#as", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qty = parseNum(fd.get("qty"));
    if (Number.isNaN(qty) || qty < 0) return toast("Số lượng không hợp lệ.");
    busy(e.submitter, async () => {
      const r = await api("/api/stock", { method: "POST", body: { food_id: f.id, qty, unit: fd.get("unit"), note: fd.get("note") } });
      haptic();
      closeSheet();
      toast(r.merged ? `Đã cộng thêm vào kho: ${f.name}.` : `Đã thêm vào kho: ${f.name}.`);
      await refreshStock();
      if (after) after();
    });
  };
}

async function loadStock() {
  try {
    await flushStock();
    setStock(await api("/api/stock"));
  } catch (e) {
    // Hiện lỗi ngay trong tab (VD: chưa chạy migration 009) thay vì toast thoáng qua.
    $("#k-sum").textContent = "";
    $("#stock-list").innerHTML = `<p class="err">⚠️ ${esc(e.message)}</p>`;
    throw e;
  }
  renderStock();
}

function stockRow(r) {
  const f = r.food_id ? state.byId.get(r.food_id) : null;
  const empty = r.qty != null && r.qty <= 0;
  const q = r.qty != null ? `${fmtQty(r.qty)}${r.unit ? " " + esc(r.unit) : ""}` : esc(r.unit || "");
  return `<div class="srow krw${empty ? " done" : ""}" data-id="${r.id}">
    <span class="emo">${f ? foodIcon(f) : `<span class="fi fl">${esc(initial(r.name))}</span>`}</span>
    <button class="sn link-row">${esc(r.name)}${r.note ? `<span class="hint">${esc(r.note)}</span>` : ""}</button>
    <button class="qb minus" aria-label="Bớt">−</button>
    <span class="qv">${empty ? "hết" : q || "—"}</span>
    <button class="qb plus" aria-label="Thêm">+</button>
    <button class="qb toplan" aria-label="Thêm vào thực đơn">🍽</button>
  </div>`;
}

function renderStock() {
  const q = norm($("#k-q").value);
  const list = state.stock.filter((r) => !q || norm(r.name).includes(q));
  const have = state.stock.filter((r) => r.qty == null || r.qty > 0).length;
  $("#k-sum").textContent = state.stock.length
    ? `Đang có ${have} thứ${state.stock.length > have ? ` · ${state.stock.length - have} đã hết` : ""}`
    : "Kho trống. Thêm những thứ đang có ở nhà ở ô bên dưới.";
  const groups = new Map();
  for (const r of list) {
    const c = r.category || (r.kind ? kindLabel(r.kind) : "Khác");
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(r);
  }
  let html = "";
  for (const c of [...groups.keys()].sort((a, b) => a.localeCompare(b, "vi"))) {
    html += `<h3>${esc(c)}</h3>${groups.get(c).map(stockRow).join("")}`;
  }
  $("#stock-list").innerHTML = html || (state.stock.length ? `<p class="hint empty">Không tìm thấy.</p>` : "");
}
$("#k-q").oninput = renderStock;


$("#k-menu").onclick = () => {
  // Chọn món trong Menu để thêm vào kho.
  let kind = "all";
  const sh = openSheet(`${sheetHead("Chọn từ Menu")}
    <input type="search" id="km-q" placeholder="Tìm món..." />
    <div class="filter" id="km-k">${kindButtons(kind, true)}</div>
    <div class="list" id="km-list"></div>`);
  const render = () => {
    const q = norm($("#km-q", sh).value);
    const list = state.foods.filter((f) => (kind === "all" || f.kind === kind) && (!q || norm(f.name).includes(q)));
    $("#km-list", sh).innerHTML =
      list.map((f) => {
        const have = stockOf(f.id);
        return `<button class="item" data-id="${f.id}"><span class="emo">${foodIcon(f)}</span>
        <span class="nm">${esc(f.name)}<span class="hint">${esc(foodSub(f))}</span>${have ? `<span class="instock">📦 ${esc(have)}</span>` : ""}</span></button>`;
      }).join("") || `<p class="hint empty">Không có món nào.</p>`;
  };
  render();
  $("#km-q", sh).oninput = render;
  $("#km-k", sh).onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    kind = b.dataset.k;
    $$("#km-k button", sh).forEach((x) => x.classList.toggle("on", x === b));
    render();
  };
  $("#km-list", sh).onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (b) openAddStock(state.byId.get(Number(b.dataset.id)), renderStock);
  };
};

$("#stock-list").addEventListener("click", (e) => {
  const row = e.target.closest(".srow");
  if (!row) return;
  const id = Number(row.dataset.id);
  const r = state.stock.find((x) => x.id === id);
  const step = (d) => {
    // Cập nhật ngay trên màn hình, gửi lên sau (bấm nhanh nhiều lần vẫn cộng đủ, không phải chờ tải lại cả kho).
    r.qty = Math.max(0, round2((r.qty ?? 0) + d));
    tap();
    setStock(state.stock);
    renderStock();
    saveStockQty(r);
  };
  if (e.target.closest(".minus")) step(-1);
  else if (e.target.closest(".plus")) step(1);
  else if (e.target.closest(".toplan")) openStockToPlan(r);
  else if (e.target.closest(".sn")) openStockEntry(r);
});

function openStockEntry(r) {
  const sh = openSheet(`${sheetHead(esc(r.name))}
    <form id="ks" class="form" autocomplete="off">
      <div class="f2">
        <label>Số lượng<input name="qty" inputmode="decimal" value="${r.qty != null ? fmtQty(r.qty) : ""}" /></label>
        <label>Đơn vị<input name="unit" list="dl-units" maxlength="15" value="${esc(r.unit)}" /></label>
      </div>
      <label>Ghi chú<input name="note" maxlength="200" placeholder="VD: hạn dùng, để ở tủ đông..." value="${esc(r.note)}" /></label>
      <div class="actions">
        <button type="button" class="ghost danger" id="ks-del">Xoá khỏi kho</button>
        <button class="primary">Lưu</button>
      </div>
    </form>`, { modal: true });
  $("#ks", sh).onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qty = parseNum(fd.get("qty"));
    if (Number.isNaN(qty) || qty < 0) return toast("Số lượng không hợp lệ.");
    busy(e.submitter, async () => {
      await api(`/api/stock/${r.id}`, { method: "PUT", body: { qty, unit: fd.get("unit"), note: fd.get("note") } });
      haptic();
      closeSheet();
      await loadStock();
    });
  };
  $("#ks-del", sh).onclick = (e) =>
    busy(e.currentTarget, async () => {
      await api(`/api/stock/${r.id}`, { method: "DELETE" });
      haptic("warning");
      closeSheet();
      await loadStock();
    });
}

$("#k-name").addEventListener("change", () => {
  const f = state.foods.find((x) => norm(x.name) === norm($("#k-name").value));
  if (f?.unit && !$("#k-unit").value) $("#k-unit").value = f.unit;
});
$("#k-add").onsubmit = (e) => {
  e.preventDefault();
  if (!$("#k-name").value.trim()) {
    $("#k-name").focus();
    return toast("Nhập tên thứ cần thêm vào kho trước.");
  }
  const qty = parseNum($("#k-qty").value);
  if (Number.isNaN(qty)) return toast("Số lượng không hợp lệ.");
  busy(e.submitter, async () => {
    const r = await api("/api/stock", {
      method: "POST",
      body: { name: $("#k-name").value, qty, unit: $("#k-unit").value },
    });
    e.target.reset();
    haptic();
    if (r.merged) toast("Đã cộng dồn vào món có sẵn trong kho.");
    await loadStock();
    $("#k-name").focus();
  });
};

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
    <div><b>${fmtMoney(total) || "0đ"}</b><span>tổng chi</span></div>
    <div><b>${cur?.n ?? 0}</b><span>lần mua</span></div>
    <div><b>${fmtMoney(total / days) || "0đ"}</b><span>trung bình/ngày</span></div>
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
