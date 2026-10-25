const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
const CSVS_DIR = path.join(UPLOADS_DIR, 'csvs');

// Ensure directories exist
[UPLOADS_DIR, PHOTOS_DIR, CSVS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Product photo storage
const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

// CSV storage
const csvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CSVS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  if (allowed.test(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

const csvFilter = (_req, file, cb) => {
  const allowed = /csv|xlsx|xls/;
  if (allowed.test(path.extname(file.originalname).toLowerCase())) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV/Excel files are allowed'));
  }
};

const uploadPhoto = multer({ storage: photoStorage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadCsv = multer({ storage: csvStorage, fileFilter: csvFilter, limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { uploadPhoto, uploadCsv, PHOTOS_DIR, CSVS_DIR };
