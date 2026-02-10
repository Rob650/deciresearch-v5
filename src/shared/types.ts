export interface Token {
  id: string;
  symbol: string;
  name: string;
  price: number;
  volume24h: number;
  marketCap: number;
  priceChange24h: number;
  priceChange7d: number;
  score?: number;
  analysis?: string;
  timestamp: number;
  // Validation fields
  age?: number; // milliseconds since creation
  volatility24h?: number; // percentage
  liquidity?: number; // USD value of liquidity
  topHolderPercent?: number; // percentage owned by largest holder
  contractRenounced?: boolean;
}

export interface TweetContent {
  text: string;
  scheduledTime?: Date;
}
