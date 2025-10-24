const express = require('express');
const AWS = require('aws-sdk');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');

// 로거 설정
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Express 앱 설정
const app = express();
const PORT = process.env.PORT || 8080;

// AWS 설정
const cloudwatch = new AWS.CloudWatch({
  region: process.env.AWS_REGION || 'ap-northeast-2'
});

// 미들웨어
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// 메트릭 수집용 변수
let requestCount = 0;
let totalResponseTime = 0;
let activeConnections = 0;
let startTime = Date.now();

// 메트릭 수집 미들웨어
app.use((req, res, next) => {
  const requestStart = Date.now();
  activeConnections++;
  
  // 요청 완료 시 메트릭 업데이트
  res.on('finish', () => {
    const responseTime = Date.now() - requestStart;
    requestCount++;
    totalResponseTime += responseTime;
    activeConnections--;
    
    logger.info('Request processed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: responseTime,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  
  next();
});

// 헬스체크 엔드포인트
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// 메트릭 엔드포인트 (디버깅용)
app.get('/metrics', (req, res) => {
  const currentTime = Date.now();
  const elapsedSeconds = (currentTime - startTime) / 1000;
  const rps = requestCount / elapsedSeconds;
  const avgResponseTime = requestCount > 0 ? totalResponseTime / requestCount : 0;
  
  res.json({
    requestCount,
    rps: rps.toFixed(2),
    averageResponseTime: avgResponseTime.toFixed(2),
    activeConnections,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  });
});

// 루트 엔드포인트
app.get('/', (req, res) => {
  res.json({
    message: 'Fast Scaling Demo Application',
    timestamp: new Date().toISOString(),
    requestId: Math.random().toString(36).substr(2, 9)
  });
});

// 부하 테스트용 엔드포인트
app.get('/load/:intensity', (req, res) => {
  const intensity = parseInt(req.params.intensity) || 1;
  
  // CPU 집약적 작업 시뮬레이션
  let result = 0;
  for (let i = 0; i < intensity * 100000; i++) {
    result += Math.sqrt(i);
  }
  
  res.json({
    message: 'Load test completed',
    intensity,
    result: result.toFixed(2),
    timestamp: new Date().toISOString()
  });
});

// 메모리 사용량 증가 엔드포인트 (테스트용)
const memoryStore = [];
app.get('/memory/:size', (req, res) => {
  const size = parseInt(req.params.size) || 1;
  const data = new Array(size * 1000).fill('x'.repeat(1000));
  memoryStore.push(data);
  
  res.json({
    message: 'Memory allocated',
    size: `${size}MB`,
    totalAllocated: memoryStore.length,
    memoryUsage: process.memoryUsage()
  });
});

// CloudWatch 메트릭 발행 함수
async function publishMetrics() {
  try {
    const currentTime = Date.now();
    const elapsedSeconds = (currentTime - startTime) / 1000;
    const rps = elapsedSeconds > 0 ? requestCount / elapsedSeconds : 0;
    const avgResponseTime = requestCount > 0 ? totalResponseTime / requestCount : 0;
    
    const params = {
      Namespace: process.env.CLOUDWATCH_NAMESPACE || 'FastScaling/Application',
      MetricData: [
        {
          MetricName: 'RequestsPerSecond',
          Value: rps,
          Unit: 'Count/Second',
          Timestamp: new Date(),
          StorageResolution: 1 // 고해상도 메트릭
        },
        {
          MetricName: 'AverageResponseTime',
          Value: avgResponseTime,
          Unit: 'Milliseconds',
          Timestamp: new Date(),
          StorageResolution: 1
        },
        {
          MetricName: 'ActiveConnections',
          Value: activeConnections,
          Unit: 'Count',
          Timestamp: new Date(),
          StorageResolution: 1
        },
        {
          MetricName: 'TotalRequests',
          Value: requestCount,
          Unit: 'Count',
          Timestamp: new Date(),
          StorageResolution: 1
        }
      ]
    };
    
    await cloudwatch.putMetricData(params).promise();
    
    logger.info('Metrics published to CloudWatch', {
      rps: rps.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(2),
      activeConnections,
      totalRequests: requestCount
    });
    
    // 메트릭 리셋 (5초마다 새로 시작)
    requestCount = 0;
    totalResponseTime = 0;
    startTime = Date.now();
    
  } catch (error) {
    logger.error('Failed to publish metrics to CloudWatch', {
      error: error.message,
      stack: error.stack
    });
  }
}

// 에러 핸들링
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// 404 핸들링
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// 서버 시작
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server started on port ${PORT}`, {
    port: PORT,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
  
  // 5초마다 메트릭 발행
  setInterval(publishMetrics, 5000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

module.exports = app;// Pipeline test #오후
// 🚀 GitHub Actions 파이프라인 테스트 - 2025-10-25 01:16:27
