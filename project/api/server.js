export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { messages } = await req.json();
    const key = process.env.GOOGLE_API_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 500 });
    }

    // Convert Badr AI messages to Gemini format
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content) }]
      }));

    const systemMsg = messages.find(m => m.role === 'system');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          system_instruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined
        })
      }
    );

    return new Response(response.body, {
      headers: { 'Content-Type': 'text/event-stream' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
