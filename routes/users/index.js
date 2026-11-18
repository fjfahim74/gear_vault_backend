import { Router } from "express";
import { ObjectId } from "mongodb";
import { usersCollection } from "../../config/db.js";
import verifyToken, { verifyAdmin } from "../../middlewares/verifyApi.js";

const router = Router();

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
            message: "Failed to update user role",
            error: error.message
        });
    }
});

export default router;