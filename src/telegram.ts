// Xác thực initData của Telegram Mini App và gọi Bot API.
// Tài liệu: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Trả về user nếu initData hợp lệ (đúng chữ ký, chưa quá maxAgeSec), ngược lại null. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 7 * 24 * 3600,
): Promise<TgUser | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (expected !== hash) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
}

export async function tgCall(botToken: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
