import cron from 'node-cron';
import { accountDiscovery, DiscoveryCandidate } from './account-discovery.js';
import { vectorDB } from './vectordb.js';
import { logger } from '../shared/logger.js';

export class DiscoveryScheduler {
  private isRunning = false;
  private lastRunTime: number | null = null;

  start() {
    if (this.isRunning) {
      logger.warn('Discovery scheduler already running');
      return;
    }

    this.isRunning = true;

    // Run discovery every 24 hours (daily at 3am UTC)
    cron.schedule('0 3 * * *', async () => {
      await this.runDiscovery();
    });

    logger.info('Discovery scheduler started (runs daily at 3am UTC)');
  }

  stop() {
    this.isRunning = false;
    logger.info('Discovery scheduler stopped');
  }

  async runDiscovery(): Promise<void> {
    try {
      logger.info('=== Discovery cycle starting ===');
      const startTime = Date.now();

      // Run discovery
      const candidates = await accountDiscovery.discoverAccountsFromNetwork();

      logger.info(`Found ${candidates.length} candidates`);

      // Auto-approve accounts that have been suggested multiple times
      const autoApproved = await accountDiscovery.autoApproveConfirmed();
      if (autoApproved.length > 0) {
        logger.info(`Auto-approved ${autoApproved.length} accounts after confirmation:`);
        for (const handle of autoApproved) {
          logger.info(`  - @${handle}`);
        }
      }

      // Get summary
      const summary = accountDiscovery.getDiscoverySummary();

      // Log results
      const duration = Date.now() - startTime;
      logger.info('=== Discovery cycle complete ===');
      logger.info(`Duration: ${duration}ms`);
      logger.info(`Suggested: ${summary.suggested}`);
      logger.info(`Approved: ${summary.approved}`);
      logger.info(`Rejected: ${summary.rejected}`);

      this.lastRunTime = Date.now();
    } catch (error: any) {
      logger.error('Discovery cycle failed', error.message);
    }
  }

  // Manual trigger for testing
  async triggerNow(): Promise<void> {
    logger.info('Triggering discovery cycle immediately...');
    await this.runDiscovery();
  }

  // Get status
  getStatus() {
    const summary = accountDiscovery.getDiscoverySummary();
    return {
      running: this.isRunning,
      lastRun: this.lastRunTime ? new Date(this.lastRunTime).toISOString() : null,
      nextRun: 'Daily at 3am UTC',
      summary
    };
  }

  // Approve a candidate for addition to network
  async approveCandidateForAddition(handle: string): Promise<boolean> {
    try {
      const approved = await accountDiscovery.approveAccount(handle);
      if (approved) {
        logger.info(`Manually approved @${handle} for network addition`);
        // TODO: Add to tracked_accounts table
      }
      return approved;
    } catch (error: any) {
      logger.error(`Failed to approve @${handle}`, error.message);
      return false;
    }
  }

  // Reject a candidate
  rejectCandidate(handle: string): void {
    accountDiscovery.rejectAccount(handle);
    logger.info(`Manually rejected @${handle}`);
  }
}

export const discoveryScheduler = new DiscoveryScheduler();
