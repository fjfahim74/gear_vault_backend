import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { usersCollection } from "../config/db.js";

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized!" });
    }

    try {
        const token = authHeader.split(" ")[1];

        const JWKS = createRemoteJWKSet(
            new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
        );

        const { payload } = await jwtVerify(token, JWKS);

        if (!ObjectId.isValid(payload.id)) {
            return res.status(401).send({ message: "Unauthorized!" });
        }

        const user = await usersCollection.findOne({
            _id: new ObjectId(payload.id)
        });

        if (!user) {
            return res.status(401).send({ message: "Unauthorized!" });
        }

        req.user = {
            ...payload,
            role: user.role
        };

        next();
    } catch (error) {
        return res.status(401).send({ message: "Unauthorized!" });
    }
};

const verifyRole = (roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).send({
                message: "Forbidden! You do not have permission."
            });
        }

        next();
    };
};

const verifyRenter = verifyRole(["Customer"]);
const verifyOwner = verifyRole(["Owner"]);
const verifyAdmin = verifyRole(["Admin"]);

export { verifyRenter, verifyOwner, verifyAdmin };
export default verifyToken;