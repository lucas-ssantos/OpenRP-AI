import { initDomRefs } from './chat/state.js';
import { initRollbackModal, initEditModal, initResetModal } from './chat/events.js';
import { init, initImmersiveMode } from './chat/loader.js';
import { initSelectionMode } from './chat/selection.js';
import { initConvModelModal } from './chat/model.js';

window.addEventListener('load', () => {
  initDomRefs();
  initImmersiveMode();
  initRollbackModal();
  initEditModal();
  initResetModal();
  initSelectionMode();
  initConvModelModal();
  init();
});
