const config = require('./config');

const os = require('os');

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

// Metrics stored in memory
const requests = {};
const requestsMethod = {};
let totalLatency = 0;
let requestCount = 0;

function recordLatency(ms){
  totalLatency += ms;
  requestCount += 1;
}

function getAverageLatency() {
  const avg = requestCount > 0 ? totalLatency / requestCount : 0;
  totalLatency = 0
  requestCount = 0;
  return avg
}

// Middleware to track requests
function requestTracker(req, res, next) {
  const endpoint = `[${req.method}] ${req.path}`;
  const method = `$req.method`;
  requests[endpoint] = (requests[endpoint] || 0) + 1;
  requestsMethod[method] = (requestsMethod[method] || 0) + 1;
  const startTime = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - startTime;
    recordLatency(latency);

    if (req.path === '/api/auth'){
      if(res.status === 200){
        recordAuth(true);
      }
      else{
        recordAuth(false);
      }
    }
    else if(res.status === 401){
      recordAuth(false);
    }
  })
  next();
  
}

const authData = {};

function recordAuth(success){
  if(success === true){
    authData['success'] = (authData['success'] || 0) + 1;
  }
  else{
    authData['failure'] = (authData['failure'] || 0) + 1;
  }
  
}

function sendMetricsPeriodically(period) {
  const timer = setInterval(() => {
    try {
      const metrics = new OtelMetricBuilder();
      metrics.add(httpMetrics);
      metrics.add(systemMetrics);
      metrics.add(userMetrics);
      metrics.add(purchaseMetrics);
      metrics.add(authMetrics);

      metrics.sendToGrafana();
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}
// Periodically send metrics to Grafana
setInterval(() => {
  const metrics = [];
  Object.keys(requests).forEach((endpoint) => {
    metrics.push(createMetric('requests', requests[endpoint], '1', 'sum', 'asInt', { endpoint }));
  });

  metrics.push(createMetric('greetingChange', greetingChangedCount, '1', 'sum', 'asInt', {}));

}, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: metricValue,
          timeUnixNano: Date.now() * 1000000,
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });

  if (metricType === 'sum') {
    metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

let pizzaLatency = 0;
let pizzaCreate = 0;
let pizzas = {}
let revenue = 0;

function getFactoryLatency(){
  const avg = pizzaCreate > 0 ? pizzaLatency / pizzaCreate : 0
  pizzaLatency = 0;
  pizzaCreate = 0;
  return avg;
}

function pizzaPurchase(success, latency, price){
  pizzaLatency += latency;
  pizzaCreate++;
  if(success === true){
    pizzas['success'] = (requests['success'] || 0) + 1;
  }
  else{
    pizzas['failure'] = (requests['failure'] || 0) + 1;
  }
  revenue += price;
}

class OtelMetricBuilder{
  metrics = [];

  sendMetricToGrafana() {
    const metrics = this.metrics
    const body = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics,
            },
          ],
        },
      ],
    };

    fetch(`${config.endpointUrl}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${config.accountId}:${config.apiKey}`, 'Content-Type': 'application/json' },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP status: ${response.status}`);
        }
      })
      .catch((error) => {
        console.error('Error pushing metrics:', error);
      });
  }

  createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
    attributes = { ...attributes, source: config.source };

    const metric = {
      name: metricName,
      unit: metricUnit,
      [metricType]: {
        dataPoints: [
          {
            [valueType]: metricValue,
            timeUnixNano: Date.now() * 1000000,
            attributes: [],
          },
        ],
      },
    };

    Object.keys(attributes).forEach((key) => {
      metric[metricType].dataPoints[0].attributes.push({
        key: key,
        value: { stringValue: attributes[key] },
      });
    });

    if (metricType === 'sum') {
      metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
      metric[metricType].isMonotonic = true;
    }

    return metric;
  }

}

module.exports = { requestTracker, sendMetricsPeriodically, recordAuth, pizzaPurchase };