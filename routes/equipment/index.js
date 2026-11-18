import { Router } from "express";
import { ObjectId } from "mongodb";
import { equipmentCollection } from "../../config/db.js";
import verifyToken, { verifyOwner } from "../../middlewares/verifyApi.js";

const router = Router();

// Create new equipment
router.post("/", verifyToken, verifyOwner, async (req, res) => {
    const equipment = {
        ...req.body,
        ownerId: req.user.id,
        ownerEmail: req.user.email,
        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const result = await equipmentCollection.insertOne(equipment);

    res.status(201).send(result);
});

// Get approved equipment with search and filters
router.get("/", async (req, res) => {
    const { search, category, rentalType, availability, minPrice, maxPrice } = req.query;

    const query = {
        status: "Approved"
    };

    // Search by equipment name or category
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } }
        ];
    }

    // Filter by category
    if (category) {
        query.category = category;
    }

    if (rentalType) {
        query.rentalType = rentalType;
    }

    // Filter by availability
    if (availability === "available") {
        query.availableQuantity = { $gt: 0 };
    } else if (availability === "unavailable") {
        query.availableQuantity = { $lte: 0 };
    }

    if (minPrice || maxPrice) {
        query.rentalPrice = {};

        if (minPrice) {
            query.rentalPrice.$gte = Number(minPrice);
        }

        if (maxPrice) {
            query.rentalPrice.$lte = Number(maxPrice);
        }
    }

    const sort = {};

    if (req.query.sort === "price-low") {
        sort.rentalPrice = 1;
    } else if (req.query.sort === "price-high") {
        sort.rentalPrice = -1;
    }

    const result = await equipmentCollection
        .find(query)
        .sort(sort)
        .toArray();

    res.send(result);
});

// Update equipment
router.patch("/:id", verifyToken, verifyOwner, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    const allowedFields = [
        "name", "description", "category", "location",
        "rentalPrice", "rentalType", "availableQuantity",
        "condition", "brand", "model", "imageUrl", "rentalTerms"
    ];

    const data = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            data[field] = req.body[field];
        }
    }

    if (Object.keys(data).length === 0) {
        return res.status(400).send({ message: "No information provided to update." });
    }

    data.updatedAt = new Date();

    const result = await equipmentCollection.updateOne(
        {
            _id: new ObjectId(id),
            ownerId: req.user.id
        },
        { $set: data }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({
            message: "Equipment not found or you are not the owner."
        });
    }

    res.send({ message: "Equipment updated successfully." });
});

// Delete equipment
router.delete("/:id", verifyToken, verifyOwner, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    const result = await equipmentCollection.deleteOne({
        _id: new ObjectId(id),
        ownerId: req.user.id
    });

    if (result.deletedCount === 0) {
        return res.status(404).send({
            message: "Equipment not found or you are not the owner."
        });
    }

    res.send({ message: "Equipment deleted successfully." });
});

// Get all approved equipment
router.get("/", async (req, res) => {
    const result = await equipmentCollection
        .find({ status: "Approved" })
        .toArray();

    res.send(result);
});

export default router;