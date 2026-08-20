const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function fixPhone(p) {
  if (!p) return null;
  let d = p.replace(/\D/g, '');

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

function fixCTC(val) {
  if (!val) return null;
  const n = parseFloat(val.toString().replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return null;
  return n < 100 ? Math.round(n * 100000) : Math.round(n);
}

function isValidCandidateRow(r) {
  if (!Array.isArray(r)) return false;
  const hasEmail = r.some(cell => cell && cell.includes('@'));
  const hasPhone = r.some(cell => {
    if (!cell) return false;
    const clean = cell.replace(/\D/g, '');
    return clean.length >= 10 && clean.length <= 12;
  });
  return hasEmail || hasPhone;
}

function getRate(str) {
  const out = { hourly: null, monthly: null };
  if (!str) return out;

  const s = str.trim().toLowerCase();
  if (s.includes('/hr') || s.includes('/hour')) {
    out.hourly = parseFloat(s.replace(/[^0-9.]/g, '')) || null;
  } else if (s.includes('/month') || s.includes('/mo')) {
    let numPart = s.replace('/month', '').replace('/mo', '').trim();
    let mult = 1;
    if (numPart.endsWith('k')) {
      mult = 1000;
      numPart = numPart.slice(0, -1);
    }
    out.monthly = (parseFloat(numPart.replace(/[^0-9.]/g, '')) * mult) || null;
  }
  return out;
}

function readCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;

    const cells = [];
    let cur = '';
    let inQuotes = false;

    for (let j = 0; j < ln.length; j++) {
      const ch = ln[j];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    out.push(cells);
  }
  return out;
}

const workersList = [];

function addOrMerge(person) {
  const cleanEmail = person.email ? person.email.trim().toLowerCase() : null;
  const cleanPhone = fixPhone(person.phone);
  const cleanName = person.name ? person.name.trim().toLowerCase() : null;
  const cleanCity = fixCity(person.city);

  let match = null;
  for (let i = 0; i < workersList.length; i++) {
    const p = workersList[i];

    if (cleanEmail && p.email && p.email.toLowerCase() === cleanEmail) {
      match = p;
      break;
    }

    if (cleanPhone && p.phone && p.phone === cleanPhone) {
      match = p;
      break;
    }

    if (cleanName && cleanCity && p.name && p.city) {
      if (p.name.toLowerCase() === cleanName && p.city === cleanCity) {
        match = p;
        break;
      }
    }
  }

  if (match) {
    if (!match.email && cleanEmail) match.email = cleanEmail;
    if (!match.phone && cleanPhone) match.phone = cleanPhone;
    if (!match.city && cleanCity) match.city = cleanCity;
    if (person.name && (!match.name || person.name.length > match.name.length)) {
      match.name = person.name.trim();
    }

    if (person.experience) match.experience = Math.max(match.experience || 0, person.experience);
    if (person.ctc) match.ctc = person.ctc;
    if (person.hourly_rate) match.hourly_rate = person.hourly_rate;
    if (person.monthly_rate) match.monthly_rate = person.monthly_rate;
    if (person.verified) match.verified = person.verified;
    if (person.projects) match.projects = Math.max(match.projects || 0, person.projects);

    if (person.applied_date) {
      if (!match.applied_date || person.applied_date < match.applied_date) {
        match.applied_date = person.applied_date;
      }
    }

    if (person.skills) {
      const skillList = person.skills.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      skillList.forEach(s => {
        if (!match.skills.includes(s)) match.skills.push(s);
      });
    }

    if (person.source && !match.sources.includes(person.source)) {
      match.sources.push(person.source);
    }
  } else {
    const skillList = person.skills ? person.skills.split(',').map(s => s.trim().toLowerCase()).filter(s => s) : [];
    workersList.push({
      name: person.name ? person.name.trim() : null,
      email: cleanEmail,
      phone: cleanPhone,
      city: cleanCity,
      experience: person.experience || null,
      ctc: person.ctc || null,
      hourly_rate: person.hourly_rate || null,
      monthly_rate: person.monthly_rate || null,
      skills: skillList,
      status: person.status || 'Active',
      verified: person.verified || 'No',
      projects: person.projects || 0,
      applied_date: person.applied_date || null,
      sources: [person.source]
    });
  }
}

function start() {
  console.log('starting merge...');

  const naukriFile = path.join(__dirname, '..', 'source1_naukri_applicants.csv');
  const gigFile = path.join(__dirname, '..', 'source2_gig_workers.csv');
  const cbFile = path.join(__dirname, '..', 'source3_cbnexus_contacts.csv');

  console.log('doing naukri...');
  const naukriData = readCSV(naukriFile);
  for (let i = 1; i < naukriData.length; i++) {
    const r = naukriData[i];
    if (!isValidCandidateRow(r)) continue;

    addOrMerge({
      name: r[0],
      email: r[1],
      phone: r[2],
      city: r[3],
      experience: parseFloat(r[4]) || 0,
      ctc: fixCTC(r[5]),
      applied_date: r[6] ? r[6].trim() : null,
      skills: r[7],
      source: 'naukri'
    });
  }

  console.log('doing gig workers...');
  const gigData = readCSV(gigFile);
  for (let i = 1; i < gigData.length; i++) {
    const r = gigData[i];
    if (!isValidCandidateRow(r)) continue;

    let email = r[0];
    let name = r[1];
    let rate = r[2];
    let city = r[3];
    let status = r[4];
    let skills = r[5];

    if (name && name.includes('@')) {
      skills = r[0];
      email = r[1];
      name = r[2];
      rate = r[3];
      city = r[4];
      status = r[5];
    }

    const rateInfo = getRate(rate);
    addOrMerge({
      name,
      email,
      phone: null,
      city,
      hourly_rate: rateInfo.hourly,
      monthly_rate: rateInfo.monthly,
      skills,
      status: status ? (status.trim().toLowerCase() === 'active' ? 'Active' : status.trim()) : 'Active',
      source: 'gig_workers'
    });
  }

  console.log('doing cbnexus...');
  const cbData = readCSV(cbFile);
  const cbHeaders = cbData[0];
  for (let i = 1; i < cbData.length; i++) {
    const r = cbData[i];
    if (!isValidCandidateRow(r)) continue;

    const verifiedFlag = (r[3] && (r[3].toLowerCase() === 'y' || r[3].toLowerCase() === 'yes')) ? 'Yes' : 'No';
    addOrMerge({
      name: r[0],
      email: null,
      phone: r[1],
      city: r[2],
      verified: verifiedFlag,
      projects: parseInt(r[4]) || 0,
      source: 'cbnexus'
    });
  }

  console.log(`got ${workersList.length} unique people`);
  storedb(workersList);
}

function storedb(list) {
  const dbFile = path.join(__dirname, '..', 'consultbae.db');

  if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile);
  }

  const db = new sqlite3.Database(dbFile);

  db.serialize(() => {
    db.run(`
      CREATE TABLE workers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        city TEXT,
        experience_years REAL,
        current_ctc INTEGER,
        hourly_rate REAL,
        monthly_rate REAL,
        skills TEXT,
        status TEXT,
        verified TEXT,
        projects_completed INTEGER,
        applied_date TEXT,
        sources TEXT,
        audio_filename TEXT,
        audio_duration REAL,
        audio_sample_rate_khz REAL,
        audio_bitrate_kbps REAL,
        audio_loudness_db REAL,
        audio_quality_estimate TEXT
      )
    `);

    const insert = db.prepare(`
      INSERT INTO workers (
        name, email, phone, city, experience_years, current_ctc,
        hourly_rate, monthly_rate, skills, status, verified,
        projects_completed, applied_date, sources
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    list.forEach(w => {
      insert.run(
        w.name,
        w.email,
        w.phone,
        w.city,
        w.experience,
        w.ctc,
        w.hourly_rate,
        w.monthly_rate,
        w.skills.join(', '),
        w.status,
        w.verified,
        w.projects,
        w.applied_date,
        w.sources.join(', ')
      );
    });

    insert.finalize(() => {
      console.log('saved to db');
      db.close();
    });
  });
}

start();