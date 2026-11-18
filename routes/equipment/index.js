import { Router } from "express";
import { equipmentCollection } from "../../config/db.js";
import verifyToken, { verifyOwner } from "../../middlewares/verifyApi.js";

const router = Router();

// Create new equipment
router.post("/", verifyToken, verifyOwner, async (req, res) => {
    const {
        name,
        description,
        category,
        location,
        rentalPrice,
        rentalType,
        availableQuantity,
        condition,
        brand,
        model,
        imageUrl,
        rentalTerms
    } = req.body || {};

    const requiredFields = [
        name,
        description,
        category,
        location,
        condition,
        brand,
        model,
        imageUrl,
        rentalTerms
    ];

    if (requiredFields.some(field => typeof field !== "string" || !field.trim())) {
        return res.status(400).send({
            message: "Please provide all required equipment information."
        });
    }

    const allowedCategories = [
        "Construction Equipment",
        "Photography Equipment",
        "Vehicles & Transportation",
        "Agriculture Equipment",
        "Electronics",
        "Event Equipment"
    ];

    if (!allowedCategories.includes(category)) {
        return res.status(400).send({
            message: "Invalid equipment category."
        });
    }

    if (!["Daily", "Weekly", "Monthly"].includes(rentalType)) {
        return res.status(400).send({
            message: "Invalid rental type."
        });
    }

    if (!Number.isFinite(rentalPrice) || rentalPrice <= 0) {
        return res.status(400).send({
            message: "Rental price must be greater than zero."
        });
    }

    if (!Number.isInteger(availableQuantity) || availableQuantity < 1) {
        return res.status(400).send({
            message: "Available quantity must be at least 1."
        });
    }

    const equipment = {
        name: name.trim(),
        description: description.trim(),
        category,
        location: location.trim(),
        rentalPrice,
        rentalType,
        availableQuantity,
        condition,
        brand: brand.trim(),
        model: model.trim(),
        imageUrl: imageUrl.trim(),
        rentalTerms: rentalTerms.trim(),

        ownerId: req.user.id,
        ownerEmail: req.user.email,

        status: "Pending",
        createdAt: new Date(),
        updatedAt: new Date()
    };

    try {
        const result = await equipmentCollection.insertOne(equipment);

        res.status(201).send({
            message: "Equipment added successfully. Waiting for admin approval.",
            insertedId: result.insertedId
        });
    } catch (error) {
        res.status(500).send({
            message: "Failed to add equipment.",
            error: error.message
        });
    }
});

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