const multer = require('multer');

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg', 
  'image/jpg', 
  'image/png', 
  'application/pdf'
]);

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Tipo de archivo no permitido'), false);
  }
  cb(null, true);
};

module.exports = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});