import webpush from "web-push";
import { store } from "./base.mjs";

// Notifiche sul telefono (app aggiunta alla schermata Home): "dispensa pronta" anche ad app chiusa.
// Le chiavi VAPID stanno nelle variabili di Netlify (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
export const chiavePubblica = () => process.env.VAPID_PUBLIC_KEY || "";
export async function avvisa(uid, titolo, testo, url) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  webpush.setVapidDetails("https://unilampo.netlify.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const st = store("notifiche"), subs = (await st.get(uid, { type: "json" }).catch(() => null)) || [];
  if (!subs.length) return;
  const vive = [];
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify({ titolo, testo, url }), { TTL: 86400 }); vive.push(s); }
    catch (e) { if (e && e.statusCode !== 404 && e.statusCode !== 410) vive.push(s); } // 404/410: telefono disiscritto
  }
  if (vive.length !== subs.length) await st.setJSON(uid, vive).catch(() => {});
}
