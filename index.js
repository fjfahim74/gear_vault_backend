import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { connectDB } from "./config/db.js";
import verifyApi from "./middlewares/verifyApi.js";
import routes from "./routes/index.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use("/", routes);

app.get('/', (req, res) => {
    res.send('Hello World from express.js!');
});

connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch((error) => {
        console.log('MongoDB connection failed:', error);
    });