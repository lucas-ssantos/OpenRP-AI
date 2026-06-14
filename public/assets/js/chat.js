import { initDomRefs } from './chat/state.js';
import { initRollbackModal, initEditModal } from './chat/events.js';
import { init, initImmersiveMode } from './chat/loader.js';

window.addEventListener('load', () => {
  initDomRefs();
  initImmersiveMode();
  initRollbackModal();
  initEditModal();
  init();
});
