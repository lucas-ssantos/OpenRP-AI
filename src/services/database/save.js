import { flushDB } from "./db.js";

// Usada pelo shutdown: força a gravação imediata de qualquer escrita pendente
// do debounce (ver db.js).
export function saveDB() {
  flushDB();
}
