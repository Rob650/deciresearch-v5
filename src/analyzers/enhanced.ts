import { Token } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export interface EnhancedMetrics {
  volumeTrendStr: string; // "increasing" | "stable" | "decreasing"
  liquidityStr: string; // "deep" | "medium" | "shallow"
  volatilityStr: string; // "low" | "moderate" | "high" | "extreme"
  concentrationStr: string; // "distributed" | "moderate" | "high" | "extreme"
  ageStr: string; // "new" | "young" | "established" | "mature"
  riskLevel: string; // "safe" | "moderate" | "high" | "extreme"
}

export function analyzeMetrics(token: Token): EnhancedMetrics {
  // Volume trend
  let volumeTrendStr = 'stable';
  if (token.priceChange24h > 15 && token.volume24h > 50000000) {
    volumeTrendStr = 'increasing';
  } else if (token.priceChange24h < -15) {
    volumeTrendStr = 'decreasing';
  }

  // Liquidity assessment
  let liquidityStr = 'shallow';
  if (token.liquidity && token.liquidity > 1000000) {
    liquidityStr = 'deep';
  } else if (token.liquidity && token.liquidity > 100000) {
    liquidityStr = 'medium';
  }

  // Volatility
  let volatilityStr = 'moderate';
  if (token.volatility24h) {
    if (token.volatility24h < 20) volatilityStr = 'low';
    else if (token.volatility24h < 50) volatilityStr = 'moderate';
    else if (token.volatility24h < 100) volatilityStr = 'high';
    else volatilityStr = 'extreme';
  }

  // Holder concentration
  let concentrationStr = 'distributed';
  if (token.topHolderPercent) {
    if (token.topHolderPercent > 70) concentrationStr = 'extreme';
    else if (token.topHolderPercent > 50) concentrationStr = 'high';
    else if (token.topHolderPercent > 25) concentrationStr = 'moderate';
  }

  // Token age
  let ageStr = 'established';
  if (token.age) {
    const daysOld = token.age / (24 * 60 * 60 * 1000);
    if (daysOld < 7) ageStr = 'new';
    else if (daysOld < 30) ageStr = 'young';
    else if (daysOld < 365) ageStr = 'established';
    else ageStr = 'mature';
  }

  // Overall risk level
  let riskLevel = 'moderate';
  const riskFactors = [
    volatilityStr === 'extreme' ? 1 : 0,
    concentrationStr === 'extreme' ? 1 : 0,
    ageStr === 'new' ? 1 : 0,
    liquidityStr === 'shallow' ? 1 : 0,
    token.priceChange24h > 150 ? 1 : 0
  ].reduce((a, b) => a + b, 0);

  if (riskFactors >= 3) riskLevel = 'extreme';
  else if (riskFactors === 2) riskLevel = 'high';
  else if (riskFactors === 1) riskLevel = 'moderate';
  else riskLevel = 'safe';

  return {
    volumeTrendStr,
    liquidityStr,
    volatilityStr,
    concentrationStr,
    ageStr,
    riskLevel
  };
}

export function generateContextPrompt(token: Token): string {
  const metrics = analyzeMetrics(token);

  return `
Token: ${token.symbol} (${token.name})
Price: $${token.price.toFixed(token.price < 0.01 ? 6 : 4)}
24h Change: ${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}%
7d Change: ${token.priceChange7d > 0 ? '+' : ''}${token.priceChange7d.toFixed(1)}%
Volume (24h): $${(token.volume24h / 1000000).toFixed(1)}M
Market Cap: $${(token.marketCap / 1000000).toFixed(1)}M
Volume/Mcap: ${(token.volume24h / token.marketCap).toFixed(2)}x

Market Conditions:
- Volume trend: ${metrics.volumeTrendStr}
- Liquidity: ${metrics.liquidityStr}
- Volatility: ${metrics.volatilityStr}
- Holder concentration: ${metrics.concentrationStr}
- Age: ${metrics.ageStr}
- Risk level: ${metrics.riskLevel}

Write 2 sentences analyzing this token. Include:
1. One specific opportunity or positive signal
2. One specific risk or concern
Always use concrete data points from above.`;
}
