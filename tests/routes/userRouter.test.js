const request = require("supertest");
const app = require("../../src/service");
const {
    createAdminUser,
    randomName,
    expectValidJwt,
} = require("../testService");

let testUserAuthToken;
let userId;

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
beforeEach(async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + "@test.com";
    const registerRes = await request(app).post("/api/auth").send(testUser);
    userId = registerRes.body.user.id;
    testUserAuthToken = registerRes.body.token;
    expectValidJwt(testUserAuthToken);
});

test("get user", async () => {
    const userRes = await request(app)
        .get("/api/user/me")
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    const expectedUser = { ...testUser, roles: [{ role: "diner" }] };
    delete expectedUser.password;
    expect(userRes.body).toMatchObject(expectedUser);
});

test("update user", async () => {
    const updateTo = {
        name: randomName(),
        email: `${randomName()}@test.com`,
        password: `Y010`,
    };
    const updateRes = await request(app)
        .put(`/api/user/${userId}`)
        .send(updateTo)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(updateRes.status).toBe(200);
    expectValidJwt(updateRes.body.token);

    const expectedUser = { ...updateTo, roles: [{ role: "diner" }] };
    delete expectedUser.password;
    expect(updateRes.body.user).toMatchObject(expectedUser);
});

test("delete user", async () => {
    const deleteRes = await request(app)
        .delete(`/api/user/${userId}`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(deleteRes.status).toBe(200);

    const expectedObject = {message : 'not implemented'};
    expect(deleteRes.body).toMatchObject(expectedObject);
});

test("list users", async () => {
    const deleteRes = await request(app)
        .get('/api/user/')
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(deleteRes.status).toBe(200);

    const expectedObject = {message : 'not implemented', users: [], more: false};
    expect(deleteRes.body).toMatchObject(expectedObject);
});


test("update user unauthorized", async () => {
    const updateTo = {
        name: randomName(),
        email: `${randomName()}@test.com`,
        password: `Y010`,
    };
    const updateRes = await request(app)
        .put(`/api/user/${userId - 1}`)
        .send(updateTo)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(updateRes.status).toBe(403);
    const expectedBody = { message: "unauthorized" };

    expect(updateRes.body).toMatchObject(expectedBody);
});

describe("needs admin", () => {
    let adminAuthToken;
    let admin;

    beforeAll(async () => {
        admin = await createAdminUser();
    });
    beforeEach(async () => {
        const sendUser = { ...admin };
        delete sendUser.roles;
        delete sendUser.id;
        const loginRes = await request(app).put("/api/auth").send(sendUser);
        adminAuthToken = loginRes.body.token;
        expectValidJwt(adminAuthToken);
    });
    test("admin gets self", async () => {
        const userRes = await request(app)
            .get("/api/user/me")
            .set("Authorization", `Bearer ${adminAuthToken}`);
        const expectedUser = { ...admin };
        delete expectedUser.password;
        expect(userRes.body).toMatchObject(expectedUser);
    });

    test("admin update user", async () => {
        const updateTo = {
            name: randomName(),
            email: `${randomName()}@test.com`,
            password: `Y010`,
        };
        const updateRes = await request(app)
            .put(`/api/user/${userId}`)
            .send(updateTo)
            .set("Authorization", `Bearer ${adminAuthToken}`);
        expect(updateRes.status).toBe(200);
        expectValidJwt(updateRes.body.token);

        const expectedUser = { ...updateTo, roles: [{ role: "diner" }] };
        delete expectedUser.password;
        expect(updateRes.body.user).toMatchObject(expectedUser);
    });
});
