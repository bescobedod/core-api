const multer = require('multer');

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 50) * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg', 
  'image/jpg', 
  'image/png', 
  'application/pdf'
]);

const ALLOWED_MIME_DOCS = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Tipo de archivo no permitido'), false);
  }
  cb(null, true);
};

const fileFilterDocs = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (!ALLOWED_MIME_DOCS.has(file.mimetype) && !['xlsx', 'xls'].includes(ext)) {
    return cb(new Error('Solo se permiten archivos Excel (.xlsx o .xls)'), false);
  }
  cb(null, true);
};

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE }, fileFilter });
const uploadDocumentos = multer({ storage, limits: { fileSize: MAX_FILE_SIZE }, fileFilterDocs });

module.exports = { upload, uploadDocumentos };