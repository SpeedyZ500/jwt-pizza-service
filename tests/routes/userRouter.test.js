const request = require("supertest");
const app = require("../../src/service");
const {
    createAdminUser,
    randomName,
    expectValidJwt,
    registerUser,
} = require("../testService");

test("list users unauthorized", async () => {
    const listUsersRes = await request(app).get("/api/user");
    expect(listUsersRes.status).toBe(401);
});

describe("authorized tests", () => {
    let testUserAuthToken;
    let testUser;
    // const testUser = {
    //     name: "pizza diner",
    //     email: "reg@test.com",
    //     password: "a",
    // };
    beforeEach(async () => {
        [testUser, testUserAuthToken] = await registerUser(request(app));
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
            .put(`/api/user/${testUser.id}`)
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
            .delete(`/api/user/${testUser.id}`)
            .set("Authorization", `Bearer ${testUserAuthToken}`);
        expect(deleteRes.status).toBe(200);

        const expectedObject = { message: "not implemented" };
        expect(deleteRes.body).toMatchObject(expectedObject);
    });

    test("list users needs admin", async () => {
        const listUsersRes = await request(app)
            .get("/api/user")
            .set("Authorization", "Bearer " + testUserAuthToken);
        expect(listUsersRes.status).toBe(403);
    });

    test("update user unauthorized", async () => {
        const updateTo = {
            name: randomName(),
            email: `${randomName()}@test.com`,
            password: `Y010`,
        };
        const updateRes = await request(app)
            .put(`/api/user/${testUser.id - 1}`)
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
                .put(`/api/user/${testUser.id}`)
                .send(updateTo)
                .set("Authorization", `Bearer ${adminAuthToken}`);
            expect(updateRes.status).toBe(200);
            expectValidJwt(updateRes.body.token);

            const expectedUser = { ...updateTo, roles: [{ role: "diner" }] };
            delete expectedUser.password;
            expect(updateRes.body.user).toMatchObject(expectedUser);
        });
        test("list users needs admin", async () => {
            const listUsersRes = await request(app)
                .get("/api/user")
                .set("Authorization", "Bearer " + adminAuthToken);
            expect(listUsersRes.status).toBe(200);
        });
    });
});
