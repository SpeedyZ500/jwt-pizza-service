const request = require("supertest");
const app = require("../../src/service");
const { createFixtures } = require("../coverageFixtures");
const { DB } = require("../../src/database/database");
const { setAuth } = require("../../src/routes/authRouter");
const {
    createAdminUser,
    randomName,
    expectValidJwt,
} = require("../testService");

test("list users unauthorized", async () => {
    const listUsersRes = await request(app).get("/api/user");
    expect(listUsersRes.status).toBe(401);
});

describe("authorized tests", () => {
    let testUserAuthToken;
    let testUser;
    let fixtures;
    // const testUser = {
    //     name: "pizza diner",
    //     email: "reg@test.com",
    //     password: "a",
    // };
    beforeEach(async () => {
        fixtures = createFixtures();
        testUser = { ...await fixtures.user(), password: "fixture-password" };
        testUserAuthToken = testUser.token;
        delete testUser.token;
        expectValidJwt(testUserAuthToken);
    });

    afterEach(async () => { await fixtures.cleanup(); });

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
        expect(deleteRes.status).toBe(403);

        const expectedObject = { message: "unauthorized" };
        expect(deleteRes.body).toMatchObject(expectedObject);
    });

    test("listing users requires an admin", async () => {
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

        beforeEach(async () => {
            admin = { ...await fixtures.user("admin"), password: "fixture-password" };
            delete admin.token;
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

        test("admin updates a user", async () => {
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
        test("list users", async () => {
            const listUsersRes = await request(app)
                .get("/api/user")
                .set("Authorization", "Bearer " + adminAuthToken);
            expect(listUsersRes.status).toBe(200);
            const connection = await DB.getConnection();
            try {
                const rows = await DB.query(connection, "SELECT id, name, email FROM user ORDER BY id LIMIT 11");
                expect(listUsersRes.body.users).toHaveLength(Math.min(rows.length, 10));
                expect(listUsersRes.body.more).toBe(rows.length > 10);
                for (const [index, user] of listUsersRes.body.users.entries()) {
                    expect(user).toMatchObject(rows[index]);
                    expect(Object.keys(user).sort()).toEqual(["email", "id", "name", "roles"]);
                    expect(user.roles).toEqual((await DB.getUser(user.email)).roles);
                }
            } finally {
                await connection.end();
            }
        });
    });
});


describe("user listing and deletion fixtures", () => {
    let adminToken;
    let prefix;
    let users;
    let fixtureIds;

    beforeEach(async () => {
        fixtureIds = [];
        prefix = `list-${randomName()}`;
        const admin = await createAdminUser();
        fixtureIds.push(admin.id);
        adminToken = await setAuth(admin);
        users = [];
        for (const suffix of ["alpha", "beta", "gamma"]) {
            const user = await DB.addUser({
                name: `${prefix}-${suffix}`,
                email: `${prefix}-${suffix}@test.com`,
                password: "fixture-password",
                roles: [{ role: "diner" }, { role: "admin" }],
            });
            fixtureIds.push(user.id);
            users.push(JSON.parse(JSON.stringify(user)));
        }
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        const connection = await DB.getConnection();
        try {
            for (const id of fixtureIds) {
                await DB.query(connection, "DELETE FROM auth WHERE userId=?", [id]);
                await DB.query(connection, "DELETE FROM userRole WHERE userId=?", [id]);
                await DB.query(connection, "DELETE FROM user WHERE id=?", [id]);
            }
        } finally {
            await connection.end();
        }
    });

    const list = (token, query) => request(app).get("/api/user")
        .set("Authorization", `Bearer ${token}`).query(query);
    const remove = (token, id) => request(app).delete(`/api/user/${id}`)
        .set("Authorization", `Bearer ${token}`);

    test("list users filters exact names and wildcard patterns", async () => {
        for (const [name, expected] of [
            [users[0].name, [users[0]]],
            [`${prefix}*`, users],
            [`*${prefix}*a`, users],
            [`${prefix}-missing`, []],
        ]) {
            const response = await list(adminToken, { name });
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ users: expected, more: false });
        }
    });

    test("list users combines filtering, limits, and successive pages", async () => {
        for (const [page, expected, more] of [
            [1, users.slice(0, 2), true],
            [2, users.slice(2), false],
            [3, [], false],
        ]) {
            const response = await list(adminToken, { name: `${prefix}*`, limit: 2, page });
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ users: expected, more });
        }
        const response = await list(adminToken, { name: `${prefix}*`, limit: 1 });
        expect(response.body).toEqual({ users: [users[0]], more: true });
    });

    test.each([
        { page: 0 }, { page: -1 }, { page: "abc" }, { page: "1.5" },
        { limit: 0 }, { limit: -1 }, { limit: "abc" }, { limit: "2.5" },
        { page: "9007199254740992" }, { limit: "9007199254740992" },
        { page: [1, 2] }, { name: ["a", "b"] },
    ])("list users rejects invalid queries %j", async (query) => {
        const response = await list(adminToken, query);
        expect(response.status).toBe(400);
    });

    async function snapshot(id) {
        const connection = await DB.getConnection();
        try {
            return {
                auth: await DB.query(connection, "SELECT * FROM auth WHERE userId=? ORDER BY token", [id]),
                roles: await DB.query(connection, "SELECT * FROM userRole WHERE userId=? ORDER BY id", [id]),
                user: await DB.query(connection, "SELECT * FROM user WHERE id=?", [id]),
            };
        } finally {
            await connection.end();
        }
    }

    test("delete user requires authentication", async () => {
        const response = await request(app).delete(`/api/user/${users[0].id}`);
        expect(response.status).toBe(401);
        expect((await snapshot(users[0].id)).user).toHaveLength(1);
    });

    test("admin deletes all user details and revokes all tokens", async () => {
        const target = users[0];
        const tokens = [await setAuth(target), await setAuth({ ...target, name: "another session" })];
        const otherBefore = await snapshot(users[1].id);
        expect((await snapshot(target.id)).auth).toHaveLength(2);
        const response = await remove(adminToken, target.id);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
        expect(await snapshot(target.id)).toEqual({ auth: [], roles: [], user: [] });
        expect(await snapshot(users[1].id)).toEqual(otherBefore);
        for (const token of tokens) {
            expect((await request(app).get("/api/user/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
        }
        const login = await request(app).put("/api/auth").send({ email: target.email, password: "fixture-password" });
        expect(login.status).toBe(404);
    });

    test("delete nonexistent user returns 404", async () => {
        const response = await remove(adminToken, 2147483647);
        expect(response.status).toBe(404);
        expect(response.body.message).toBe("unknown user");
    });

    test.each(["userRole", "user"])("delete rolls back when removing %s fails", async (table) => {
        const target = users[0];
        const token = await setAuth(target);
        const before = await snapshot(target.id);
        const originalQuery = DB.query.bind(DB);
        const spy = jest.spyOn(DB, "query").mockImplementation(async (connection, sql, params) => {
            if (sql.startsWith(`DELETE FROM ${table} WHERE`)) {
                throw new Error("injected deletion failure");
            }
            return originalQuery(connection, sql, params);
        });
        let response;
        try {
            response = await remove(adminToken, target.id);
        } finally {
            spy.mockRestore();
        }
        expect(response.status).toBe(500);
        expect(response.body.message).toBe("unable to delete user");
        expect(await snapshot(target.id)).toEqual(before);
        expect((await request(app).get("/api/user/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    });
});



const authorized = (method, path, user) => request(app)[method](path).set('Authorization', `Bearer ${user.token}`);

describe('user update and validation', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
    test.each(['name', 'email', 'password', 'empty'])('updates %s independently', async (field) => {
        const user = await fixtures.user();
        const values = { name: "Diner's updated name", email: `${fixtures.prefix}-updated@test.com`, password: 'new-password' };
        const changes = field === 'empty' ? {} : { [field]: values[field] };
        const response = await authorized('put', `/api/user/${user.id}`, user).send(changes);
        expect(response.status).toBe(200);
        expectValidJwt(response.body.token);
        expect(response.body.user).toEqual({ id: user.id, name: changes.name || user.name, email: changes.email || user.email, roles: user.roles });
        const login = await request(app).put('/api/auth').send({ email: changes.email || user.email, password: changes.password || 'fixture-password' });
        expect(login.status).toBe(200);
        if (field === 'password') {
            expect((await request(app).put('/api/auth').send({ email: user.email, password: 'fixture-password' })).status).toBe(404);
        }
    });

    test('updating a missing user cannot return another user with the submitted email', async () => {
        const admin = await fixtures.user('admin');
        const response = await authorized('put', '/api/user/2147483647', admin).send({ email: admin.email });
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('unknown user');
    });

    test.each(['0', '-1', 'abc', '1.5', '9007199254740992'])('rejects invalid deletion ID %s', async (id) => {
        const admin = await fixtures.user('admin');
        expect((await authorized('delete', `/api/user/${id}`, admin)).status).toBe(400);
    });

    test.each([{ limit: '9007199254740991' }, { page: '9007199254740991', limit: 2 }])('rejects unsafe pagination %j', async (params) => {
        const admin = await fixtures.user('admin');
        expect((await authorized('get', '/api/user', admin).query(params)).status).toBe(400);
    });
});
