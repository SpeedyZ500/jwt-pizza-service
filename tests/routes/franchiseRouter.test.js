const request = require("supertest");
const app = require("../../src/service");
const { DB } = require("../../src/database/database");
const {
    randomName,
    expectValidJwt
} = require("../testService");

const { createFixtures } = require("../coverageFixtures");
describe('franchise management', () => {
    let fixtures;
    let testUserAuthToken;
    let testUser;

    afterEach(async () => { await fixtures.cleanup(); });

    beforeEach(async () => {
        fixtures = createFixtures();
        testUser = await fixtures.user();
        testUserAuthToken = testUser.token;

        expectValidJwt(testUserAuthToken);
    });

    test("get franchises for the authenticated user", async () => {
        const listFranchisesRes = await request(app)
            .get(`/api/franchise/${testUser.id}`)
            .set("Authorization", `Bearer ${testUserAuthToken}`);
        expect(listFranchisesRes.status).toBe(200);
        expect(listFranchisesRes.body).toEqual([]);
    });

    test("cannot get franchises for another user", async () => {
        const otherUser = await fixtures.user();
        const listFranchisesRes = await request(app)
            .get(`/api/franchise/${otherUser.id}`)
            .set("Authorization", `Bearer ${testUserAuthToken}`);
        expect(listFranchisesRes.status).toBe(200);
        expect(listFranchisesRes.body).toEqual([]);
    });



    test("non-admin cannot create a franchise", async () => {
        const franchiseCreate = {
            name: "testFranchise",
            admins: [{ email: testUser.email }],
        };
        const createFranchiseRes = await request(app)
            .post(`/api/franchise`)
            .set("Authorization", `Bearer ${testUserAuthToken}`)
            .send(franchiseCreate);
        expect(createFranchiseRes.status).toBe(403);
        const expectedObject = { message: "unable to create a franchise" };
        expect(createFranchiseRes.body).toMatchObject(expectedObject);
    });

    test("non-admin cannot delete a franchise", async () => {
        const owner = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        const deleteFranchiseRes = await request(app)
            .delete(`/api/franchise/${franchise.id}`)
            .set("Authorization", `Bearer ${testUserAuthToken}`);
        expect(deleteFranchiseRes.status).toBe(403);
        const expectedObject = { message: "unable to delete a franchise" };
        expect(deleteFranchiseRes.body).toMatchObject(expectedObject);
    });

    test("user who is neither an admin nor a franchise owner cannot create a store", async () => {
        const owner = await fixtures.user();
        const franchiseId = (await fixtures.franchise(owner)).id;
        const storeCreate = {
            name: "testStore",
            franchiseId: franchiseId,
        };

        const createStoreRes = await request(app)
            .post(`/api/franchise/${franchiseId}/store`)
            .set("Authorization", `Bearer ${testUserAuthToken}`)
            .send(storeCreate);
        expect(createStoreRes.status).toBe(403);
        const expectedObject = { message: "unable to create a store" };
        expect(createStoreRes.body).toMatchObject(expectedObject);
    });

    test("user who is neither an admin nor a franchise owner cannot delete a store", async () => {
        const owner = await fixtures.user();
        const franchiseId = (await fixtures.franchise(owner)).id;

        const store = await DB.createStore(franchiseId, { name: "protected store" });
        const deleteStoreRes = await request(app)
            .delete(`/api/franchise/${franchiseId}/store/${store.id}`)
            .set("Authorization", `Bearer ${testUserAuthToken}`);

        expect(deleteStoreRes.status).toBe(403);
        const expectedObject = { message: "unable to delete a store" };
        expect(deleteStoreRes.body).toMatchObject(expectedObject);
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

        test("admin creates a franchise", async () => {
            const franchiseCreate = {
                name: `${fixtures.prefix}-${randomName()}`,
                admins: [{ email: admin.email }],
            };
            const createFranchiseRes = await request(app)
                .post(`/api/franchise`)
                .set("Authorization", `Bearer ${adminAuthToken}`)
                .send(franchiseCreate);
            expect(createFranchiseRes.status).toBe(200);

            expect(createFranchiseRes.body.name).toEqual(franchiseCreate.name);
            const expectedAdimn = { ...admin };
            delete expectedAdimn.roles;
            delete expectedAdimn.password;
            expect(createFranchiseRes.body.admins).toContainEqual(expectedAdimn);
        });

        test("admin deletes a franchise", async () => {
            const franchiseCreate = {
                name: `${fixtures.prefix}-${randomName()}`,
                admins: [{ email: admin.email }],
            };
            const createFranchiseRes = await request(app)
                .post(`/api/franchise`)
                .set("Authorization", `Bearer ${adminAuthToken}`)
                .send(franchiseCreate);
            expect(createFranchiseRes.status).toBe(200);

            expect(createFranchiseRes.body.name).toEqual(franchiseCreate.name);
            const expectedAdimn = { ...admin };
            delete expectedAdimn.roles;
            delete expectedAdimn.password;
            expect(createFranchiseRes.body.admins).toContainEqual(expectedAdimn);
            const franchiseId = createFranchiseRes.body.id;
            const franchiseDeleteRes = await request(app)
                .delete(`/api/franchise/${franchiseId}`)
                .set("Authorization", `Bearer ${adminAuthToken}`);
            expect(franchiseDeleteRes.status).toBe(200);
            const expectedObject = { message: "franchise deleted" };
            expect(franchiseDeleteRes.body).toMatchObject(expectedObject);
        });

        describe("needs franchise", () => {
            let franchiseId;
            beforeEach(async () => {
                const franchiseCreate = {
                    name: `${fixtures.prefix}-${randomName()}`,
                    admins: [{ email: admin.email }],
                };
                const createFranchiseRes = await request(app)
                    .post(`/api/franchise`)
                    .set("Authorization", `Bearer ${adminAuthToken}`)
                    .send(franchiseCreate);
                franchiseId = createFranchiseRes.body.id;
            });

            test("create store", async () => {
                const storeCreate = {
                    name: `${fixtures.prefix}-${randomName()}`,
                    franchiseId: franchiseId,
                };

                const createStoreRes = await request(app)
                    .post(`/api/franchise/${franchiseId}/store`)
                    .set("Authorization", `Bearer ${adminAuthToken}`)
                    .send(storeCreate);
                expect(createStoreRes.status).toBe(200);
                expect(createStoreRes.body.name).toEqual(storeCreate.name);
                expect(createStoreRes.body.totalRevenue).toBe(0);
            });

            test("delete store", async () => {
                const storeCreate = {
                    name: `${fixtures.prefix}-${randomName()}`,
                    franchiseId: franchiseId,
                };

                const createStoreRes = await request(app)
                    .post(`/api/franchise/${franchiseId}/store`)
                    .set("Authorization", `Bearer ${adminAuthToken}`)
                    .send(storeCreate);
                expect(createStoreRes.status).toBe(200);
                expect(createStoreRes.body.name).toEqual(storeCreate.name);
                expect(createStoreRes.body.totalRevenue).toBe(0);
                const storeId = createStoreRes.body.id;

                const deleteStoreRes = await request(app)
                    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
                    .set("Authorization", `Bearer ${adminAuthToken}`);
                expect(deleteStoreRes.status).toBe(200);
                const expectedObject = { message: "store deleted" };
                expect(deleteStoreRes.body).toMatchObject(expectedObject);
            });

            afterEach(async () => {
                await request(app)
                    .delete(`/api/franchise/${franchiseId}`)
                    .set("Authorization", `Bearer ${adminAuthToken}`);
            });
        });
    });

});

