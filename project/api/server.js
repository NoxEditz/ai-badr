// Robust API Handler with Model Discovery and Fallback
const rateLimitMap = new Map();
const RATE_LIMIT = 20; 
const RATE_WINDOW = 60000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, reset: now + RATE_WINDOW };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + RATE_WINDOW; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "هدي اللعب شوية! (20 رسالة/دقيقة)" });

  const { messages } = req.body;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROQ_KEY   = process.env.GROQ_API_KEY;

  if (!GEMINI_KEY && !GROQ_KEY) return res.status(500).json({ error: "No API keys found." });

  // --- ATTEMPT 1: GEMINI ---
  if (GEMINI_KEY) {
    try {
      // Primary model string - common in 2026
      const modelName = "gemini-1.5-flash"; 
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`;
      
      const contents = formatGeminiMessages(messages);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) return res.status(200).json({ reply });
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error(`Gemini Failed | Status: ${response.status} | Model: ${modelName}`, JSON.stringify(errData));
        
        // DISCOVERY: List models to help debug what's available
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`;
        const listRes = await fetch(listUrl).then(r => r.json()).catch(() => ({}));
        console.log("AVAILABLE MODELS ON YOUR ACCOUNT:", JSON.stringify(listRes.models?.map(m => m.name)));
      }
    } catch (err) {
      console.error("Gemini Error:", err);
    }
  }

  // --- ATTEMPT 2: GROQ (Fallback) ---
  if (GROQ_KEY) {
    try {
      const groqMessages = formatGroqMessages(messages);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: groqMessages,
          max_tokens: 1000,
          temperature: 0.7
        })
      });
      const data = await response.json();
      if (response.ok) {
        const reply = data.choices?.[0]?.message?.content;
        return res.status(200).json({ reply: reply + " (Groq Fallback Mode)" });
      }
    } catch (err) {
      console.error("Groq Fallback Error:", err);
    }
  }

  return res.status(500).json({ error: "لا يمكن التواصل مع الذكاء الاصطناعي حالياً، حاول مرة أخرى." });
}

function formatGeminiMessages(messages) {
  const userMessages = messages.filter(m => m.role !== 'system').slice(-10).map(m => {
    let parts = [];
    if (Array.isArray(m.content)) {
      parts = m.content.map(p => {
        if (p.inlineData) return { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } };
        if (p.inline_data) return { inline_data: { mime_type: p.inline_data.mime_type || p.inline_data.mimeType, data: p.inline_data.data } };
        return p;
      });
    } else {
      parts = [{ text: m.content }];
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });

  return [
    { role: 'user', parts: [{ text: "Instruction: أنت علوق النخل. مساعد تعليمي مصري. رد بالعامية المصرية دايماً." }] },
    { role: 'model', parts: [{ text: "فهمتك! أنا جاهز للمساعدة." }] },
    ...userMessages
  ];
}

function formatGroqMessages(messages) {
  const groqMessages = messages.map(m => {
    let content = "";
    if (Array.isArray(m.content)) {
      content = m.content.filter(p => p.text).map(p => p.text).join("\n");
    } else {
      content = m.content;
    }
    return {
      role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'),
      content: content
    };
  }).slice(-11);

  if (groqMessages[0].role !== 'system') {
    groqMessages.unshift({ role: 'system', content: "أنت علوق النخل. مساعد تعليمي مصري. رد بالعامية المصرية دايماً." });
  }
  return groqMessages;
}
