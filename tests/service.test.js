const request = require("supertest");
const app = require("../src/service");
const version = require("../src/version.json");

test("bad endpoint 404", async () => {
    const res = await request(app).get("/whatever");
    expect(res.status).toBe(404);
    const expectedObject = {
        message: "unknown endpoint",
    };
    expect(res.body).toMatchObject(expectedObject);
});
test("root endpoint", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    const expectedObject = {
        message: "welcome to JWT Pizza",
        version: version.version,
    };
    expect(res.body).toMatchObject(expectedObject);
});

test("docs", async () => {
    const res = await request(app).get("/api/docs");
    expect(res.status).toBe(200);
    expect(res.body.version).toEqual(version.version);
});
