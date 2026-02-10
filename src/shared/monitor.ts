import { logger } from './logger.js';

export interface HealthMetrics {
  uptime: number; // milliseconds
  tasksCompleted: number;
  tasksFailed: number;
  tokensFetched: number;
  tokensAnalyzed: number;
  tweetsPosted: number;
  tweetsFailed: number;
  llmCallsUsed: number;
  llmCallsRemaining: number;
  lastError: string | null;
  lastErrorTime: number | null;
  successRate: number; // 0-100
}

export interface PerformanceMetrics {
  avgFetchTime: number; // ms
  avgAnalysisTime: number; // ms
  avgPostTime: number; // ms
  p95FetchTime: number;
  p95AnalysisTime: number;
  p95PostTime: number;
}

export class Monitor {
  private startTime = Date.now();
  private metrics: HealthMetrics = {
    uptime: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tokensFetched: 0,
    tokensAnalyzed: 0,
    tweetsPosted: 0,
    tweetsFailed: 0,
    llmCallsUsed: 0,
    llmCallsRemaining: 10, // per hour
    lastError: null,
    lastErrorTime: null,
    successRate: 100
  };

  private performanceData = {
    fetchTimes: [] as number[],
    analysisTimes: [] as number[],
    postTimes: [] as number[]
  };

  recordTaskStart() {
    return Date.now();
  }

  recordTaskComplete(startTime: number, success: boolean) {
    const duration = Date.now() - startTime;
    this.metrics.tasksCompleted++;
    
    if (success) {
      // Success counted in specific metrics
    } else {
      this.metrics.tasksFailed++;
    }

    this.updateSuccessRate();
  }

  recordFetch(count: number, timeMs: number) {
    this.metrics.tokensFetched += count;
    this.performanceData.fetchTimes.push(timeMs);
    logger.info(`Fetched ${count} tokens in ${timeMs}ms`);
  }

  recordAnalysis(count: number, timeMs: number) {
    this.metrics.tokensAnalyzed += count;
    this.performanceData.analysisTimes.push(timeMs);
    logger.info(`Analyzed ${count} tokens in ${timeMs}ms`);
  }

  recordTweet(success: boolean, timeMs: number) {
    if (success) {
      this.metrics.tweetsPosted++;
    } else {
      this.metrics.tweetsFailed++;
    }
    this.performanceData.postTimes.push(timeMs);
    this.updateSuccessRate();
  }

  recordLLMCall() {
    this.metrics.llmCallsUsed++;
    this.metrics.llmCallsRemaining--;
  }

  recordError(error: Error) {
    this.metrics.lastError = error.message;
    this.metrics.lastErrorTime = Date.now();
    logger.error('Monitor recorded error', error.message);
  }

  resetLLMQuota() {
    this.metrics.llmCallsUsed = 0;
    this.metrics.llmCallsRemaining = 10;
    logger.info('LLM quota reset for new hour');
  }

  getMetrics(): HealthMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime
    };
  }

  getPerformanceMetrics(): PerformanceMetrics {
    const percentile = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)] || 0;
    };

    return {
      avgFetchTime: this.getAverage(this.performanceData.fetchTimes),
      avgAnalysisTime: this.getAverage(this.performanceData.analysisTimes),
      avgPostTime: this.getAverage(this.performanceData.postTimes),
      p95FetchTime: percentile(this.performanceData.fetchTimes, 95),
      p95AnalysisTime: percentile(this.performanceData.analysisTimes, 95),
      p95PostTime: percentile(this.performanceData.postTimes, 95)
    };
  }

  getDashboard() {
    const health = this.getMetrics();
    const perf = this.getPerformanceMetrics();

    const uptimeHours = (health.uptime / (1000 * 60 * 60)).toFixed(1);
    const apiUsagePercent = ((health.llmCallsUsed / 10) * 100).toFixed(0);

    return `
╔════════════════════════════════════════════════════════════╗
║               DeciResearch v5 - Live Dashboard             ║
╠════════════════════════════════════════════════════════════╣
║ HEALTH                                                     ║
║  Uptime: ${uptimeHours}h                                          ║
║  Success Rate: ${health.successRate.toFixed(1)}%                                 ║
║  Status: ${health.successRate > 90 ? '✅ HEALTHY' : health.successRate > 70 ? '⚠️  DEGRADED' : '❌ CRITICAL'}                                       ║
╠════════════════════════════════════════════════════════════╣
║ ACTIVITY                                                   ║
║  Tasks Completed: ${health.tasksCompleted}                                ║
║  Tasks Failed: ${health.tasksFailed}                                   ║
║  Tokens Fetched: ${health.tokensFetched}                                ║
║  Tokens Analyzed: ${health.tokensAnalyzed}                               ║
║  Tweets Posted: ${health.tweetsPosted}                                 ║
║  Tweets Failed: ${health.tweetsFailed}                                  ║
╠════════════════════════════════════════════════════════════╣
║ API USAGE                                                  ║
║  LLM Calls: ${health.llmCallsUsed}/10 (${apiUsagePercent}%)                             ║
║  Remaining: ${health.llmCallsRemaining}                                      ║
╠════════════════════════════════════════════════════════════╣
║ PERFORMANCE (latency)                                      ║
║  Fetch: avg ${perf.avgFetchTime.toFixed(0)}ms | p95 ${perf.p95FetchTime.toFixed(0)}ms                  ║
║  Analysis: avg ${perf.avgAnalysisTime.toFixed(0)}ms | p95 ${perf.p95AnalysisTime.toFixed(0)}ms              ║
║  Post: avg ${perf.avgPostTime.toFixed(0)}ms | p95 ${perf.p95PostTime.toFixed(0)}ms                    ║
╠════════════════════════════════════════════════════════════╣
║ LAST ERROR                                                 ║
║  ${health.lastError ? health.lastError.slice(0, 56) : 'None'}                           ║
║  Time: ${health.lastErrorTime ? new Date(health.lastErrorTime).toLocaleTimeString() : '-'}                ║
╚════════════════════════════════════════════════════════════╝
    `;
  }

  private getAverage(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  private updateSuccessRate() {
    const total = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    if (total === 0) {
      this.metrics.successRate = 100;
    } else {
      this.metrics.successRate = (this.metrics.tasksCompleted / total) * 100;
    }
  }
}

export const monitor = new Monitor();
