import { Router } from "express";
import equipmentRouter from "./equipment/index.js";
import usersRouter from "./users/index.js";

const router = Router();

// API test route
router.get("/test", (req, res) => {
    res.send({
        message: "GearVault API is running!"
    });
});

router.use("/equipment", equipmentRouter);
router.use("/users", usersRouter);

export default router;