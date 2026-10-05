const DAILY_MOODS = [
  {
    mood: "a little mentally drained and less patient than usual",
    cause: "a tedious, demanding day of work or other responsibilities",
  },
  {
    mood: "quietly worried and somewhat distracted",
    cause: "an unresolved responsibility or a small uncertainty weighing on the character",
  },
  {
    mood: "more sensitive and easily irritated than usual",
    cause: "accumulated fatigue, stress, or physical discomfort",
  },
  {
    mood: "subdued and a little discouraged",
    cause: "a personal disappointment that matters to the character, even if it seems minor to others",
  },
  {
    mood: "restless and mildly tense",
    cause: "plans being disrupted or too many demands piling up",
  },
  {
    mood: "slightly brighter and more energetic than usual",
    cause: "a modest, pleasant surprise or a small bit of good luck",
  },
  {
    mood: "quietly proud and warmer than usual",
    cause: "something personally meaningful going a little better than the character expected",
  },
  {
    mood: "short-tempered and stressed",
    cause: "stress, physical discomfort, or hormonal fluctuations if those fit the character's established traits and context",
  },
];

export function rollDailyMood(random = Math.random) {
  if (random() >= 0.35) return null;
  const index = Math.min(Math.floor(random() * DAILY_MOODS.length), DAILY_MOODS.length - 1);
  return { ...DAILY_MOODS[index] };
}
