import axios from 'axios';
import { Token } from '../shared/types.js';
import { logger } from '../shared/logger.js';

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

export async function fetchTrendingTokens(): Promise<Token[]> {
  try {
    const response = await axios.get(`${DEXSCREENER_API}/tokens/trending`);

    const tokens: Token[] = response.data.map((pair: any) => ({
      id: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      price: parseFloat(pair.priceUsd || '0'),
      volume24h: parseFloat(pair.volume?.h24 || '0'),
      marketCap: parseFloat(pair.marketCap || '0'),
      priceChange24h: parseFloat(pair.priceChange?.h24 || '0'),
      priceChange7d: 0,
      timestamp: Date.now()
    })).filter((t: Token) => t.volume24h > 100000); // Filter low volume

    logger.info(`Fetched ${tokens.length} trending tokens from DEXScreener`);
    return tokens;
  } catch (error: any) {
    logger.error('DEXScreener fetch failed', error.message);
    return [];
  }
}
