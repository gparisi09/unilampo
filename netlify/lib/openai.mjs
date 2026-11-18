import { store, oggi } from "./base.mjs";

// Voce e ascolto dell'orale. Due strade, senza chiavi nuove:
// - AI Gateway di Netlify (come Bandolampo): Netlify mette da sé OPENAI_API_KEY e OPENAI_BASE_URL
//   e il costo si paga in crediti Netlify (180 crediti ogni dollaro di uso);
// - oppure una chiave OpenAI propria, se un giorno la si aggiunge.
export const viaGateway = () => /netlify/i.test(process.env.OPENAI_BASE_URL || "");
export const chiaveOpenAI = () => !!process.env.OPENAI_API_KEY;
export const urlOpenAI = () => (viaGateway() ? process.env.OPENAI_BASE_URL : "https://api.openai.com/v1").replace(/\/+$/, "");

// Tetto a parte per la voce pagata in crediti Netlify (team Personal, crediti in comune con Bandolampo).
export const TETTO_VOCE_GATEWAY_GIORNO = 0.5; // dollari al giorno, circa 90 crediti Netlify: una decina di orali
export async function voceGatewayOk(usd) {
  if (!viaGateway()) return true;
  const g = await store("spesa").get("gateway/" + oggi(), { type: "json" }).catch(() => null);
  return ((g && g.usd) || 0) + usd <= TETTO_VOCE_GATEWAY_GIORNO;
}
export async function segnaGateway(usd) {
  if (!viaGateway()) return;
  const st = store("spesa"), k = "gateway/" + oggi(), g = (await st.get(k, { type: "json" }).catch(() => null)) || { usd: 0 };
  g.usd = Math.round((g.usd + usd) * 1e5) / 1e5;
  await st.setJSON(k, g).catch(() => {});
}
