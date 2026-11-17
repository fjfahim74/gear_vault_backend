import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from "jose";

const client = new MongoClient(process.env.MONGO_DB_URL);
const db = client.db("next_project");


const app = express();
const PORT = process.env.PORT || 5000;

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

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World from express.js!');
});

async function connectDB() {
    try {
        await client.connect();
        console.log('MongoDB connected successfully!');

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

    } catch (error) {
        console.log('MongoDB connection failed:', error);
    }
}

connectDB();