const { AsyncLocalStorage } = require('node:async_hooks');
const { writeSync } = require('node:fs');
const { relative } = require('node:path');
const config = require('./config');
const { Role } = require('./model/model');

const redacted = '[redacted]';
const metadata = {
  http: ['method', 'path', 'statusCode', 'authorized'],
  db: ['query'],
  factory: ['statusCode'],
};
const roleNames = new Set(Object.values(Role));
const safeMessages = new Set([
  'welcome to JWT Pizza', 'unknown endpoint', 'unauthorized', 'unknown user',
  'invalid user ID', 'invalid user list query', 'unknown user for franchise admin provided',
  'name, email, and password are required', 'logout successful', 'menu item deleted',
  'franchise deleted', 'store deleted', 'Failed to fulfill order at factory',
  'unable to add menu item', 'unable to delete menu item', 'unable to create a franchise',
  'unable to delete a franchise', 'unable to create a store', 'unable to delete a store',
  'No ID found', 'unable to delete user', 'unable to delete franchise',
]);
const numericFields = new Set([
  'id', 'userId', 'dinerId', 'franchiseId', 'storeId', 'menuId', 'objectId',
  'orderId', 'price', 'totalRevenue', 'page', 'iat', 'exp',
]);
const nestedFields = new Set([
  'user', 'users', 'diner', 'order', 'orders', 'items', 'franchises', 'stores',
  'admins', 'roles',
]);
const textFields = new Set(['name', 'title', 'description']);
const confidentialFields = new Map([
  'password', 'email', 'token', 'jwt', 'authorization', 'authHeader', 'apiKey',
  'secret', 'cookie', 'reportUrl', 'followLinkToEndChaos', 'config', 'stack',
].map((key) => [key.toLowerCase(), key]));

function sanitizeText(value) {
  if (typeof value !== 'string' || value.length > 2048) return redacted;
  const secrets = [
    config.jwtSecret, config.db.connection.password, config.factory.apiKey,
    config.logging.apiKey, config.metrics.apiKey,
  ];
  if (secrets.some((secret) => secret && value.includes(secret))) return redacted;
  if (/\b(?:bearer\s+\S|basic\s+[A-Za-z0-9+/]{8,}={0,2}\b|(?:password|token|secret|api[_ -]?key)\s*[:=])/i.test(value)) {
    return redacted;
  }
  return value
    .replace(/[\p{L}\p{M}\p{N}_.!#$%&'*+/=?^`{|}~-]+@[\p{L}\p{M}\p{N}-]+(?:\.[\p{L}\p{M}\p{N}-]+)*/gu, redacted)
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>]+/gi, redacted)
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, redacted);
}

function sanitizeBody(body, depth = 0, factoryResponse = false) {
  if (body == null) return null;
  if (depth >= 12) return redacted;
  if (Array.isArray(body)) return body.map((item) => sanitizeBody(item, depth + 1, factoryResponse));
  if (typeof body !== 'object' || Object.getPrototypeOf(body) !== Object.prototype) return redacted;

  const sanitized = {};
  for (const [key, value] of Object.entries(body)) {
    const confidentialKey = confidentialFields.get(key.toLowerCase());
    if (confidentialKey) sanitized[confidentialKey] = redacted;
    else if (numericFields.has(key)) sanitized[key] = Number.isFinite(value) ? value : redacted;
    else if (nestedFields.has(key)) sanitized[key] = sanitizeBody(value, depth + 1);
    else if (textFields.has(key)) sanitized[key] = sanitizeText(value);
    else if (key === 'image') sanitized[key] = typeof value === 'string' && /^[\w-]+\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(value) ? sanitizeText(value) : redacted;
    else if (key === 'role') sanitized[key] = roleNames.has(value) ? value : redacted;
    else if (key === 'message') sanitized[key] = factoryResponse ? sanitizeText(value) : safeMessages.has(value) ? value : redacted;
    else if (factoryResponse && key === 'error') {
      sanitized[key] = typeof value === 'string' ? sanitizeText(value) : sanitizeBody(value, depth + 1, true);
    }
    else if (key === 'more') sanitized[key] = typeof value === 'boolean' ? value : redacted;
    else if (key === 'date') sanitized[key] = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value : redacted;
    else if (key === 'version') sanitized[key] = typeof value === 'string' && /^(?:\d{8}\.\d{6}|\d+\.\d+\.\d+)$/.test(value) ? value : redacted;
    else sanitized.redactedFields = true;
  }
  return sanitized;
}

function exceptionDetails(error, category) {
  const status = error?.statusCode ?? error?.status;
  const frames = typeof error?.stack === 'string' ? error.stack.split('\n').slice(1) : [];
  const stack = [];
  for (const frame of frames) {
    const location = frame.match(/^\s+at (?:[^()]* \()?([^()]+\.js):(\d+):(\d+)\)?$/);
    if (!location) continue;
    const file = relative(__dirname, location[1]);
    if (/^(?:[\w-]+\/)*[\w-]+\.js$/.test(file) && !file.startsWith('node_modules/')) {
      stack.push(`src/${file}:${location[2]}:${location[3]}`);
    }
  }
  return {
    category,
    status: Number.isInteger(status) ? status : null,
    message: safeMessages.has(error?.message) ? error.message : 'Unexpected error',
    stack,
  };
}

