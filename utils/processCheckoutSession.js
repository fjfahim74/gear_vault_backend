import { ObjectId } from "mongodb";
import {
    bookingsCollection,
    bookingHoldsCollection,
    paymentsCollection
} from "../config/db.js";

const processCheckoutSession = async (session) => {
    // Check payment status
    if (
        session.status !== "complete" ||
        session.payment_status !== "paid"
    ) {
        throw new Error("Payment is not completed.");
    }

    const { holdId, customerId } = session.metadata || {};

    if (!ObjectId.isValid(holdId) || !customerId) {
        throw new Error("Invalid booking information.");
    }

    const paymentIntentId =
        typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

    if (!paymentIntentId) {
        throw new Error("Payment intent not found.");
    }

    // Check if payment was already processed
    const existingBooking = await bookingsCollection.findOne({
        stripeSessionId: session.id
    });

    const existingPayment = await paymentsCollection.findOne({
        stripeSessionId: session.id
    });

    if (existingBooking && existingPayment) {
        await bookingHoldsCollection.deleteOne({
            _id: new ObjectId(holdId),
            customerId,
            stripeSessionId: session.id
        });

        return {
            booking: existingBooking,
            payment: existingPayment,
            alreadyProcessed: true
        };
    }

    // Find the booking hold
    const hold = await bookingHoldsCollection.findOne({
        _id: new ObjectId(holdId),
        customerId,
        stripeSessionId: session.id
    });

    if (!hold) {
        throw new Error("Booking hold not found.");
    }

    // Verify payment amount and currency
    const expectedAmount = Math.round(hold.totalAmount * 100);
    const expectedCurrency = (
        process.env.STRIPE_CURRENCY || "usd"
    ).toLowerCase();

    if (
        session.amount_total !== expectedAmount ||
        session.currency !== expectedCurrency
    ) {
        throw new Error("Payment amount or currency mismatch.");
    }

    // Create confirmed booking
    const { _id, expiresAt, ...bookingData } = hold;

    await bookingsCollection.updateOne(
        { stripeSessionId: session.id },
        {
            $setOnInsert: {
                ...bookingData,
                stripeSessionId: session.id,
                paymentStatus: "Paid",
                bookingStatus: "Confirmed",
                createdAt: new Date()
            }
        },
        { upsert: true }
    );

    const booking = await bookingsCollection.findOne({
        stripeSessionId: session.id
    });

    if (!booking) {
        throw new Error("Booking creation failed.");
    }

    // Save payment information
    await paymentsCollection.updateOne(
        { stripeSessionId: session.id },
        {
            $setOnInsert: {
                bookingId: booking._id,
                customerId,
                stripeSessionId: session.id,
                paymentIntentId,
                amount: hold.totalAmount,
                currency: session.currency,
                status: "Paid",
                paidAt: new Date()
            }
        },
        { upsert: true }
    );

    const payment = await paymentsCollection.findOne({
        stripeSessionId: session.id
    });

    if (!payment) {
        throw new Error("Payment record creation failed.");
    }

    // Delete the temporary booking hold
    await bookingHoldsCollection.deleteOne({
        _id: hold._id
    });

    return {
        booking,
        payment,
        alreadyProcessed: false
    };
};

export default processCheckoutSession;