const express = require("express");
const { asyncHandler } = require("../endpointHelper.js");
const { DB, Role } = require("../database/database.js");
const { authRouter, setAuth } = require("./authRouter.js");

const userRouter = express.Router();

userRouter.docs = [
    {
        method: "GET",
        path: "/api/user/me",
        requiresAuth: true,
        description: "Get authenticated user",
        example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
        response: {
            id: 1,
            name: "常用名字",
            email: "a@jwt.com",
            roles: [{ role: "admin" }],
        },
    },
    {
        method: "PUT",
        path: "/api/user/:userId",
        requiresAuth: true,
        description: "Update user",
        example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
        response: {
            user: {
                id: 1,
                name: "常用名字",
                email: "a@jwt.com",
                roles: [{ role: "admin" }],
            },
            token: "tttttt",
        },
    },
    {
        method: "GET",
        path: "/api/user?page=1&limit=10&name=*",
        requiresAuth: true,
        description: "Gets a list of users (admin only). Defaults: page=1, limit=10, name=*. Use * as a name wildcard.",
        example: `curl -X GET localhost:3000/api/user -H 'Authorization: Bearer tttttt'`,
        response: {
            users: [
                {
                    id: 1,
                    name: "常用名字",
                    email: "a@jwt.com",
                    roles: [{ role: "admin" }],
                },
            ],
            more: false,
        },
    },
    {
        method: "DELETE",
        path: "/api/user/:userId",
        requiresAuth: true,
        description: "Deletes a user and their authentication and roles (admin only)",
        example: `curl -X DELETE localhost:3000/api/user/3 -H 'Authorization: Bearer tttttt'`,
        response: {},
    },
];

// getUser
userRouter.get(
    "/me",
    authRouter.authenticateToken,
    asyncHandler(async (req, res) => {
        DB.getUser;
        res.json(req.user);
    }),
);

// updateUser
userRouter.put(
    "/:userId",
    authRouter.authenticateToken,
    asyncHandler(async (req, res) => {
        const { name, email, password } = req.body;
        const userId = Number(req.params.userId);
        const user = req.user;
        if (user.id !== userId && !user.isRole(Role.Admin)) {
            return res.status(403).json({ message: "unauthorized" });
        }

        const updatedUser = await DB.updateUser(userId, name, email, password);
        if (!updatedUser) {
            return res.status(404).json({ message: "unknown user" });
        }
        const auth = await setAuth(updatedUser);
        res.json({ user: updatedUser, token: auth });
    }),
);

// deleteUser
userRouter.delete(
    "/:userId",
    authRouter.authenticateToken,
    asyncHandler(async (req, res) => {
        const user = req.user;
        if (!user.isRole(Role.Admin)) {
            return res.status(403).json({ message: "unauthorized" });
        }
        const userId = Number(req.params.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({ message: "invalid user ID" });
        }
        const deleted = await DB.deleteUser(userId);
        if (!deleted) {
            return res.status(404).json({ message: "unknown user" });
        }
        res.json({});
    }),
);

// listUsers
userRouter.get(
    "/",
    authRouter.authenticateToken,
    asyncHandler(async (req, res) => {
        const user = req.user;
        if (!user.isRole(Role.Admin)) {
            return res.status(403).json({ message: "unauthorized" });
        }
        const { page = "1", limit = "10", name = "*" } = req.query;
        const validInteger = (value) => typeof value === "string" &&
            /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
        if (!validInteger(page) || !validInteger(limit) || typeof name !== "string" ||
            !Number.isSafeInteger(Number(limit) + 1) ||
            !Number.isSafeInteger((Number(page) - 1) * Number(limit))) {
            return res.status(400).json({ message: "invalid user list query" });
        }
        res.json(await DB.getUsers(Number(page), Number(limit), name));
    }),
);

module.exports = userRouter;
