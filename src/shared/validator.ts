import { Token } from './types.js';
import { logger } from './logger.js';

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100, higher is safer
  risks: string[];
  warnings: string[];
}

export function validateToken(token: Token): ValidationResult {
  const risks: string[] = [];
  const warnings: string[] = [];
  let safetyScore = 100;

  // 1. Red flags: Very new tokens
  if (token.age && token.age < 7 * 24 * 60 * 60 * 1000) { // Less than 7 days
    risks.push('Token less than 7 days old');
    safetyScore -= 40;
  }

  // 2. Red flags: Extremely low market cap with high volume (classic pump)
  if (token.marketCap > 0 && token.volume24h > 0) {
    const volumeToMcapRatio = token.volume24h / token.marketCap;
    if (volumeToMcapRatio > 2) {
      risks.push(`Suspicious volume/market cap ratio: ${volumeToMcapRatio.toFixed(2)}x`);
      safetyScore -= 30;
    }
  }

  // 3. Red flag: Price up >200% in 24h (classic pump before dump)
  if (token.priceChange24h > 200) {
    warnings.push(`Extreme 24h gain: +${token.priceChange24h.toFixed(0)}%`);
    safetyScore -= 20;
  }

  // 4. Red flag: Extreme volatility (>150% swing in a day)
  if (token.volatility24h && token.volatility24h > 150) {
    risks.push(`Extreme volatility: ${token.volatility24h.toFixed(0)}%`);
    safetyScore -= 25;
  }

  // 5. Warning: Low liquidity relative to price
  if (token.liquidity && token.liquidity < 100000) {
    warnings.push(`Low liquidity: $${(token.liquidity / 1000).toFixed(0)}K`);
    safetyScore -= 10;
  }

  // 6. Warning: Holder concentration (if one wallet owns >50%)
  if (token.topHolderPercent && token.topHolderPercent > 50) {
    risks.push(`High holder concentration: Top holder owns ${token.topHolderPercent.toFixed(1)}%`);
    safetyScore -= 35;
  }

  // 7. Warning: Low volume for its market cap (dead token)
  if (token.marketCap > 0 && token.volume24h > 0) {
    const volumeToMcapRatio = token.volume24h / token.marketCap;
    if (volumeToMcapRatio < 0.01) {
      warnings.push('Very low trading volume relative to market cap (illiquid)');
      safetyScore -= 15;
    }
  }

  // 8. Red flag: Contract renounced (could be abandoned)
  if (token.contractRenounced) {
    warnings.push('Ownership renounced (could be abandoned project)');
    safetyScore -= 5;
  }

  // Clamp score to 0-100
  safetyScore = Math.max(0, Math.min(100, safetyScore));

  const isValid = risks.length === 0 && safetyScore >= 40;

  if (!isValid) {
    logger.warn(`Token ${token.symbol} failed validation`, {
      score: safetyScore,
      risks,
      warnings
    });
  }

  return {
    isValid,
    score: safetyScore,
    risks,
    warnings
  };
}

export function filterSafeTokens(tokens: Token[]): Token[] {
  return tokens.filter(token => {
    const validation = validateToken(token);
    return validation.isValid;
  });
}
