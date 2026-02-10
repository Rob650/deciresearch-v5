import { mentionListener } from './mention-listener.js';
import { autoReplyEngine } from './auto-reply.js';
import { logger } from '../shared/logger.js';
import { rateLimitManager } from '../shared/rate-limits.js';

interface ParsedMention {
  type: 'account_tag' | 'question' | 'analysis_request' | 'unknown';
  account?: string;
  question?: string;
  topic?: string;
}

export class MentionHandler {
  async handleMentions() {
    try {
      logger.info('Starting mention handler...');
      await mentionListener.start();
      logger.info('Mention handler active');
    } catch (error: any) {
      logger.error('Failed to start mention handler', error.message);
    }
  }

  async processMention(
    mentionText: string,
    author: string,
    mentionId: string
  ): Promise<void> {
    try {
      // Parse the mention type
      const parsed = this.parseMentionType(mentionText);

      if (parsed.type === 'account_tag' && parsed.account) {
        // Someone tagged an account for us to research
        await this.handleAccountNomination(parsed.account, author, mentionId);
      } else if (parsed.type === 'question' && parsed.question) {
        // Someone asked a question
        await this.handleQuestion(parsed.question, author, mentionId);
      } else if (parsed.type === 'analysis_request' && parsed.topic) {
        // Someone asked for analysis on a topic
        await this.handleAnalysisRequest(parsed.topic, author, mentionId);
      } else {
        // Generic mention - acknowledge
        await this.handleGenericMention(author, mentionId);
      }
    } catch (error: any) {
      logger.error(`Failed to process mention from @${author}`, error.message);
    }
  }

  private async handleAccountNomination(
    accountHandle: string,
    author: string,
    mentionId: string
  ): Promise<void> {
    try {
      if (!(await rateLimitManager.canReply())) {
        logger.warn('Reply rate limit hit, skipping account nomination reply');
        return;
      }

      logger.info(`Processing account nomination: @${accountHandle}`);
      // Reply will be handled by mention-listener's processAccountNomination
      rateLimitManager.recordReply();
    } catch (error: any) {
      logger.error('Failed to process account nomination', error.message);
    }
  }

  private async handleQuestion(
    question: string,
    author: string,
    mentionId: string
  ): Promise<void> {
    try {
      if (!(await rateLimitManager.canReply())) {
        logger.warn('Reply rate limit hit, skipping question response');
        return;
      }

      logger.info(`Responding to question from @${author}`);

      // Wait for Anthropic slot (auto-reply uses Claude)
      await rateLimitManager.waitForAnthropicSlot();

      const success = await autoReplyEngine.replyToMention(
        mentionId,
        question,
        author
      );

      if (success) {
        rateLimitManager.recordReply();
        rateLimitManager.recordAnthropicCall();
        logger.info(`Replied to @${author}'s question`);
      }
    } catch (error: any) {
      logger.error('Failed to handle question', error.message);
    }
  }

  private async handleAnalysisRequest(
    topic: string,
    author: string,
    mentionId: string
  ): Promise<void> {
    try {
      if (!(await rateLimitManager.canReply())) {
        logger.warn('Reply rate limit hit, skipping analysis reply');
        return;
      }

      logger.info(`Providing analysis on ${topic} for @${author}`);

      // Wait for Anthropic slot
      await rateLimitManager.waitForAnthropicSlot();

      const success = await autoReplyEngine.replyWithAnalysis(
        mentionId,
        topic,
        author
      );

      if (success) {
        rateLimitManager.recordReply();
        rateLimitManager.recordAnthropicCall();
      }
    } catch (error: any) {
      logger.error('Failed to handle analysis request', error.message);
    }
  }

  private async handleGenericMention(
    author: string,
    mentionId: string
  ): Promise<void> {
    try {
      // For generic mentions, just acknowledge
      logger.info(`Generic mention from @${author}`);
      // Could send a generic response here if desired
    } catch (error: any) {
      logger.error('Failed to handle generic mention', error.message);
    }
  }

  private parseMentionType(text: string): ParsedMention {
    const lower = text.toLowerCase();

    // Check for account tags (@username)
    const accountMatch = text.match(/@([a-zA-Z0-9_]+)/);
    if (accountMatch && accountMatch[1] !== 'deciresearch') {
      return {
        type: 'account_tag',
        account: accountMatch[1]
      };
    }

    // Check for analysis requests ("analyze", "what do you think", etc.)
    if (
      lower.includes('analyze') ||
      lower.includes('thoughts on') ||
      lower.includes('analysis') ||
      lower.includes('what do you think')
    ) {
      // Extract topic
      const topicMatch = text.match(/(?:analyze|thoughts on|analysis of|what do you think about)\s+([^?]+)/i);
      if (topicMatch) {
        return {
          type: 'analysis_request',
          topic: topicMatch[1].trim()
        };
      }
    }

    // Check for questions (ends with ?)
    if (text.includes('?')) {
      return {
        type: 'question',
        question: text
      };
    }

    return { type: 'unknown' };
  }

  getStatus() {
    return {
      rateLimits: rateLimitManager.getStatus(),
      activeListeners: ['mentions', 'accounts']
    };
  }
}

export const mentionHandler = new MentionHandler();
