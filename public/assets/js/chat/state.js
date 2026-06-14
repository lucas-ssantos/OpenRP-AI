export const characterId = window.location.pathname.split('/')[2];

export const state = {
  conversationId: null,
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
};

export function initDomRefs() {
  dom.bg        = document.getElementById('bg');
  dom.headerAvt = document.getElementById('header-avatar');
  dom.charNameEl = document.getElementById('char-name');
  dom.scenarioEl = document.getElementById('char-scenario');
  dom.messagesEl = document.getElementById('messages');
  dom.inputEl    = document.getElementById('msg-input');
  dom.sendBtn    = document.getElementById('send-btn');
}
