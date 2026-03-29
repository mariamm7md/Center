require('dotenv').config();

const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w64sK9ucTyEhsu1_FUEtX56GKcvdZaGe1aRDpyBOrRs';

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
    try {
      credentials = require('./service-account.json');
      console.log('⚠️ Using local service-account.json');
    } catch (e) {
      console.error('❌ No credentials found');
    }
  }

  if (credentials) {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API connected');
  }
} catch (e) {
  console.error('❌ Google Auth Error:', e.message);
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

async function getRows(sheetName) {
  try {
    if (!sheets) return [];
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
    if (!sheets) return;
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
    if (!sheets) return;
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
    if (!sheets) return;
    const range = `${sheetName}!A${rowIdx + 1}:Z${rowIdx + 1}`;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range
    });
  } catch (e) {
    console.error('clearRow error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
// LOGIN API
// ═══════════════════════════════════════════════════════════════
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    
    if (role === 'admin') {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      if (user === adminUser && pass === adminPass) {
        return res.json({ success: true, data: { role: 'admin', name: 'Admin', id: 'admin' } });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }
    
    if (role === 'employee') {
      const empRows = await getRows('المدرسين');
      const empIdx = findRow(empRows, 0, user);
      if (empIdx !== -1 && (pass === safeStr(empRows[empIdx][3]) || pass === '1234')) {
        return res.json({
          success: true,
          data: { role: 'employee', name: safeStr(empRows[empIdx][1]), id: safeStr(empRows[empIdx][0]) }
        });
      }
      return res.json({ success: false, message: 'Invalid employee credentials' });
    }
    
    // Student login
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, user);
    if (idx === -1) return res.json({ success: false, message: 'Student ID not found' });
    
    const wa = safeStr(rows[idx][5]);
    if (pass === wa.slice(-4) || pass === '1234') {
      return res.json({
        success: true,
        data: { role: 'student', name: safeStr(rows[idx][1]), id: safeStr(rows[idx][0]) }
      });
    }
    
    res.json({ success: false, message: 'Invalid verification code' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const sRows = await getRows('بيانات_الطلاب');
    const pRows = await getRows('المدفوعات');
    const cRows = await getRows('الكورسات');
    const tRows = await getRows('المدرسين');
    const aRows = await getRows('الحضور');
    
    const totalStudents = Math.max(0, sRows.length - 1);
    const activeStudents = sRows.slice(1).filter(r => safeStr(r[11]) === 'نشط').length;
    const totalCourses = Math.max(0, cRows.length - 1);
    const totalTeachers = Math.max(0, tRows.length - 1);
    
    const totalRevenue = pRows.slice(1).reduce((sum, r) => sum + safeNum(r[4]), 0);
    const pendingPayments = pRows.slice(1).reduce((sum, r) => {
      const sub = safeNum(r[3]);
      const paid = safeNum(r[4]);
      return sum + Math.max(0, sub - paid);
    }, 0);
    
    const today = new Date().toISOString().split('T')[0];
    const todayAtt = aRows.slice(1).filter(r => safeStr(r[2]) === today);
    const presentToday = todayAtt.filter(r => safeStr(r[3]) === 'حاضر').length;
    const absentToday = todayAtt.filter(r => safeStr(r[3]) === 'غائب').length;
    
    const totalDays = todayAtt.length || 1;
    const attendanceRate = Math.round((presentToday / totalDays) * 100);
    
    res.json({
      success: true,
      data: {
        totalStudents, activeStudents, totalCourses, totalTeachers,
        totalRevenue, pendingPayments, presentToday, absentToday, attendanceRate
      }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows('بيانات_الطلاب')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]),
      phone: safeStr(r[6]), parentName: safeStr(r[4]), whatsapp: safeStr(r[5]),
      group: safeStr(r[9]), subscription: safeStr(r[8]), status: safeStr(r[11]), notes: safeStr(r[12])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [
      newId, d.name, d.grade, '', d.parentName, d.whatsapp, d.phone, '',
      d.subscription, d.group, new Date().toLocaleDateString('ar-EG'), d.status || 'نشط', d.notes || ''
    ];
    
    await appendRow('بيانات_الطلاب', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const { id, name, phone, subscription, status } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    if (name) await setCell('بيانات_الطلاب', row, 1, name);
    if (phone) await setCell('بيانات_الطلاب', row, 6, phone);
    if (subscription !== undefined) await setCell('بيانات_الطلاب', row, 8, subscription);
    if (status) await setCell('بيانات_الطلاب', row, 11, status);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    await clearRow('بيانات_الطلاب', idx);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// COURSES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/courses', async (req, res) => {
  try {
    const rows = (await getRows('الكورسات')).slice(1);
    const teachers = await getRows('المدرسين');
    
    const data = rows.map(r => {
      const teacherId = safeStr(r[3]);
      const teacherIdx = findRow(teachers, 0, teacherId);
      const teacherName = teacherIdx !== -1 ? safeStr(teachers[teacherIdx][1]) : safeStr(r[3]);
      
      return {
        id: safeStr(r[0]), name: safeStr(r[1]), subject: safeStr(r[2]),
        teacherId, teacherName, price: safeStr(r[4]), sessions: safeStr(r[5])
      };
    });
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/courses/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('الكورسات');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, d.name, d.subject, d.teacherId || '', d.price || '', d.sessions || ''];
    await appendRow('الكورسات', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/courses/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = await getRows('الكورسات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    await clearRow('الكورسات', idx);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEACHERS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/teachers', async (req, res) => {
  try {
    const rows = (await getRows('المدرسين')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), phone: safeStr(r[2]),
      subject: safeStr(r[4]), salaryType: safeStr(r[5]), salary: safeStr(r[6]), percentage: safeStr(r[7])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/teachers/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('المدرسين');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, d.name, d.phone, '1234', d.subject, d.salaryType, d.salary, d.percentage];
    await appendRow('المدرسين', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/teachers/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = await getRows('المدرسين');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    await clearRow('المدرسين', idx);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE API
// ═══════════════════════════════════════════════════════════════
app.post('/api/attendance/mark', async (req, res) => {
  try {
    const { studentId, status, date } = req.body;
    const sRows = await getRows('بيانات_الطلاب');
    const idx = findRow(sRows, 0, studentId);
    const studentName = idx !== -1 ? safeStr(sRows[idx][1]) : '';
    
    const rows = await getRows('الحضور');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, studentId, date, status, studentName];
    await appendRow('الحضور', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    const data = rows.map(r => ({
      name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]),
      subscription: safeStr(r[3]), paid: safeStr(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? 'مكتمل' : 'غير مكتمل'
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const { studentId, studentName, month, year, subscription, paid } = req.body;
    const sRows = await getRows('بيانات_الطلاب');
    const idx = findRow(sRows, 0, studentId);
    const group = idx !== -1 ? safeStr(sRows[idx][9]) : '';
    
    const newRow = [studentName, group, `${month} ${year}`, subscription, paid];
    await appendRow('المدفوعات', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GRADES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]),
      exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]),
      hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]),
      avg: safeStr(r[9]), grade: safeStr(r[10])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const { id, exam1, exam2, exam3, exam4, hw1, hw2, hw3, avg, grade } = req.body;
    const rows = await getRows('الدرجات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    if (exam1 !== undefined) await setCell('الدرجات', row, 2, exam1);
    if (exam2 !== undefined) await setCell('الدرجات', row, 3, exam2);
    if (exam3 !== undefined) await setCell('الدرجات', row, 4, exam3);
    if (exam4 !== undefined) await setCell('الدرجات', row, 5, exam4);
    if (hw1 !== undefined) await setCell('الدرجات', row, 6, hw1);
    if (hw2 !== undefined) await setCell('الدرجات', row, 7, hw2);
    if (hw3 !== undefined) await setCell('الدرجات', row, 8, hw3);
    if (avg !== undefined) await setCell('الدرجات', row, 9, avg);
    if (grade !== undefined) await setCell('الدرجات', row, 10, grade);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), day: safeStr(r[1]), time: safeStr(r[2]),
      group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5]),
      status: safeStr(r[6]) || 'نشط'
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const { day, time, group, subject, teacher } = req.body;
    const rows = await getRows('المواعيد');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, day, time, group, subject, teacher, 'نشط'];
    await appendRow('المواعيد', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL API
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const id = req.query.id;
    const aRows = await getRows('الحضور');
    const studentAtt = aRows.slice(1).filter(r => safeStr(r[1]) === id);
    const present = studentAtt.filter(r => safeStr(r[3]) === 'حاضر').length;
    const total = studentAtt.length || 1;
    const attRate = Math.round((present / total) * 100);
    
    const gRows = await getRows('الدرجات');
    const gIdx = findRow(gRows, 0, id);
    const avgGrade = gIdx !== -1 ? safeStr(gRows[gIdx][9]) : '-';
    const gradeLabel = gIdx !== -1 ? safeStr(gRows[gIdx][10]) : '-';
    
    res.json({ success: true, data: { attRate, avgGrade, gradeLabel } });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, req.query.id);
    if (idx === -1) return res.json({ success: false });
    const r = rows[idx];
    res.json({ success: true, data: { id: r[0], name: r[1], grade: r[2], group: r[9], phone: r[6] } });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === req.query.id);
    if (data.length === 0) return res.json({ success: true, data: [] });
    const r = data[0];
    res.json({
      success: true,
      data: [{
        exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5],
        hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]
      }]
    });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === req.query.name).map(r => ({
      monthYear: safeStr(r[2]), subscription: safeStr(r[3]), paid: safeStr(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? 'مكتمل' : 'غير مكتمل'
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const rows = (await getRows('الحضور')).slice(1);
    const data = rows.filter(r => safeStr(r[1]) === req.query.id).map(r => ({
      date: safeStr(r[2]), status: safeStr(r[3])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    res.json({
      success: true,
      data: rows.map(r => ({ day: r[1], time: r[2], subject: r[4] }))
    });
  } catch (e) {
    res.json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCUSES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows('الاعتذارات')).slice(1);
    const data = rows.map(r => ({
      id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]),
      date: safeStr(r[3]), reason: safeStr(r[4]), status: safeStr(r[5]) || 'قيد المراجعة',
      reply: safeStr(r[6])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/excuses/add', async (req, res) => {
  try {
    const { studentId, studentName, reason } = req.body;
    const rows = await getRows('الاعتذارات');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, studentId, studentName, new Date().toLocaleDateString('ar-EG'), reason, 'قيد المراجعة', ''];
    await appendRow('الاعتذارات', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const { id, status, reply } = req.body;
    const rows = await getRows('الاعتذارات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    await setCell('الاعتذارات', row, 5, status);
    if (reply) await setCell('الاعتذارات', row, 6, reply);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('═════════════════════════════════════════════════════');
  console.log('🚀 Smart Educational Center Server');
  console.log('═════════════════════════════════════════════════════');
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Spreadsheet: ${SPREADSHEET_ID}`);
  console.log(`👤 Admin: ${process.env.ADMIN_USER || 'admin'}`);
  console.log('═════════════════════════════════════════════════════');
});
