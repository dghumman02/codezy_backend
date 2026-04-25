import express from "express";
import Stripe from "stripe";
import Payment from "../models/Payment.js";
import Enrollment from "../models/Enrollment.js";
import User from "../models/User.js";
import GlobalCourse from "../models/GlobalCourse.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

// ---------------------------------------------
// Stripe initialization
// ---------------------------------------------
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ ERROR: STRIPE_SECRET_KEY is missing in .env file");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------------------------------------------
// Middleware: Authentication
// ---------------------------------------------
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

// ---------------------------------------------
// CREATE CHECKOUT SESSION
// ---------------------------------------------
router.post("/create-checkout-session", authMiddleware, async (req, res) => {
  try {
    const { planName, priceId, amount } = req.body;

    if (!planName || (!priceId && !amount)) {
      return res
        .status(400)
        .json({ message: "Missing planName or priceId or amount" });
    }

    const sessionData = {
      payment_method_types: ["card"],
      mode: priceId ? "subscription" : "payment",
      success_url: `${process.env.FRONTEND_URL}/payment-success?plan=${planName}&amount=${amount}&email=${req.user.email}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancel?plan=${planName}&amount=${amount}`,
      metadata: { userId: req.user.userId, planName },
      line_items: [],
    };

    if (priceId) {
      sessionData.line_items.push({ price: priceId, quantity: 1 });
    } else {
      sessionData.line_items.push({
        price_data: {
          currency: "usd",
          product_data: { name: planName },
          unit_amount: amount * 100, // convert dollars to cents
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create(sessionData);

    return res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error("CHECKOUT SESSION ERROR:", err);
    return res.status(500).json({ message: "Stripe checkout error" });
  }
});

// ---------------------------------------------
// CREATE CHECKOUT SESSION FOR COURSE PURCHASE
// ---------------------------------------------
router.post("/create-course-checkout", authMiddleware, async (req, res) => {
  try {
    const { courseId, courseTitle, coursePrice } = req.body;

    // Fetch user to get their tenantId
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/learner-dashboard?courseId=${courseId}`,
      cancel_url: `${process.env.FRONTEND_URL}/learner-dashboard`,
      metadata: {
        userId: req.user.userId,
        courseId: courseId,
        courseTitle: courseTitle,
        tenantId: user.tenantId.toString(),
        paymentType: "COURSE_PURCHASE"
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: courseTitle },
          unit_amount: Math.round(coursePrice * 100),
        },
        quantity: 1,
      }],
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Course Checkout Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------
// STRIPE WEBHOOK
// ---------------------------------------------
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("WEBHOOK SIGNATURE ERROR:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { userId, courseId, paymentType, tenantId, courseTitle, planName } = session.metadata || {};

      try {
        // Record payment
        const paymentData = {
          userId,
          planName: courseTitle || planName || "Payment",
          amountPaid: session.amount_total ? session.amount_total / 100 : 0,
          currency: session.currency || "usd",
          paymentStatus: "paid",
          stripeSessionId: session.id,
        };
        // Add tenantId if available
        if (tenantId) paymentData.tenantId = tenantId;

        await Payment.create(paymentData);
        console.log("Payment saved in DB");

        // Handle course purchase enrollment
        if (paymentType === "COURSE_PURCHASE" && courseId && userId) {
          const existing = await Enrollment.findOne({ userId, courseId });

          if (!existing) {
            const course = await GlobalCourse.findById(courseId);
            let parentCourseId = courseId;
            let activeChildCourseId = null;

            if (course?.isSpecialization && course.childCourses?.length > 0) {
              parentCourseId = course._id;
              activeChildCourseId = course.childCourses[0];
            } else if (course?.parentCourse) {
              parentCourseId = course.parentCourse;
              activeChildCourseId = course._id;
            }

            await Enrollment.create({
              tenantId,
              userId,
              courseId: parentCourseId,
              activeChildCourseId,
              enrolledAt: new Date(),
              progress: 0,
            });
            console.log("Enrollment created for course purchase");
          }
        }
      } catch (err) {
        console.error("Database error handling webhook:", err);
      }
    }

    res.json({ received: true });
  }
);

export default router;
