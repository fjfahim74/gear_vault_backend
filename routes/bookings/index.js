import { Router } from "express";
import { ObjectId } from "mongodb";
import {
    equipmentCollection,
    bookingsCollection,
    bookingHoldsCollection,
    paymentsCollection
} from "../../config/db.js";
import verifyToken, { verifyRenter } from "../../middlewares/verifyApi.js";
import { stripe } from "../../config/stripe.js";

const router = Router();

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

            cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,

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

// Verify Checkout Payment
router.post("/checkout-verify", verifyToken, verifyRenter, async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).send({
            message: "Session ID is required."
        });
    }

    try {
        // Get payment session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.status !== "complete" || session.payment_status !== "paid") {
            return res.status(400).send({
                message: "Payment verification failed."
            });
        }

        // Check customer
        if (session.metadata.customerId !== req.user.id) {
            return res.status(403).send({
                message: "Unauthorized payment session."
            });
        }

        // Check if payment was already processed
        const existingBooking = await bookingsCollection.findOne({
            stripeSessionId: sessionId
        });

        const existingPayment = await paymentsCollection.findOne({
            stripeSessionId: sessionId
        });

        if (existingBooking && existingPayment) {
            return res.send({
                success: true,
                message: "Payment already verified.",
                booking: {
                    _id: existingBooking._id,
                    equipmentName: existingBooking.equipmentName,
                    equipmentImage: existingBooking.equipmentImage,
                    rentalStartDate: existingBooking.rentalStartDate,
                    rentalEndDate: existingBooking.rentalEndDate,
                    quantity: existingBooking.quantity,
                    totalAmount: existingBooking.totalAmount
                },
                payment: {
                    paymentIntentId: existingPayment.paymentIntentId,
                    amount: existingPayment.amount,
                    currency: existingPayment.currency
                }
            });
        }

        // Find booking hold
        const holdId = session.metadata.holdId;

        if (!ObjectId.isValid(holdId)) {
            return res.status(400).send({
                message: "Invalid booking information."
            });
        }

        const hold = await bookingHoldsCollection.findOne({
            _id: new ObjectId(holdId),
            customerId: req.user.id,
            stripeSessionId: sessionId
        });

        if (!hold) {
            return res.status(404).send({
                message: "Booking hold not found."
            });
        }

        // Verify payment amount and currency
        const expectedAmount = Math.round(hold.totalAmount * 100);
        const expectedCurrency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();

        if (
            session.amount_total !== expectedAmount ||
            session.currency !== expectedCurrency
        ) {
            return res.status(400).send({
                message: "Payment amount or currency mismatch."
            });
        }

        // Create booking
        const { _id, expiresAt, ...bookingData } = hold;

        await bookingsCollection.updateOne(
            { stripeSessionId: sessionId },
            {
                $setOnInsert: {
                    ...bookingData,
                    stripeSessionId: sessionId,
                    paymentStatus: "Paid",
                    bookingStatus: "Confirmed",
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );

        const booking = await bookingsCollection.findOne({
            stripeSessionId: sessionId
        });

        // Save payment information
        await paymentsCollection.updateOne(
            { stripeSessionId: sessionId },
            {
                $setOnInsert: {
                    bookingId: booking._id,
                    customerId: req.user.id,
                    stripeSessionId: sessionId,
                    paymentIntentId: session.payment_intent,
                    amount: hold.totalAmount,
                    currency: session.currency,
                    status: "Paid",
                    paidAt: new Date()
                }
            },
            { upsert: true }
        );

        // Delete temporary booking hold
        await bookingHoldsCollection.deleteOne({
            _id: hold._id
        });

        const payment = await paymentsCollection.findOne({
            stripeSessionId: sessionId
        });

        res.send({
            success: true,
            message: "Payment successful. Booking confirmed.",
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