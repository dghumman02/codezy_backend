import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    planName: {
      type: String,
      required: true,
    },
    amountPaid: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "usd",
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "pending", "failed"],
      default: "paid",
    },
    stripeSessionId: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);
