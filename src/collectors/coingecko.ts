import axios from 'axios';
import { Token } from '../shared/types.js';
import { logger } from '../shared/logger.js';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

export async function fetchTopTokens(): Promise<Token[]> {
  try {
    const response = await axios.get(`${COINGECKO_API}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        order: 'volume_desc',
        per_page: 50,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h,7d'
      },
      headers: {
        'x-cg-demo-api-key': process.env.COINGECKO_API_KEY || ''
      }
    });

    const tokens: Token[] = response.data.map((coin: any) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      volume24h: coin.total_volume,
      marketCap: coin.market_cap,
      priceChange24h: coin.price_change_percentage_24h || 0,
      priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
      timestamp: Date.now()
    }));

    logger.info(`Fetched ${tokens.length} tokens from CoinGecko`);
    return tokens;
  } catch (error: any) {
    logger.error('CoinGecko fetch failed', error.message);
    return [];
  }
}
