import { Router } from "express";
import {
    usersCollection,
    equipmentCollection,
    bookingsCollection,
    paymentsCollection
} from "../../config/db.js";
import verifyToken, { verifyAdmin } from "../../middlewares/verifyApi.js";

const router = Router();

router.get("/admin", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const now = new Date();

        const startDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() - 11,
            1
        ));

        const endDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            1
        ));

        // Total statistics
        const [
            totalUsers,
            totalEquipment,
            totalBookings,
            pendingApprovals,
            completedRentals
        ] = await Promise.all([
            usersCollection.countDocuments(),
            equipmentCollection.countDocuments(),
            bookingsCollection.countDocuments(),
            equipmentCollection.countDocuments({ status: "Pending" }),
            bookingsCollection.countDocuments({ bookingStatus: "Completed" })
        ]);

        // Monthly bookings
        const monthlyBookings = await bookingsCollection.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m",
                            date: "$createdAt",
                            timezone: "UTC"
                        }
                    },
                    bookings: { $sum: 1 }
                }
            }
        ]).toArray();

        // Unique verified payments
        const payments = await paymentsCollection.aggregate([
            {
                $match: {
                    status: "Paid",
                    stripeSessionId: { $exists: true, $ne: "" }
                }
            },
            {
                $group: {
                    _id: "$stripeSessionId",
                    amount: { $first: "$amount" },
                    paidAt: { $first: "$paidAt" }
                }
            }
        ]).toArray();

        const totalRevenue = payments.reduce(
            (total, payment) => total + (Number(payment.amount) || 0),
            0
        );

        // Equipment status
        const equipmentByStatus = await equipmentCollection.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        // Prepare 12 months
        const monthlyStats = [];

        for (let i = 0; i < 12; i++) {
            const date = new Date(Date.UTC(
                startDate.getUTCFullYear(),
                startDate.getUTCMonth() + i,
                1
            ));

            const key = `${date.getUTCFullYear()}-${String(
                date.getUTCMonth() + 1
            ).padStart(2, "0")}`;

            monthlyStats.push({
                key,
                month: date.toLocaleString("en-US", {
                    month: "short",
                    timeZone: "UTC"
                }),
                year: date.getUTCFullYear(),
                bookings: 0,
                revenue: 0
            });
        }

        const monthMap = new Map(
            monthlyStats.map(item => [item.key, item])
        );

        monthlyBookings.forEach(item => {
            const month = monthMap.get(item._id);
            if (month) month.bookings = item.bookings;
        });

        payments.forEach(payment => {
            const date = new Date(payment.paidAt);

            if (isNaN(date.getTime())) return;

            const key = `${date.getUTCFullYear()}-${String(
                date.getUTCMonth() + 1
            ).padStart(2, "0")}`;

            const month = monthMap.get(key);

            if (month) {
                month.revenue += Number(payment.amount) || 0;
            }
        });

        // Recent pending approvals
        const pendingEquipment = await equipmentCollection
            .find({ status: "Pending" })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();

        const ownerEmails = [
            ...new Set(pendingEquipment.map(item => item.ownerEmail))
        ].filter(Boolean);

        const owners = await usersCollection.find({
            email: { $in: ownerEmails }
        }).project({
            name: 1,
            email: 1
        }).toArray();

        const ownerMap = new Map(
            owners.map(owner => [owner.email, owner.name])
        );

        const recentPendingApprovals = pendingEquipment.map(item => ({
            ...item,
            ownerName: ownerMap.get(item.ownerEmail) || "Equipment Owner"
        }));

        res.send({
            totalUsers,
            totalEquipment,
            totalBookings,
            pendingApprovals,
            completedRentals,
            totalRevenue,
            currency: (process.env.STRIPE_CURRENCY || "usd").toLowerCase(),
            monthlyStats: monthlyStats.map(({ key, ...item }) => item),
            equipmentByStatus: equipmentByStatus.map(item => ({
                status: item._id || "Unknown",
                count: item.count
            })),
            recentPendingApprovals
        });

    } catch (error) {
        console.error("Admin analytics error:", error);

        res.status(500).send({
            message: "Failed to load Admin analytics."
        });
    }
});

export default router;