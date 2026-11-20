import { MongoClient } from "mongodb";
import "dotenv/config";

const client = new MongoClient(process.env.MONGO_DB_URL);
const db = client.db("next_project");

const equipmentCollection = db.collection("equipment");
const favoritesCollection = db.collection("favorites");
const bookingsCollection = db.collection("bookings");
const paymentsCollection = db.collection("payments");
const usersCollection = db.collection("user");
const bookingHoldsCollection = db.collection("bookingHolds");

const connectDB = async () => {
    await client.connect();
    console.log("MongoDB connected successfully!");
};

export {
    db,
    connectDB,
    equipmentCollection,
    favoritesCollection,
    bookingsCollection,
    paymentsCollection,
    usersCollection,
    bookingHoldsCollection
};