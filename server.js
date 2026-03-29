const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1emhIjMexXdwWvuMQWHWQx4p0AtfjqcCie5IV0Pl4Rzk';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google Auth Setup
let credentials;
try {
  credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : require('./service-account.json');
} catch (e) {
  console.error('❌ Auth Error:', e.message);
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

async function getRows(sheetName) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:ZZ`
    });
    return res.data.values || [];
  } catch (e) {
    console.error(`Error reading ${sheetName}:`, e.message);
    return [];
  }
}

async function appendRow(sheetName, values) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] }
    });
    return true;
  } catch (e) { console.error(e); return false; }
}

async function updateRow(sheetName, rowIndex, values) {
  try {
    const endCol = String.fromCharCode(64 + values.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A${rowIndex}:${endCol}${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] }
    });
    return true;
  } catch (e) { console.error(e); return false; }
}

async function deleteRow(sheetName, rowIndex) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetId = meta.data.sheets.find(s => s.properties.title === sheetName)?.properties.sheetId;
    if (!sheetId) return false;
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
          }
        }]
      }
    });
    return true;
  } catch (e) { console.error(e); return false; }
}

function findRowIndex(rows, colIndex, value) {
  for (let i = 0; i < rows.length; i++) {
    if (safeStr(rows[i][colIndex]) === safeStr(value)) return i + 1; // 1-based index
  }
  return -1;
}

// ═══════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Login
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      if (user === 'admin' && pass === 'admin123') return res.json({ success: true, data: { role: 'admin', name: 'المدير' } });
      return res.json({ success: false, message: 'بيانات خاطئة' });
    }
    
    // Student Login
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRowIndex(rows, 0, user); // Search in Col 0 (ID)
    if (idx === -1) return res.json({ success: false, message: 'رقم الطالب غير موجود' });
    
    const studentRow = rows[idx - 1];
    const wa = safeStr(studentRow[5]); // WhatsApp Col 5
    if (pass === wa.slice(-4) || pass === '1234') {
      return res.json({ success: true, data: { role: 'student', name: safeStr(studentRow[1]), studentId: safeStr(studentRow[0]) } });
    }
    res.json({ success: false, message: 'رمز التحقق خاطئ' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const sRows = await getRows('بيانات_الطلاب');
    const pRows = await getRows('المدفوعات');
    
    const total = sRows.length - 1;
    const active = sRows.slice(1).filter(r => safeStr(r[11]).includes('نشط')).length;
    const paid = pRows.slice(1).reduce((sum, r) => sum + safeNum(r[4]), 0);
    
    const monthNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    res.json({ success: true, data: { totalStudents: total, activeStudents: active, totalPaid: paid, currentMonth: monthNames[new Date().getMonth()] }});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// STUDENTS API
// ═══════════════════════════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows('بيانات_الطلاب')).slice(1);
    // 0:ID, 1:Name, 2:Grade, 3:Subject, 4:Parent, 5:WA, 6:StuPh, 7:Ph2, 8:Subs, 9:Group, 10:Date, 11:Status, 12:Notes
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]),
      parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]),
      phone2: safeStr(r[7]), subscription: safeStr(r[8]), group: safeStr(r[9]),
      status: safeStr(r[11]), notes: safeStr(r[12])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const newId = rows.length > 1 ? (parseInt(rows[rows.length-1][0]) || 0) + 1 : 1;
    const newRow = [newId, d.name, d.grade, d.subject, d.parentName, d.whatsapp, d.studentPhone, d.phone2, d.subscription, d.group, new Date().toISOString().split('T')[0], d.status, d.notes];
    await appendRow('بيانات_الطلاب', newRow);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRowIndex(rows, 0, d.id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = rows[idx-1];
    row[1] = d.name; row[2] = d.grade; row[3] = d.subject; row[4] = d.parentName;
    row[5] = d.whatsapp; row[6] = d.studentPhone; row[7] = d.phone2;
    row[8] = d.subscription; row[9] = d.group; row[11] = d.status; row[12] = d.notes;
    
    await updateRow('بيانات_الطلاب', idx, row);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRowIndex(rows, 0, req.body.id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    await deleteRow('بيانات_الطلاب', idx);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// PAYMENTS API
// ═══════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    // 0:Name, 1:Group, 2:Month, 3:Subs, 4:Paid, 5:Notes
    const data = rows.map((r, i) => ({
      name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]),
      subscription: safeStr(r[3]), paid: safeStr(r[4]), notes: safeStr(r[5]),
      remaining: safeNum(r[3]) - safeNum(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? '✅ مكتمل' : '⚠️ غير مكتمل',
      rowIndex: i
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const d = req.body;
    // Name, Group, Month, Subs, Paid, Notes
    await appendRow('المدفوعات', [d.studentName, d.group, d.monthYear, d.subscription, d.paid, d.notes]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// GRADES, SCHEDULES, EXCUSES
// ═══════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), exam1: safeStr(r[2]), exam2: safeStr(r[3]),
      exam3: safeStr(r[4]), exam4: safeStr(r[5]), hw1: safeStr(r[6]), hw2: safeStr(r[7]),
      hw3: safeStr(r[8]), avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11])
    }));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('الدرجات');
    const idx = findRowIndex(rows, 0, d.id);
    if (idx === -1) return res.json({ success: false });
    
    const row = rows[idx-1];
    row[2]=d.exam1; row[3]=d.exam2; row[4]=d.exam3; row[5]=d.exam4;
    row[6]=d.hw1; row[7]=d.hw2; row[8]=d.hw3;
    row[9]=d.avg; row[10]=d.grade; row[11]=d.notes;
    
    await updateRow('الدرجات', idx, row);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), day: safeStr(r[1]), time: safeStr(r[2]),
      group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5]),
      status: safeStr(r[6]) || 'نشط', notes: safeStr(r[7])
    }));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows('الاعتذارات')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]),
      date: safeStr(r[3]), reason: safeStr(r[4]), status: safeStr(r[5]) || 'قيد المراجعة', reply: safeStr(r[6])
    }));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const { id, status, reply } = req.body;
    const rows = await getRows('الاعتذارات');
    const idx = findRowIndex(rows, 0, id);
    if (idx === -1) return res.json({ success: false });
    
    const row = rows[idx-1];
    row[5] = status; row[6] = reply;
    await updateRow('الاعتذارات', idx, row);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════
app.get('/api/attendance', async (req, res) => {
  try {
    const { month } = req.query; // e.g., "يناير"
    const rows = await getRows(month); // Sheet name is the month
    
    // Structure: Row 0 Title, Row 1 Legend, Row 2 Header, Row 3+ Data
    // Data Cols: 0:ID, 1:Year, 2:Name, 3:Group, 4-34:Days
    const data = rows.slice(3).filter(r => r.length > 0).map(r => {
      const days = [];
      for(let d=4; d<35; d++) days.push(safeStr(r[d]));
      return { id: safeStr(r[0]), name: safeStr(r[2]), group: safeStr(r[3]), days };
    });
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// STUDENT PORTAL
// ═══════════════════════════════════════════════════════════
app.get('/api/student/profile', async (req, res) => { 
   try {
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRowIndex(rows, 0, req.query.id);
    if (idx === -1) return res.json({ success: false });
    const r = rows[idx-1];
    res.json({ success: true, data: { id: r[0], name: r[1], grade: r[2], group: r[9], whatsapp: r[5], studentPhone: r[6], subscription: r[8], status: r[11] } });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/grades', async (req, res) => { 
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === safeStr(req.query.id));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/payments', async (req, res) => { 
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === safeStr(req.query.name));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/schedules', async (req, res) => { 
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    const data = rows.filter(r => safeStr(r[6]) === 'نشط');
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/excuses', async (req, res) => { 
  try {
    const rows = (await getRows('الاعتذارات')).slice(1);
    const data = rows.filter(r => safeStr(r[1]) === safeStr(req.query.id));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('الاعتذارات');
    const newId = rows.length > 1 ? (parseInt(rows[rows.length-1][0]) || 0) + 1 : 1;
    const date = new Date().toISOString().split('T')[0];
    await appendRow('الاعتذارات', [newId, d.studentId, d.studentName, date, d.reason, 'قيد المراجعة', '']);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const { id } = req.query;
    const monthNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const currentMonth = monthNames[new Date().getMonth()];
    const rows = await getRows(currentMonth);
    
    const idx = findRowIndex(rows, 0, id); // Search ID in col 0
    if (idx === -1) return res.json({ success: true, data: { month: currentMonth, days: [] } });
    
    const row = rows[idx-1];
    const days = [];
    for(let d=4; d<35; d++) days.push(safeStr(row[d]));
    
    res.json({ success: true, data: { month: currentMonth, days } });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Downloads
app.get('/api/sheets', async (req, res) => { 
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    res.json({ success: true, data: r.data.sheets.map(s => ({ name: s.properties.title, gid: s.properties.sheetId })) });
  } catch(e) { res.json({ success: false }); }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
