import express from 'express';
import authRoutes from "./auth";

const router = express.Router();

router.use("/api/v1", authRoutes);
//router.use("/api/v1/admins", adminRoutes);

export default router;