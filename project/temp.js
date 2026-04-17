
// --- CHAT API LOGIC INLINED TO AVOID LOCAL CORS ERRORS ---
const SYSTEM_PROMPT = `أنت "بدر AI" - مساعد ذكاء اصطناعي متطور ومتخصص في المنهج المصري ومساعدة بدر وصحابه . بترد بالعامية المصرية وبطريقة ودودة جداً.`;

async function* streamChat({ messages }) {
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

const Storage = {
  saveChats: arr => { try { localStorage.setItem(`badr_chats`, JSON.stringify(arr.slice(-50))); } catch {} },
  loadChats: () => { try { return JSON.parse(localStorage.getItem(`badr_chats`) ?? '[]'); } catch { return []; } },
  clearAll: () => { try { localStorage.clear(); } catch {} }
};

class APIError extends Error {
  constructor(message) {
    super(message);
    this.name = 'APIError';
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({ name: file.name, mediaType: file.type, data: base64, size: file.size });
    };
    reader.onerror = () => reject(new Error('فشل قراءة الصورة'));
    reader.readAsDataURL(file);
  });
}

function buildMessageContent(text, images) {
  let parts = [];
  if (text) {
    parts.push({ text: text });
  }
  if (images && images.length > 0) {
    images.forEach(img => {
      parts.push({
        inlineData: {
          mimeType: img.mediaType,
          data: img.data
        }
      });
    });
  }
  return parts.length > 0 ? parts : '';
}
// --------------------------------------------------------

/* ─── Configure marked.js ─── */
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
  });
}

/* ═══════════════════════════
   APP STATE
═══════════════════════════ */
let state = {
  apiKey:         '',
  chats:          [],         // [{ id, title, messages: [{role, content, images?, time}] }]
  activeChatId:   null,
  streaming:      false,
  pendingImages:  [],         // { name, mediaType, data, size, preview }[]
  recognition:    null,
  recordingTimer: null,
  recordingSec:   0,
  abortController: null,
};

/* active chat shortcut */
const activeChat = () => state.chats.find(c => c.id === state.activeChatId);

/* ═══════════════════════════
   DOM REFS
═══════════════════════════ */
const $  = id => document.getElementById(id);
const $onboarding     = $('onboarding-screen');
const $aiIntroModal   = $('ai-intro-modal');
const $sliderHandleWrap = $('slider-handle-wrap');
const $sliderHandle   = $('slider-handle');
const $sliderProgress = $('slider-progress');
const $introStartBtn  = $('intro-start-btn');

const $app            = $('app');
const $msgList        = $('messages-list');
const $msgContainer   = $('messages-container');
const $welcome        = $('welcome-screen');
let $typingInd        = null;  // created dynamically
const $input          = $('message-input');
const $sendBtn        = $('send-btn');
const $fileBtn        = $('file-btn');
const $fileInput      = $('file-input');
const $voiceBtn       = $('voice-btn');
const $previewStrip   = $('file-preview-strip');
const $chatHistory    = $('chat-history');
const $emptyMsg       = $('sb-empty-msg');
const $voiceOverlay   = $('voice-overlay');
const $voTimer        = $('vo-timer');
const $voTranscript   = $('vo-transcript');

