import { Router } from "express";
import { equipmentCollection } from "../../config/db.js";

const router = Router();

// Get all approved equipment
router.get("/", async (req, res) => {
    try {
        const equipments = await equipmentCollection
            .find({ status: "Approved" })
            .toArray();

        res.send(equipments);
    } catch (error) {
        res.status(500).send({
            message: "Failed to fetch equipment",
            error: error.message
        });
    }
});

export default router;