class Logger {
  context = new AsyncLocalStorage();
  requestContexts = new WeakMap();

  requestContext = (req, res, next) => {
    const user = req.user;
    const context = user ? {
      user: {
        id: Number.isSafeInteger(user.id) ? user.id : redacted,
        name: user.name,
        roles: Array.isArray(user.roles)
          ? user.roles.map((entry) => entry?.role).filter((role) => roleNames.has(role))
          : [],
      },
    } : {};
    this.requestContexts.set(res, context);
    this.context.run(context, next);
  };

  requestPath(req) {
    if (req.route?.path === '*') return '[unmatched]';
    if (typeof req.route?.path === 'string') {
      const mount = req.baseUrl || req.originalUrl.match(/^\/api\/(?:auth|user|order|franchise)(?=[/?]|$)/i)?.[0] || '';
      return (mount + req.route.path).replace(/\/$/, '') || '/';
    }
    return req.baseUrl === '/api/docs' ? '/api/docs' : '[unmatched]';
  }

  httpLogger = (req, res, next) => {
    const send = res.send;
    let responseBody = null;
    let path = '[unmatched]';
    res.send = (body) => {
      path = this.requestPath(req);
      responseBody = body ?? null;
      if (typeof body === 'string' && /^application\/json\b/i.test(res.getHeader('Content-Type') ?? '')) {
        try {
          responseBody = JSON.parse(body);
        } catch {
          responseBody = redacted;
        }
      }
      return send.call(res, body);
    };

    res.once('finish', () => {
      const statusCode = res.statusCode;
      const hasRequestBody = Number(req.headers['content-length']) > 0 || Boolean(req.headers['transfer-encoding']);
      let requestBody = null;
      if (hasRequestBody) {
        requestBody = res.locals.malformedRequestBody || !req.is('application/json') ? redacted : req.body;
      }
      const hasNoBody = req.method === 'HEAD' || [204, 205, 304].includes(statusCode);
      this.context.run(this.requestContexts.get(res), () => {
        this.log(this.statusToLogLevel(statusCode), 'http', {
          method: req.method,
          path,
          statusCode,
          authorized: Object.hasOwn(req.headers, 'authorization'),
          reqBody: requestBody,
          resBody: hasNoBody ? null : responseBody,
        });
      });
    });
    next();
  };

  dbLogger(query) {
    this.log('info', 'db', { query });
  }

  factoryLogger(reqBody, resBody, statusCode, failed = false) {
    this.log(failed ? 'error' : this.statusToLogLevel(statusCode), 'factory', {
      statusCode: Number.isInteger(statusCode) ? statusCode : null, reqBody, resBody,
    });
  }

  unhandledErrorLogger(error) {
    const category = error?.type === 'entity.parse.failed' ? 'jsonParse' : 'http';
    this.log('error', 'unhandledError', { error, category });
  }

  fatalErrorLogger(error, category) {
    writeSync(2, JSON.stringify({
      type: 'unhandledError', level: 'error', ...exceptionDetails(error, category),
    }) + '\n');
  }

  log(level, type, logData) {
    const data = type === 'unhandledError' ? exceptionDetails(logData.error, logData.category) : {};
    const allowedMetadata = Object.hasOwn(metadata, type) ? metadata[type] : [];
    for (const key of allowedMetadata) {
      if (Object.hasOwn(logData, key)) data[key] = logData[key];
    }
    if (type === 'db' && typeof data.query === 'string') {
      data.query = data.query
        .replace(/^(USE|CREATE DATABASE IF NOT EXISTS)\s+[\s\S]+$/i, '$1 [redacted]')
        .replace(/'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"/g, '?');
    }
    if (Object.hasOwn(logData, 'reqBody')) data.reqBody = sanitizeBody(logData.reqBody);
    if (Object.hasOwn(logData, 'resBody')) data.resBody = sanitizeBody(logData.resBody, 0, type === 'factory');
    const user = this.context.getStore()?.user;
    if (user) data.user = { ...user};

    const labels = { component: config.logging.source, level, type };
    const values = [this.nowString(), JSON.stringify(data)];
    void this.sendLogToGrafana({ streams: [{ stream: labels, values: [values] }] });
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (BigInt(Date.now()) * 1000000n).toString();
  }

  async sendLogToGrafana(event) {
    try {
      const response = await fetch(config.logging.endpointUrl, {
        method: 'post',
        body: JSON.stringify(event),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
        },
      });
      if (response.ok) return;
    } catch {
      // Delivery is best-effort.
    }
    console.warn('Failed to send log to Grafana');
  }
}

module.exports = new Logger();
