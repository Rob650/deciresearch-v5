import { Token } from '../shared/types.js';

export function composeMarketBrief(tokens: Token[]): string {
  const top3 = tokens.slice(0, 3);
  let tweet = `📊 Market Pulse `;
  for (const token of top3) {
    const emoji = token.priceChange24h > 0 ? '📈' : '📉';
    tweet += `${emoji} ${token.symbol}: ${token.price.toFixed(4)} (${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}%) `;
    if (token.analysis) {
      tweet += `${token.analysis} `;
    }
  }
  tweet += `Volume leaders showing ${top3.filter(t => t.priceChange24h > 0).length}/3 positive momentum.`;
  return tweet.slice(0, 280); // Twitter limit
}

export function composeAlphaSignal(token: Token): string {
  const emoji = token.priceChange24h > 5 ? '🚨' : '👀';
  let tweet = `${emoji} ${token.symbol} Signal `;
  tweet += `Price: ${token.price.toFixed(4)} `;
  tweet += `24h: ${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}% `;
  tweet += `Volume: ${(token.volume24h / 1000000).toFixed(1)}M `;
  if (token.analysis) {
    tweet += token.analysis;
  }
  return tweet.slice(0, 280);
}
