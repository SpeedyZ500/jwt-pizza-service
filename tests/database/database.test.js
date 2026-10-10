const { DB } = require('../../src/database/database');
const { createFixtures, query } = require('../coverageFixtures');
const { randomName } = require('../testService');

describe('franchise role persistence', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
    test('database adds franchise roles with their object IDs and rejects missing franchises', async () => {
        const admin = await fixtures.user('admin');
        const franchise = await fixtures.franchise(admin);
        const email = `${fixtures.prefix}-franchisee@test.com`;
        const user = await DB.addUser({ name: fixtures.prefix, email, password: 'password', roles: [{ role: 'franchisee', object: franchise.name }] });
        expect((await DB.getUser(email)).roles).toEqual([{ role: 'franchisee', objectId: franchise.id }]);
        expect((await DB.getUserFranchises(user.id)).map((f) => f.id)).toEqual([franchise.id]);
        await expect(DB.addUser({ name: fixtures.prefix, email: `${fixtures.prefix}-partial@test.com`, password: 'password', roles: [{ role: 'franchisee', object: `${fixtures.prefix}-missing` }] })).rejects.toThrow('No ID found');
    });
});

describe('database failure cleanup', () => {
    test.each(['getUser', 'getUsers', 'deleteUser'])('%s releases its connection after failure with an ordinary error', async (method) => {
        const connection = await DB.getConnection();
        const end = jest.spyOn(connection, 'end');
        const execute = jest.spyOn(connection, 'execute').mockRejectedValue(new Error('database operation failed'));
        const getConnection = jest.spyOn(DB, 'getConnection').mockResolvedValue(connection);
        try {
            const error = await DB[method](method === 'deleteUser' ? 2147483647 : undefined).catch((error) => error);
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toHaveProperty('code');
            expect(error).not.toHaveProperty('statusCode');
            expect(end).toHaveBeenCalledTimes(1);
        } finally {
            getConnection.mockRestore();
            execute.mockRestore();
            end.mockRestore();
        }
    });
});

test("database missing results contain no error codes", async () => {
    expect(await DB.getUser(`${randomName()}@missing.test`)).toBeNull();
    expect(await DB.deleteUser(2147483647)).toBe(false);
    expect(await DB.createFranchise({ name: randomName(), admins: [{ email: `${randomName()}@missing.test` }] })).toBeNull();
});

describe('deletion persistence and rollback', () => {
    let fixtures;
    beforeEach(() => { fixtures = createFixtures(); });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fixtures.cleanup();
    });
    async function userSnapshot(id) {
        return {
            auth: await query('SELECT * FROM auth WHERE userId=? ORDER BY token', [id]),
            roles: await query('SELECT * FROM userRole WHERE userId=? ORDER BY id', [id]),
            user: await query('SELECT * FROM user WHERE id=?', [id]),
        };
    }
    async function targetUser() {
        const user = await fixtures.user();
        await DB.loginUser(user.id, `fixture.second.session-${user.id}`);
        await query('INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)', [user.id, 'admin', 0]);
        return user;
    }
    test('user deletion removes all sessions, roles, and user rows without changing another user', async () => {
        const target = await targetUser();
        const other = await fixtures.user();
        const before = await userSnapshot(other.id);
        const targetBefore = await userSnapshot(target.id);
        expect(targetBefore.auth).toHaveLength(2);
        expect(targetBefore.roles).toHaveLength(2);
        expect(await DB.deleteUser(target.id)).toBe(true);
        expect(await userSnapshot(target.id)).toEqual({ auth: [], roles: [], user: [] });
        expect(await userSnapshot(other.id)).toEqual(before);
    });
    test.each(['userRole', 'user'])('user deletion rolls back when removing %s fails', async (table) => {
        const target = await targetUser();
        const before = await userSnapshot(target.id);
        const original = DB.query.bind(DB);
        const spy = jest.spyOn(DB, 'query').mockImplementation((connection, sql, params) => {
            if (sql.startsWith(`DELETE FROM ${table} WHERE`)) throw new Error('injected failure');
            return original(connection, sql, params);
        });
        let error;
        try { error = await DB.deleteUser(target.id).catch((error) => error); }
        finally { spy.mockRestore(); }
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('unable to delete user');
        expect(error).not.toHaveProperty('code');
        expect(error).not.toHaveProperty('statusCode');
        expect(await userSnapshot(target.id)).toEqual(before);
    });
    async function franchiseSnapshot(id) {
        return {
            stores: await query('SELECT * FROM store WHERE franchiseId=? ORDER BY id', [id]),
            roles: await query("SELECT * FROM userRole WHERE role='franchisee' AND objectId=? ORDER BY id", [id]),
            franchise: await query('SELECT * FROM franchise WHERE id=?', [id]),
        };
    }
    test('franchise deletion removes stores and roles without changing another franchise', async () => {
        const owner = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        await DB.createStore(franchise.id, { name: 'deleted store' });
        const other = await fixtures.franchise(owner);
        await DB.createStore(other.id, { name: 'remaining store' });
        const before = await franchiseSnapshot(other.id);
        await DB.deleteFranchise(franchise.id);
        expect(await franchiseSnapshot(franchise.id)).toEqual({ stores: [], roles: [], franchise: [] });
        expect(await franchiseSnapshot(other.id)).toEqual(before);
    });
    test.each(['userRole', 'franchise'])('franchise deletion rolls back when removing %s fails', async (table) => {
        const owner = await fixtures.user();
        const franchise = await fixtures.franchise(owner);
        await DB.createStore(franchise.id, { name: 'rollback store' });
        const before = await franchiseSnapshot(franchise.id);
        const original = DB.query.bind(DB);
        const spy = jest.spyOn(DB, 'query').mockImplementation((connection, sql, params) => {
            if (sql.startsWith(`DELETE FROM ${table} WHERE`)) throw new Error('injected failure');
            return original(connection, sql, params);
        });
        let error;
        try { error = await DB.deleteFranchise(franchise.id).catch((error) => error); }
        finally { spy.mockRestore(); }
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('unable to delete franchise');
        expect(error).not.toHaveProperty('code');
        expect(error).not.toHaveProperty('statusCode');
        expect(await franchiseSnapshot(franchise.id)).toEqual(before);
    });
    test('order persistence stores all item details', async () => {
        const user = await fixtures.user();
        const franchise = await fixtures.franchise(user);
        const store = await DB.createStore(franchise.id, { name: 'order store' });
        const menus = [await fixtures.menu(), await fixtures.menu(0.5)];
        const items = menus.map((menu) => ({ menuId: menu.id, description: menu.description, price: menu.price }));
        const order = await DB.addDinerOrder(user, { franchiseId: franchise.id, storeId: store.id, items });
        expect(await query('SELECT menuId, description, price FROM orderItem WHERE orderId=? ORDER BY id', [order.id])).toEqual(items);
        expect(await query('SELECT dinerId, franchiseId, storeId FROM dinerOrder WHERE id=?', [order.id])).toEqual([{ dinerId: user.id, franchiseId: franchise.id, storeId: store.id }]);
    });
});
