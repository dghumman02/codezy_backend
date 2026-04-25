import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Teacher from "../models/Teacher.js";
import dotenv from "dotenv";

dotenv.config();

async function repair() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to DB");

  const teachers = await Teacher.find();
  let fixed = 0;

  for (const t of teachers) {
    if (!t.password || !t.password.startsWith("$2")) {
      const tempPassword = "Temp@123";
      t.password = await bcrypt.hash(tempPassword, 10);
      await t.save();
      fixed++;
      console.log(`Reset password for ${t.email}`);
    }
  }

  console.log(`✅ Repaired ${fixed} teacher accounts`);
  process.exit(0);
}

repair();
