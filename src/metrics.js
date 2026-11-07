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
    if(ms < value){
      latencyBuckets[index] = latencyBuckets[index] + 1;
      foundBucket = true;
      break;
    }
  }
  if(foundBucket === false){
    latencyBuckets[latencyBounds.length] = latencyBuckets[latencyBounds.length] + 1
  }

}

function getAndResetWindowed() {
  const currentMin = minLatency === Infinity ? 0 : minLatency;
  const currentMax = maxLatency;
  
  // Reset for the next interval
  minLatency = Infinity;
  maxLatency = 0;
  
  return { currentMin, currentMax };
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
const pizzaLatencyBuckets = Array(latencyBounds.length + 1).fill(0);

let minPizzaLatency = Infinity;
let maxPizzaLatency = 0;




function pizzaPurchase(success, latency, price, sold){
  if (latency < minPizzaLatency) minLatency = latency;
  if (latency > maxPizzaLatency) maxLatency = latency;
  pizzaLatency += latency;
  pizzaCreate++;
  let foundBucket = false;
  for( const [index, value] of pizzaLatencyBounds.entries()){
    if(latency < value){
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

function getAndResetPizzaWindowed() {
  const currentMin = minPizzaLatency === Infinity ? 0 : minPizzaLatency;
  const currentMax = maxPizzaLatency;
  
  // Reset for the next interval
  minPizzaLatency = Infinity;
  maxPizzaLatency = 0;
  
  return { currentMin, currentMax };
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

let startTimeUnixNano = Date.now() * 1000000;
function sendMetricsPeriodically(period) {
  
  const timer = setInterval(() => {
    try {
      const metrics = new OtelMetricBuilder();
      metrics.addGauge("cpu", getCpuUsagePercentage(), "%", "asInt", {});
      metrics.addGauge("memory", getMemoryUsagePercentage(), "%", "asInt", {});
      metrics.addGauge("users", getNumberActiveUsers(), "1", "asInt", {});
      const {curMin, curMax} = getAndResetWindowed();
      metrics.addHistogram("request_latency", totalLatency, requestCount, latencyBuckets, latencyBounds, curMin, curMax, "ms", {});
      const {currPizzaMin, currPizzaMax} = getAndResetPizzaWindowed()
      metrics.addHistogram("pizza_creation_latency", pizzaLatency, pizzaCreate, pizzaLatencyBuckets, pizzaLatencyBounds, currPizzaMin, currPizzaMax, "ms", {});

      metrics.addSum("revenue", revenue, "1", "asInt", {});
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
      startTimeUnixNano = Date.now() * 1000000;
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}
// Periodically send metrics to Grafana
// setInterval(() => {
//   const metrics = [];
//   Object.keys(requests).forEach((endpoint) => {
//     metrics.push(createMetric('requests', requests[endpoint], '1', 'sum', 'asInt', { endpoint }));
//   });

//   metrics.push(createMetric('greetingChange', greetingChangedCount, '1', 'sum', 'asInt', {}));

// }, 10000);

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
  attributes = { ...attributes, source: config.metrics.source };

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

class OtelMetricBuilder{
  metrics = [];
  addSum(metricName, metricValue, metricUnit, valueType, attributes){
    const metric = createMetric(metricName, metricValue, metricUnit, "sum", valueType, attributes)
    metric.sum.aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric.sum.isMonotonic = true;
    this.metrics.push(metric)
  }

  addGauge(metricName, metricValue, metricUnit, valueType, attributes){
    this.metrics.push(createMetric(metricName, metricValue, metricUnit, "gauge", valueType, attributes))
  }

  addHistogram(metricName, sum, count, bucket, bounds, mini, maxi, metricUnit, attributes){
    const metric = createMetric(metricName, sum, metricUnit, "histogram", "sum", attributes)
    metric.histogram.dataPoints[0].startTimeUnixNano = startTimeUnixNano;
    metric.histogram.dataPoints[0].count = count;
    metric.histogram.dataPoints[0].bucketCounts = bucket;
    metric.histogram.dataPoints[0].explicitBounds = bounds;
    metric.histogram.dataPoints[0].mini = mini;
    metric.histogram.dataPoints[0].maxi = maxi;

    this.metrics.push(metric)
  }


  sendToGrafana() {
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

    fetch(`${config.metrics.endpointUrl}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
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
    attributes = { ...attributes, source: config.metrics.source };

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

    return metric;
  }

}



module.exports = { requestTracker, sendMetricsPeriodically, recordAuth, pizzaPurchase, isActiveUser };