const authorized = (method, path, user) => request(app)[method](path).set('Authorization', `Bearer ${user.token}`);

describe('franchise listing and permissions', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
    async function listingFixtures() {
        const admin = await fixtures.user('admin');
        const diner = await fixtures.user();
        const franchises = [];
        for (const suffix of ['alpha', 'beta', 'gamma']) {
            const franchise = await fixtures.franchise(admin, suffix);
            const store = await DB.createStore(franchise.id, { name: `${suffix} store` });
            franchises.push({ franchise, store });
        }
        return { admin, diner, franchises };
    }

    test('public and diner listings expose stores; admin listing includes admins and revenue', async () => {
        const { admin, diner, franchises } = await listingFixtures();
        const { franchise, store } = franchises[0];
        const menu = await fixtures.menu();
        await DB.addDinerOrder(diner, { franchiseId: franchise.id, storeId: store.id, items: [{ menuId: menu.id, description: 'revenue pizza', price: 0.75 }] });
        const path = `/api/franchise?name=${franchise.name}`;
        for (const response of [await request(app).get(path), await authorized('get', path, diner)]) {
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ franchises: [{ id: franchise.id, name: franchise.name, stores: [{ id: store.id, name: store.name }] }], more: false });
        }
        const response = await authorized('get', path, admin);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ franchises: [{ id: franchise.id, name: franchise.name, admins: [{ id: admin.id, name: admin.name, email: admin.email }], stores: [{ id: store.id, name: store.name, totalRevenue: 0.75 }] }], more: false });
    });

    test('franchise filters, limits, and zero-based pages', async () => {
        const { franchises } = await listingFixtures();
        for (const [page, expected, more] of [[0, franchises.slice(0, 2), true], [1, franchises.slice(2), false], [2, [], false]]) {
            const response = await request(app).get('/api/franchise').query({ name: `${fixtures.prefix}*`, limit: 2, page });
            expect(response.status).toBe(200);
            expect(response.body.franchises.map((f) => f.id)).toEqual(expected.map((f) => f.franchise.id));
            expect(response.body.more).toBe(more);
        }
        const suffix = await request(app).get('/api/franchise').query({ name: `*${fixtures.prefix}*a` });
        expect(suffix.body.franchises).toHaveLength(3);
        const empty = await request(app).get('/api/franchise').query({ name: `${fixtures.prefix}-missing` });
        expect(empty.body).toEqual({ franchises: [], more: false });
    });

    test('franchisee retrieves owned franchises and manages stores and franchise', async () => {
        const owner = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        const login = await request(app).put('/api/auth').send({ email: owner.email, password: 'fixture-password' });
        owner.token = login.body.token;
        expect(login.body.user.roles).toContainEqual({ role: 'franchisee', objectId: franchise.id });
        const store = await authorized('post', `/api/franchise/${franchise.id}/store`, owner).send({ name: 'owned store' });
        expect(store.status).toBe(200);
        const list = await authorized('get', `/api/franchise/${owner.id}`, owner);
        expect(list.status).toBe(200);
        expect(list.body).toEqual([{ id: franchise.id, name: franchise.name, admins: [{ id: owner.id, name: owner.name, email: owner.email }], stores: [{ id: store.body.id, name: store.body.name, totalRevenue: 0 }] }]);
        const admin = await fixtures.user('admin');
        expect((await authorized('get', `/api/franchise/${owner.id}`, admin)).body).toEqual(list.body);
        expect((await authorized('delete', `/api/franchise/${franchise.id}/store/${store.body.id}`, owner)).status).toBe(200);
        const afterStoreDelete = await authorized('get', `/api/franchise/${owner.id}`, owner);
        expect(afterStoreDelete.body[0].stores).toEqual([]);
        expect((await authorized('delete', `/api/franchise/${franchise.id}`, owner)).status).toBe(200);
        expect((await authorized('get', `/api/franchise/${owner.id}`, owner)).body).toEqual([]);
        const relogin = await request(app).put('/api/auth').send({ email: owner.email, password: 'fixture-password' });
        expect(relogin.body.user.roles).toEqual([{ role: 'diner' }]);
    });

    test('unrelated user cannot manage an owned franchise or see its user listing', async () => {
        const owner = await fixtures.user();
        const other = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        const store = await DB.createStore(franchise.id, { name: 'protected store' });
        expect((await authorized('get', `/api/franchise/${owner.id}`, other)).body).toEqual([]);
        expect((await authorized('post', `/api/franchise/${franchise.id}/store`, other).send({ name: 'forbidden' })).status).toBe(403);
        expect((await authorized('delete', `/api/franchise/${franchise.id}/store/${store.id}`, other)).status).toBe(403);
        expect((await authorized('delete', `/api/franchise/${franchise.id}`, other)).status).toBe(403);
        const remaining = await authorized('get', `/api/franchise/${owner.id}`, owner);
        expect(remaining.body[0].stores).toEqual([{ id: store.id, name: store.name, totalRevenue: 0 }]);
    });

    test('franchise deletion requires authentication', async () => {
        const owner = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        expect((await request(app).delete(`/api/franchise/${franchise.id}`)).status).toBe(401);
        const remaining = await authorized('get', `/api/franchise/${owner.id}`, owner);
        expect(remaining.body.map((f) => f.id)).toEqual([franchise.id]);
    });

    test('unknown franchise admin returns 404 without inserting a franchise', async () => {
        const admin = await fixtures.user('admin');
        const response = await authorized('post', '/api/franchise', admin).send({ name: fixtures.prefix, admins: [{ email: `${fixtures.prefix}-missing@test.com` }] });
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('unknown user for franchise admin provided');
        const remaining = await request(app).get('/api/franchise').query({ name: fixtures.prefix });
        expect(remaining.body).toEqual({ franchises: [], more: false });
    });

    test('franchise deletion returns 500 when the database operation fails', async () => {
        const admin = await fixtures.user('admin');
        const franchise = await fixtures.franchise(admin);
        const spy = jest.spyOn(DB, 'deleteFranchise').mockRejectedValue(new Error('unable to delete franchise'));
        const response = await authorized('delete', `/api/franchise/${franchise.id}`, admin);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('unable to delete franchise');
        expect(spy).toHaveBeenCalledWith(franchise.id);
    });

});
