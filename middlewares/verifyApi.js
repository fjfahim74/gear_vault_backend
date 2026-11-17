import { createRemoteJWKSet, jwtVerify } from "jose";

const verifyApi = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }

    const JWKS = createRemoteJWKSet(
        new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
    );

    try {
        const { payload } = await jwtVerify(token, JWKS);

        req.user = payload;

        next();
    } catch (error) {
        return res.status(401).send({ msg: "Unauthorized!" });
    }
};

export default verifyApi;