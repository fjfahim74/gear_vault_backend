import { Router } from "express";
import { ObjectId } from "mongodb";
import {
    equipmentCollection,
    bookingsCollection,
    bookingHoldsCollection,
    usersCollection,
    paymentsCollection
} from "../../config/db.js";
import verifyToken, { verifyRenter, verifyOwner, verifyAdmin } from "../../middlewares/verifyApi.js";
import { stripe } from "../../config/stripe.js";
import processCheckoutSession from "../../utils/processCheckoutSession.js";
import sendBookingCompletedEmails from "../../utils/sendBookingCompletedEmails.js";

const router = Router();

// Get all rental records for Admin
router.get("/admin/all", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const bookings = await bookingsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        const userIds = [
            ...new Set(bookings.flatMap(booking => [
                booking.customerId,
                booking.ownerId
            ]))
        ].filter(id => ObjectId.isValid(id));

        const users = await usersCollection.find({
            _id: { $in: userIds.map(id => new ObjectId(id)) }
        }).toArray();

        const userMap = new Map(
            users.map(user => [user._id.toString(), user])
        );

        const sessionIds = bookings
            .map(booking => booking.stripeSessionId)
            .filter(Boolean);

        const payments = await paymentsCollection.find({
            stripeSessionId: { $in: sessionIds }
        }).toArray();

        const paymentMap = new Map(
            payments.map(payment => [payment.stripeSessionId, payment])
        );

        const result = bookings.map(booking => {
            const customer = userMap.get(booking.customerId);
            const owner = userMap.get(booking.ownerId);
            const payment = paymentMap.get(booking.stripeSessionId);

            return {
                ...booking,
                customerName: customer?.name || booking.customerEmail || "Unknown customer",
                customerEmail: booking.customerEmail || customer?.email || "",
                ownerName: owner?.name || booking.ownerEmail || "Unknown owner",
                ownerEmail: booking.ownerEmail || owner?.email || "",
                paymentStatus: payment?.status || booking.paymentStatus || "Unknown",
                currency: payment?.currency || process.env.STRIPE_CURRENCY || "usd"
            };
        });

        res.send(result);

    } catch (error) {
        console.error("Admin rentals fetch error:", error);
        res.status(500).send({
            message: "Failed to load rental records."
        });
    }
});

// Update a rental booking status (Admin only)
router.patch("/admin/:id/status", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { bookingStatus } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).send({
            message: "Invalid rental record."
        });
    }

    if (!["Confirmed", "Completed", "Cancelled"].includes(bookingStatus)) {
        return res.status(400).send({
            message: "Invalid booking status."
        });
    }

    try {
        const existingBooking = await bookingsCollection.findOne({
            _id: new ObjectId(id)
        });

        if (!existingBooking) {
            return res.status(404).send({
                message: "Confirmed rental not found. It may already be managed."
            });
        }

        const result = await bookingsCollection.updateOne(
            {
                _id: new ObjectId(id)
            },
            {
                $set: {
                    bookingStatus,
                    updatedAt: new Date()
                }
            }
        );

        if (!result.matchedCount) {
            return res.status(404).send({
                message: "Rental record not found."
            });
        }

        // Send emails only when the booking becomes completed
        if (
            bookingStatus === "Completed" &&
            existingBooking.bookingStatus !== "Completed"
        ) {
            sendBookingCompletedEmails(existingBooking);
        }

        res.send({
            success: true,
            message: `Rental marked as ${bookingStatus.toLowerCase()}.`
        });

    } catch (error) {
        console.error("Admin rental update error:", error);

        res.status(500).send({
            message: "Failed to update rental status."
        });
    }
});

// Get customer's rentals
router.get("/my-rentals", verifyToken, verifyRenter, async (req, res) => {
    const bookings = await bookingsCollection.find({
        customerId: req.user.id
    }).sort({ createdAt: -1 }).toArray();

    const payments = await paymentsCollection.find({
        customerId: req.user.id
    }).toArray();

    const paymentMap = new Map(
        payments.map(payment => [
            payment.stripeSessionId,
            payment.currency
        ])
    );

    const result = bookings.map(booking => ({
        ...booking,
        currency: paymentMap.get(booking.stripeSessionId) || "usd"
    }));

    res.send(result);
});

