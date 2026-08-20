const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
app.use(express.json());

const dbPath = __dirname + '/../consultbae.db';
const db = new sqlite3.Database(dbPath);

function fixPhone(phone) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.substring(1);
  if (d.length === 12 && d.startsWith('91')) d = d.substring(2);
  return d.length === 10 ? d : d;
}

function fixCity(city) {
  if (!city) return null;
  const c = city.trim().toLowerCase();
  if (c.includes('gurgaon') || c.includes('gurugram')) return 'Gurugram';
  if (c.includes('noida')) return 'Noida';
  if (c.includes('pune')) return 'Pune';
  if (c.includes('delhi')) return 'Delhi';
  if (c.includes('bangalore') || c.includes('bengaluru')) return 'Bengaluru';
  return city.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function alignFields(c) {
  let email = null;
  let phone = null;
  let name = null;
  let city = null;

  const vals = Object.values(c).map(v => v ? v.toString().trim() : '').filter(v => v !== '');

  const emailIdx = vals.findIndex(v => v.includes('@'));
  if (emailIdx !== -1) {
    email = vals[emailIdx];
    vals.splice(emailIdx, 1);
  }

  const phoneIdx = vals.findIndex(v => {
    const d = v.replace(/\D/g, '');
    return d.length >= 10 && d.length <= 12;
  });
  if (phoneIdx !== -1) {
    phone = vals[phoneIdx];
    vals.splice(phoneIdx, 1);
  }

  const cityNames = ['noida', 'pune', 'delhi', 'gurgaon', 'gurugram', 'bangalore', 'bengaluru', 'mumbai'];
  const cityIdx = vals.findIndex(v => {
    const lower = v.toLowerCase();
    return cityNames.some(k => lower.includes(k));
  });
  if (cityIdx !== -1) {
    city = vals[cityIdx];
    vals.splice(cityIdx, 1);
  }

  if (vals.length > 0) {
    const nameVal = vals.find(v => /[a-zA-Z]/.test(v));
    if (nameVal) name = nameVal;
  }

  return { email, phone, name, city };
}

app.post('/check-duplicate-bulk', (req, res) => {
  const candidates = req.body;

  if (!Array.isArray(candidates)) {
    return res.status(400).json({ error: 'Body must be an array of candidates.' });
  }

  if (candidates.length === 0) {
    return res.json([]);
  }

  const dupes = [];
  const nonDupes = [];
  let done = 0;

  function finalize() {
    const logPath = __dirname + '/duplicate_alerts.json';
    const logData = {
      timestamp: new Date().toISOString(),
      summary: {
        total_processed: candidates.length,
        duplicates_count: dupes.length,
        new_profiles_count: nonDupes.length
      },
      duplicates: dupes,
      new_profiles: nonDupes
    };
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));

    // Print only the new profiles in the terminal
    nonDupes.forEach(nd => {
      console.log(`✨ NEW PROFILE DETECTED: "${nd.name}" (${nd.email || 'No Email'})`);
    });

    // Print the batch summary
    console.log(`📊 BATCH COMPLETE: ${dupes.length} duplicates, ${nonDupes.length} new profiles found.`);

    res.json({
      duplicates: dupes,
      non_duplicates: nonDupes
    });
  }

  candidates.forEach(c => {
    const aligned = alignFields(c);

    const email = aligned.email ? aligned.email.trim().toLowerCase() : null;
    const phone = aligned.phone ? fixPhone(aligned.phone) : null;
    const name = aligned.name ? aligned.name.trim().toLowerCase() : null;
    const city = aligned.city ? fixCity(aligned.city) : null;

    if (!email && !phone) {
      done++;
      if (done === candidates.length) {
        finalize();
      }
      return;
    }

    db.get(
      `SELECT id, name, email, phone, sources FROM workers 
       WHERE (email IS NOT NULL AND email = ?) 
          OR (phone IS NOT NULL AND phone = ?) 
          OR (name IS NOT NULL AND city IS NOT NULL AND LOWER(name) = ? AND city = ?)`,
      [email, phone, name, city],
      (err, row) => {
        if (row) {
          dupes.push({
            name: aligned.name || row.name,
            email: email || row.email,
            phone: phone || row.phone,
            id: row.id,
            sources: row.sources
          });
        } else {
          nonDupes.push({
            name: aligned.name || null,
            email: email,
            phone: phone,
            city: city
          });
        }

        done++;
        if (done === candidates.length) {
          finalize();
        }
      }
    );
  });
});

app.post('/alert', (req, res) => {
  // Silent endpoint to prevent duplicate alerts flooding the terminal
  res.json({ status: 'received' });
});

app.listen(5001, () => {
  console.log('bridge server up on http://localhost:5001');
});