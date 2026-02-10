import Database from 'better-sqlite3';
import { Token } from './types.js';

const db = new Database('deciresearch.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    name TEXT,
    price REAL,
    volume24h REAL,
    marketCap REAL,
    priceChange24h REAL,
    priceChange7d REAL,
    score REAL,
    analysis TEXT,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS tweets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    tweetId TEXT,
    postedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_timestamp ON tokens(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tokens_score ON tokens(score);
`);

export function saveTokens(tokens: Token[]) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tokens (id, symbol, name, price, volume24h, marketCap, priceChange24h, priceChange7d, score, analysis, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insert = db.transaction((tokens: Token[]) => {
    for (const t of tokens) {
      stmt.run(t.id, t.symbol, t.name, t.price, t.volume24h, t.marketCap, t.priceChange24h, t.priceChange7d, t.score || null, t.analysis || null, t.timestamp);
    }
  });
  insert(tokens);
}

export function getTopTokens(limit: number = 50): Token[] {
  return db.prepare(`
    SELECT * FROM tokens
    WHERE timestamp > ?
    ORDER BY score DESC
    LIMIT ?
  `).all(Date.now() - 86400000, limit) as Token[];
}

export function saveTweet(content: string, tweetId?: string) {
  db.prepare(`
    INSERT INTO tweets (content, tweetId, postedAt)
    VALUES (?, ?, ?)
  `).run(content, tweetId || null, Date.now());
}

export function getTweetCount24h(): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM tweets
    WHERE postedAt > ?
  `).get(Date.now() - 86400000) as { count: number };
  return result.count;
}
