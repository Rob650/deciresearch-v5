import { TwitterApi } from 'twitter-api-v2';
import { ragEngine } from './rag.js';
import { logger } from '../shared/logger.js';
import Anthropic from '@anthropic-ai/sdk';

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

const rwClient = client.readWrite;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export class AutoReplyEngine {
  async generateReply(question: string, context?: string): Promise<string> {
    try {
      // Query knowledge base for relevant context
      const ragContext = await ragEngine.queryContext(question);

      // Build knowledge summary
      let knowledge = '';
      if (ragContext.topAccounts.length > 0) {
        knowledge += `Key insights from credible accounts:\n`;
        for (const account of ragContext.topAccounts.slice(0, 3)) {
          knowledge += `- @${account.handle} (${account.category})\n`;
        }
      }

      if (ragContext.themes.length > 0) {
        knowledge += `\nKey themes: ${ragContext.themes.map(t => t.theme).join(', ')}\n`;
      }

      if (ragContext.summary) {
        knowledge += `\nSummary: ${ragContext.summary}\n`;
      }

      // Compose reply using knowledge base
      const prompt = `Based on this knowledge, reply to a question about crypto/DeFi. Be concise (1-2 sentences max), data-backed, and authoritative.

Question: "${question}"
${context ? `Context: ${context}` : ''}

Knowledge from our network:
${knowledge}

Reply (keep under 280 characters):`;

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

      const reply = message.content[0].type === 'text' ? message.content[0].text : '';
      return reply.slice(0, 280);
    } catch (error: any) {
      logger.error('Failed to generate reply', error.message);
      return '';
    }
  }

  async replyToMention(
    mentionId: string,
    question: string,
    author: string
  ): Promise<boolean> {
    try {
      const reply = await this.generateReply(question);

      if (!reply) {
        logger.error('Failed to generate reply text');
        return false;
      }

      // Post reply
      await rwClient.v2.reply(`@${author} ${reply}`, mentionId);

      logger.info(`Replied to @${author} with: ${reply.substring(0, 50)}...`);
      return true;
    } catch (error: any) {
      logger.error('Failed to post reply', error.message);
      return false;
    }
  }

  async replyToAccountNomination(
    mentionId: string,
    accountHandle: string,
    nominator: string
  ): Promise<boolean> {
    try {
      const reply = `Thanks for nominating @${accountHandle}! We're analyzing their perspective and adding to our research network. 📊`;

      await rwClient.v2.reply(reply, mentionId);
      logger.info(`Acknowledged nomination from @${nominator} for @${accountHandle}`);
      return true;
    } catch (error: any) {
      logger.error('Failed to reply to nomination', error.message);
      return false;
    }
  }

  async replyWithAnalysis(
    mentionId: string,
    topic: string,
    author: string
  ): Promise<boolean> {
    try {
      // Get insights from specific category
      const ragContext = await ragEngine.queryContext(topic);

      // Build brief analysis
      let analysis = '';
      if (ragContext.sentiment.bullish > ragContext.sentiment.bearish) {
        analysis = `Bullish signals detected on ${topic}. `;
      } else if (ragContext.sentiment.bearish > ragContext.sentiment.bullish) {
        analysis = `Bearish signals on ${topic}. `;
      } else {
        analysis = `Mixed sentiment on ${topic}. `;
      }

      if (ragContext.themes.length > 0) {
        analysis += `Key themes: ${ragContext.themes.slice(0, 2).map(t => t.theme).join(', ')}.`;
      }

      const reply = `@${author} ${analysis}`.slice(0, 280);

      await rwClient.v2.reply(reply, mentionId);
      logger.info(`Sent analysis reply for ${topic}`);
      return true;
    } catch (error: any) {
      logger.error('Failed to send analysis reply', error.message);
      return false;
    }
  }
}

export const autoReplyEngine = new AutoReplyEngine();
