/**
 * Compact emoji catalog for the composer picker and `:shortcode:` autocomplete.
 *
 * Source: Unicode Emoji 15.1 names / CLDR short names (Unicode License,
 * https://www.unicode.org/license.txt). Glyphs are the public Unicode
 * characters; this file is a small curated subset, not a full CLDR dump.
 */

export type EmojiEntry = {
  native: string;
  id: string;
  name: string;
  keywords: readonly string[];
};

export const EMOJI_DATASET: readonly EmojiEntry[] = [
  { native: "😀", id: "grinning", name: "grinning", keywords: ["smile", "happy"] },
  { native: "😃", id: "smiley", name: "smiley", keywords: ["smile", "happy"] },
  { native: "😄", id: "smile", name: "smile", keywords: ["happy"] },
  { native: "😁", id: "grin", name: "grin", keywords: ["happy"] },
  { native: "😆", id: "laughing", name: "laughing", keywords: ["lol"] },
  { native: "😅", id: "sweat_smile", name: "sweat smile", keywords: ["relief"] },
  { native: "😂", id: "joy", name: "joy", keywords: ["tears", "lol"] },
  { native: "🤣", id: "rofl", name: "rofl", keywords: ["lol"] },
  { native: "😊", id: "blush", name: "blush", keywords: ["smile"] },
  { native: "😇", id: "innocent", name: "innocent", keywords: ["angel"] },
  { native: "🙂", id: "slightly_smiling_face", name: "slightly smiling", keywords: ["smile"] },
  { native: "😉", id: "wink", name: "wink", keywords: ["flirt"] },
  { native: "😍", id: "heart_eyes", name: "heart eyes", keywords: ["love"] },
  { native: "🥰", id: "smiling_face_with_hearts", name: "smiling hearts", keywords: ["love"] },
  { native: "😘", id: "kissing_heart", name: "kissing heart", keywords: ["love"] },
  { native: "😋", id: "yum", name: "yum", keywords: ["tasty"] },
  { native: "😜", id: "stuck_out_tongue_winking_eye", name: "wink tongue", keywords: ["joke"] },
  { native: "🤔", id: "thinking", name: "thinking", keywords: ["hmm"] },
  { native: "🤨", id: "raised_eyebrow", name: "raised eyebrow", keywords: ["skeptic"] },
  { native: "😐", id: "neutral_face", name: "neutral", keywords: ["meh"] },
  { native: "😑", id: "expressionless", name: "expressionless", keywords: ["blank"] },
  { native: "🙄", id: "roll_eyes", name: "rolling eyes", keywords: ["ugh"] },
  { native: "😬", id: "grimacing", name: "grimacing", keywords: ["awkward"] },
  { native: "😔", id: "pensive", name: "pensive", keywords: ["sad"] },
  { native: "😢", id: "cry", name: "cry", keywords: ["sad"] },
  { native: "😭", id: "sob", name: "sob", keywords: ["sad"] },
  { native: "😤", id: "triumph", name: "triumph", keywords: ["steam"] },
  { native: "😡", id: "rage", name: "rage", keywords: ["angry"] },
  { native: "🤬", id: "cursing", name: "cursing", keywords: ["angry"] },
  { native: "😱", id: "scream", name: "scream", keywords: ["shock"] },
  { native: "😴", id: "sleeping", name: "sleeping", keywords: ["zzz"] },
  { native: "😷", id: "mask", name: "mask", keywords: ["sick"] },
  { native: "🤒", id: "sick", name: "sick", keywords: ["ill"] },
  { native: "🥳", id: "partying_face", name: "partying", keywords: ["party"] },
  { native: "😎", id: "sunglasses", name: "sunglasses", keywords: ["cool"] },
  { native: "🤓", id: "nerd", name: "nerd", keywords: ["geek"] },
  { native: "👍", id: "thumbsup", name: "thumbs up", keywords: ["yes", "+1"] },
  { native: "👎", id: "thumbsdown", name: "thumbs down", keywords: ["no", "-1"] },
  { native: "👏", id: "clap", name: "clap", keywords: ["applause"] },
  { native: "🙌", id: "raised_hands", name: "raised hands", keywords: ["hooray"] },
  { native: "🤝", id: "handshake", name: "handshake", keywords: ["deal"] },
  { native: "🙏", id: "pray", name: "folded hands", keywords: ["please", "thanks"] },
  { native: "💪", id: "muscle", name: "muscle", keywords: ["strong"] },
  { native: "👀", id: "eyes", name: "eyes", keywords: ["look"] },
  { native: "❤️", id: "heart", name: "red heart", keywords: ["love"] },
  { native: "🧡", id: "orange_heart", name: "orange heart", keywords: ["love"] },
  { native: "💛", id: "yellow_heart", name: "yellow heart", keywords: ["love"] },
  { native: "💚", id: "green_heart", name: "green heart", keywords: ["love"] },
  { native: "💙", id: "blue_heart", name: "blue heart", keywords: ["love"] },
  { native: "💜", id: "purple_heart", name: "purple heart", keywords: ["love"] },
  { native: "🖤", id: "black_heart", name: "black heart", keywords: ["love"] },
  { native: "🤍", id: "white_heart", name: "white heart", keywords: ["love"] },
  { native: "💔", id: "broken_heart", name: "broken heart", keywords: ["sad"] },
  { native: "🔥", id: "fire", name: "fire", keywords: ["hot", "lit"] },
  { native: "✨", id: "sparkles", name: "sparkles", keywords: ["shine"] },
  { native: "⭐", id: "star", name: "star", keywords: ["favorite"] },
  { native: "✅", id: "white_check_mark", name: "check", keywords: ["done"] },
  { native: "❌", id: "x", name: "cross mark", keywords: ["no"] },
  { native: "⚠️", id: "warning", name: "warning", keywords: ["caution"] },
  { native: "🎉", id: "tada", name: "party popper", keywords: ["celebrate"] },
  { native: "🎂", id: "birthday", name: "birthday cake", keywords: ["cake"] },
  { native: "☕", id: "coffee", name: "coffee", keywords: ["tea"] },
  { native: "🍺", id: "beer", name: "beer", keywords: ["drink"] },
  { native: "🍕", id: "pizza", name: "pizza", keywords: ["food"] },
  { native: "🍔", id: "hamburger", name: "hamburger", keywords: ["food"] },
  { native: "🍎", id: "apple", name: "red apple", keywords: ["fruit"] },
  { native: "🌈", id: "rainbow", name: "rainbow", keywords: ["pride"] },
  { native: "☀️", id: "sunny", name: "sun", keywords: ["weather"] },
  { native: "🌧️", id: "cloud_rain", name: "rain", keywords: ["weather"] },
  { native: "❄️", id: "snowflake", name: "snowflake", keywords: ["cold"] },
  { native: "🌙", id: "crescent_moon", name: "moon", keywords: ["night"] },
  { native: "🏠", id: "house", name: "house", keywords: ["home"] },
  { native: "🚗", id: "car", name: "car", keywords: ["drive"] },
  { native: "✈️", id: "airplane", name: "airplane", keywords: ["travel"] },
  { native: "🚀", id: "rocket", name: "rocket", keywords: ["launch"] },
  { native: "💡", id: "bulb", name: "light bulb", keywords: ["idea"] },
  { native: "📎", id: "paperclip", name: "paperclip", keywords: ["attach"] },
  { native: "🔒", id: "lock", name: "lock", keywords: ["secure"] },
  { native: "🔑", id: "key", name: "key", keywords: ["unlock"] },
  { native: "💸", id: "money_with_wings", name: "money wings", keywords: ["pay"] },
  { native: "₿", id: "bitcoin", name: "bitcoin", keywords: ["btc"] },
  { native: "🐶", id: "dog", name: "dog", keywords: ["pet"] },
  { native: "🐱", id: "cat", name: "cat", keywords: ["pet"] },
  { native: "🐸", id: "frog", name: "frog", keywords: ["animal"] },
  { native: "🌸", id: "cherry_blossom", name: "cherry blossom", keywords: ["flower"] },
  { native: "💯", id: "100", name: "hundred", keywords: ["perfect"] },
  { native: "🫂", id: "people_hugging", name: "hug", keywords: ["care"] },
  { native: "🫡", id: "saluting_face", name: "salute", keywords: ["ok"] },
  { native: "🤷", id: "shrug", name: "shrug", keywords: ["idk"] },
  { native: "🤦", id: "facepalm", name: "facepalm", keywords: ["doh"] },
];

export function colonTokenAt(text: string, caret: number): { start: number; query: string } | null {
  const left = text.slice(0, caret);
  const match = left.match(/(^|[\s([{:]):([a-z0-9_+-]{1,32})$/i);
  if (!match) return null;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  return { start, query: query.toLowerCase() };
}

export function searchEmoji(query: string, limit = 8): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/_/g, " ");
  if (!q) return EMOJI_DATASET.slice(0, limit);
  const scored = EMOJI_DATASET.map((entry) => {
    const id = entry.id.replace(/_/g, " ");
    const hay = `${id} ${entry.name} ${entry.keywords.join(" ")}`;
    let score = 0;
    if (entry.id === q || id === q) score = 100;
    else if (entry.id.startsWith(q) || id.startsWith(q)) score = 80;
    else if (hay.includes(q)) score = 40;
    return { entry, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, limit).map((row) => row.entry);
}

export function replaceColonToken(text: string, caret: number, native: string): { text: string; caret: number } | null {
  const token = colonTokenAt(text, caret);
  if (!token) return null;
  const next = `${text.slice(0, token.start)}${native}${text.slice(caret)}`;
  return { text: next, caret: token.start + native.length };
}
