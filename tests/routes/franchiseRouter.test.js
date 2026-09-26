const request = require("supertest");
const app = require("../../src/service");
const { createAdminUser, randomName, expectValidJwt } = require("../testService");

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

test("Get Fanchises for User", async () => {
    const listFranchisesRes =  await request(app).get(`/api/franchise/${userId}`).set()
})




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
    
});
