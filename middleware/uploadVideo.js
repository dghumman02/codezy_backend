import multer from "multer";

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("video/")) cb(null, true);
  else cb(new Error("Only video files are allowed"), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

export default upload;
