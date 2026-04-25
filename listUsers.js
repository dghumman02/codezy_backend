import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/codezy';

async function listUsers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    
    console.log(`Found ${users.length} users:\n`);
    users.forEach(u => {
      console.log(`Email: ${u.email}`);
      console.log(`Name: ${u.fullName}`);
      console.log(`Role: ${u.role}`);
      console.log(`XP: ${u.xp || 0}`);
      console.log('---');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

listUsers();
