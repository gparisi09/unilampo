import { json } from "../lib/base.mjs";
import { esegui } from "../lib/passi.mjs";

// Un passaggio alla volta, chiamato dall'app (approfondimenti, orale, e come riserva se il background non parte).
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad" }, 400); }
  return esegui(b);
};
export const config = { path: "/api/genera" };
