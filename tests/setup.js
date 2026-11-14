jest.mock('../src/logger.js', () => ({
    requestContext: (_req, _res, next) => next(),
    httpLogger: (_req, _res, next) => next(),
    log: () => {},
    factoryLogger: () => {},
    dbLogger: () => {},
    unhandledErrorLogger: () => {},
}));

jest.mock('../src/metrics.js', () => ({
    requestTracker: (_req, _res, next) => next(),
    recordAuth: () => {},
    pizzaPurchase: () => {},
    isActiveUser: () => {},
    sendMetricsPeriodically: () => {},
}));
