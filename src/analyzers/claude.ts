import Anthropic from '@anthropic-ai/sdk';
import { Token } from '../shared/types.js';
import { rateLimiter } from '../shared/rate-limiter.js';
import { logger } from '../shared/logger.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function analyzeToken(token: Token, attempt = 0): Promise<string> {
  try {
    await rateLimiter.waitForSlot();

    const prompt = `Analyze ${token.symbol} (${token.name}) in exactly 2 concise sentences:
Price: ${token.price.toFixed(4)}
24h Volume: ${(token.volume24h / 1000000).toFixed(1)}M
Market Cap: ${(token.marketCap / 1000000).toFixed(1)}M
24h Change: ${token.priceChange24h.toFixed(1)}%
7d Change: ${token.priceChange7d.toFixed(1)}%

Give a balanced take - mention both the bullish case and the risk. Be specific with numbers.`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const analysis = response.content[0].type === 'text' ? response.content[0].text : '';
    logger.info(`Analyzed ${token.symbol}`);
    await sleep(20000); // 20 second wait
    return analysis;
  } catch (error: any) {
    if (error.status === 429 && attempt < 2) {
      rateLimiter.openCircuit();
      const backoff = Math.pow(2, attempt) * 30000;
      logger.warn(`429 error for ${token.symbol}, backing off ${backoff/1000}s`);
      await sleep(backoff);
      return analyzeToken(token, attempt + 1);
    }
    logger.error(`Failed to analyze ${token.symbol}`, error.message);
    return 'Analysis unavailable due to rate limits.';
  }
}
