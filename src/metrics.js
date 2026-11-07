const config = require('./config');

const os = require('os');

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Math.round(cpuUsage * 100);
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return Number(memoryUsage.toFixed(2));
}

// Metrics stored in memory
const requests = {};
let totalLatency = 0;
let requestCount = 0;
const latencyBounds = [ 100, 500, 1000];
const latencyBuckets = Array(latencyBounds.length + 1).fill(0);

let minLatency = Infinity;
let maxLatency = 0;


function recordLatency(ms){
  if (ms < minLatency) minLatency = ms;
  if (ms > maxLatency) maxLatency = ms;
  totalLatency += ms;
  requestCount += 1;
  let foundBucket = false;
  for( const [index, value] of latencyBounds.entries()){
    if(ms <= value){
      latencyBuckets[index] = latencyBuckets[index] + 1;
      foundBucket = true;
      break;
    }
  }
  if(foundBucket === false){
    latencyBuckets[latencyBounds.length] = latencyBuckets[latencyBounds.length] + 1
  }

}

// Middleware to track requests
function requestTracker(req, res, next) {
  const startTime = Date.now();
  res.on('finish', () => {
    const method = req.method;
    const path = req.path;
    const status = res.statusCode; 

    const latency = Date.now() - startTime;
    recordLatency(latency);
    if(!Object.hasOwn(requests, method)){
      requests[method] = {};
    }
    if(!Object.hasOwn(requests[method], path)){
      requests[method][path] = {}
    }
    requests[method][path][status] = (requests[method][path][status] || 0) + 1
    if (path === '/api/auth'){
      if(status === 200){
        recordAuth(true);
      }
      else{
        recordAuth(false);
      }
    }
    else if(status === 401){
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

let pizzaLatency = 0;
let pizzaCreate = 0;
let pizzas = {}
let revenue = 0;
const pizzaLatencyBounds = [100, 500, 1000];
const pizzaLatencyBuckets = Array(pizzaLatencyBounds.length + 1).fill(0);

let minPizzaLatency = Infinity;
let maxPizzaLatency = 0;




function pizzaPurchase(success, latency, price, sold){
  if (latency < minPizzaLatency) minPizzaLatency = latency;
  if (latency > maxPizzaLatency) maxPizzaLatency = latency;
  pizzaLatency += latency;
  pizzaCreate++;
  let foundBucket = false;
  for( const [index, value] of pizzaLatencyBounds.entries()){
    if(latency <= value){
      pizzaLatencyBuckets[index] = pizzaLatencyBuckets[index] + 1;
      foundBucket = true;
      break;
    }
  }
  if(foundBucket === false){
    pizzaLatencyBuckets[pizzaLatencyBounds.length] = pizzaLatencyBuckets[pizzaLatencyBounds.length] + 1
  }
  if(success === true){
    pizzas['pizzas'] = (pizzas['pizzas'] || 0) + sold;
  }
  else{
    pizzas['failure'] = (pizzas['failure'] || 0) + 1;
  }
  revenue += price;
}

const activeUsers = new Map();

function isActiveUser(userId) {
  activeUsers.set(userId, Date.now())
}
function getNumberActiveUsers(){
  let active = 0;
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  for (const [id, lastSeen] of activeUsers){
    if (lastSeen > tenMinutesAgo){
      active++;
    }
    else{
      activeUsers.delete(id);
    }
    
  }
  return active
}

const cumulativeTemporality = 2;
const startTimeUnixNano = toUnixNano(Math.round(performance.timeOrigin));

function toUnixNano(milliseconds) {
  return (BigInt(milliseconds) * 1000000n).toString();
}
function sendMetricsPeriodically(period) {
  
  setInterval(() => {
    try {
      const metrics = new OtelMetricBuilder();
      metrics.addGauge("cpu", getCpuUsagePercentage(), "%", "asInt", {});
      metrics.addGauge("memory", getMemoryUsagePercentage(), "%", "asDouble", {});
      metrics.addGauge("users", getNumberActiveUsers(), "1", "asInt", {});
      metrics.addHistogram("request_latency", totalLatency, requestCount, latencyBuckets, latencyBounds, minLatency, maxLatency, "ms", {});
      metrics.addHistogram("pizza_creation_latency", pizzaLatency, pizzaCreate, pizzaLatencyBuckets, pizzaLatencyBounds, minPizzaLatency, maxPizzaLatency, "ms", {});

      metrics.addSum("revenue", revenue, "1", "asDouble", {});
      Object.keys(pizzas).forEach((pizza) => {
        metrics.addSum("pizzas", pizzas[pizza], "1", "asInt", { pizza })
      })
      Object.keys(authData).forEach((auth) => {
        metrics.addSum("authentications", authData[auth], "1", "asInt", {auth})
      })

      
      Object.keys(requests).forEach((method) => {
        Object.keys(requests[method]).forEach((path) => {
          Object.keys(requests[method][path]).forEach((status) => {
            metrics.addSum("requests", requests[method][path][status], "1", "asInt", {method, path, status})
          })
        })
      })

      metrics.sendToGrafana();
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}
function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

  const metric = {
    name: metricName,
    unit: metricUnit,
    [metricType]: {
      dataPoints: [
        {
          [valueType]: valueType === 'asInt' ? String(metricValue) : metricValue,
          timeUnixNano: toUnixNano(Date.now()),
          attributes: [],
        },
      ],
    },
  };

  Object.keys(attributes).forEach((key) => {
    metric[metricType].dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: String(attributes[key]) },
    });
  });

  if (metricType === 'sum') {
    metric.sum.aggregationTemporality = cumulativeTemporality;
    metric.sum.dataPoints[0].startTimeUnixNano = startTimeUnixNano;
    metric[metricType].isMonotonic = true;
  }

  return metric;
}

class OtelMetricBuilder{
  metrics = [];
  addSum(metricName, metricValue, metricUnit, valueType, attributes){
    this.metrics.push(createMetric(metricName, metricValue, metricUnit, "sum", valueType, attributes));
  }

  addGauge(metricName, metricValue, metricUnit, valueType, attributes){
    this.metrics.push(createMetric(metricName, metricValue, metricUnit, "gauge", valueType, attributes))
  }

  addHistogram(metricName, sum, count, bucket, bounds, mini, maxi, metricUnit, attributes){
    const metric = createMetric(metricName, sum, metricUnit, "histogram", "sum", attributes)
    metric.histogram.aggregationTemporality = cumulativeTemporality;
    const point = metric.histogram.dataPoints[0];
    point.startTimeUnixNano = startTimeUnixNano;
    point.count = String(count);
    point.bucketCounts = bucket.map(String);
    point.explicitBounds = bounds;
    if (count > 0) {
      point.min = mini;
      point.max = maxi;
    }

    this.metrics.push(metric)
  }


  async sendToGrafana() {
    const { endpointUrl, accountId, apiKey } = config.metrics;
    const credentials = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
    const body = {
      resourceMetrics: [{ scopeMetrics: [{ metrics: this.metrics }] }],
    };

    const safeDetail = (value) => {
      let detail = String(value ?? '');
      for (const secret of [credentials, String(apiKey ?? ''), String(accountId ?? '')]) {
        if (secret) detail = detail.replaceAll(secret, '[redacted]');
      }
      return detail.slice(0, 512);
    };

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
      });
      const responseBody = await response.text();
      if (!response.ok) {
        console.error('Error pushing metrics:', response.status, safeDetail(responseBody));
        return;
      }

      const partialSuccess = responseBody ? JSON.parse(responseBody).partialSuccess : undefined;
      if (Number(partialSuccess?.rejectedDataPoints) > 0 || partialSuccess?.errorMessage) {
        console.warn('Grafana metrics partial success:', Number(partialSuccess.rejectedDataPoints ?? 0),
          safeDetail(partialSuccess.errorMessage));
      }
    } catch (error) {
      console.error('Error pushing metrics:', safeDetail(error.message));
    }
  }
}

module.exports = { requestTracker, sendMetricsPeriodically, recordAuth, pizzaPurchase, isActiveUser };
