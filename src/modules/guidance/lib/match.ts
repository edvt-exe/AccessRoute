import type { Spot } from "@/core/map";

const numberWords: Record<string, string> = {
  zero: "0", one: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", first: "1", second: "2", third: "3",
};

const filler = new Set([
  "i", "want", "would", "like", "to", "go", "take", "me", "the", "a", "an", "please", "get", "bring", "find",
  "where", "is", "lead", "show", "way", "need", "number", "no",
]);

export function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i, all) => {
      // "to" only counts as a number right after a word like "lift", otherwise it is filler
      if (word === "to" || word === "too" || word === "for") return i > 0 && !filler.has(all[i - 1]) ? numberWords[word] : word;
      return numberWords[word] ?? word;
    })
    .flatMap((word) => word.match(/[a-z]+|\d+/g) ?? []);
}

function meaningful(words: string[]) {
  return words.filter((w) => !filler.has(w) && (w.length > 1 || /\d/.test(w)));
}

// true when every word the person said appears in the place name ("toilet" in "women's toilet")
function saidPartOf(spokenText: string, placeName: string) {
  const spoken = meaningful(normalizeWords(spokenText));
  const name = meaningful(normalizeWords(placeName));
  return spoken.length > 0 && spoken.every((s) => name.some((n) => wordScore(s, n) >= 0.8));
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function wordScore(spoken: string, name: string) {
  if (spoken === name) return 1;
  if (/\d/.test(spoken) || /\d/.test(name)) return 0; // numbers must match exactly, lift 1 is not lift 2
  const longest = Math.max(spoken.length, name.length);
  return longest < 3 ? 0 : Math.max(0, 1 - editDistance(spoken, name) / longest);
}

export function scorePlace(spokenText: string, placeName: string) {
  const spoken = meaningful(normalizeWords(spokenText));
  const name = meaningful(normalizeWords(placeName));
  if (spoken.length === 0 || name.length === 0) return 0;
  // every word of the place name should be heard, extra spoken words cost a little
  const matched = name.map((n) => Math.max(...spoken.map((s) => wordScore(s, n))));
  const coverage = matched.reduce((a, b) => a + b, 0) / name.length;
  const extra = Math.max(0, spoken.length - name.length) * 0.05;
  const numbersOk = name.filter((n) => /\d/.test(n)).every((n) => spoken.includes(n));
  return numbersOk ? Math.max(0, coverage - extra) : coverage * 0.4;
}

export type Match = { place: Spot; score: number };

export function matchPlace(spokenText: string, places: Spot[]): Match | null {
  const ranked = places
    .map((place) => ({ place, score: scorePlace(spokenText, place.name) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  if (best.score < 0.6) {
    const partial = places.filter((p) => saidPartOf(spokenText, p.name));
    return partial.length === 1 ? { place: partial[0], score: 0.6 } : null;
  }
  // two places that fit equally well is a guess, better ask again
  if (ranked[1] && ranked[1].score > best.score - 0.05 && ranked[1].place.name.toLowerCase() !== best.place.name.toLowerCase()) return null;
  return best;
}
