jest.mock('../src/logger.js', () => ({
    httpLogger: (_req, _res, next) => next(),
    log: () => {},
}));

jest.mock('../src/metrics.js', () => ({
    requestTracker: (_req, _res, next) => next(),
    recordAuth: () => {},
    pizzaPurchase: () => {},
    isActiveUser: () => {},
    sendMetricsPeriodically: () => {},
}));
