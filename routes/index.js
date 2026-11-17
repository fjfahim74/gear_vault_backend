import { Router } from "express";
import equipmentRouter from "./equipment/index.js";
import verifyApi from "../middlewares/verifyApi.js";

const router = Router();

// API test route
router.get("/test", (req, res) => {
    res.send({
        message: "GearVault API is running!"
    });
});

router.get("/check-user", verifyApi, (req, res) => {
    console.log(req.user);

    res.send({
        message: "User authenticated!",
        user: req.user
    });
});

router.use("/equipment", equipmentRouter);

export default router;