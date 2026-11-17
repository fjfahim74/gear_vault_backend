import { MongoClient } from "mongodb";
import "dotenv/config";

const client = new MongoClient(process.env.MONGO_DB_URL);
const db = client.db("next_project");

const connectDB = async () => {
    await client.connect();
    console.log("MongoDB connected successfully!");
};

export { db, connectDB };