jest.unmock('../src/logger.js');

const { spawnSync } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/service');
const config = require('../src/config');
const logger = require('../src/logger');
const { DB } = require('../src/database/database');

const user = { id: 7, name: 'Pizza Diner', roles: [{ role: 'diner', objectId: 99 }], email: 'private@example.test' };
const logUser = { id: user.id, name: user.name, roles: ['diner'] };
const marker = '[redacted]';
const sql = 'SELECT id FROM user WHERE email=?';
const secret = 'credential-that-must-not-be-logged';

let transport;
let startupQueries;
const sendLogToGrafana = logger.sendLogToGrafana.bind(logger);

function events(type) {
    return transport.mock.calls.map(([event]) => {
        const { stream, values } = event.streams[0];
        const [timestamp, data] = values[0];
        return { ...stream, timestamp, data: JSON.parse(data) };
    }).filter((event) => event.type === type);
}

function tokenFor(identity) {
    return `Bearer ${jwt.sign(identity, config.jwtSecret)}`;
}

beforeAll(async () => {
    transport = jest.spyOn(logger, 'sendLogToGrafana').mockResolvedValue();
    await DB.initialized;
    startupQueries = events('db').map(({ data }) => data);
});

beforeEach(() => {
    transport.mockClear();
    jest.spyOn(DB, 'isLoggedIn').mockResolvedValue(true);
});

afterEach(() => {
    DB.isLoggedIn.mockRestore();
    if (jest.isMockFunction(DB.updateUser)) DB.updateUser.mockRestore();
    if (jest.isMockFunction(DB.addDinerOrder)) DB.addDinerOrder.mockRestore();
    if (jest.isMockFunction(global.fetch)) global.fetch.mockRestore();
});

afterAll(() => transport.mockRestore());

test('serializes an authenticated HTTP response with a route template and redacted structured bodies', async () => {
    jest.spyOn(DB, 'updateUser').mockResolvedValue(user);
    jest.spyOn(DB, 'loginUser').mockResolvedValueOnce();
    try {
        await request(app).put('/api/user/7?search=private-query')
            .set('Authorization', tokenFor(user))
            .send({ name: 'Pizza Diner', email: user.email, password: secret, [secret]: secret })
            .expect(200);
    } finally {
        DB.loginUser.mockRestore();
    }

    expect(events('http')).toEqual([{
        component: config.logging.source, type: 'http', level: 'info', timestamp: expect.stringMatching(/^\d+$/),
        data: {
            method: 'PUT', path: '/api/user/:userId', statusCode: 200, authorized: true, user: logUser,
            reqBody: { name: 'Pizza Diner', email: marker, password: marker, redactedFields: true },
            resBody: {
                user: { id: 7, name: 'Pizza Diner', email: marker, roles: [{ role: 'diner', objectId: 99 }] },
                token: marker,
            },
        },
    }]);
    expect(JSON.stringify(transport.mock.calls)).not.toMatch(/credential-that-must-not-be-logged|private@example\.test|private-query/);
});

test('logs startup SQL without exposing the configured database name', () => {
    expect(startupQueries).toEqual(expect.arrayContaining([
        { query: 'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?' },
        { query: 'CREATE DATABASE IF NOT EXISTS [redacted]' },
        { query: 'USE [redacted]' },
    ]));
    expect(startupQueries.every((query) => !Object.hasOwn(query, 'user'))).toBe(true);
});

test('leaves the SQL session lookup anonymous until the user is authenticated', async () => {
    const sessionQuery = 'SELECT userId FROM auth WHERE token=?';
    DB.isLoggedIn.mockImplementation(async (token) => {
        await DB.query({ execute: async () => [[]] }, sessionQuery, [token]);
        return true;
    });

    await request(app).get('/api/user/me').set('Authorization', tokenFor(user)).expect(200);
    expect(events('db').map(({ data }) => data)).toEqual([{ query: sessionQuery }]);
    expect(events('http')[0].data.user).toEqual(logUser);
});

test('isolates concurrent SQL and HTTP logging contexts', async () => {
    const testApp = express();
    const execute = jest.fn(async () => [[]]);
    testApp.use(logger.httpLogger);
    testApp.use((req, _res, next) => {
        const id = Number(req.get('test-user'));
        if (id) req.user = { ...user, id, name: `Diner ${id}` };
        next();
    });
    testApp.use(logger.requestContext);
    let releaseFirst;
    let firstWaiting;
    const firstPending = new Promise((resolve) => { firstWaiting = resolve; });
    const otherFinished = new Promise((resolve) => { releaseFirst = resolve; });
    testApp.get('/', async (req, res) => {
        if (req.user?.id === 1) {
            firstWaiting();
            await otherFinished;
        }
        await DB.query({ execute }, sql, [secret]);
        res.json({ id: req.user?.id ?? 0 });
    });
    const first = request(testApp).get('/').set('test-user', '1').then((response) => response);
    await firstPending;
    try {
        await request(testApp).get('/').set('test-user', '2').expect(200);
        await request(testApp).get('/').expect(200);
    } finally {
        releaseFirst();
        await first;
    }

    const diner = (id) => ({ id, name: `Diner ${id}`, roles: ['diner'] });
    expect(execute).toHaveBeenCalledWith(sql, [secret]);
    expect(events('db').map(({ data }) => data)).toEqual([
        { query: sql, user: diner(2) }, { query: sql }, { query: sql, user: diner(1) },
    ]);
    expect(events('http').map(({ data }) => [data.resBody.id, data.user])).toEqual([
        [2, diner(2)], [0, undefined], [1, diner(1)],
    ]);
});

