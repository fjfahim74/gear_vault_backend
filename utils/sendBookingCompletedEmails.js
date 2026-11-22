import { Resend } from "resend";
import { ObjectId } from "mongodb";
import { usersCollection } from "../config/db.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (email, subject, html) => {
    if (!email) {
        console.log("Email skipped: No recipient email found.");
        return;
    }

    try {
        const { error } = await resend.emails.send({
            from: "GearVault <onboarding@resend.dev>",
            to: email,
            subject,
            html
        });

        if (error) {
            console.error(`Email failed for ${email}:`, error);
            return;
        }

        console.log(`Email sent successfully to ${email}`);
    } catch (error) {
        console.error(`Email error for ${email}:`, error);
    }
};

const createEmailTemplate = (title, message, booking) => {
    const startDate = new Date(booking.rentalStartDate).toLocaleDateString(
        "en-GB",
        { day: "numeric", month: "short", year: "numeric" }
    );

    const endDate = new Date(booking.rentalEndDate).toLocaleDateString(
        "en-GB",
        { day: "numeric", month: "short", year: "numeric" }
    );

    return `
        <!DOCTYPE html>
        <html>
        <body style="
            margin: 0;
            padding: 30px 15px;
            background-color: #F8FAFC;
            font-family: Arial, Helvetica, sans-serif;
            color: #0F2B46;
        ">

            <div style="
                max-width: 560px;
                margin: auto;
                background-color: #FFFFFF;
                border-radius: 12px;
                overflow: hidden;
                border: 1px solid #E2E8F0;
            ">

                <!-- Header -->
                <div style="
                    background-color: #0F2B46;
                    padding: 28px 30px;
                    border-bottom: 5px solid #F4A300;
                ">
                    <h1 style="
                        margin: 0;
                        color: #FFFFFF;
                        font-size: 25px;
                        font-weight: 800;
                    ">
                        GearVault
                    </h1>

                    <p style="
                        margin: 8px 0 0;
                        color: #CBD5E1;
                        font-size: 13px;
                    ">
                        Equipment Rental Platform
                    </p>
                </div>

                <!-- Content -->
                <div style="padding: 32px 30px;">

                    <div style="
                        display: inline-block;
                        padding: 7px 13px;
                        background-color: #CCFBF1;
                        color: #0F766E;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: bold;
                    ">
                        RENTAL COMPLETED
                    </div>

                    <h2 style="
                        margin: 20px 0 12px;
                        font-size: 23px;
                        color: #0F2B46;
                    ">
                        ${title}
                    </h2>

                    <p style="
                        color: #475569;
                        font-size: 15px;
                        line-height: 1.7;
                    ">
                        ${message}
                    </p>

                    <!-- Booking Details -->
                    <div style="
                        margin-top: 25px;
                        padding: 22px;
                        background-color: #F8FAFC;
                        border: 1px solid #E2E8F0;
                        border-radius: 10px;
                    ">

                        <h3 style="
                            margin: 0 0 18px;
                            font-size: 16px;
                            color: #0F2B46;
                        ">
                            Rental Summary
                        </h3>

                        <p style="margin: 12px 0; font-size: 14px;">
                            <span style="color: #64748B;">Equipment</span><br>
                            <strong>${booking.equipmentName}</strong>
                        </p>

                        <div style="
                            height: 1px;
                            background-color: #E2E8F0;
                            margin: 15px 0;
                        "></div>

                        <p style="margin: 12px 0; font-size: 14px;">
                            <span style="color: #64748B;">Rental Start</span><br>
                            <strong>${startDate}</strong>
                        </p>

                        <p style="margin: 12px 0; font-size: 14px;">
                            <span style="color: #64748B;">Rental End</span><br>
                            <strong>${endDate}</strong>
                        </p>

                        <div style="
                            margin-top: 18px;
                            padding: 12px;
                            background-color: #CCFBF1;
                            color: #0F766E;
                            border-radius: 6px;
                            text-align: center;
                            font-size: 14px;
                            font-weight: bold;
                        ">
                            ✓ Booking Status: Completed
                        </div>

                    </div>

                    <p style="
                        margin-top: 28px;
                        color: #475569;
                        font-size: 14px;
                        line-height: 1.7;
                    ">
                        Thank you for being part of GearVault.
                        We appreciate your trust!
                    </p>

                </div>

                <!-- Footer -->
                <div style="
                    padding: 22px 30px;
                    background-color: #F1F5F9;
                    text-align: center;
                ">
                    <p style="
                        margin: 0;
                        color: #0F2B46;
                        font-size: 13px;
                        font-weight: bold;
                    ">
                        GearVault
                    </p>

                    <p style="
                        margin: 7px 0 0;
                        color: #64748B;
                        font-size: 12px;
                    ">
                        Rent Smart. Work Better.
                    </p>

                    <p style="
                        margin: 12px 0 0;
                        color: #94A3B8;
                        font-size: 11px;
                    ">
                        This is an automated notification from GearVault.
                        Please do not reply directly to this email.
                    </p>
                </div>

            </div>

        </body>
        </html>
    `;
};

const sendBookingCompletedEmails = async (booking) => {
    try {
        if (!process.env.RESEND_API_KEY) {
            console.log("Resend API key not configured. Emails skipped.");
            return;
        }

        const customer = ObjectId.isValid(booking.customerId)
            ? await usersCollection.findOne({
                _id: new ObjectId(booking.customerId)
            })
            : null;

        const owner = ObjectId.isValid(booking.ownerId)
            ? await usersCollection.findOne({
                _id: new ObjectId(booking.ownerId)
            })
            : null;

        const customerEmail = booking.customerEmail || customer?.email;
        const ownerEmail = booking.ownerEmail || owner?.email;

        await Promise.all([
            sendEmail(
                customerEmail,
                "Your GearVault Rental is Completed!",
                createEmailTemplate(
                    "Your rental is complete!",
                    "Your equipment rental has been successfully marked as completed. We hope you had a great experience!",
                    booking
                )
            ),

            sendEmail(
                ownerEmail,
                "GearVault: Your Equipment Rental is Completed",
                createEmailTemplate(
                    "Rental successfully completed!",
                    "The rental period for your equipment has ended, and this booking has been marked as completed.",
                    booking
                )
            )
        ]);

    } catch (error) {
        console.error("Booking completion notification error:", error);
    }
};

export default sendBookingCompletedEmails;