/* ═══════════════════════════
   CANVAS BACKGROUND
═══════════════════════════ */
(function initCanvas() {
  const canvas = $('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, nodes = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    initNodes();
  }

  function initNodes() {
    const count = Math.min(Math.floor((W * H) / 14000), 90);
    nodes = Array.from({ length: count }, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      vx: (Math.random() - .5) * .35,
      vy: (Math.random() - .5) * .35,
      r:  Math.random() * 2.2 + .8,
      pulse: Math.random() * Math.PI * 2,
    }));
  }

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    // draw connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          const alpha = (1 - dist / 130) * .18;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(0,255,65,${alpha})`;
          ctx.lineWidth   = .7;
          ctx.stroke();
        }
      }
    }

    // draw nodes
    for (const n of nodes) {
      n.pulse += .025;
      const glow = (.5 + .5 * Math.sin(n.pulse)) * .6 + .2;

      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
      grad.addColorStop(0,   `rgba(0,255,65,${glow * .9})`);
      grad.addColorStop(.4,  `rgba(0,255,65,${glow * .35})`);
      grad.addColorStop(1,   'rgba(0,255,65,0)');

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,255,65,${glow})`;
      ctx.fill();

      n.x += n.vx; n.y += n.vy;
      if (n.x < -10)  n.x = W + 10;
      if (n.x > W+10) n.x = -10;
      if (n.y < -10)  n.y = H + 10;
      if (n.y > H+10) n.y = -10;
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

/* ═══════════════════════════
   HELPERS
═══════════════════════════ */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function now() {
  return new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, isError = false) {
  const $t = $('toast');
  $t.innerHTML = `<div class="toast-inner${isError?' error':''}">${msg}</div>`;
  $t.classList.remove('hidden');
  setTimeout(() => $t.classList.add('hidden'), 3000);
}

function autoResize() {
  $input.style.height = 'auto';
  $input.style.height = Math.min($input.scrollHeight, 160) + 'px';
}

function scrollToBottom(smooth = true) {
  $msgContainer.scrollTo({
    top: $msgContainer.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  });
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return text;
  try {
    return DOMPurify.sanitize(marked.parse(text));
  } catch { return text; }
}

function updateSendBtn() {
  const hasText  = $input.value.trim().length > 0;
  const hasImages = state.pendingImages.length > 0;
  $sendBtn.disabled = (!hasText && !hasImages) || state.streaming;
}

/* ═══════════════════════════
   ONBOARDING / SLIDE TO UNLOCK
═══════════════════════════ */
function initOnboarding() {
  const hasSeenIntro = localStorage.getItem('badr_intro_seen') === 'true';
  
  if (hasSeenIntro) {
    // User has seen intro before, launch app directly
    $onboarding.classList.add('hidden');
    launchApp();
    return;
  }
  
  // First time user - show slide to unlock
  $onboarding.classList.remove('hidden');
  $aiIntroModal.classList.remove('visible');
  
  let isDragging = false;
  let startX = 0;
  const sliderTrack = document.getElementById("slider-track");
  const maxSlide = sliderTrack ? sliderTrack.offsetWidth - 64 : 240;

  function completeSlide() {
    console.log("✅ Slide completed!");
    isDragging = false;
    $sliderHandleWrap.style.transition = "transform .4s cubic-bezier(.4,0,.2,1)";
    // Snap to end with negative value for RTL
    $sliderHandleWrap.style.transform = `translateY(-50%) translateX(${-maxSlide}px)`;
    $sliderProgress.style.width = "100%";

    setTimeout(() => {
      $onboarding.classList.add("hidden");
      setTimeout(() => {
        $aiIntroModal.classList.add("visible");
      }, 100);
    }, 300);
  }

  function handleStart(e) {
    isDragging = true;
    startX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
    $sliderHandle.style.transition = "none";
    $sliderHandleWrap.style.transition = "none";
    console.log("🖱️ Drag started at", startX);
  }

  function handleMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const currentX = e.type.includes("mouse") ? e.clientX : e.touches[0].clientX;
    
    // RTL FIX: Calculate distance (stay positive for math)
    let moveDistance = Math.min(Math.max(0, startX - currentX), maxSlide);
    
    // APPLY AS NEGATIVE - This moves it left in RTL
    $sliderHandleWrap.style.transform = `translateY(-50%) translateX(${-moveDistance}px)`;
    $sliderProgress.style.width = `${(moveDistance / maxSlide) * 100}%`;
    
    // Visual feedback: dim text as you slide
    const sliderText = document.querySelector('.slider-text');
    if (sliderText) {
      sliderText.style.opacity = 1 - (moveDistance / maxSlide);
    }

    if (moveDistance >= maxSlide * 0.9) {
      handleEnd();
      completeSlide();
    }
  }

  function handleEnd() {
    if (!isDragging) return;
    isDragging = false;
    $sliderHandle.style.transition = "transform .15s ease";

    const currentTransform = $sliderHandleWrap.style.transform;
    const match = currentTransform.match(/translateX\(([\d.]+)px\)/);
    const currentX = match ? parseFloat(match[1]) : 0;

    if (currentX < maxSlide * 0.9) {
      $sliderHandleWrap.style.transition = "transform .3s cubic-bezier(.4,0,.2,1)";
      $sliderHandleWrap.style.transform = "translateY(-50%) translateX(0)";
      $sliderProgress.style.transition = "width .3s ease";
      $sliderProgress.style.width = "0%";
    }
  }

  // Attach events to handle wrapper
  $sliderHandleWrap.addEventListener("mousedown", handleStart);
  $sliderHandleWrap.addEventListener("touchstart", handleStart, { passive: false });

  // Attach move/end to window for smooth dragging
  window.addEventListener("mousemove", handleMove);
  window.addEventListener("touchmove", handleMove, { passive: false });
  window.addEventListener("mouseup", handleEnd);
  window.addEventListener("touchend", handleEnd);

  console.log("🚀 Slider initialized. Max slide:", maxSlide);
}



function launchApp() {
  state.chats = Storage.loadChats();
  renderSidebar();
  if (state.chats.length) {
    loadChat(state.chats[state.chats.length - 1].id);
  } else {
    newChat();
  }
}

/* ═══════════════════════════
   CHAT MANAGEMENT
═══════════════════════════ */
function newChat() {
  const chat = {
    id:       genId(),
    title:    'محادثة جديدة',
    messages: [],
    created:  Date.now(),
  };
  state.chats.push(chat);
  state.activeChatId = chat.id;
  Storage.saveChats(state.chats);
  renderSidebar();
  renderMessages();
}

function loadChat(id) {
  state.activeChatId = id;
  renderSidebar();
  renderMessages();
  state.pendingImages = [];
  renderFilePreview();
  scrollToBottom(false);
}

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  Storage.saveChats(state.chats);
  if (state.activeChatId === id) {
    if (state.chats.length) loadChat(state.chats[state.chats.length - 1].id);
    else newChat();
  }
  renderSidebar();
}

function updateChatTitle(chat, text) {
  if (chat.title === 'محادثة جديدة') {
    chat.title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    renderSidebar();
  }
}

/* ═══════════════════════════
   SIDEBAR RENDERING
═══════════════════════════ */
function renderSidebar() {
  const sorted = [...state.chats].reverse();
  $emptyMsg.style.display = sorted.length ? 'none' : 'block';

  // rebuild list
  const existing = {};
  $chatHistory.querySelectorAll('.chat-history-item').forEach(el => {
    existing[el.dataset.id] = el;
  });

  // clear & re-render (simple approach)
  $chatHistory.innerHTML = '';
  if (!sorted.length) {
    $chatHistory.appendChild($emptyMsg);
    return;
  }

  for (const chat of sorted) {
    const el = document.createElement('div');
    el.className = 'chat-history-item' + (chat.id === state.activeChatId ? ' active' : '');
    el.dataset.id = chat.id;
    el.innerHTML = `
      <span class="chi-icon">💬</span>
      <span class="chi-title">${escapeHtml(chat.title)}</span>
      <button class="chi-del" data-del="${chat.id}" title="حذف">✕</button>
    `;
    el.addEventListener('click', () => loadChat(chat.id));
    el.querySelector('.chi-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteChat(chat.id);
    });
    $chatHistory.appendChild(el);
  }
}

/* ═══════════════════════════
   MESSAGE RENDERING
═══════════════════════════ */
function renderMessages() {
  const chat = activeChat();
  if (!chat) return;

  $msgList.innerHTML = '';

  if (!chat.messages.length) {
    $welcome.style.display = 'flex';
    return;
  }

  $welcome.style.display = 'none';

  for (const msg of chat.messages) {
    $msgList.appendChild(buildMessageEl(msg));
  }

  scrollToBottom(false);
}

function buildMessageEl(msg) {
  const row = document.createElement('div');
  row.className = `msg-row ${msg.role}`;
  row.dataset.msgId = msg.id || '';

  const avatarHtml = msg.role === 'user'
    ? `<div class="msg-avatar user-av">👤</div>`
    : `<div class="msg-avatar ai-av">🤖</div>`;

  let imagesHtml = '';
  if (msg.images?.length) {
    imagesHtml = msg.images.map(img =>
      `<img class="msg-image-preview" src="data:${img.mediaType};base64,${img.data}" alt="${escapeHtml(img.name)}" />`
    ).join('');
  }

  const bubbleContent = msg.role === 'assistant'
    ? renderMarkdown(msg.content || '')
    : escapeHtml(msg.content || '').replace(/\n/g, '<br>');

  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-body">
      ${imagesHtml}
      <div class="msg-bubble">${bubbleContent}</div>
      <span class="msg-time">${msg.time || ''}</span>
    </div>
  `;
  return row;
}

