const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
const CSVS_DIR = path.join(UPLOADS_DIR, 'csvs');
const SUBMISSIONS_DIR = path.join(UPLOADS_DIR, 'submissions');

// Ensure directories exist
[UPLOADS_DIR, PHOTOS_DIR, CSVS_DIR, SUBMISSIONS_DIR].forEach((dir) => {
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

// Production work submissions storage (photos and videos)
const submissionStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(SUBMISSIONS_DIR)) {
      fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
    }
    cb(null, SUBMISSIONS_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/gi, '');
    cb(null, `submission-${unique}${ext || '.bin'}`);
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

// Validates images and videos for proof-of-work submissions
const submissionMediaFilter = (_req, file, cb) => {
  const allowedExts = /\.(jpe?g|png|webp|gif|mp4|webm|mov|quicktime|mkv)$/i;
  const allowedMimes = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime|x-matroska)|application\/octet-stream)$/i;

  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (allowedExts.test(ext) || allowedMimes.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, GIF images and MP4, WebM, MOV videos are allowed.'));
  }
};

const uploadPhoto = multer({ storage: photoStorage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadCsv = multer({ storage: csvStorage, fileFilter: csvFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadSubmissionMedia = multer({
  storage: submissionStorage,
  fileFilter: submissionMediaFilter,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
});

module.exports = {
  uploadPhoto,
  uploadCsv,
  uploadSubmissionMedia,
  PHOTOS_DIR,
  CSVS_DIR,
  SUBMISSIONS_DIR,
};
