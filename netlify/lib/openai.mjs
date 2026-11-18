// Voce e ascolto: sempre api.openai.com con la chiave dell'utente (mai l'AI Gateway di Netlify).
export const URL_OPENAI = "https://api.openai.com/v1";
export const chiaveOpenAI = () => !!process.env.OPENAI_API_KEY && !/netlify/i.test(process.env.OPENAI_BASE_URL || "");
