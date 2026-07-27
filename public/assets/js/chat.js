import { initDomRefs } from './chat/state.js';
import { initRollbackModal, initEditModal, initResetModal, initRegenerateModal, initDeleteConversationModal } from './chat/events.js';
import { init, initImmersiveMode } from './chat/loader.js';
import { initSelectionMode } from './chat/selection.js';
import { initConvModelModal } from './chat/model.js';
import { initIdeas } from './chat/ideas.js';

window.addEventListener('load', () => {
  initDomRefs();
  initImmersiveMode();
  initRollbackModal();
  initEditModal();
  initResetModal();
  initDeleteConversationModal();
  initRegenerateModal();
  initSelectionMode();
  initConvModelModal();
  initIdeas();
  init();
});
