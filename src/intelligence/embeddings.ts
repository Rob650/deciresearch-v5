import OpenAI from 'openai';
import { logger } from '../shared/logger.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class EmbeddingsService {
  private cache: Map<string, number[]> = new Map();
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
  private cacheTimestamps: Map<string, number> = new Map();

  async embedText(text: string): Promise<number[]> {
    // Check cache first
    const cached = this.getFromCache(text);
    if (cached) {
      logger.info('Using cached embedding');
      return cached;
    }

    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      });

      const embedding = response.data[0].embedding;

      // Cache for future use
      this.cache.set(text, embedding);
      this.cacheTimestamps.set(text, Date.now());

      logger.info('Generated embedding via OpenAI');
      return embedding;
    } catch (error: any) {
      logger.error('Failed to generate embedding', error.message);
      // Fallback to dummy embedding
      return this.getDummyEmbedding();
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const uncachedTexts: string[] = [];
      const uncachedIndices: number[] = [];
      const results: (number[] | null)[] = new Array(texts.length).fill(null);

      // Check cache for each text
      for (let i = 0; i < texts.length; i++) {
        const cached = this.getFromCache(texts[i]);
        if (cached) {
          results[i] = cached;
        } else {
          uncachedTexts.push(texts[i]);
          uncachedIndices.push(i);
        }
      }

      // If all cached, return immediately
      if (uncachedTexts.length === 0) {
        return results as number[][];
      }

      // Batch embed uncached texts (max 25 per request)
      const batchSize = 25;
      for (let i = 0; i < uncachedTexts.length; i += batchSize) {
        const batch = uncachedTexts.slice(i, i + batchSize);
        const batchIndices = uncachedIndices.slice(i, i + batchSize);

        try {
          const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: batch,
            encoding_format: 'float'
          });

          for (let j = 0; j < response.data.length; j++) {
            const embedding = response.data[j].embedding;
            results[batchIndices[j]] = embedding;

            // Cache it
            this.cache.set(batch[j], embedding);
            this.cacheTimestamps.set(batch[j], Date.now());
          }

          logger.info(`Embedded batch of ${batch.length} texts`);
        } catch (error: any) {
          logger.error('Failed to embed batch', error.message);
          // Use dummy embeddings for failed batch
          for (const idx of batchIndices) {
            results[idx] = this.getDummyEmbedding();
          }
        }
      }

      return results as number[][];
    } catch (error: any) {
      logger.error('Batch embedding failed', error.message);
      return texts.map(() => this.getDummyEmbedding());
    }
  }

  // Calculate similarity between two embeddings (cosine similarity)
  calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      logger.warn('Embedding dimensions mismatch');
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  // Find most similar texts
  findMostSimilar(
    queryEmbedding: number[],
    candidates: { text: string; embedding: number[] }[],
    topK: number = 5
  ): { text: string; similarity: number }[] {
    const similarities = candidates.map(candidate => ({
      text: candidate.text,
      similarity: this.calculateSimilarity(queryEmbedding, candidate.embedding)
    }));

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  // Clear old cache entries
  cleanupCache() {
    const now = Date.now();
    let cleaned = 0;

    for (const [text, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.cacheTTL) {
        this.cache.delete(text);
        this.cacheTimestamps.delete(text);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old embeddings from cache`);
    }
  }

  private getFromCache(text: string): number[] | null {
    const cached = this.cache.get(text);
    if (!cached) return null;

    const timestamp = this.cacheTimestamps.get(text);
    if (!timestamp || Date.now() - timestamp > this.cacheTTL) {
      this.cache.delete(text);
      this.cacheTimestamps.delete(text);
      return null;
    }

    return cached;
  }

  private getDummyEmbedding(): number[] {
    // Fallback: return dummy vector (all zeros)
    // In production, this should rarely happen
    return Array(1536).fill(0);
  }

  getStatus() {
    return {
      cacheSize: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([text, _]) => text.substring(0, 50) + '...')
    };
  }
}

export const embeddingsService = new EmbeddingsService();

// Cleanup old embeddings every hour
setInterval(() => {
  embeddingsService.cleanupCache();
}, 60 * 60 * 1000);
