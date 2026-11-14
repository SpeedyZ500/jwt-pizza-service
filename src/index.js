const logger = require('./logger.js');

function logFatalError(error, category) {
  try {
    logger.fatalErrorLogger(error, category);
  } finally {
    process.exit(1);
  }
}

process.on('uncaughtException', logFatalError);
process.on('unhandledRejection', (error) => logFatalError(error, 'unhandledRejection'));

const app = require('./service.js');
const metrics = require('./metrics.js');

metrics.sendMetricsPeriodically(6000);
const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
