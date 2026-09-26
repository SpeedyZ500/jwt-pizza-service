const request = require("supertest");
const app = require("../../src/service");
const { randomName, expectValidJwt } = require("../testService");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;

beforeAll(async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
    const registerRes = await request(app).post("/api/auth").send(testUser);
    testUserAuthToken = registerRes.body.token;
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

test("logout fail", async () => {
    const logoutRes = await request(app)
        .delete("/api/auth")
        .set("Authorization", "Bearer yeet");
    expect(logoutRes.status).toBe(401);
    const expectedObject = { message: "unauthorized" };
    expect(logoutRes.body).toMatchObject(expectedObject);
});

test("register", async () => {
    const name = randomName();
    const email = `${randomName()}@test.com`;
    const password = "t3st_pa55";
    const user = { name: name, email: email, password: password };
    const registerRes = await request(app).post("/api/auth").send(user);
    expect(registerRes.status).toBe(200);
    expectValidJwt(registerRes.body.token);
    const expectedUser = { ...user, roles: [{ role: "diner" }] };
    delete expectedUser.password;
    expect(registerRes.body.user).toMatchObject(expectedUser);
});

test("register fail", async () => {
    const name = randomName();
    const password = "t3st_pa55";
    const user = { name: name, password: password };
    const registerRes = await request(app).post("/api/auth").send(user);
    expect(registerRes.status).toBe(400);
    expect(registerRes.body).toMatchObject({
        message: "name, email, and password are required",
    });
});
