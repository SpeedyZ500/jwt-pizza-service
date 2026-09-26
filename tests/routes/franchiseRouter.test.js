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
    testUser.email = randomName() + "@test.com";
    const registerRes = await request(app).post("/api/auth").send(testUser);
    userId = registerRes.body.user.id;
    testUserAuthToken = registerRes.body.token;
    expectValidJwt(testUserAuthToken);
});

test("Get franchise for User", async () => {
    const listFranchisesRes = await request(app)
        .get(`/api/franchise/${userId}`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(listFranchisesRes.status).toBe(200);
    expect(listFranchisesRes.body).toEqual([]);
});

test("Get franchise for not the user", async () => {
    const listFranchisesRes = await request(app)
        .get(`/api/franchise/${userId + 1}`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(listFranchisesRes.status).toBe(200);
    expect(listFranchisesRes.body).toEqual([]);
});

test("Get franchise for not the user", async () => {
    const listFranchisesRes = await request(app)
        .get(`/api/franchise/${userId + 1}`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(listFranchisesRes.status).toBe(200);
    expect(listFranchisesRes.body).toEqual([]);
});

test("create franchise not admin", async () => {
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

test("delete franchise not admin", async () => {
    const deleteFranchiseRes = await request(app)
        .delete(`/api/franchise/1`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(deleteFranchiseRes.status).toBe(403);
    const expectedObject = { message: "unable to delete a franchise" };
    expect(deleteFranchiseRes.body).toMatchObject(expectedObject);
});

test("create store not admin or franchise", async () => {
    const franchiseId = 1;
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

test("delete store not admin no franchise", async () => {
    const franchiseId = 1;

    const deleteStoreRes = await request(app)
        .delete(`/api/franchise/${franchiseId}/store/1`)
        .set("Authorization", `Bearer ${testUserAuthToken}`);

    expect(deleteStoreRes.status).toBe(403);
    const expectedObject = { message: "unable to delete a store" };
    expect(deleteStoreRes.body).toMatchObject(expectedObject);
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

    test("admin create franchise", async () => {
        const franchiseCreate = {
            name: `${randomName()}`,
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

    test("admin delete franchise", async () => {
        const franchiseCreate = {
            name: `${randomName()}`,
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
                name: `${randomName()}`,
                admins: [{ email: admin.email }],
            };
            const createFranchiseRes = await request(app)
                .post(`/api/franchise`)
                .set("Authorization", `Bearer ${adminAuthToken}`)
                .send(franchiseCreate);
            franchiseId = createFranchiseRes.body.id;
        });

        test("create store ", async () => {
            const storeCreate = {
                name: `${randomName()}`,
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
                name: `${randomName()}`,
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