test('logs malformed JSON and invalid authorization without leaking submitted data', async () => {
    await request(app).post('/api/auth').set('Content-Type', 'application/json').send(`{"password":"${secret}"`).expect(400);
    await request(app).get('/api/user/me').set('Authorization', `Bearer ${secret}`).expect(401);
    await request(app).head('/').expect(200);

    expect(events('http').map(({ data }) => data)).toEqual([
        expect.objectContaining({ statusCode: 400, reqBody: marker, resBody: { message: marker, stack: marker } }),
        { method: 'GET', path: '/api/user/me', statusCode: 401, authorized: true, reqBody: null, resBody: { message: 'unauthorized' } },
        { method: 'HEAD', path: '/', statusCode: 200, authorized: false, reqBody: null, resBody: null },
    ]);
    expect(events('unhandledError').map(({ data }) => data)).toEqual([
        { category: 'jsonParse', status: 400, message: 'Unexpected error', stack: expect.any(Array) },
    ]);
    expect(JSON.stringify(transport.mock.calls)).not.toContain(secret);
});

test.each([
    ['success', 200, 'info', 200, false],
    ['rejected', 422, 'warn', 500, false],
    ['network', null, 'error', 500, true],
    ['invalid body', 200, 'error', 500, true],
])('logs exactly one factory attempt for %s', async (outcome, statusCode, level, clientStatus, failed) => {
    const order = { id: 10, franchiseId: 2, storeId: 3, items: [{ menuId: 5, price: 8.5 }] };
    jest.spyOn(DB, 'addDinerOrder').mockResolvedValue(order);
    const fetch = jest.spyOn(global, 'fetch');
    const factoryBody = { jwt: secret, reportUrl: `https://example.test/${secret}` };
    if (outcome === 'rejected') {
        factoryBody.message = 'Store is closed. Contact private@example.test for help.';
        factoryBody.error = { message: 'Ordering is unavailable', token: secret };
    }
    const json = jest.fn().mockResolvedValue(factoryBody);
    if (outcome === 'invalid body') json.mockRejectedValue(new SyntaxError(secret));
    if (outcome === 'network') fetch.mockRejectedValue(new Error(secret));
    else fetch.mockResolvedValue({ status: statusCode, ok: statusCode < 400, json });
    await request(app).post('/api/order').set('Authorization', tokenFor(user)).send(order).expect(clientStatus);
    const loggedBody = { jwt: marker, reportUrl: marker };
    if (outcome === 'rejected') {
        loggedBody.message = 'Store is closed. Contact [redacted] for help.';
        loggedBody.error = { message: 'Ordering is unavailable', token: marker };
    }
    expect(events('factory')).toEqual([expect.objectContaining({
        level,
        data: {
            statusCode, user: logUser,
            reqBody: { diner: { id: 7, name: 'Pizza Diner', email: marker }, order },
            resBody: failed ? null : loggedBody,
        },
    })]);
    const exceptions = events('unhandledError');
    expect(exceptions).toHaveLength(failed ? 1 : 0);
    if (failed) expect(exceptions[0].data).toMatchObject({ user: logUser, message: 'Unexpected error' });
    expect(JSON.stringify(transport.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(transport.mock.calls)).not.toContain('private@example.test');
});

test('logger.log redacts nested and unknown fields before serializing them', () => {
    logger.log('info', 'factory', {
        statusCode: 200,
        password: secret,
        user: { id: 99 },
        reqBody: { order: { items: [{ menuId: 2, PASSWORD: secret, [secret]: secret }] } },
        resBody: secret,
    });
    expect(events('factory')[0].data).toEqual({
        statusCode: 200,
        reqBody: { order: { items: [{ menuId: 2, password: marker, redactedFields: true }] } },
        resBody: marker,
    });
    expect(JSON.stringify(transport.mock.calls)).not.toContain(secret);
});

test('contains Grafana transport failures', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error(secret));
    try {
        await sendLogToGrafana({});
        expect(warn.mock.calls).toEqual([['Failed to send log to Grafana']]);
    } finally {
        warn.mockRestore();
    }
});

test('keeps ordinary business details around redacted text', () => {
    logger.log('info', 'http', {
        resBody: {
            version: '20261114.123456',
            items: [
                {
                    title: 'Pizza @ Noon',
                    description: 'Basic cheese. Questions? Write to private@example.test for help.',
                    image: 'pizza1.png',
                },
                { image: `https://example.test/pizza.png?token=${secret}` },
            ],
        },
    });
    expect(events('http')[0].data.resBody).toEqual({
        version: '20261114.123456',
        items: [
            {
                title: 'Pizza @ Noon',
                description: 'Basic cheese. Questions? Write to [redacted] for help.',
                image: 'pizza1.png',
            },
            { image: marker },
        ],
    });
    expect(JSON.stringify(transport.mock.calls)).not.toContain(secret);
});

test.each([
    ['uncaughtException', 'setImmediate(() => { throw new Error(process.argv[1]); });'],
    ['unhandledRejection', 'Promise.reject(new Error(process.argv[1]));'],
])('logs sanitized %s output and exits nonzero', (category, failure) => {
    const input = `process.argv[2] = '0'; global.fetch = async () => ({ ok: true }); require('./src/index'); ${failure}`;
    const child = spawnSync(process.execPath, ['-e', input, secret], { encoding: 'utf8', timeout: 5000 });
    expect(child.status).toBe(1);
    expect(child.stderr).not.toContain(secret);
    expect(child.stderr.trim().split('\n').map(JSON.parse)).toContainEqual(expect.objectContaining({
        type: 'unhandledError', level: 'error', category, message: 'Unexpected error', stack: expect.any(Array),
    }));
});
