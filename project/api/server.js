export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { messages } = await req.json();
    const key = process.env.GOOGLE_API_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: 'Key Missing' }), { status: 500 });
    }

    // 1. Map messages to Gemini format (user -> user, assistant -> model)
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '...') }]
      }));

    // 2. Get the system prompt text
    const systemMsg = messages.find(m => m.role === 'system');
    const systemText = systemMsg ? systemMsg.content : "You are a helpful assistant.";

    // 3. The Fetch Call
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          system_instruction: {
            parts: [{ text: systemText }]
          }
        })
      }
    );

    if (!response.ok) {
      const errorMsg = await response.text();
      return new Response(JSON.stringify({ error: errorMsg }), { status: response.status });
    }

    return new Response(response.body, {
      headers: { 
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
