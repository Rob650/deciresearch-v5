import { TwitterApi } from 'twitter-api-v2';
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

export class MentionListener {
  private lastMentionId: string | null = null;
  private isRunning = false;

  async start() {
    if (this.isRunning) {
      logger.warn('Mention listener already running');
      return;
    }

    this.isRunning = true;
    logger.info('Mention listener started');

    // Check for mentions every 5 minutes
    this.pollMentions();
  }

  async stop() {
    this.isRunning = false;
    logger.info('Mention listener stopped');
  }

  private async pollMentions() {
    while (this.isRunning) {
      try {
        await this.fetchAndProcessMentions();
        // Poll every 5 minutes
        await this.sleep(5 * 60 * 1000);
      } catch (error: any) {
        logger.error('Mention polling error', error.message);
        await this.sleep(60 * 1000); // Retry after 1 minute on error
      }
    }
  }

  private async fetchAndProcessMentions() {
    try {
      // Get our bot's mentions
      const mentions = await rwClient.v2.homeTimeline('me', {
        'tweet.fields': [
          'created_at',
          'public_metrics',
          'author_id',
          'conversation_id'
        ],
        expansions: ['author_id'],
        max_results: 100,
        since_id: this.lastMentionId
      });

      if (!mentions.data || mentions.data.length === 0) {
        return;
      }

      const users = mentions.includes?.users || [];

      for (const mention of mentions.data) {
        try {
          // Find author of mention
          const author = users.find(u => u.id === mention.author_id);
          if (!author) continue;

          // Skip retweets of us
          if (mention.text.includes('RT @')) continue;

          // Parse mention for account tags or questions
          const parsedMention = await this.parseMention(mention.text, author.username);

          if (parsedMention.type === 'account_tag') {
            // Someone tagged an account for us to research
            logger.info(`Account nomination: @${parsedMention.account} from @${author.username}`);
            await this.processAccountNomination(
              parsedMention.account,
              author.username,
              mention.id
            );
          } else if (parsedMention.type === 'question') {
            // Someone asked a question
            logger.info(`Question from @${author.username}: ${parsedMention.question}`);
            // Will trigger auto-reply in next step
          }

          this.lastMentionId = mention.id;
        } catch (error: any) {
          logger.error('Failed to process mention', error.message);
        }
      }

      logger.info(`Processed ${mentions.data.length} mentions`);
    } catch (error: any) {
      logger.error('Failed to fetch mentions', error.message);
    }
  }

  private async parseMention(
    text: string,
    author: string
  ): Promise<{ type: 'account_tag' | 'question' | 'unknown'; account?: string; question?: string }> {
    try {
      const prompt = `Parse this Twitter mention to @deciresearch. Identify:
1. If it tags another account (e.g., @username) - respond with: TYPE:account_tag ACCOUNT:@username
2. If it's asking a question - respond with: TYPE:question QUESTION:...
3. Otherwise - respond with: TYPE:unknown

Mention from @${author}: "${text}"

Response:`;

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

      const response = message.content[0].type === 'text' ? message.content[0].text : '';

      if (response.includes('TYPE:account_tag')) {
        const match = response.match(/ACCOUNT:(@\w+)/);
        if (match) {
          return {
            type: 'account_tag',
            account: match[1].substring(1) // Remove @
          };
        }
      }

      if (response.includes('TYPE:question')) {
        const match = response.match(/QUESTION:(.*?)(?:$|TYPE:)/);
        if (match) {
          return {
            type: 'question',
            question: match[1].trim()
          };
        }
      }

      return { type: 'unknown' };
    } catch (error: any) {
      logger.error('Failed to parse mention', error.message);
      return { type: 'unknown' };
    }
  }

  private async processAccountNomination(
    accountHandle: string,
    nominator: string,
    mentionId: string
  ) {
    try {
      // Check if account is credible enough to add
      const user = await client.v2.userByUsername(accountHandle, {
        'user.fields': ['public_metrics', 'verified', 'description']
      });

      if (!user.data) {
        logger.warn(`Account not found: ${accountHandle}`);
        return;
      }

      const followers = user.data.public_metrics?.followers_count || 0;
      const verified = user.data.verified || false;

      // Minimum credibility threshold: 1000 followers or verified
      if (followers < 1000 && !verified) {
        logger.info(`Account ${accountHandle} below credibility threshold (${followers} followers)`);
        return;
      }

      // Account is credible - store nomination
      logger.info(`Nominating @${accountHandle} (${followers} followers, verified: ${verified})`);

      // In production: trigger classifier to analyze this account
      // For now: log it
      const nomination = {
        account: accountHandle,
        nominator,
        followers,
        verified,
        timestamp: Date.now(),
        mentionId
      };

      // Store in database (would need: accountNominations table)
      logger.info(`Nomination stored: ${JSON.stringify(nomination)}`);

      // Optionally reply to nominator
      // await this.replyToNomination(mentionId, accountHandle, nominator);
    } catch (error: any) {
      logger.error(`Failed to process nomination for ${accountHandle}`, error.message);
    }
  }

  private async replyToNomination(
    mentionId: string,
    accountHandle: string,
    nominator: string
  ) {
    try {
      const reply = `Thanks for the nomination! Adding @${accountHandle} to our research network. 📊`;

      await rwClient.v2.reply(reply, mentionId);
      logger.info(`Replied to @${nominator} about @${accountHandle}`);
    } catch (error: any) {
      logger.error('Failed to reply to nomination', error.message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const mentionListener = new MentionListener();
