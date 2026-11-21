import { Router } from "express";
import equipmentRouter from "./equipment/index.js";
import usersRouter from "./users/index.js";
import favoritesRouter from "./favorites/index.js";
import bookingsRouter from "./bookings/index.js";
import analyticsRouter from "./analytics/index.js";

const router = Router();

// API test route
router.get("/test", (req, res) => {
    res.send({
        message: "GearVault API is running!"
    });
});

router.use("/equipment", equipmentRouter);
router.use("/users", usersRouter);
router.use("/favorites", favoritesRouter);
router.use("/bookings", bookingsRouter);
router.use("/analytics", analyticsRouter);

export default router;