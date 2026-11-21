import { Router } from "express";
import {
    usersCollection,
    equipmentCollection,
    bookingsCollection,
    paymentsCollection
} from "../../config/db.js";
import verifyToken, { verifyAdmin, verifyOwner } from "../../middlewares/verifyApi.js";
import { ObjectId } from "mongodb";

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

// Get Owner Dashboard Analytics
router.get("/owner", verifyToken, verifyOwner, async (req, res) => {
    try {
        const ownerId = req.user.id;

        const [equipment, bookings] = await Promise.all([
            equipmentCollection.find({ ownerId }).toArray(),
            bookingsCollection
                .find({ ownerId })
                .sort({ createdAt: -1 })
                .toArray()
        ]);

        // Get paid payments belonging to this owner's bookings
        const bookingIds = bookings.map(booking => booking._id);

        const payments = await paymentsCollection.find({
            bookingId: { $in: bookingIds },
            status: "Paid"
        }).toArray();

        const paymentMap = new Map(
            payments.map(payment => [
                payment.bookingId.toString(),
                payment
            ])
        );

        // Total earnings
        const totalEarnings = payments.reduce(
            (total, payment) => total + Number(payment.amount || 0),
            0
        );

        // Completed rentals
        const completedRentals = bookings.filter(
            booking => booking.bookingStatus === "Completed"
        ).length;

        // Last 12 months
        const monthlyEarnings = [];

        for (let i = 11; i >= 0; i--) {
            const date = new Date();
            date.setUTCDate(1);
            date.setUTCHours(0, 0, 0, 0);
            date.setUTCMonth(date.getUTCMonth() - i);

            monthlyEarnings.push({
                month: date.toLocaleString("en-US", {
                    month: "short",
                    timeZone: "UTC"
                }),
                year: date.getUTCFullYear(),
                key: `${date.getUTCFullYear()}-${date.getUTCMonth()}`,
                earnings: 0
            });
        }

        payments.forEach(payment => {
            if (!payment.paidAt) return;

            const date = new Date(payment.paidAt);
            const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;

            const month = monthlyEarnings.find(item => item.key === key);

            if (month) {
                month.earnings += Number(payment.amount || 0);
            }
        });

        // Equipment listings by status
        const statusCounts = {};

        equipment.forEach(item => {
            const status = item.status || "Other";

            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        const listingsByStatus = Object.entries(statusCounts).map(
            ([status, count]) => ({ status, count })
        );

        // Top earning equipment
        const equipmentEarnings = {};

        bookings.forEach(booking => {
            const payment = paymentMap.get(booking._id.toString());

            if (!payment) return;

            const id = booking.equipmentId;

            if (!equipmentEarnings[id]) {
                equipmentEarnings[id] = {
                    name: booking.equipmentName,
                    earnings: 0
                };
            }

            equipmentEarnings[id].earnings += Number(payment.amount || 0);
        });

        const topEquipment = Object.values(equipmentEarnings)
            .sort((a, b) => b.earnings - a.earnings)
            .slice(0, 5);

        // Recent rental requests
        const recentBookings = bookings.slice(0, 5);

        const customerIds = [
            ...new Set(recentBookings.map(booking => booking.customerId))
        ];

        const customers = await usersCollection.find({
            _id: {
                $in: customerIds
                    .filter(id => ObjectId.isValid(id))
                    .map(id => new ObjectId(id))
            }
        }).toArray();

        const customerMap = new Map(
            customers.map(customer => [
                customer._id.toString(),
                customer.name
            ])
        );

        const recentRequests = recentBookings.map(booking => ({
            _id: booking._id,
            customerName:
                customerMap.get(booking.customerId) ||
                booking.customerEmail ||
                "Customer",
            equipmentName: booking.equipmentName,
            totalAmount: booking.totalAmount,
            bookingStatus: booking.bookingStatus,
            createdAt: booking.createdAt
        }));

        res.send({
            totalEquipment: equipment.length,
            completedRentals,
            totalEarnings,
            thisMonthEarnings:
                monthlyEarnings[monthlyEarnings.length - 1].earnings,
            currency: payments[0]?.currency || process.env.STRIPE_CURRENCY || "usd",
            monthlyEarnings,
            listingsByStatus,
            topEquipment,
            recentRequests
        });

    } catch (error) {
        console.error("Owner analytics error:", error);

        res.status(500).send({
            message: "Failed to load owner analytics."
        });
    }
});

export default router;