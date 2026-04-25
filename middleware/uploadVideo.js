// backend/middleware/uploadVideo.js
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

// Convert ES module URL to file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set the upload directory
const uploadPath = path.join(__dirname, "../uploads/videos");

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Save the file with original name + timestamp to avoid collisions
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/\s+/g, "_"); // replace spaces
    cb(null, `${timestamp}-${originalName}`);
  },
});

// Filter only video files
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("video/")) {
    cb(null, true);
  } else {
    cb(new Error("Only video files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

export default upload;