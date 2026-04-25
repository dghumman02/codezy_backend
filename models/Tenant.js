import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ["individual"], default: "individual" },
  status: { type: String, default: "active" },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Tenant", tenantSchema);
