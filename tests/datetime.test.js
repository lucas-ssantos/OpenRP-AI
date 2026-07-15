import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime, weekdayOf } from "../src/utils/datetime.js";

const NOW = "2026-07-13 15:00:00";

test("formatRelativeTime: dias de calendário relativos ao agora", () => {
  assert.equal(formatRelativeTime("2026-07-13 01:00:00", NOW), "today");
  assert.equal(formatRelativeTime("2026-07-12 23:59:00", NOW), "yesterday");
  assert.equal(formatRelativeTime("2026-07-10 08:00:00", NOW), "3 days ago");
  assert.equal(formatRelativeTime("2026-07-05 08:00:00", NOW), "a week ago");
  assert.equal(formatRelativeTime("2026-06-28 08:00:00", NOW), "2 weeks ago");
  assert.equal(formatRelativeTime("2026-06-10 08:00:00", NOW), "a month ago");
  assert.equal(formatRelativeTime("2026-04-10 08:00:00", NOW), "3 months ago");
  assert.equal(formatRelativeTime("2025-07-01 08:00:00", NOW), "a year ago");
  assert.equal(formatRelativeTime("2023-07-13 08:00:00", NOW), "3 years ago");
});

test("formatRelativeTime: entrada inválida ou ausente retorna null", () => {
  assert.equal(formatRelativeTime(null, NOW), null);
  assert.equal(formatRelativeTime(undefined, NOW), null);
  assert.equal(formatRelativeTime("não é data", NOW), null);
});

test("formatRelativeTime: usa o agora real quando nowStr não é passado", () => {
  assert.equal(typeof formatRelativeTime("2020-01-01 00:00:00"), "string");
});

test("weekdayOf: dia da semana em inglês da parte de data", () => {
  assert.equal(weekdayOf("2026-07-13 15:00:00"), "Monday");
  assert.equal(weekdayOf("inválido"), null);
});
