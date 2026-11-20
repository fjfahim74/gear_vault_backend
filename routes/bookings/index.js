import { Router } from "express";
import { ObjectId } from "mongodb";
import {
    equipmentCollection,
    bookingsCollection,
    bookingHoldsCollection
} from "../../config/db.js";
import verifyToken, { verifyRenter } from "../../middlewares/verifyApi.js";

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

export default router;