import { getDB, saveDB } from "../db.js";
import { rollDailyMood } from "../../../core/mood.js";
import { localDatetime } from "../../../utils/datetime.js";

export function getDailyMoodForCharacter(characterId, now = localDatetime(), random = Math.random) {
  const moodDate = String(now).slice(0, 10);
  const db = getDB();
  const existing = db.exec(
    `SELECT mood_date, mood, cause_hint FROM character_moods WHERE character_id = ?`,
    [characterId]
  );

  if (existing.length > 0 && existing[0].values.length > 0) {
    const [storedDate, mood, causeHint] = existing[0].values[0];
    if (storedDate === moodDate) {
      return mood ? { date: storedDate, mood, cause: causeHint } : null;
    }
  }

  const selected = rollDailyMood(random);
  db.run(
    `INSERT INTO character_moods (character_id, mood_date, mood, cause_hint)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET
       mood_date = excluded.mood_date,
       mood = excluded.mood,
       cause_hint = excluded.cause_hint`,
    [characterId, moodDate, selected?.mood ?? null, selected?.cause ?? null]
  );
  saveDB();

  return selected ? { date: moodDate, ...selected } : null;
}