// Get owner's equipment rentals
router.get("/owner-rentals", verifyToken, verifyOwner, async (req, res) => {
    const bookings = await bookingsCollection.find({
        ownerId: req.user.id
    }).sort({ createdAt: -1 }).toArray();

    const payments = await paymentsCollection.find({
        customerId: { $in: [...new Set(bookings.map(booking => booking.customerId))] }
    }).toArray();

    const paymentMap = new Map(
        payments.map(payment => [
            payment.stripeSessionId,
            payment.currency
        ])
    );

    const customerIds = [
        ...new Set(bookings.map(booking => booking.customerId))
    ];

    const users = await usersCollection.find({
        _id: { $in: customerIds.filter(ObjectId.isValid).map(id => new ObjectId(id)) }
    }).toArray();

    const userMap = new Map(
        users.map(user => [user._id.toString(), user.name])
    );

    const result = bookings.map(booking => ({
        ...booking,
        customerName: userMap.get(booking.customerId) || booking.customerEmail,
        currency: paymentMap.get(booking.stripeSessionId) || "usd"
    }));

    res.send(result);
});

// Check Equipment Availability
router.get("/availability", verifyToken, verifyRenter, async (req, res) => {
    const { equipmentId, startDate, endDate, quantity } = req.query;

    if (
        !ObjectId.isValid(equipmentId) ||
        !startDate ||
        !endDate ||
        !quantity
    ) {
        return res.status(400).send({
            message: "Please provide all required information."
        });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const requestedQuantity = Number(quantity);

    if (
        isNaN(start.getTime()) ||
        isNaN(end.getTime()) ||
        end < start ||
        !Number.isInteger(requestedQuantity) ||
        requestedQuantity < 1
    ) {
        return res.status(400).send({
            message: "Invalid booking information."
        });
    }

    const equipment = await equipmentCollection.findOne({
        _id: new ObjectId(equipmentId),
        status: "Approved"
    });

    if (!equipment) {
        return res.status(404).send({
            message: "Equipment not found or unavailable."
        });
    }

    const bookings = await bookingsCollection.find({
        equipmentId,
        bookingStatus: "Confirmed",
        rentalStartDate: { $lte: end },
        rentalEndDate: { $gte: start }
    }).toArray();

    const holds = await bookingHoldsCollection.find({
        equipmentId,
        expiresAt: { $gt: new Date() },
        rentalStartDate: { $lte: end },
        rentalEndDate: { $gte: start }
    }).toArray();

    let availableQuantity = equipment.availableQuantity;

    for (
        let date = new Date(start);
        date <= end;
        date.setUTCDate(date.getUTCDate() + 1)
    ) {
        const bookedQuantity = bookings
            .filter(booking =>
                booking.rentalStartDate <= date &&
                booking.rentalEndDate >= date
            )
            .reduce((total, booking) => total + booking.quantity, 0);

        const heldQuantity = holds
            .filter(hold =>
                hold.rentalStartDate <= date &&
                hold.rentalEndDate >= date
            )
            .reduce((total, hold) => total + hold.quantity, 0);

        availableQuantity = Math.min(
            availableQuantity,
            equipment.availableQuantity - bookedQuantity - heldQuantity
        );
    }

    availableQuantity = Math.max(0, availableQuantity);

    const isAvailable = availableQuantity >= requestedQuantity;

    res.send({
        isAvailable,
        availableQuantity,
        requestedQuantity,
        message: isAvailable
            ? `${availableQuantity} units available for these dates.`
            : `Only ${availableQuantity} units available for these dates.`
    });
});

// Create Stripe Checkout Session
router.post("/create-checkout-session", verifyToken, verifyRenter, async (req, res) => {
    const data = req.body;

    // Check required information
    if (
        !ObjectId.isValid(data.equipmentId) ||
        !data.startDate ||
        !data.endDate ||
        !data.quantity ||
        !data.contactNumber ||
        !data.deliveryAddress
    ) {
        return res.status(400).send({
            message: "Please provide all required information."
        });
    }

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const quantity = Number(data.quantity);

    if (
        isNaN(start.getTime()) ||
        isNaN(end.getTime()) ||
        end < start ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        start < new Date(new Date().toISOString().split("T")[0]) ||
        !/^\+?[0-9\s-]{7,20}$/.test(data.contactNumber.trim()) ||
        data.additionalNotes?.length > 300
    ) {
        return res.status(400).send({
            message: "Invalid booking information."
        });
    }

    // Find equipment
    const equipment = await equipmentCollection.findOne({
        _id: new ObjectId(data.equipmentId),
        status: "Approved"
    });

    if (!equipment) {
        return res.status(404).send({
            message: "Equipment not found."
        });
    }

    // Calculate rental duration
    const days = Math.round(
        (end.getTime() - start.getTime()) / 86400000
    ) + 1;

    let durationUnits = days;

    if (equipment.rentalType === "Weekly") {
        durationUnits = Math.ceil(days / 7);
    }

    if (equipment.rentalType === "Monthly") {
        durationUnits = Math.ceil(days / 30);
    }

    // Calculate total amount
    const totalAmount =
        Number(equipment.rentalPrice) * durationUnits * quantity;

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return res.status(400).send({
            message: "Invalid rental price."
        });
    }

    // Check current availability
    const bookings = await bookingsCollection.find({
        equipmentId: data.equipmentId,
        bookingStatus: "Confirmed",
        rentalStartDate: { $lte: end },
        rentalEndDate: { $gte: start }
    }).toArray();

    const holds = await bookingHoldsCollection.find({
        equipmentId: data.equipmentId,
        expiresAt: { $gt: new Date() },
        rentalStartDate: { $lte: end },
        rentalEndDate: { $gte: start }
    }).toArray();

    let availableQuantity = Number(equipment.availableQuantity);

    for (
        let date = new Date(start);
        date <= end;
        date.setUTCDate(date.getUTCDate() + 1)
    ) {
        const bookedQuantity = bookings
            .filter(booking =>
                booking.rentalStartDate <= date &&
                booking.rentalEndDate >= date
            )
            .reduce((total, booking) => total + booking.quantity, 0);

        const heldQuantity = holds
            .filter(hold =>
                hold.rentalStartDate <= date &&
                hold.rentalEndDate >= date
            )
            .reduce((total, hold) => total + hold.quantity, 0);

        availableQuantity = Math.min(
            availableQuantity,
            equipment.availableQuantity - bookedQuantity - heldQuantity
        );
    }

    if (availableQuantity < quantity) {
        return res.status(409).send({
            message: `Only ${Math.max(0, availableQuantity)} units are available.`
        });
    }

    // Create temporary booking hold
    const hold = {
        customerId: req.user.id,
        customerEmail: req.user.email,
        equipmentId: data.equipmentId,
        equipmentName: equipment.name,
        equipmentImage: equipment.imageUrl,
        ownerId: equipment.ownerId,
        rentalStartDate: start,
        rentalEndDate: end,
        rentalType: equipment.rentalType,
        unitPrice: equipment.rentalPrice,
        quantity,
        durationUnits,
        totalAmount,
        contactNumber: data.contactNumber.trim(),
        deliveryAddress: data.deliveryAddress.trim(),
        additionalNotes: data.additionalNotes || "",
        expiresAt: new Date(Date.now() + 35 * 60 * 1000),
        createdAt: new Date()
    };

    const holdResult = await bookingHoldsCollection.insertOne(hold);

    try {
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: "payment",

            line_items: [
                {
                    price_data: {
                        currency: process.env.STRIPE_CURRENCY || "usd",
                        product_data: {
                            name: equipment.name
                        },
                        unit_amount: Math.round(totalAmount * 100)
                    },
                    quantity: 1
                }
            ],

            customer_email: req.user.email,

            success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

            cancel_url: `${process.env.CLIENT_URL}/payment/cancel?hold_id=${holdResult.insertedId}`,

            expires_at: Math.floor(hold.expiresAt.getTime() / 1000),

            metadata: {
                holdId: holdResult.insertedId.toString(),
                customerId: req.user.id,
                equipmentId: data.equipmentId
            }
        });

        // Save Stripe session ID
        await bookingHoldsCollection.updateOne(
            { _id: holdResult.insertedId },
            {
                $set: {
                    stripeSessionId: session.id
                }
            }
        );

        res.send({
            success: true,
            message: "Checkout session created successfully.",
            data: {
                redirectUrl: session.url
            }
        });

    } catch (error) {
        // Remove temporary hold if Stripe fails
        await bookingHoldsCollection.deleteOne({
            _id: holdResult.insertedId
        });

        console.error("Stripe Checkout Error:", error);

        res.status(500).send({
            message: "Unable to create checkout session."
        });
    }
});