function appendMessage(msg) {
  const chat = activeChat();
  if (!chat) return;

  if (!msg.id) msg.id = genId();
  chat.messages.push(msg);
  Storage.saveChats(state.chats);

  $welcome.style.display = 'none';

  const el = buildMessageEl(msg);
  $msgList.appendChild(el);
  scrollToBottom();
  return el;
}

function appendTypingIndicator() {
  const el = document.createElement('div');
  el.id = 'typing-indicator';
  el.className = 'typing-indicator';
  el.innerHTML = `
    <div class="msg-row assistant" style="padding:5px 16px">
      <div class="msg-avatar ai-av">🤖</div>
      <div class="msg-body">
        <div class="msg-bubble" style="padding:14px 18px">
          <div style="display:flex;gap:5px;align-items:center">
            <div class="ti-dot"></div>
            <div class="ti-dot"></div>
            <div class="ti-dot"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  $msgList.appendChild(el);
  scrollToBottom();
  return el;
}

//* ═══════════════════════════
   SEND MESSAGE
═══════════════════════════ */
async function sendMessage() {
  if (state.streaming) return;
  const text   = $input.value.trim();
  const images = [...state.pendingImages];

  if (!text && !images.length) return;

  const chat = activeChat();
  if (!chat) return;

  // Clear input
  $input.value = '';
  autoResize();
  state.pendingImages = [];
  renderFilePreview();
  updateSendBtn();

  // User message
  const userMsg = {
    id:      genId(),
    role:    'user',
    content: text,
    images:  images.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
    time:    now(),
  };
  appendMessage(userMsg);
  updateChatTitle(chat, text || '📎 صورة');

  // --- API messages format (Updated to include SYSTEM_PROMPT) ---
  const apiMessages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  // Add previous messages from the chat history
  chat.messages.slice(0, -1).forEach(m => {
    apiMessages.push({
      role:    m.role,
      content: m.images?.length
        ? buildMessageContent(m.content, m.images)
        : m.content,
    });
  });

  // Add the current message the user just typed
  apiMessages.push({
    role:    'user',
    content: images.length
      ? buildMessageContent(text, images)
      : text,
  });
  // --------------------------------------------------------------

  // Show typing
  state.streaming = true;
  $sendBtn.disabled = true;
  const typingEl = appendTypingIndicator();

  // Streaming AI response
  let fullText = '';
  let aiMsgEl  = null;
  let aiBubble = null;

  try {
    state.abortController = new AbortController();

    for await (const chunk of streamChat({ messages: apiMessages })) {
      fullText += chunk;

      if (!aiMsgEl) {
        // First chunk — remove typing, add bubble
        typingEl.remove();
        const aiMsg = {
          id:      genId(),
          role:    'assistant',
          content: '',
          time:    now(),
        };
        chat.messages.push(aiMsg);
        aiMsgEl  = buildMessageEl(aiMsg);
        aiMsgEl.dataset.live = '1';
        $msgList.appendChild(aiMsgEl);
        aiBubble = aiMsgEl.querySelector('.msg-bubble');
        aiBubble.classList.add('streaming', 'cursor');
      }

      // Update bubble content live
      aiBubble.innerHTML = renderMarkdown(fullText);
      aiBubble.classList.add('cursor');
      scrollToBottom(false);
    }

    // Finalise
    if (aiMsgEl) {
      const aiMsg = chat.messages[chat.messages.length - 1];
      aiMsg.content = fullText;
      aiMsg.time    = now();
      aiBubble.classList.remove('streaming', 'cursor');
      aiBubble.innerHTML = renderMarkdown(fullText);
      Storage.saveChats(state.chats);
    } else if (typingEl.parentNode) {
      // empty response
      typingEl.remove();
    }

  } catch (err) {
    typingEl?.remove();
    if (aiMsgEl) aiMsgEl.remove();

    // Pop last AI if partially added
    if (chat.messages[chat.messages.length - 1]?.role === 'assistant') {
      chat.messages.pop();
    }

    const isNetwork = err instanceof NetworkError;
    const errMsg    = err.message || 'حصل خطأ غير متوقع، حاول تاني';
    showToast(`❌ ${errMsg}`, true);

    // Show error bubble
    const errMsgObj = {
      id:      genId(),
      role:    'assistant',
      content: `⚠️ **عذراً، حصلت مشكلة:**\n\n${errMsg}\n\n${isNetwork ? 'تأكد من اتصالك بالإنترنت وحاول تاني.' : ''}`,
      time:    now(),
    };
    appendMessage(errMsgObj);
  } finally {
    state.streaming      = false;
    state.abortController = null;
    updateSendBtn();
    renderSidebar();
  }
}
/* ═══════════════════════════
   FILE UPLOAD
═══════════════════════════ */
$fileBtn.addEventListener('click', () => $fileInput.click());

$fileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  $fileInput.value = '';
  if (!files.length) return;

  for (const file of files) {
    try {
      const processed  = await processImageFile(file);
      const previewUrl = URL.createObjectURL(file);
      state.pendingImages.push({ ...processed, preview: previewUrl });
    } catch (err) {
      showToast(`⚠️ ${err.message}`, true);
    }
  }
  renderFilePreview();
  updateSendBtn();
});

function renderFilePreview() {
  if (!state.pendingImages.length) {
    $previewStrip.classList.add('hidden');
    $previewStrip.innerHTML = '';
    return;
  }
  $previewStrip.classList.remove('hidden');
  $previewStrip.innerHTML = state.pendingImages.map((img, i) => `
    <div class="fp-item">
      <img src="${img.preview}" alt="${escapeHtml(img.name)}" />
      <button class="fp-remove" data-idx="${i}" title="حذف الصورة">✕</button>
    </div>
  `).join('');

  $previewStrip.querySelectorAll('.fp-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      URL.revokeObjectURL(state.pendingImages[idx]?.preview);
      state.pendingImages.splice(idx, 1);
      renderFilePreview();
      updateSendBtn();
    });
  });
}

/* ═══════════════════════════
   VOICE RECORDING
═══════════════════════════ */
let voiceRecognition = null;
let voiceTimer       = null;
let voiceSec         = 0;
let voiceTranscript  = '';

function startVoiceRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showToast('⚠️ المتصفح ده مش بيدعم التسجيل الصوتي، استخدم Chrome أو Edge', true);
    return;
  }

  voiceTranscript = '';
  voiceSec        = 0;
  $voTimer.textContent   = '0:00';
  $voTranscript.textContent = 'تكلم الآن... 🎙️';
  $voiceOverlay.classList.remove('hidden');
  $voiceBtn.classList.add('recording');

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang              = 'ar-EG';
  voiceRecognition.interimResults    = true;
  voiceRecognition.continuous        = true;
  voiceRecognition.maxAlternatives   = 1;

  voiceRecognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) voiceTranscript += t + ' ';
      else interim = t;
    }
    $voTranscript.textContent = (voiceTranscript + interim).trim() || 'تكلم الآن... 🎙️';
  };

  voiceRecognition.onerror = e => {
    if (e.error !== 'no-speech') {
      showToast(`⚠️ خطأ في التسجيل: ${e.error}`, true);
    }
    stopVoiceRecording(false);
  };

  voiceRecognition.onend = () => {
    // auto-restart if overlay still visible
    if (!$voiceOverlay.classList.contains('hidden')) {
      try { voiceRecognition.start(); } catch {}
    }
  };

  voiceRecognition.start();

  voiceTimer = setInterval(() => {
    voiceSec++;
    const m = Math.floor(voiceSec / 60);
    const s = (voiceSec % 60).toString().padStart(2, '0');
    $voTimer.textContent = `${m}:${s}`;
    if (voiceSec >= 120) stopVoiceRecording(true); // max 2 min
  }, 1000);
}

function stopVoiceRecording(send = true) {
  clearInterval(voiceTimer);
  try { voiceRecognition?.stop(); } catch {}
  $voiceOverlay.classList.add('hidden');
  $voiceBtn.classList.remove('recording');

  const text = voiceTranscript.trim();
  if (send && text) {
    $input.value = ($input.value + ' ' + text).trim();
    autoResize();
    updateSendBtn();
    showToast('✅ تم تسجيل الكلام بنجاح');
  }
  voiceRecognition = null;
}

$voiceBtn.addEventListener('click', () => {
  if ($voiceOverlay.classList.contains('hidden')) startVoiceRecording();
  else stopVoiceRecording(true);
});

$('vo-stop-btn').addEventListener('click', () => stopVoiceRecording(true));

/* ═══════════════════════════
   INPUT EVENTS
═══════════════════════════ */
$input.addEventListener('input', () => { autoResize(); updateSendBtn(); });

$input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!$sendBtn.disabled) sendMessage();
  }
});

$sendBtn.addEventListener('click', sendMessage);

/* Welcome card clicks */
document.querySelectorAll('.welcome-card').forEach(card => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt;
    if (prompt) {
      $input.value = prompt;
      autoResize();
      updateSendBtn();
      $input.focus();
    }
  });
});

/* ═══════════════════════════
   SIDEBAR CONTROLS
═══════════════════════════ */
$('new-chat-btn').addEventListener('click', newChat);
$('header-new-chat').addEventListener('click', newChat);

$('clear-chat-btn').addEventListener('click', () => {
  const chat = activeChat();
  if (!chat || !chat.messages.length) return;
  chat.messages = [];
  Storage.saveChats(state.chats);
  renderMessages();
  showToast('🗑️ تم مسح المحادثة');
});

const $sidebarEl   = $('sidebar');
const $backdrop    = $('sidebar-backdrop');

function openSidebar() {
  $sidebarEl.classList.add('open');
  $backdrop.classList.add('show');
}
function closeSidebar() {
  $sidebarEl.classList.remove('open');
  $backdrop.classList.remove('show');
}

$('toggle-sidebar').addEventListener('click', () => {
  $sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar();
});
$backdrop.addEventListener('click', closeSidebar);



/* ═══════════════════════════
   UTILITY
═══════════════════════════ */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════
   BOOT
═══════════════════════════ */

// Bulletproof event listener for the "Start Chat" button
const startBtn = document.getElementById('intro-start-btn');

if (startBtn) {
  startBtn.addEventListener('click', () => {
    console.log("✅ Start button clicked!"); 
    
    // 1. Mark as seen
    localStorage.setItem('badr_intro_seen', 'true');
    
    // 2. Hide the Intro Modal
    const modal = document.getElementById('ai-intro-modal');
    if (modal) modal.classList.remove('visible');
    
    // 3. Hide the entire Onboarding screen
    const onboarding = document.getElementById('onboarding-screen');
    if (onboarding) {
        onboarding.classList.add('hidden');
        onboarding.style.display = 'none'; // Force hide just in case
    }
    
    // 4. Show the main chat interface directly (skip API key setup since it's in env)
    const app = document.getElementById('app');
    const welcome = document.getElementById('welcome-screen');
    if (app) {
        app.classList.remove('hidden');
        if (welcome) welcome.classList.remove('hidden');
        
        // Render sidebar and messages
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof renderMessages === 'function') renderMessages();
    }
  });
}

initOnboarding();

