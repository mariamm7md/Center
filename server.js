const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1emhIjMexXdwWvuMQWHWQx4p0AtfjqcCie5IV0Pl4Rzk';

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
  console.error('❌ Auth Error: Make sure service-account.json exists.', e.message);
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const getRows = async (sn) => {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sn}!A:ZZ` });
    return r.data.values || [];
  } catch (e) {
    console.error(`Error reading ${sn}:`, e.message);
    return [];
  }
};

const findRow = (rows, col, val) => {
  for (let i = 0; i < rows.length; i++) {
    if (safeStr(rows[i][col]) === safeStr(val)) return i;
  }
  return -1;
};

const colL = (i) => {
  let s = '';
  i++; // 1-indexed for calculation
  while (i > 0) {
    const mod = (i - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

const setCell = async (sn, row, col, val) => {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sn}!${colL(col)}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[val]] }
    });
  } catch (e) { console.error(e); }
};

const appendRow = async (sn, vals) => {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sn}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [vals] }
    });
  } catch (e) { console.error(e); }
};

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

// Main HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Login
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      // Default admin credentials (change in production)
      if (user === 'admin' && pass === 'admin123') return res.json({ success: true, data: { role: 'admin', name: 'المدير' } });
      return res.json({ success: false, message: 'بيانات خاطئة' });
    }
    
    // Student Login
    const rows = await getRows('بيانات_الطلاب');
    // ID is Col 0
    const idx = findRow(rows, 0, user);
    if (idx === -1) return res.json({ success: false, message: 'رقم الطالب غير موجود' });
    
    // WhatsApp is Col 5. Check last 4 digits or default code
    const wa = safeStr(rows[idx][5]);
    if (pass === wa.slice(-4) || pass === '1234') {
      return res.json({ success: true, data: { role: 'student', name: safeStr(rows[idx][1]), studentId: safeStr(rows[idx][0]) } });
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
    // Status is Col 11
    const active = sRows.slice(1).filter(r => safeStr(r[11]).includes('نشط')).length;
    // Paid Amount is Col 4 in Payments
    const paid = pRows.slice(1).reduce((sum, r) => sum + safeNum(r[4]), 0);
    
    res.json({ success: true, data: { totalStudents: total, activeStudents: active, totalPaid: paid } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS API
// ═══════════════════════════════════════════════════════════════

app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows('بيانات_الطلاب')).slice(1);
    // Mapping: 0رقم | 1اسم | 2صف | 3مادة | 4ولي أمر | 5واتساب | 6تليفون طالب | 7تليفون2 | 8تاريخ | 9اشتراك | 10مجموعة | 11حالة | 12ملاحظات
    const data = rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]),
      parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]),
      phone2: safeStr(r[7]), subscription: safeStr(r[9]), group: safeStr(r[10]),
      status: safeStr(r[11]), notes: safeStr(r[12])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [
      newId, d.name, d.grade, d.subject, d.parentName, d.whatsapp, d.studentPhone,
      d.phone2 || '', new Date().toLocaleDateString('ar-EG'), d.subscription, d.group, d.status, d.notes || ''
    ];
    
    await appendRow('بيانات_الطلاب', newRow);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const { id, name, grade, whatsapp, studentPhone, group, subscription, status } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    // Update cells (Row index is idx+1 for sheet)
    const row = idx + 1;
    if (name) await setCell('بيانات_الطلاب', row, 1, name);
    if (grade) await setCell('بيانات_الطلاب', row, 2, grade);
    if (whatsapp) await setCell('بيانات_الطلاب', row, 5, whatsapp);
    if (studentPhone) await setCell('بيانات_الطلاب', row, 6, studentPhone);
    if (group) await setCell('بيانات_الطلاب', row, 10, group);
    if (subscription) await setCell('بيانات_الطلاب', row, 9, subscription);
    if (status) await setCell('بيانات_الطلاب', row, 11, status);
    
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    // Clear row content (simple approach) or use batchUpdate to delete row
    // Using clear for simplicity here
    const range = `بيانات_الطلاب!A${idx+1}:M${idx+1}`;
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
    
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS & GRADES API
// ═══════════════════════════════════════════════════════════════

app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    // 0اسم | 1مجموعة | 2شهر | 3اشتراك | 4مدفوع | 5ملاحظات
    const data = rows.map((r, i) => ({
      name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]),
      subscription: safeStr(r[3]), paid: safeStr(r[4]), notes: safeStr(r[5]),
      remaining: safeNum(r[3]) - safeNum(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? '✅ مكتمل' : '⚠️ غير مكتمل',
      rowIndex: i
    }));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    // 0رقم | 1اسم | 2-5 امتحانات | 6-8 واجبات | 9متوسط | 10تقدير
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
    const { id, exam1, exam2, exam3, exam4, hw1, hw2, hw3, avg, grade } = req.body;
    const rows = await getRows('الدرجات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    // Update cells
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
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES & EXCUSES API
// ═══════════════════════════════════════════════════════════════

app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    // 0رقم | 1يوم | 2وقت | 3مجموعة | 4مادة | 5مدرس | 6حالة
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

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL API
// ═══════════════════════════════════════════════════════════════

app.get('/api/student/dashboard', async (req, res) => { 
  // Implement logic to calculate student stats
  res.json({ success: true, data: { attRate: 85, avgGrade: 'B+', gradeLabel: 'جيد جداً' } }); 
});

app.get('/api/student/profile', async (req, res) => { 
   try {
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, req.query.id);
    if (idx === -1) return res.json({ success: false });
    const r = rows[idx];
    res.json({ success: true, data: { id: r[0], name: r[1], grade: r[2], group: r[10], whatsapp: r[5] } });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/grades', async (req, res) => { 
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === req.query.id);
    if(data.length === 0) return res.json({ success: true, data: [] });
    const r = data[0];
    res.json({ success: true, data: [{ 
      exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5], 
      hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10] 
    }] });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/payments', async (req, res) => { 
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    // Filter by name (Col 0)
    const data = rows.filter(r => safeStr(r[0]) === req.query.name).map(r => ({
      monthYear: safeStr(r[2]), subscription: safeStr(r[3]), paid: safeStr(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? '✅ مكتمل' : '⚠️ غير مكتمل'
    }));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

app.get('/api/student/schedules', async (req, res) => { 
  // For simplicity, returning all schedules. Ideally filter by student group.
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    res.json({ success: true, data: rows.map(r => ({
      day: r[1], time: r[2], group: r[3], subject: r[4]
    })) });
  } catch(e) { res.json({ success: false }); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const { studentId, studentName, reason } = req.body;
    const rows = await getRows('الاعتذارات');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, studentId, studentName, new Date().toLocaleDateString('ar-EG'), reason, 'قيد المراجعة', ''];
    await appendRow('الاعتذارات', newRow);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/excuses', async (req, res) => { 
  try {
    const rows = (await getRows('الاعتذارات')).slice(1);
    const data = rows.filter(r => safeStr(r[1]) === req.query.id);
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false }); }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
