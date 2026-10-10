const { DB } = require('../src/database/database');
const { setAuth } = require('../src/routes/authRouter');
const { randomName } = require('./testService');

async function query(sql, params) {
    const connection = await DB.getConnection();
    try {
        return await DB.query(connection, sql, params);
    } finally {
        await connection.end();
    }
}

function createFixtures() {
    const prefix = `coverage-${randomName()}`;
    async function user(role = 'diner') {
        const name = `${prefix}-${randomName()}`;
        const result = await DB.addUser({ name, email: `${name}@test.com`, password: 'fixture-password', roles: [{ role }] });
        return { ...result, token: await setAuth(result) };
    }
    async function franchise(owner, suffix = randomName()) {
        return DB.createFranchise({ name: `${prefix}-${suffix}`, admins: [{ email: owner.email }] });
    }
    async function menu(price = 0.25) {
        return DB.addMenuItem({ title: `${prefix}-${randomName()}`, image: 'fixture.svg', description: 'Fixture pizza', price });
    }
    async function cleanup() {
        // Select by the unique prefix to include partially inserted fixtures.
        const users = await query('SELECT id FROM user WHERE email LIKE ?', [`${prefix}%`]);
        const franchises = await query('SELECT id FROM franchise WHERE name LIKE ?', [`${prefix}%`]);
        for (const user of users) {
            await query('DELETE oi FROM orderItem oi JOIN dinerOrder d ON oi.orderId=d.id WHERE d.dinerId=?', [user.id]);
            await query('DELETE FROM dinerOrder WHERE dinerId=?', [user.id]);
        }
        for (const franchise of franchises) {
            await query('DELETE FROM store WHERE franchiseId=?', [franchise.id]);
            await query("DELETE FROM userRole WHERE role='franchisee' AND objectId=?", [franchise.id]);
            await query('DELETE FROM franchise WHERE id=?', [franchise.id]);
        }
        for (const user of users) {
            await query('DELETE FROM auth WHERE userId=?', [user.id]);
            await query('DELETE FROM userRole WHERE userId=?', [user.id]);
            await query('DELETE FROM user WHERE id=?', [user.id]);
        }
        await query('DELETE FROM menu WHERE title LIKE ?', [`${prefix}%`]);
    }
    return { prefix, user, franchise, menu, cleanup };
}

module.exports = { createFixtures, query };
