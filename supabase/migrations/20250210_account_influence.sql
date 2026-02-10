-- Create account_influence table for tracking account influence metrics
CREATE TABLE IF NOT EXISTS account_influence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL UNIQUE,
  credibility NUMERIC NOT NULL DEFAULT 0,
  influence_score NUMERIC NOT NULL DEFAULT 0,
  cited_count INTEGER NOT NULL DEFAULT 0,
  conversation_starter_score NUMERIC NOT NULL DEFAULT 0,
  early_narrative_score NUMERIC NOT NULL DEFAULT 0,
  accuracy NUMERIC NOT NULL DEFAULT 0,
  momentum TEXT NOT NULL DEFAULT 'stable' CHECK (momentum IN ('rising', 'stable', 'declining')),
  tier TEXT NOT NULL DEFAULT 'follower' CHECK (tier IN ('trendsetter', 'leader', 'contributor', 'follower')),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on handle for fast lookups
CREATE INDEX IF NOT EXISTS idx_account_influence_handle ON account_influence(handle);

-- Create index on influence_score for ranking queries
CREATE INDEX IF NOT EXISTS idx_account_influence_score ON account_influence(influence_score DESC);

-- Create index on tier for filtering by influence tier
CREATE INDEX IF NOT EXISTS idx_account_influence_tier ON account_influence(tier);

-- Create index on momentum for trend analysis
CREATE INDEX IF NOT EXISTS idx_account_influence_momentum ON account_influence(momentum);

-- Create index on last_updated for tracking freshness
CREATE INDEX IF NOT EXISTS idx_account_influence_updated ON account_influence(last_updated DESC);

-- Create a function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_account_influence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS account_influence_timestamp_trigger ON account_influence;
CREATE TRIGGER account_influence_timestamp_trigger
BEFORE UPDATE ON account_influence
FOR EACH ROW
EXECUTE FUNCTION update_account_influence_timestamp();

-- Add helpful comments
COMMENT ON TABLE account_influence IS 'Stores computed influence metrics for accounts tracking who moves conversations';
COMMENT ON COLUMN account_influence.handle IS 'Twitter handle (unique identifier)';
COMMENT ON COLUMN account_influence.credibility IS 'Credibility score (0-100) based on expertise category';
COMMENT ON COLUMN account_influence.influence_score IS 'Composite influence score (0-100) calculated from multiple factors';
COMMENT ON COLUMN account_influence.cited_count IS 'Number of times this account has been cited or mentioned by others';
COMMENT ON COLUMN account_influence.conversation_starter_score IS 'Score based on how many reply chains their tweets generate';
COMMENT ON COLUMN account_influence.early_narrative_score IS 'Score based on identifying trends before others (days ahead)';
COMMENT ON COLUMN account_influence.accuracy IS 'Historical prediction accuracy percentage (0-100)';
COMMENT ON COLUMN account_influence.momentum IS 'Trend direction: rising (engagement increasing), stable, or declining';
COMMENT ON COLUMN account_influence.tier IS 'Influence tier classification: trendsetter (80+), leader (65-79), contributor (50-64), follower (<50)';
