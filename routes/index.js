import { Router } from "express";
import equipmentRouter from "./equipment/index.js";
import verifyToken, { verifyRenter, verifyOwner } from "../middlewares/verifyApi.js";
import { verifyAdmin } from "../middlewares/verifyApi.js";

const router = Router();

// API test route
router.get("/test", (req, res) => {
    res.send({
        message: "GearVault API is running!"
    });
});

router.get("/check-user", verifyToken, verifyAdmin, (req, res) => {
    res.send({
        message: "Admin access granted!",
        user: req.user
    });
});

router.use("/equipment", equipmentRouter);

export default router;