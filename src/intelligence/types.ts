export interface TrackedAccount {
  id: string;
  handle: string;
  category: 'NARRATIVE' | 'TECHNICAL' | 'SMART_MONEY' | 'MARKET_STRUCTURE';
  credibilityScore: number; // 0-100, updated over time
  followerCount: number;
  engagementRate: number;
  accuracyScore: number; // how often their takes are right
  tags: string[];
  addedAt: number;
  lastUpdated: number;
}

export interface StoredTweet {
  id: string;
  tweetId: string;
  handle: string;
  text: string;
  embedding: number[]; // OpenAI embedding vector
  timestamp: number;
  likes: number;
  retweets: number;
  replies: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  topics: string[];
  credibilityAtTime: number;
  storedAt: number;
}

export interface KnowledgeEntry {
  id: string;
  type: 'account' | 'tweet' | 'insight' | 'pattern';
  content: string;
  embedding: number[];
  sources: string[]; // which accounts mentioned this
  credibility: number;
  timestamp: number;
}

export interface RAGContext {
  query: string;
  relevantTweets: StoredTweet[];
  topAccounts: TrackedAccount[];
  sentiment: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  themes: {
    theme: string;
    mentions: number;
    credibility: number;
  }[];
  summary: string;
}
