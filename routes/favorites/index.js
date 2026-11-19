import { Router } from "express";
import { ObjectId } from "mongodb";
import {
    favoritesCollection,
    equipmentCollection
} from "../../config/db.js";
import verifyToken, { verifyRenter } from "../../middlewares/verifyApi.js";

const router = Router();

// Get customer's favorites
router.get("/", verifyToken, verifyRenter, async (req, res) => {
    const favorites = await favoritesCollection.find({
        userId: req.user.id
    }).toArray();

    const result = [];

    for (const favorite of favorites) {
        const equipment = await equipmentCollection.findOne({
            _id: new ObjectId(favorite.equipmentId)
        });

        if (equipment) {
            result.push(equipment);
        }
    }

    res.send(result);
});

// Add equipment to favorites
router.post("/", verifyToken, verifyRenter, async (req, res) => {
    const { equipmentId } = req.body;

    if (!ObjectId.isValid(equipmentId)) {
        return res.status(400).send({
            message: "Invalid equipment ID"
        });
    }

    const equipment = await equipmentCollection.findOne({
        _id: new ObjectId(equipmentId)
    });

    if (!equipment) {
        return res.status(404).send({
            message: "Equipment not found"
        });
    }

    const existingFavorite = await favoritesCollection.findOne({
        userId: req.user.id,
        equipmentId
    });

    if (existingFavorite) {
        return res.status(400).send({
            message: "Already added to favorites"
        });
    }

    const favorite = {
        userId: req.user.id,
        equipmentId,
        createdAt: new Date()
    };

    const result = await favoritesCollection.insertOne(favorite);

    res.status(201).send(result);
});

// Remove equipment from favorites
router.delete("/:equipmentId", verifyToken, verifyRenter, async (req, res) => {
    const { equipmentId } = req.params;

    const result = await favoritesCollection.deleteOne({
        userId: req.user.id,
        equipmentId
    });

    if (result.deletedCount === 0) {
        return res.status(404).send({
            message: "Favorite not found"
        });
    }

    res.send({
        message: "Favorite removed successfully"
    });
});

export default router;