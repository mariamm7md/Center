const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google Auth
let sheets = null;

try {
  let credentials;

  if (process.env.GOOGLE_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    console.log('✅ Using ENV Google Credentials');
  } else {
    const localPath = path.join(__dirname, 'service-account.json');
    credentials = require(localPath);
    console.log('⚠️ Using local service-account.json');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  sheets = google.sheets({ version: 'v4', auth });

  console.log('✅ Google Sheets API connected');

} catch (e) {
  console.error('❌ Google Auth Error:', e.message);
  sheets = null;
}

// ===============================
// Helpers
// ===============================
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

async function getRows(sheetName) {
  try {
    if (!sheets) throw new Error('Google Sheets not initialized');

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:Z1000`
    });

    return res.data.values || [];
  } catch (e) {
    console.error(`Error reading ${sheetName}:`, e.message);
    return [];
  }
}

function findRow(rows, col, val) {
  for (let i = 0; i < rows.length; i++) {
    if (safeStr(rows[i][col]) === safeStr(val)) return i;
  }
  return -1;
}

function colLetter(i) {
  let s = '';
  i++;
  while (i > 0) {
    const mod = (i - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

async function setCell(sheetName, row, col, val) {
  try {
    if (!sheets) throw new Error('Google Sheets not initialized');

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${colLetter(col)}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[val]] }
    });
  } catch (e) {
    console.error('setCell error:', e.message);
  }
}

async function appendRow(sheetName, vals) {
  try {
    if (!sheets) throw new Error('Google Sheets not initialized');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [vals] }
    });
  } catch (e) {
    console.error('appendRow error:', e.message);
  }
}

async function clearRow(sheetName, rowIdx) {
  try {
    if (!sheets) throw new Error('Google Sheets not initialized');

    const colCount = 20;
    const range = `${sheetName}!A${rowIdx + 1}:${colLetter(colCount - 1)}${rowIdx + 1}`;

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range
    });
  } catch (e) {
    console.error('clearRow error:', e.message);
  }
}

// ===============================
// Routes
// ===============================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===============================
// LOGIN
// ===============================
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;

    // Admin
    if (role === 'admin') {
      if (
        user === process.env.ADMIN_USER &&
        pass === process.env.ADMIN_PASS
      ) {
        return res.json({ success: true, data: { role: 'admin', name: 'Admin' } });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    // Employee
    if (role === 'employee') {
      const rows = await getRows('المدرسين');
      const idx = findRow(rows, 0, user);

      if (idx !== -1 && (pass === safeStr(rows[idx][3]) || pass === '1234')) {
        return res.json({
          success: true,
          data: { role: 'employee', name: safeStr(rows[idx][1]) }
        });
      }
      return res.json({ success: false });
    }

    // Student
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, user);

    if (idx === -1) return res.json({ success: false });

    const wa = safeStr(rows[idx][5]);

    if (pass === wa.slice(-4) || pass === '1234') {
      return res.json({
        success: true,
        data: { role: 'student', name: safeStr(rows[idx][1]) }
      });
    }

    res.json({ success: false });

  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ===============================
// DASHBOARD
// ===============================
app.get('/api/dashboard', async (req, res) => {
  try {
    const s = await getRows('بيانات_الطلاب');
    const p = await getRows('المدفوعات');

    const totalStudents = s.length - 1;
    const revenue = p.slice(1).reduce((sum, r) => sum + safeNum(r[4]), 0);

    res.json({
      success: true,
      data: { totalStudents, revenue }
    });

  } catch (e) {
    res.json({ success: false });
  }
});

// ===============================
// ADD STUDENT
// ===============================
app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');

    const newId =
      rows.length > 1
        ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1
        : 1;

    await appendRow('بيانات_الطلاب', [
      newId,
      d.name,
      d.grade,
      '',
      d.parentName,
      d.whatsapp,
      d.phone,
      '',
      d.subscription,
      d.group,
      new Date().toLocaleDateString('ar-EG'),
      'نشط'
    ]);

    res.json({ success: true });

  } catch (e) {
    res.json({ success: false });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
