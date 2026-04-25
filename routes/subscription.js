import express from "express";
import Subscription from "../models/Subscription.js";

const router = express.Router();

// -------------------------
// Get subscription of a user
// -------------------------
router.get("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const subscription = await Subscription.findOne({ userId });

    if (!subscription) {
      return res.status(404).json({ message: "No active subscription" });
    }

    return res.status(200).json(subscription);
  } catch (err) {
    console.error("SUBSCRIPTION FETCH ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// -------------------------
// Create or update subscription
// -------------------------
router.post("/create", async (req, res) => {
  try {
    const { userId, planName, price } = req.body;

    const subscriptionData = {
      userId,
      planName,
      startDate: new Date(), // or keep old startDate if upgrading
      endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      price
    };

    // Create new subscription if none exists, or update existing
    const subscription = await Subscription.findOneAndUpdate(
      { userId },
      subscriptionData,
      { new: true, upsert: true }
    );

    return res.status(200).json(subscription);
  } catch (err) {
    console.error("SUBSCRIPTION CREATE/UPDATE ERROR:", err);
    return res.status(500).json({ message: "Server error creating/updating subscription" });
  }
});

export default router;
