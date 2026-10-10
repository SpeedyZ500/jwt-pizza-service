const request = require("supertest");
const app = require("../../src/service");
const { randomName, expectValidJwt } = require("../testService");
const jwt = require("jsonwebtoken");
const { DB } = require("../../src/database/database");
const { createFixtures } = require("../coverageFixtures");

describe('authentication endpoints', () => {
    let testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
    let testUserAuthToken;

    let fixtures;
    beforeEach(async () => {
        fixtures = createFixtures();
        const user = await fixtures.user();
        testUser = { id: user.id, name: user.name, email: user.email, password: "fixture-password" };
        testUserAuthToken = user.token;
        expectValidJwt(testUserAuthToken);
    });

    test("login", async () => {
        const loginRes = await request(app).put("/api/auth").send(testUser);
        expect(loginRes.status).toBe(200);
        expectValidJwt(loginRes.body.token);

        const expectedUser = { ...testUser, roles: [{ role: "diner" }] };
        delete expectedUser.password;
        expect(loginRes.body.user).toMatchObject(expectedUser);
    });

    test("logout", async () => {
        const logoutRes = await request(app)
            .delete("/api/auth")
            .set("Authorization", `Bearer ${testUserAuthToken}`);
        expect(logoutRes.status).toBe(200);
        const expectedObject = { message: "logout successful" };
        expect(logoutRes.body).toMatchObject(expectedObject);
    });

    test("logout rejects an invalid token", async () => {
        const logoutRes = await request(app)
            .delete("/api/auth")
            .set("Authorization", "Bearer yeet");
        expect(logoutRes.status).toBe(401);
        const expectedObject = { message: "unauthorized" };
        expect(logoutRes.body).toMatchObject(expectedObject);
    });

    test("register", async () => {
        const name = randomName();
        const email = `${fixtures.prefix}-${randomName()}@test.com`;
        const password = "t3st_pa55";
        const user = { name: name, email: email, password: password };
        const registerRes = await request(app).post("/api/auth").send(user);
        expect(registerRes.status).toBe(200);
        expectValidJwt(registerRes.body.token);
        const expectedUser = { ...user, roles: [{ role: "diner" }] };
        delete expectedUser.password;
        expect(registerRes.body.user).toMatchObject(expectedUser);
    });

    test("registration rejects missing required fields", async () => {
        const name = randomName();
        const password = "t3st_pa55";
        const user = { name: name, password: password };
        const registerRes = await request(app).post("/api/auth").send(user);
        expect(registerRes.status).toBe(400);
        expect(registerRes.body).toMatchObject({
            message: "name, email, and password are required",
        });
    });

    afterEach(async () => { await fixtures.cleanup(); });
});

const authorized = (method, path, user) => request(app)[method](path).set('Authorization', `Bearer ${user.token}`);

describe('credentials and token validity', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
    test.each(['unknown', 'wrong password'])('login rejects %s credentials', async (scenario) => {
        const user = await fixtures.user();
        const response = await request(app).put('/api/auth').send({ email: scenario === 'unknown' ? `${fixtures.prefix}-missing@test.com` : user.email, password: 'wrong password' });
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('unknown user');
    });

    test('logout revokes access', async () => {
        const user = await fixtures.user();
        expect((await authorized('delete', '/api/auth', user)).status).toBe(200);
        expect((await authorized('get', '/api/user/me', user)).status).toBe(401);
    });

    test('stored token with invalid signature is rejected', async () => {
        const user = await fixtures.user();
        const token = jwt.sign({ id: user.id, roles: user.roles }, 'incorrect-secret');
        await DB.loginUser(user.id, token);
        expect((await authorized('get', '/api/user/me', { token })).status).toBe(401);
    });

});
