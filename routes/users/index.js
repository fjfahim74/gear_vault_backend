import { Router } from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../../config/db.js";
import verifyToken, { verifyAdmin } from "../../middlewares/verifyApi.js";

const router = Router();

// Get all users (Admin only)
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const users = await usersCollection
            .find(
                {},
                {
                    projection: {
                        name: 1,
                        email: 1,
                        image: 1,
                        role: 1,
                        createdAt: 1
                    }
                }
            )
            .sort({ createdAt: -1 })
            .toArray();

        res.send(users);
    } catch (error) {
        res.status(500).send({
            message: "Failed to load users"
        });
    }
});

// Change user role (Admin only)
router.patch("/:id/role", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    const allowedRoles = ["Customer", "Owner", "Admin"];

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            message: "Invalid user ID"
        });
    }

    if (!allowedRoles.includes(role)) {
        return res.status(400).send({
            message: "Invalid role"
        });
    }

    if (id === req.user.id) {
        return res.status(400).send({
            message: "You cannot change your own role"
        });
    }

    try {
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    role,
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({
                message: "User not found"
            });
        }

        res.send({
            message: "User role updated successfully"
        });
    } catch (error) {
        res.status(500).send({
            message: "Failed to update user role"
        });
    }
});

// Delete user (Admin only)
router.delete("/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            message: "Invalid user ID"
        });
    }

    if (id === req.user.id) {
        return res.status(400).send({
            message: "You cannot delete your own account"
        });
    }

    try {
        const result = await usersCollection.deleteOne({
            _id: new ObjectId(id)
        });

        if (result.deletedCount === 0) {
            return res.status(404).send({
                message: "User not found"
            });
        }

        res.send({
            message: "User deleted successfully"
        });
    } catch (error) {
        res.status(500).send({
            message: "Failed to delete user"
        });
    }
});

// Get logged-in user's profile
router.get("/profile", verifyToken, async (req, res) => {
    try {
        const user = await usersCollection.findOne(
            { _id: new ObjectId(req.user.id) },
            {
                projection: {
                    name: 1,
                    email: 1,
                    image: 1,
                    phoneNumber: 1,
                    address: 1,
                    role: 1,
                    createdAt: 1
                }
            }
        );

        if (!user) {
            return res.status(404).send({
                message: "User not found"
            });
        }

        res.send(user);
    } catch (error) {
        res.status(500).send({
            message: "Failed to load profile"
        });
    }
});

// Update logged-in user's profile
router.patch("/profile", verifyToken, async (req, res) => {
    const { name, image, phoneNumber, address } = req.body;

    if (!name?.trim()) {
        return res.status(400).send({
            message: "Name is required"
        });
    }

    try {
        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.id) },
            {
                $set: {
                    name: name.trim(),
                    image: image || "",
                    phoneNumber: phoneNumber?.trim() || "",
                    address: address?.trim() || "",
                    updatedAt: new Date()
                }
            }
        );

        res.send({
            message: "Profile updated successfully"
        });
    } catch (error) {
        res.status(500).send({
            message: "Failed to update profile"
        });
    }
});

export default router;