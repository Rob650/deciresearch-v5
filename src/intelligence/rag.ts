import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';
import { RAGContext } from './types.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export class RAGEngine {
  async queryContext(query: string, category?: string): Promise<RAGContext> {
    try {
      logger.info(`RAG query: ${query}`);

      // 1. Search for relevant tweets from vector DB
      const mockEmbedding = Array(1536).fill(0); // TODO: use real embeddings
      const relevantTweets = await vectorDB.semanticSearch(mockEmbedding, 20, category);

      // 2. Get top credible accounts in this category
      const topAccounts = await vectorDB.getTopAccounts(5);

      // 3. Analyze sentiment distribution
      const sentiment = {
        bullish: relevantTweets.filter(t => t.sentiment === 'bullish').length,
        bearish: relevantTweets.filter(t => t.sentiment === 'bearish').length,
        neutral: relevantTweets.filter(t => t.sentiment === 'neutral').length
      };

      // 4. Extract theme frequency
      const themeMap = new Map<string, { count: number; credibility: number }>();
      for (const tweet of relevantTweets) {
        for (const topic of tweet.topics) {
          const current = themeMap.get(topic) || { count: 0, credibility: 0 };
          current.count += 1;
          current.credibility += tweet.credibilityAtTime;
          themeMap.set(topic, current);
        }
      }

      const themes = Array.from(themeMap.entries())
        .map(([theme, data]) => ({
          theme,
          mentions: data.count,
          credibility: data.credibility / data.count
        }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 5);

      // 5. Synthesize brief summary
      const summary = await this.synthesizeSummary(query, relevantTweets, topAccounts);

      const context: RAGContext = {
        query,
        relevantTweets,
        topAccounts,
        sentiment,
        themes,
        summary
      };

      return context;
    } catch (error: any) {
      logger.error('RAG query failed', error.message);
      return {
        query,
        relevantTweets: [],
        topAccounts: [],
        sentiment: { bullish: 0, bearish: 0, neutral: 0 },
        themes: [],
        summary: ''
      };
    }
  }

  private async synthesizeSummary(
    query: string,
    tweets: any[],
    accounts: any[]
  ): Promise<string> {
    try {
      // Build context from top tweets
      const tweetSummary = tweets
        .slice(0, 3)
        .map(t => `@${t.handle}: "${t.text.substring(0, 100)}..."`)
        .join('\n');

      const accountList = accounts
        .slice(0, 3)
        .map(a => `@${a.handle} (${a.category}, score: ${a.credibilityScore})`)
        .join(', ');

      const prompt = `Based on these insights about "${query}", write a 1-sentence summary of what credible accounts are saying.
      
Key accounts: ${accountList}

Recent takes:
${tweetSummary}

Summary:`;

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return message.content[0].type === 'text' ? message.content[0].text : '';
    } catch (error: any) {
      logger.error('Synthesis failed', error.message);
      return '';
    }
  }

  async queryForTweet(tokenSymbol: string, narrative: string): Promise<RAGContext> {
    // Query for a specific token + narrative combination
    // Used by tweet composer to get context for analysis
    const query = `${tokenSymbol} ${narrative}`;
    return this.queryContext(query);
  }

  async queryByCategory(category: string): Promise<RAGContext> {
    // Get insights from a specific account category
    return this.queryContext(category, category);
  }

  async getSmartMoneySentiment(tokenSymbol: string): Promise<string> {
    const context = await this.queryContext(
      `Smart money ${tokenSymbol}`,
      'SMART_MONEY'
    );

    const bullishCount = context.sentiment.bullish;
    const bearishCount = context.sentiment.bearish;

    if (bullishCount > bearishCount * 2) return 'very_bullish';
    if (bullishCount > bearishCount) return 'bullish';
    if (bearishCount > bullishCount * 2) return 'very_bearish';
    if (bearishCount > bullishCount) return 'bearish';
    return 'neutral';
  }

  async getTechnicalInsights(topic: string): Promise<string[]> {
    const context = await this.queryContext(
      `Technical ${topic}`,
      'TECHNICAL'
    );

    return context.themes.map(
      t => `${t.theme} (mentioned ${t.mentions} times)`
    );
  }

  async getNarrativeContext(narrative: string): Promise<RAGContext> {
    return this.queryContext(narrative, 'NARRATIVE');
  }
}

export const ragEngine = new RAGEngine();
