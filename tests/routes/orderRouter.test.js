const request = require("supertest");
const app = require("../../src/service");
const {
    createAdminUser,
    randomName,
    expectValidJwt,
} = require("../testService");

let testUserAuthToken;

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
beforeAll(async () => {
    testUser.email = randomName() + "@test.com";
    const registerRes = await request(app).post("/api/auth").send(testUser);
    testUserAuthToken = registerRes.body.token;
    expectValidJwt(testUserAuthToken);
});

test("non admin cant add menue item", async () => {
    const menuItem = {
        title: "test",
        description: "A testy pizza",
        image: "test_21.svg",
        price: 0.0001,
    };
    const addMenueItemRes = await request(app)
        .put("/api/order/menu")
        .set("Authorization", `Bearer ${testUserAuthToken}`)
        .send(menuItem);
    expect(addMenueItemRes.status).toBe(403);
    const expectedObject = {
        message: "unable to add menu item",
    };
    expect(addMenueItemRes.body).toMatchObject(expectedObject);
});

test("non admin cant delete menue item", async () => {
    const delMenueItemRes = await request(app)
        .delete("/api/order/menu/1")
        .set("Authorization", `Bearer ${testUserAuthToken}`);
    expect(delMenueItemRes.status).toBe(403);
    const expectedObject = {
        message: "unable to delete menu item",
    };
    expect(delMenueItemRes.body).toMatchObject(expectedObject);
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

    test("admin add menue item", async () => {
        const menuItem = {
            title: "test",
            description: "A testy pizza",
            image: "test_21.svg",
            price: 0.0001,
        };
        const addMenueItemRes = await request(app)
            .put("/api/order/menu")
            .set("Authorization", `Bearer ${adminAuthToken}`)
            .send(menuItem);
        expect(addMenueItemRes.status).toBe(200);

        expect(addMenueItemRes.body).toMatchObject(menuItem);
    });

    test("admin delete menue item", async () => {
        const menuItem = {
            title: "test",
            description: "A testy pizza",
            image: "test_21.svg",
            price: 0.0001,
        };
        const addMenueItemRes = await request(app)
            .put("/api/order/menu")
            .set("Authorization", `Bearer ${adminAuthToken}`)
            .send(menuItem);
        expect(addMenueItemRes.status).toBe(200);

        expect(addMenueItemRes.body).toMatchObject(menuItem);
        const itemId = addMenueItemRes.body.id;
        const delMenueItemRes = await request(app)
            .delete(`/api/order/menu/${itemId}`)
            .set("Authorization", `Bearer ${adminAuthToken}`);
        expect(delMenueItemRes.status).toBe(200);
        const expectedObject = {
            message: "menu item deleted",
        };
        expect(delMenueItemRes.body).toMatchObject(expectedObject);
    });

    describe("needs franchise, store, and/or menu items", () => {
        let franchiseId;
        let storeId;
        const menuItem = {
            title: "Veggie",
            image: "pizza1.png",
            price: 0.0038,
            description: "A garden of delight",
        };
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
            const storeCreate = {
                name: `${randomName()}`,
                franchiseId: franchiseId,
            };

            const createStoreRes = await request(app)
                .post(`/api/franchise/${franchiseId}/store`)
                .set("Authorization", `Bearer ${adminAuthToken}`)
                .send(storeCreate);
            storeId = createStoreRes.body.id;

            const addMenueItemRes = await request(app)
                .put("/api/order/menu")
                .set("Authorization", `Bearer ${adminAuthToken}`)
                .send(menuItem);
            menuItem.id = addMenueItemRes.body.id;
        });

        test("get menu", async () => {
            const getMenuRes = await request(app).get("/api/order/menu");
            expect(getMenuRes.status).toBe(200);
            expect(getMenuRes.body).toContainEqual(menuItem);
        });

        afterEach(async () => {
            await request(app)
                .delete(`/api/franchise/${franchiseId}`)
                .set("Authorization", `Bearer ${adminAuthToken}`);
            await request(app)
                .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
                .set("Authorization", `Bearer ${adminAuthToken}`);
            await request(app)
                .delete(`/api/order/menu/${menuItem.id}`)
                .set("Authorization", `Bearer ${adminAuthToken}`);
            delete menuItem.id;
        });
    });
});
