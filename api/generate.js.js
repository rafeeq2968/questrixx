// ═══════════════════════════════════════════════════════════════════
// Questrix — Vercel Serverless Function  /api/generate.js
// Both Gemini and Groq are used with EQUAL weight (random pick).
// If the chosen one fails, the other is tried automatically.
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' });
  if (prompt.length > 50000) return res.status(400).json({ error: 'Prompt too long' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROQ_KEY   = process.env.GROQ_API_KEY;

  // ─── Equal load balancing: randomly pick which AI goes first ────
  // If the first one fails for any reason, the second is tried automatically.
  const useGeminiFirst = Math.random() < 0.5;
  const order = useGeminiFirst ? ['gemini', 'groq'] : ['groq', 'gemini'];

  for (const engine of order) {

    // ── GEMINI ──────────────────────────────────────────────────────
    if (engine === 'gemini' && GEMINI_KEY) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
            })
          }
        );
        if (r.ok) {
          const d = await r.json();
          const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return res.status(200).json({ result: text, model: 'Gemini 1.5 Flash' });
        }
        const eb = await r.json().catch(() => ({}));
        console.warn('Gemini failed:', eb?.error?.message || r.status, '— trying next');
      } catch (e) {
        console.warn('Gemini exception:', e.message, '— trying next');
      }
    }

    // ── GROQ ────────────────────────────────────────────────────────
    if (engine === 'groq' && GROQ_KEY) {
      try {
        const p = prompt.length > 16000
          ? prompt.substring(0, 16000) + '\n\n[Trimmed. Generate complete paper from above specifications.]'
          : prompt;

        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: p }],
            max_tokens: 8000,
            temperature: 0.7
          })
        });
        if (r.ok) {
          const d = await r.json();
          const text = d?.choices?.[0]?.message?.content;
          if (text) return res.status(200).json({ result: text, model: 'Groq LLaMA 3.3' });
        }
        const eb = await r.json().catch(() => ({}));
        console.warn('Groq failed:', eb?.error?.message || r.status);
      } catch (e) {
        console.warn('Groq exception:', e.message);
      }
    }
  }

  // Both failed
  if (!GEMINI_KEY && !GROQ_KEY) {
    return res.status(500).json({
      error: 'API keys not configured. Go to Vercel → Settings → Environment Variables and add GEMINI_API_KEY and GROQ_API_KEY, then Redeploy.'
    });
  }
  return res.status(500).json({ error: 'AI generation failed. Please try again.' });
}
