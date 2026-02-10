import { Token } from '../shared/types.js';
import { ragEngine } from './rag.js';
import { accountInfluence } from './account-influence.js';
import { logger } from '../shared/logger.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export class IntelligenceComposer {
  async composeResearchTweet(tokens: Token[]): Promise<string> {
    try {
      // Get top 3 tokens
      const topTokens = tokens.slice(0, 3);

      // Query RAG context for each token
      const contexts = await Promise.all(
        topTokens.map(t => ragEngine.queryForTweet(t.symbol, 'market analysis'))
      );

      // Build analysis brief from RAG insights with influence weighting
      let brief = '📊 Market Pulse\n\n';

      for (let i = 0; i < topTokens.length; i++) {
        const token = topTokens[i];
        const context = contexts[i];

        const emoji = token.priceChange24h > 0 ? '📈' : '📉';
        brief += `${emoji} ${token.symbol}\n`;
        brief += `Price: $${token.price.toFixed(4)}\n`;
        brief += `24h: ${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}%\n`;
        brief += `Volume: $${(token.volume24h / 1000000).toFixed(1)}M\n`;

        // Weight themes by account influence
        if (context.themes.length > 0) {
          brief += `Key narrative: ${context.themes[0].theme}\n`;
        }

        // Add most influential sources
        if (context.topAccounts.length > 0) {
          const topInfluencerHandles = await accountInfluence.citeMostInfluential(
            context.topAccounts.map(a => a.handle),
            2
          );
          if (topInfluencerHandles.length > 0) {
            brief += `Key sources: ${topInfluencerHandles.map(h => `@${h}`).join(', ')}\n`;
          }
        }

        brief += `\n`;
      }

      // Compose tweet using market data + RAG insights
      const sentiment = contexts[0].sentiment.bullish > contexts[0].sentiment.bearish
        ? 'bullish'
        : contexts[0].sentiment.bearish > contexts[0].sentiment.bullish
        ? 'bearish'
        : 'neutral';

      const tweet = await this.composeTweetFromBrief(brief, sentiment);
      return tweet.slice(0, 280);
    } catch (error: any) {
      logger.error('Tweet composition failed', error.message);
      return '';
    }
  }

  async composeTokenAnalysis(token: Token): Promise<string> {
    try {
      // Get smart money sentiment
      const smMoney = await ragEngine.getSmartMoneySentiment(token.symbol);

      // Get technical insights
      const techInsights = await ragEngine.getTechnicalInsights(token.symbol);

      // Get narrative context
      const narrative = await ragEngine.getNarrativeContext(token.symbol);

      // Compose analysis
      const prompt = `Based on this data, write a research tweet about ${token.symbol} (2-3 sentences):

Price: $${token.price.toFixed(4)}
24h Change: ${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(1)}%
Volume: $${(token.volume24h / 1000000).toFixed(1)}M
Smart money sentiment: ${smMoney}
Technical themes: ${techInsights.join(', ')}
Narrative: ${narrative.summary}

Write original analysis combining these signals. Mention both opportunity and risk.`;

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 280,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const tweet =
        message.content[0].type === 'text' ? message.content[0].text : '';
      return tweet.slice(0, 280);
    } catch (error: any) {
      logger.error('Token analysis failed', error.message);
      return '';
    }
  }

  private async composeTweetFromBrief(brief: string, sentiment: string): Promise<string> {
    try {
      const tone = sentiment === 'bullish'
        ? 'highlight opportunities'
        : sentiment === 'bearish'
        ? 'highlight risks'
        : 'present balanced view';

      const prompt = `Based on this market brief, write a concise research tweet that ${tone}. Use data-backed insights. Max 280 characters.

${brief}

Tweet:`;

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return message.content[0].type === 'text' ? message.content[0].text : '';
    } catch (error: any) {
      logger.error('Brief composition failed', error.message);
      return '';
    }
  }

  async composeReply(mention: string, context: string): Promise<string> {
    try {
      // Query vector DB for relevant context
      const ragContext = await ragEngine.queryContext(mention);

      // Weight context by account influence
      let knowledgeBase = ragContext.summary;
      if (ragContext.topAccounts.length > 0) {
        const topInfluencers = await accountInfluence.rankByInfluence(
          ragContext.topAccounts.map(a => a.handle)
        );
        if (topInfluencers.length > 0) {
          const citations = topInfluencers
            .slice(0, 3)
            .map((inf: any) => `@${inf.handle} (${inf.tier})`)
            .join(', ');
          knowledgeBase += `\nMost influential sources: ${citations}`;
        }
      }

      const prompt = `Reply to this Twitter mention using our knowledge base:

Mention: "${mention}"
Context: "${context}"

Our knowledge (what credible accounts have said):
${knowledgeBase}

Write a research-focused reply that sounds authoritative and informed. Use data where relevant. Max 280 characters.`;

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return (message.content[0].type === 'text' ? message.content[0].text : '').slice(0, 280);
    } catch (error: any) {
      logger.error('Reply composition failed', error.message);
      return '';
    }
  }
}

export const intelligenceComposer = new IntelligenceComposer();
