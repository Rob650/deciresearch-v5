import http from 'http';
import { URL } from 'url';
import { logger } from './shared/logger.js';
import { monitor } from './shared/monitor.js';
import { config } from './shared/config.js';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export class ApiServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(port: number = 3000) {
    this.port = port;
  }

  start() {
    this.server = http.createServer((req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      try {
        // Routes
        if (pathname === '/health') {
          this.handleHealth(res);
        } else if (pathname === '/metrics') {
          this.handleMetrics(res);
        } else if (pathname === '/dashboard') {
          this.handleDashboard(res);
        } else if (pathname === '/config') {
          this.handleConfig(res);
        } else if (pathname === '/') {
          this.handleRoot(res);
        } else {
          this.sendError(res, 'Not found', 404);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('API error', err.message);
        this.sendError(res, err.message, 500);
      }
    });

    this.server.listen(this.port, () => {
      logger.info(`API server listening on port ${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('API server stopped');
      });
    }
  }

  private handleRoot(res: http.ServerResponse) {
    const response: ApiResponse = {
      success: true,
      data: {
        name: 'DeciResearch v5 API',
        version: '1.0.0',
        endpoints: [
          '/health - Basic health check',
          '/metrics - Full metrics and performance data',
          '/dashboard - ASCII dashboard view',
          '/config - Current configuration'
        ]
      },
      timestamp: Date.now()
    };
    this.sendJson(res, response);
  }

  private handleHealth(res: http.ServerResponse) {
    const metrics = monitor.getMetrics();
    const healthy = metrics.successRate > 90;

    const response: ApiResponse = {
      success: healthy,
      data: {
        status: healthy ? 'healthy' : metrics.successRate > 70 ? 'degraded' : 'unhealthy',
        uptime: metrics.uptime,
        successRate: metrics.successRate,
        tasksCompleted: metrics.tasksCompleted,
        tasksFailed: metrics.tasksFailed
      },
      timestamp: Date.now()
    };

    this.sendJson(res, response, healthy ? 200 : 503);
  }

  private handleMetrics(res: http.ServerResponse) {
    const health = monitor.getMetrics();
    const perf = monitor.getPerformanceMetrics();

    const response: ApiResponse = {
      success: true,
      data: {
        health,
        performance: perf,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    };

    this.sendJson(res, response);
  }

  private handleDashboard(res: http.ServerResponse) {
    const dashboard = monitor.getDashboard();
    
    // Return as plain text for ASCII art
    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(200);
    res.end(dashboard);
  }

  private handleConfig(res: http.ServerResponse) {
    const currentConfig = config.getAll();
    
    // Redact sensitive values
    const safe = { ...currentConfig };
    if (safe.anthropicApiKey) safe.anthropicApiKey = '***';
    if (safe.twitterApiKey) safe.twitterApiKey = '***';
    if (safe.twitterApiSecret) safe.twitterApiSecret = '***';
    if (safe.twitterAccessToken) safe.twitterAccessToken = '***';
    if (safe.twitterAccessSecret) safe.twitterAccessSecret = '***';
    if (safe.coingeckoApiKey) safe.coingeckoApiKey = '***';

    const response: ApiResponse = {
      success: true,
      data: safe,
      timestamp: Date.now()
    };

    this.sendJson(res, response);
  }

  private sendJson(
    res: http.ServerResponse,
    data: any,
    statusCode: number = 200
  ) {
    res.writeHead(statusCode);
    res.end(JSON.stringify(data, null, 2));
  }

  private sendError(
    res: http.ServerResponse,
    error: string,
    statusCode: number = 400
  ) {
    const response: ApiResponse = {
      success: false,
      error,
      timestamp: Date.now()
    };
    this.sendJson(res, response, statusCode);
  }
}

export const apiServer = new ApiServer(3000);
