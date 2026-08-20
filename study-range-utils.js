(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudyRangeUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRESETS = Object.freeze({
    all: null,
    "1-25": Object.freeze([1, 25]),
    "26-50": Object.freeze([26, 50]),
    "51-75": Object.freeze([51, 75]),
    "76-100": Object.freeze([76, 100]),
  });

  function rangeNumbers(range, total) {
    const start = Number.parseInt(range?.start, 10);
    const end = Number.parseInt(range?.end, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || start > total) return [];
    const last = Math.min(end, total);
    return Array.from({ length: last - start + 1 }, (_, index) => start + index);
  }

  function selectedNumbers(selection, total) {
    if (!Number.isInteger(total) || total < 1) return [];
    if (selection.mode === "fixed") {
      const bounds = PRESETS[selection.preset];
      if (!bounds) return Array.from({ length: total }, (_, index) => index + 1);
      const [start, end] = bounds;
      if (start > total) return [];
      return Array.from({ length: Math.min(end, total) - start + 1 }, (_, index) => start + index);
    }
    if (selection.mode === "ranges") {
      const selected = new Set();
      (selection.ranges || []).forEach(range => rangeNumbers(range, total).forEach(number => selected.add(number)));
      return [...selected].sort((a, b) => a - b);
    }
    return [...(selection.numbers || [])]
      .filter(number => Number.isInteger(number) && number >= 1 && number <= total)
      .sort((a, b) => a - b);
  }

  return Object.freeze({ PRESETS, rangeNumbers, selectedNumbers });
});
