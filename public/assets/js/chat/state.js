// O chat é por conversa: /chat/:conversationId. O personagem é descoberto via a conversa.
export const conversationId = window.location.pathname.split('/')[2];

export const state = {
  conversationId: null,
  characterId: null,
  scenarioText: '',
  isStreaming: false,
};

export const dom = {
  bg: null,
  headerAvt: null,
  charNameEl: null,
  scenarioEl: null,
  messagesEl: null,
  inputEl: null,
  sendBtn: null,
  pauseBtn: null,
};

export function initDomRefs() {
  dom.bg        = document.getElementById('bg');
  dom.headerAvt = document.getElementById('header-avatar');
  dom.charNameEl = document.getElementById('char-name');
  dom.scenarioEl = document.getElementById('char-scenario');
  dom.messagesEl = document.getElementById('messages');
  dom.inputEl    = document.getElementById('msg-input');
  dom.sendBtn    = document.getElementById('send-btn');
  dom.pauseBtn   = document.getElementById('pause-btn');
}