// Cancel Stripe Checkout and Release Booking Hold
router.post("/cancel-checkout", verifyToken, verifyRenter, async (req, res) => {
    const { holdId } = req.body;

    if (!ObjectId.isValid(holdId)) {
        return res.status(400).send({
            message: "Invalid booking information."
        });
    }

    try {
        // Find customer's booking hold
        const hold = await bookingHoldsCollection.findOne({
            _id: new ObjectId(holdId),
            customerId: req.user.id
        });

        if (!hold) {
            return res.send({
                success: true,
                message: "Booking hold already released."
            });
        }

        if (!hold.stripeSessionId) {
            return res.status(400).send({
                message: "Stripe session not found."
            });
        }

        // Retrieve Stripe Checkout Session
        let session = await stripe.checkout.sessions.retrieve(
            hold.stripeSessionId
        );

        // Expire the session if it is still open
        if (session.status === "open") {
            try {
                session = await stripe.checkout.sessions.expire(
                    hold.stripeSessionId
                );
            } catch (error) {
                // Check the latest status if expiration fails
                session = await stripe.checkout.sessions.retrieve(
                    hold.stripeSessionId
                );
            }
        }

        // Release hold only after Stripe confirms expiration
        if (session.status === "expired") {
            await bookingHoldsCollection.deleteOne({
                _id: hold._id
            });

            return res.send({
                success: true,
                message: "Checkout cancelled and booking hold released."
            });
        }

        // Payment may already have completed
        if (session.status === "complete") {
            return res.send({
                success: true,
                paymentCompleted: session.payment_status === "paid",
                sessionId: session.id,
                message: "Checkout has already been completed."
            });
        }

        return res.status(409).send({
            message: "Unable to cancel this checkout session."
        });

    } catch (error) {
        console.error("Checkout cancellation error:", error);

        res.status(500).send({
            message: "Unable to cancel checkout."
        });
    }
});

// Verify Checkout Payment
router.post("/checkout-verify", verifyToken, verifyRenter, async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).send({
            message: "Session ID is required."
        });
    }

    try {
        // Retrieve payment session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Check customer ownership
        if (session.metadata?.customerId !== req.user.id) {
            return res.status(403).send({
                message: "Unauthorized payment session."
            });
        }

        // Process payment and confirm booking
        const result = await processCheckoutSession(session);

        const { booking, payment, alreadyProcessed } = result;

        res.send({
            success: true,
            message: alreadyProcessed
                ? "Payment already verified."
                : "Payment successful. Booking confirmed.",
            booking: {
                _id: booking._id,
                equipmentName: booking.equipmentName,
                equipmentImage: booking.equipmentImage,
                rentalStartDate: booking.rentalStartDate,
                rentalEndDate: booking.rentalEndDate,
                quantity: booking.quantity,
                totalAmount: booking.totalAmount
            },
            payment: {
                paymentIntentId: payment.paymentIntentId,
                amount: payment.amount,
                currency: payment.currency
            }
        });

    } catch (error) {
        console.error("Payment verification error:", error);

        res.status(500).send({
            message: "Something went wrong while verifying payment."
        });
    }
});

export default router;