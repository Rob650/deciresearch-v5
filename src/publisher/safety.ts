const BANNED_PHRASES = [
  'not financial advice',
  'nfa',
  'guaranteed',
  'buy now',
  'to the moon',
  'moonshot',
  'easy money',
  'cant lose',
  'risk free',
  'follow for alpha',
  'like and retweet',
  'comment below'
];

export function isSafe(text: string): boolean {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      return false;
    }
  }
  return true;
}

export function removeDuplicateWords(text: string): string {
  const words = text.split(' ');
  const seen = new Set<string>();
  return words.filter(word => {
    const lower = word.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  }).join(' ');
}
