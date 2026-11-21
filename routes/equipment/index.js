import { Router } from "express";
import { ObjectId } from "mongodb";
import { equipmentCollection, usersCollection } from "../../config/db.js";
import verifyToken, { verifyOwner, verifyAdmin } from "../../middlewares/verifyApi.js";

const router = Router();

const allowedFields = [
    "name",
    "description",
    "category",
    "location",
    "rentalPrice",
    "rentalType",
    "availableQuantity",
    "condition",
    "brand",
    "model",
    "imageUrl",
    "rentalTerms"
];

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

// Get 6 featured approved equipment
router.get("/featured", async (req, res) => {
    const result = await equipmentCollection
        .find({ status: "Approved" })
        .limit(6)
        .toArray();

    res.send(result);
});

// Get owner's equipment
router.get("/my-equipment", verifyToken, verifyOwner, async (req, res) => {
    const result = await equipmentCollection.find({
        ownerId: req.user.id
    }).toArray();

    res.send(result);
});

// Get all equipment for admin
router.get("/admin/all", verifyToken, verifyAdmin, async (req, res) => {
    const result = await equipmentCollection.find({}).toArray();

    const equipmentWithOwners = await Promise.all(
        result.map(async (item) => {
            const owner = await usersCollection.findOne({
                email: item.ownerEmail
            });

            return {
                ...item,
                ownerName: owner?.name || "Equipment Owner"
            };
        })
    );

    res.send(equipmentWithOwners);
});

// Update equipment status by admin
router.patch("/admin/:id/status", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    if (!["Approved", "Rejected"].includes(status)) {
        return res.status(400).send({ message: "Invalid status." });
    }

    const updateData = {
        status,
        updatedAt: new Date()
    };

    if (status === "Rejected" && rejectionReason) {
        updateData.rejectionReason = rejectionReason;
    }

    const updateOperation = {
        $set: updateData
    };

    if (status === "Approved") {
        updateOperation.$unset = {
            rejectionReason: ""
        };
    }

    const result = await equipmentCollection.updateOne(
        { _id: new ObjectId(id) },
        updateOperation
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Equipment not found." });
    }

    res.send({ message: "Equipment status updated successfully." });
});

// Update equipment by admin
router.patch("/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    const allowedFields = [
        "name",
        "description",
        "category",
        "location",
        "rentalPrice",
        "rentalType",
        "availableQuantity",
        "condition",
        "brand",
        "model",
        "rentalTerms"
    ];

    const data = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            data[field] = req.body[field];
        }
    }

    if (Object.keys(data).length === 0) {
        return res.status(400).send({
            message: "No information provided to update."
        });
    }

    data.updatedAt = new Date();

    const result = await equipmentCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: data }
    );

    if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Equipment not found." });
    }

    res.send({ message: "Equipment updated successfully." });
});


// Delete equipment by admin
router.delete("/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    const result = await equipmentCollection.deleteOne({
        _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Equipment not found." });
    }

    res.send({ message: "Equipment deleted successfully." });
});

// Get single equipment
router.get("/:id", verifyToken, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID" });
    }

    const query = {
        _id: new ObjectId(id)
    };

    if (req.user.role === "Customer") {
        query.status = "Approved";
    }
    else if (req.user.role === "Owner") {
        query.ownerId = req.user.id;
    }
    else if (req.user.role !== "Admin") {
        return res.status(403).send({ message: "Forbidden!" });
    }

    const result = await equipmentCollection.findOne(query);

    if (!result) {
        return res.status(404).send({ message: "Equipment not found" });
    }

    res.send(result);
});

// Get approved equipment with search and filters
router.get("/", async (req, res) => {
    const {
        search,
        category,
        rentalType,
        availability,
        minPrice,
        maxPrice
    } = req.query;

    const query = { status: "Approved" };

    if (search) {
        query.$or = [
            { name: { $regex: search, $options: "i" } },
            { category: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } }
        ];
    }

    if (category) query.category = category;
    if (rentalType) query.rentalType = rentalType;

    if (availability === "available") {
        query.availableQuantity = { $gt: 0 };
    } else if (availability === "unavailable") {
        query.availableQuantity = { $lte: 0 };
    }

    if (minPrice || maxPrice) {
        query.rentalPrice = {};

        if (minPrice) query.rentalPrice.$gte = Number(minPrice);
        if (maxPrice) query.rentalPrice.$lte = Number(maxPrice);
    }

    const sort = {};

    if (req.query.sort === "price-low") sort.rentalPrice = 1;
    else if (req.query.sort === "price-high") sort.rentalPrice = -1;
    else if (req.query.sort === "recently-added") sort.createdAt = -1;

    const result = await equipmentCollection.find(query).sort(sort).toArray();

    res.send(result);
});

// Update equipment by owner
router.patch("/:id", verifyToken, verifyOwner, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid equipment ID." });
    }

    const data = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            data[field] = req.body[field];
        }
    }

    if (Object.keys(data).length === 0) {
        return res.status(400).send({
            message: "No information provided to update."
        });
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

// Delete equipment by owner
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

export default router;