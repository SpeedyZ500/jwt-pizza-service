const { DB } = require('../../src/database/database');
const { createFixtures } = require('../coverageFixtures');
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
