export const config = { runtime: 'edge' };

export default async function handler(req) {
  // 1. Handle Preflight (CORS)
  if (req.method === 'OPTIONS') {
    return new Response('OK', { status: 200 });
  }

  try {
    const { messages } = await req.json();
    const key = process.env.GOOGLE_API_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing API Key in Vercel Settings' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Prepare Gemini Format
    // Extract system message for the special 'system_instruction' field
    const systemMsg = messages.find(m => m.role === 'system');
    
    // Convert history: Gemini uses 'model' instead of 'assistant'
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: Array.isArray(m.content) ? m.content : [{ text: String(m.content) }]
      }));

    const body = {
      contents,
      system_instruction: systemMsg ? {
        parts: [{ text: systemMsg.content }]
      } : undefined,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    };

    // 3. Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API Error:", errText);
      return new Response(JSON.stringify({ error: "Gemini API rejected the request" }), { status: response.status });
    }

    // 4. Return the Stream
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (err) {
    console.error("Server Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
