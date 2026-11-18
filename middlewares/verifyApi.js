import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { usersCollection } from "../config/db.js";

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({
            message: "Unauthorized!"
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const JWKS = createRemoteJWKSet(
            new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
        );

        const { payload } = await jwtVerify(token, JWKS);

        if (!payload.id || !ObjectId.isValid(payload.id)) {
            return res.status(401).send({
                message: "Unauthorized!"
            });
        }

        const user = await usersCollection.findOne({
            _id: new ObjectId(payload.id)
        });

        if (!user) {
            return res.status(401).send({
                message: "Unauthorized!"
            });
        }

        req.user = {
            ...payload,
            role: user.role
        };

        next();
    } catch (error) {
        return res.status(401).send({
            message: "Unauthorized!"
        });
    }
};

const verifyRenter = (req, res, next) => {
    if (req.user?.role !== "Customer") {
        return res.status(403).send({
            message: "Forbidden! Only customers can access this resource."
        });
    }

    next();
};

const verifyOwner = (req, res, next) => {
    if (req.user?.role !== "Owner") {
        return res.status(403).send({
            message: "Forbidden! Only equipment owners can access this resource."
        });
    }

    next();
};

const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "Admin") {
        return res.status(403).send({
            message: "Forbidden! Only administrators can access this resource."
        });
    }

    next();
};

export { verifyRenter, verifyOwner, verifyAdmin };
export default verifyToken;