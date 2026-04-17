export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { messages } = req.body;
  const API_KEY = process.env.GOOGLE_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "Missing GOOGLE_API_KEY on Vercel." });
  }

  // Extract instructions
  const systemMsg = messages.find(m => m.role === 'system');
  const SYS_TEXT = systemMsg ? systemMsg.content : "أنت مساعد ذكي.";

  // Format message history
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      let parts = [];
      if (Array.isArray(m.content)) {
        parts = m.content;
      } else {
        parts = [{ text: m.content }];
      }
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });

  // Inject instructions into history to bypass 'system_instruction' field issues
  const contents = [
    { role: 'user', parts: [{ text: `Instruction: ${SYS_TEXT}` }] },
    { role: 'model', parts: [{ text: "فهمتك تماماً يا مستر بدر. أنا علوق النخل وجاهز لمساعدتك بالعامية المصرية وبكل احترافية! اتفضل اسألني في أي حاجة." }] },
    ...userMessages
  ];

  // Return to v1beta for better model compatibility with 'gemini-1.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { 
          maxOutputTokens: 2048, 
          temperature: 0.85 
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
       console.error("API Error:", data);
       return res.status(500).json({ error: data.error?.message || "Google API Error" });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "عذراً، لم أستطع فهم ذلك.";
    res.status(200).json({ reply });

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
