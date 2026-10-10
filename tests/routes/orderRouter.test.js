const request = require("supertest");
const app = require("../../src/service");
const { DB } = require("../../src/database/database");
const config = require("../../src/config");
const {
    randomName,
    expectValidJwt
} = require("../testService");

const { createFixtures, query } = require("../coverageFixtures");
describe('menu endpoints', () => {
    let fixtures;
    let testUserAuthToken;
    beforeEach(async () => {
        fixtures = createFixtures();
        testUserAuthToken = (await fixtures.user()).token;
        expectValidJwt(testUserAuthToken);
    });
    afterEach(async () => { await fixtures.cleanup(); });

    test("non-admin cannot add a menu item", async () => {
        const menuItem = {
            title: `${fixtures.prefix}-menu`,
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

    test("non-admin cannot delete a menu item", async () => {
        const menuItem = await fixtures.menu();
        const delMenueItemRes = await request(app)
            .delete(`/api/order/menu/${menuItem.id}`)
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

        test("admin adds a menu item", async () => {
            const menuItem = {
                title: `${fixtures.prefix}-menu`,
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

        test("admin deletes a menu item", async () => {
            const menuItem = {
                title: `${fixtures.prefix}-menu`,
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
            const menuItem = {
                title: "Veggie",
                image: "pizza1.png",
                price: 0.0038,
                description: "A garden of delight",
            };
            beforeEach(async () => {
                menuItem.title = `${fixtures.prefix}-veggie`;
                const franchiseCreate = {
                    name: `${fixtures.prefix}-${randomName()}`,
                    admins: [{ email: admin.email }],
                };
                const createFranchiseRes = await request(app)
                    .post(`/api/franchise`)
                    .set("Authorization", `Bearer ${adminAuthToken}`)
                    .send(franchiseCreate);
                franchiseId = createFranchiseRes.body.id;
                const storeCreate = {
                    name: `${fixtures.prefix}-${randomName()}`,
                    franchiseId: franchiseId,
                };

                const createStoreRes = await request(app)
                    .post(`/api/franchise/${franchiseId}/store`)
                    .set("Authorization", `Bearer ${adminAuthToken}`)
                    .send(storeCreate);
                expect(createStoreRes.status).toBe(200);

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

            afterEach(() => { delete menuItem.id; });
        });
    });

});

const authorized = (method, path, user) => request(app)[method](path).set('Authorization', `Bearer ${user.token}`);

describe('order creation and history', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
async function orderFixtures() {
    const user = await fixtures.user();
    const owner = await fixtures.user('admin');
    const franchise = await fixtures.franchise(owner);
    const store = await DB.createStore(franchise.id, { name: 'Fixture store' });
    const menus = [await fixtures.menu(), await fixtures.menu(0.5)];
    const order = { franchiseId: franchise.id, storeId: store.id, items: menus.map((menu) => ({ menuId: menu.id, description: menu.description, price: menu.price })) };
    return { user, owner, franchise, store, menus, order };
}

function factoryResponse(ok = true) {
    return jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => ({ jwt: 'factory-jwt', reportUrl: 'https://example.test/report' }) });
}

    test('creates multi-item orders, persists history, and sends the factory request', async () => {
        const { user, order } = await orderFixtures();
        const factory = factoryResponse();
        const response = await authorized('post', '/api/order', user).send(order);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ order: { ...order, id: expect.any(Number) }, followLinkToEndChaos: 'https://example.test/report', jwt: 'factory-jwt' });
        expect(factory).toHaveBeenCalledTimes(1);
        const [url, options] = factory.mock.calls[0];
        expect(url).toBe(`${config.factory.url}/api/order`);
        expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${config.factory.apiKey}` } });
        expect(JSON.parse(options.body)).toEqual({ diner: { id: user.id, name: user.name, email: user.email }, order: response.body.order });
        const history = await authorized('get', '/api/order', user);
        expect(history.status).toBe(200);
        expect(history.body).toMatchObject({ dinerId: user.id, page: 1, orders: [{ id: response.body.order.id, franchiseId: order.franchiseId, storeId: order.storeId, date: expect.any(String), items: order.items.map((item) => ({ ...item, id: expect.any(Number) })) }] });
        expect(history.body.orders).toHaveLength(1);
        expect(await query('SELECT id FROM orderItem WHERE orderId=?', [response.body.order.id])).toHaveLength(2);
    });

    test.each(['rejected', 'network'])('factory %s failure preserves the saved order', async (failure) => {
        const { user, order } = await orderFixtures();
        const factory = factoryResponse(false);
        if (failure === 'network') factory.mockRejectedValue(new Error('factory offline'));
        const response = await authorized('post', '/api/order', user).send(order);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe(failure === 'network' ? 'factory offline' : 'Failed to fulfill order at factory');
        if (failure === 'rejected') expect(response.body.followLinkToEndChaos).toBe('https://example.test/report');
        const history = await authorized('get', '/api/order', user);
        expect(history.body.orders).toHaveLength(1);
        expect(history.body.orders[0].items).toHaveLength(2);
    });

    test('empty history and user isolation', async () => {
        const { user, order } = await orderFixtures();
        const other = await fixtures.user();
        await DB.addDinerOrder(other, order);
        const response = await authorized('get', '/api/order', user);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ dinerId: user.id, orders: [], page: 1 });
    });

    test('order history paginates consistently', async () => {
        const { user, order } = await orderFixtures();
        const ids = [];
        for (let i = 0; i < config.db.listPerPage + 1; i++) ids.push((await DB.addDinerOrder(user, order)).id);
        const first = await authorized('get', '/api/order', user);
        const second = await authorized('get', '/api/order?page=2', user);
        const beyond = await authorized('get', '/api/order?page=3', user);
        expect(first.body.orders.map((o) => o.id)).toEqual(ids.slice(0, config.db.listPerPage));
        expect(second.status).toBe(200);
        expect(second.body.orders.map((o) => o.id)).toEqual(ids.slice(config.db.listPerPage));
        expect(second.body.page).toBe('2');
        expect(beyond.body.orders).toEqual([]);
    });

    test.each(['get', 'post'])('%s orders requires authentication', async (method) => {
        const factory = factoryResponse();
        expect((await request(app)[method]('/api/order')).status).toBe(401);
        expect(factory).not.toHaveBeenCalled();
    });

    test('missing menu reference fails before contacting the factory', async () => {
        const { user, order } = await orderFixtures();
        const factory = factoryResponse();
        order.items[0].menuId = 2147483647;
        const response = await authorized('post', '/api/order', user).send(order);
        expect(response.status).toBe(500);
        expect(response.body.message).toBe('No ID found');
        expect(factory).not.toHaveBeenCalled();
    });
});
