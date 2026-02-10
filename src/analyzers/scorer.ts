import { Token } from '../shared/types.js';

export function scoreTokens(tokens: Token[]): Token[] {
  return tokens.map(token => {
    let score = 0;

    // Volume score (0-30 points)
    if (token.volume24h > 1000000000) score += 30;
    else if (token.volume24h > 100000000) score += 20;
    else if (token.volume24h > 10000000) score += 10;

    // Price momentum (0-30 points)
    if (token.priceChange24h > 20) score += 30;
    else if (token.priceChange24h > 10) score += 20;
    else if (token.priceChange24h > 5) score += 10;
    else if (token.priceChange24h < -10) score -= 10;

    // Market cap score (0-20 points)
    if (token.marketCap > 10000000000) score += 20;
    else if (token.marketCap > 1000000000) score += 15;
    else if (token.marketCap > 100000000) score += 10;

    // 7d momentum (0-20 points)
    if (token.priceChange7d > 50) score += 20;
    else if (token.priceChange7d > 20) score += 10;
    else if (token.priceChange7d < -20) score -= 10;

    return { ...token, score };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}
