// ═══════════════════════════════════════════════════════════════════
// Questrix — Vercel Serverless Function  /api/generate.js
// Tries 5 models across 2 providers — if any one works, it succeeds.
// ═══════════════════════════════════════════════════════════════════

// Fetch with a hard timeout so one slow model doesn't block the others
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROQ_KEY   = process.env.GROQ_API_KEY;

  if (!GEMINI_KEY && !GROQ_KEY) {
    return res.status(500).json({
      error: 'API keys not configured. Go to Vercel → Settings → Environment Variables and add GEMINI_API_KEY and GROQ_API_KEY, then Redeploy.'
    });
  }

  const errors = [];

  // ── GEMINI: try 2.0-flash first, then 1.5-flash ─────────────────
  if (GEMINI_KEY) {
    const geminiModels = [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
    ];
    for (const m of geminiModels) {
      try {
        const r = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
            })
          },
          25000 // 25s per model attempt
        );
        if (r.ok) {
          const d = await r.json();
          const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return res.status(200).json({ result: text, model: m.label });
          errors.push(`${m.label}: empty response`);
        } else {
          const eb = await r.json().catch(() => ({}));
          const msg = eb?.error?.message || `HTTP ${r.status}`;
          errors.push(`${m.label}: ${msg}`);
          // Stop trying Gemini on auth errors — key is wrong
          if (r.status === 400 || r.status === 403) break;
        }
      } catch(e) {
        errors.push(`${m.label}: ${e.message}`);
      }
    }
  }

  // ── GROQ: try fast model first, then versatile ───────────────────
  if (GROQ_KEY) {
    const p = prompt.length > 16000
      ? prompt.substring(0, 16000) + '\n\n[Trimmed. Generate complete paper from above specifications.]'
      : prompt;

    const groqModels = [
      { id: 'llama-3.1-8b-instant',    label: 'Questrix AI (Fast)' },
      { id: 'llama-3.3-70b-versatile', label: 'Questrix AI' },
      { id: 'mixtral-8x7b-32768',      label: 'Questrix AI (Mix)' },
    ];
    for (const m of groqModels) {
      try {
        const r = await fetchWithTimeout(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
            body: JSON.stringify({
              model: m.id,
              messages: [{ role: 'user', content: p }],
              max_tokens: 8000,
              temperature: 0.7
            })
          },
          25000
        );
        if (r.ok) {
          const d = await r.json();
          const text = d?.choices?.[0]?.message?.content;
          if (text) return res.status(200).json({ result: text, model: m.label });
          errors.push(`${m.label}: empty response`);
        } else {
          const eb = await r.json().catch(() => ({}));
          const msg = eb?.error?.message || `HTTP ${r.status}`;
          errors.push(`${m.label}: ${msg}`);
          // Stop on auth error
          if (r.status === 401) break;
        }
      } catch(e) {
        errors.push(`${m.label}: ${e.message}`);
      }
    }
  }

  // All models failed — return detailed error for diagnosis
  console.error('All models failed:', errors);
  return res.status(500).json({
    error: 'AI generation failed. Please try again.',
    detail: errors.join(' | ')
  });
}
