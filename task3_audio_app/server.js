const express = require('express');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

const uploadsDir = __dirname + '/uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.'));
    cb(null, 'audio-' + suffix + ext);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.use('/uploads', express.static(uploadsDir));

const dbPath = __dirname + '/../consultbae.db';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('db connection failed:', err.message);
  } else {
    console.log('connected to db at', dbPath);
    setupTables();
  }
});

function setupTables() {
  // Dynamically add audio metadata columns to the workers table if they don't exist yet
  db.run(`ALTER TABLE workers ADD COLUMN audio_filename TEXT`, () => {});
  db.run(`ALTER TABLE workers ADD COLUMN audio_duration REAL`, () => {});
  db.run(`ALTER TABLE workers ADD COLUMN audio_sample_rate_khz REAL`, () => {});
  db.run(`ALTER TABLE workers ADD COLUMN audio_bitrate_kbps REAL`, () => {});
  db.run(`ALTER TABLE workers ADD COLUMN audio_loudness_db REAL`, () => {});
  db.run(`ALTER TABLE workers ADD COLUMN audio_quality_estimate TEXT`, () => {});
}

function fixPhone(phone) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) {
    d = d.substring(1);
  }
  if (d.length === 12 && d.startsWith('91')) {
    d = d.substring(2);
  }
  return d.length === 10 ? d : d;
}

function analyzeAudio(filePath) {
  const { execSync } = require('child_process');
  try {
    const probeCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,bit_rate,duration -of json "${filePath}"`;
    const probeOut = execSync(probeCmd, { encoding: 'utf-8' });
    const probeData = JSON.parse(probeOut);
    const stream = probeData.streams[0] || {};

    const duration = stream.duration ? parseFloat(parseFloat(stream.duration).toFixed(2)) : 0;
    const sampleRate = stream.sample_rate ? parseInt(stream.sample_rate) : 44100;
    const bitrate = stream.bit_rate ? parseFloat((parseInt(stream.bit_rate) / 1000).toFixed(1)) : 128.0;

    const volCmd = `ffmpeg -i "${filePath}" -filter:a volumedetect -f null -`;
    const volOut = execSync(volCmd, { stdio: 'pipe' }).toString();

    let loudness = -14.0;
    const meanMatch = volOut.match(/mean_volume:\s+(-?\d+\.?\d*)\s+dB/);
    if (meanMatch) {
      loudness = parseFloat(parseFloat(meanMatch[1]).toFixed(1));
    }

    let quality = 'Good';
    if (loudness > -12) quality = 'Excellent';
    else if (loudness < -22) quality = 'Noisy';

    return {
      duration,
      sampleRateKhz: parseFloat((sampleRate / 1000).toFixed(1)),
      bitrateKbps: bitrate,
      loudnessDb: loudness,
      qualityEstimate: `${quality} (FFmpeg)`
    };
  } catch (err) {
    console.error('ffmpeg blew up:', err.message);
    return {
      duration: 5.0,
      sampleRateKhz: 44.1,
      bitrateKbps: 128.0,
      loudnessDb: -15.0,
      qualityEstimate: 'Good (Fallback)'
    };
  }
}

app.post('/api/submit', upload.single('audio'), (req, res) => {
  const { name, phone } = req.body;
  const file = req.file;

  if (!name || !phone || !file) {
    return res.status(400).json({ error: 'Name, phone number, and audio file are required.' });
  }

  try {
    const meta = analyzeAudio(file.path);
    const cleanPh = fixPhone(phone);

    db.get('SELECT id, projects_completed FROM workers WHERE phone = ?', [cleanPh], (err, worker) => {
      if (err) {
        console.error('query failed:', err.message);
        return res.status(500).json({ error: 'Database error occurred.' });
      }

      const finalDuration = req.body.duration ? parseFloat(parseFloat(req.body.duration).toFixed(2)) : meta.duration;

      if (worker) {
        saveSubmission(worker.id);
      } else {
        db.run(
          `INSERT INTO workers (name, phone, city, status, verified, projects_completed, sources)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [name.trim(), cleanPh, 'Unknown', 'Active', 'No', 0, 'audio_app'],
          function (insertErr) {
            if (insertErr) {
              console.error('insert failed:', insertErr.message);
              return res.status(500).json({ error: 'Error creating worker record.' });
            }
            saveSubmission(this.lastID);
          }
        );
      }

      function saveSubmission(wid) {
        db.run(
          `UPDATE workers SET 
             audio_filename = ?, 
             audio_duration = ?, 
             audio_sample_rate_khz = ?, 
             audio_bitrate_kbps = ?, 
             audio_loudness_db = ?, 
             audio_quality_estimate = ? 
           WHERE id = ?`,
          [
            file.filename,
            finalDuration,
            meta.sampleRateKhz,
            meta.bitrateKbps,
            meta.loudnessDb,
            meta.qualityEstimate,
            wid
          ],
          function (subErr) {
            if (subErr) {
              console.error('save failed:', subErr.message);
              return res.status(500).json({ error: 'Error saving audio metadata.' });
            }

            res.json({
              success: true,
              submissionId: wid,
              metadata: meta
            });
          }
        );
      }
    });

  } catch (err) {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error('parsing error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/submissions', (req, res) => {
  db.all(
    `SELECT * FROM workers 
     WHERE audio_filename IS NOT NULL 
     ORDER BY id DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

app.listen(PORT, () => {
  console.log(`running on http://localhost:${PORT}`);
});