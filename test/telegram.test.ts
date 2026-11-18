import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyInitData } from "../src/telegram.ts";

const BOT = "123456:ABC-test";

// Ký initData giống cách Telegram làm.
function sign(fields: Record<string, string>): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 111, first_name: "Hữu" });
const now = String(Math.floor(Date.now() / 1000));

test("initData hợp lệ trả về user", async () => {
  const u = await verifyInitData(sign({ auth_date: now, query_id: "x", user }), BOT);
  assert.equal(u?.id, 111);
});

test("sai chữ ký bị từ chối", async () => {
  const s = sign({ auth_date: now, user }).replace("first_name", "first_nam3");
  assert.equal(await verifyInitData(s, BOT), null);
});

test("sai bot token bị từ chối", async () => {
  assert.equal(await verifyInitData(sign({ auth_date: now, user }), "999:other"), null);
});

test("initData quá cũ bị từ chối", async () => {
  const old = String(Math.floor(Date.now() / 1000) - 8 * 24 * 3600);
  assert.equal(await verifyInitData(sign({ auth_date: old, user }), BOT), null);
});
