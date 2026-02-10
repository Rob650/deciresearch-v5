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
}

export interface TweetContent {
  text: string;
  scheduledTime?: Date;
}
