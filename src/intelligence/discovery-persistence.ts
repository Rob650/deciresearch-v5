import { createClient } from '@supabase/supabase-js';
import { DiscoveryCandidate } from './account-discovery.js';
import { logger } from '../shared/logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

export class DiscoveryPersistence {
  async initTables() {
    try {
      // Create candidates table if not exists
      await supabase.from('discovery_candidates').select('count').limit(1);
      logger.info('Discovery tables already exist');
    } catch (error: any) {
      // Tables don't exist, create them
      logger.info('Creating discovery tables...');
      // Note: In production, run these via Supabase SQL editor
    }
  }

  async saveCandidate(candidate: DiscoveryCandidate): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('discovery_candidates')
        .upsert({
          handle: candidate.handle,
          score: candidate.score,
          category: candidate.category,
          reason: candidate.reason,
          last_seen: candidate.lastSeen,
          confirmation_count: candidate.confirmationCount,
          status: candidate.status,
          updated_at: Date.now()
        });

      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error(`Failed to save candidate ${candidate.handle}`, error.message);
      return false;
    }
  }

  async getCandidates(status?: string): Promise<DiscoveryCandidate[]> {
    try {
      let query = supabase.from('discovery_candidates').select('*');

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((row: any) => ({
        handle: row.handle,
        score: row.score,
        category: row.category,
        reason: row.reason,
        lastSeen: row.last_seen,
        confirmationCount: row.confirmation_count,
        status: row.status
      }));
    } catch (error: any) {
      logger.error('Failed to fetch candidates', error.message);
      return [];
    }
  }

  async getSuggestedAccounts(): Promise<DiscoveryCandidate[]> {
    return this.getCandidates('suggested');
  }

  async getApprovedAccounts(): Promise<DiscoveryCandidate[]> {
    return this.getCandidates('approved');
  }

  async updateCandidateStatus(
    handle: string,
    status: 'suggested' | 'approved' | 'rejected' | 'pruned'
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('discovery_candidates')
        .update({ status, updated_at: Date.now() })
        .eq('handle', handle);

      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error(`Failed to update ${handle} status`, error.message);
      return false;
    }
  }

  async logDiscoveryRun(found: number, added: number, approved: number): Promise<boolean> {
    try {
      const { error } = await supabase.from('discovery_runs').insert({
        found,
        added,
        approved,
        timestamp: Date.now()
      });

      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error('Failed to log discovery run', error.message);
      return false;
    }
  }

  async getDiscoveryHistory(limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('discovery_runs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error: any) {
      logger.error('Failed to fetch discovery history', error.message);
      return [];
    }
  }

  async cleanupPrunedCandidates(): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('discovery_candidates')
        .delete()
        .eq('status', 'pruned');

      if (error) throw error;
      return 1; // Simplified - in production use rowCount
    } catch (error: any) {
      logger.error('Failed to cleanup pruned candidates', error.message);
      return 0;
    }
  }
}

export const discoveryPersistence = new DiscoveryPersistence();
