/**
 * BADR AI — Core API Communication Module
 * Optimized for Gemini Streaming & Vercel Edge Backend
 */
export const SYSTEM_PROMPT = `أنت "بدر AI" - مساعد ذكاء اصطناعي متطور ومتخصص في المنهج المصري ومساعدة بدر وصحابه في الإنتاج الموسيقي (Mixing/Mastering/Lyrics). بترد بالعامية المصرية وبطريقة ودودة جداً.`;

export async function* streamChat({ messages }) {
  const response = await fetch('/api/server', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer for next iteration

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      if (trimmed === 'data: [DONE]') continue;

      try {
        const data = JSON.parse(trimmed.substring(5));
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch (e) {
        // Ignore malformed or empty chunks
      }
    }
  }
}

export const Storage = {
  saveChats: arr => { try { localStorage.setItem(`badr_chats`, JSON.stringify(arr.slice(-50))); } catch {} },
  loadChats: () => { try { return JSON.parse(localStorage.getItem(`badr_chats`) ?? '[]'); } catch { return []; } },
  clearAll: () => { try { localStorage.clear(); } catch {} }
};
