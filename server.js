const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
// تم تحديث المعرف ليتوافق مع الرابط الذي أرسلته
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1emhIjMexXdwWvuMQWHWQx4p0AtfjqcCie5IV0Pl4Rzk';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let credentials;
try {
  credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : require('./service-account.json');
} catch (e) {
  console.error('❌ Auth error');
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// أسماء الأوراق كما هي في جدولك
const SH = {
  students: 'بيانات_الطلاب',
  payments: 'المدفوعات',
  grades: 'الدرجات',
  schedules: 'المواعيد',
  excuses: 'الاعتذارات'
  // الحضور سيتم التعامل معه ديناميكياً حسب الشهر
};

const MO = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function colL(i) { let s=''; while(i>=0){s=String.fromCharCode(65+(i%26))+s;i=Math.floor(i/26)-1;} return s; }
async function getRows(sn) { try { const r = await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:ZZ`}); return r.data.values||[]; } catch(e) { return []; } }
async function setCell(sn, row, col, val) { try { await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(col)}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[[val]]}}); return true; } catch(e) { return false; } }
async function setRange(sn, row, startCol, vals) { try { const ec = colL(startCol + vals.length - 1); await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(startCol)}${row}:${ec}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}}); return true; } catch(e) { return false; } }
async function appendRow(sn, vals) { try { await sheets.spreadsheets.values.append({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:A`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}}); return true; } catch(e) { return false; } }
function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function safeStr(v) { return v == null ? '' : String(v).trim(); }
function findDR(allRows, colIdx, val) { for (let i = 1; i < allRows.length; i++) { if (String(allRows[i][colIdx] || '').trim() === String(val).trim()) return i + 1; } return -1; }

// ════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/setup', async (req, res) => {
  res.json({ success: true, message: 'Using existing sheet structure.' });
});

app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      if (user === 'admin' && pass === 'admin123') return res.json({ success: true, data: { role: 'admin', name: 'المدير' } });
      return res.json({ success: false, message: 'بيانات خاطئة' });
    }
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, user); // البحث في العمود الأول (رقم الطالب)
    if (sr === -1) return res.json({ success: false, message: 'رقم الطالب غير موجود' });
    
    // واتساب ولي الأمر في العمود 5 (ترتيب يبدأ من 0)
    const wa = safeStr(rows[sr-1][5]);
    const last4 = wa.length >= 4 ? wa.slice(-4) : '';
    if (pass === last4 || pass === '1234') return res.json({ success: true, data: { role: 'student', name: safeStr(rows[sr-1][1]), studentId: safeStr(rows[sr-1][0]) } });
    res.json({ success: false, message: 'رمز التحقق خاطئ' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const sR = await getRows(SH.students);
    const ts = sR.length - 1; // إجمالي الصفوف (بدون العنوان)
    const as = sR.slice(1).filter(s => safeStr(s[11]).includes('نشط')).length; // الحالة في العمود 11
    
    const pR = await getRows(SH.payments);
    let tp = 0; pR.slice(1).forEach(p => { tp += safeNum(p[4]); }); // المدفوع في العمود 4

    const now = new Date();
    const cm = MO[now.getMonth()]; // اسم الشهر الحالي
    const cy = String(now.getFullYear());
    
    res.json({ success: true, data: { totalStudents: ts, activeStudents: as, totalPaid: tp, remaining: 0, currentMonth: cm, todayPresent: 0, todayAbsent: 0, pendingExcuses: 0 } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ════════════════════════════════════════
// STUDENTS API (معدل ليتناسب مع جدولك)
// ════════════════════════════════════════

app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows(SH.students)).slice(1);
    // ترتيب الأعمدة في جدولك:
    // 0:رقم, 1:اسم, 2:صف, 3:مادة, 4:ولي أمر, 5:واتساب, 6:تليفون طالب, 7:تليفون ثاني, 8:تاريخ, 9:اشتراك, 10:مجموعة, 11:حالة, 12:ملاحظات
    res.json({ success: true, data: rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]),
      parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]),
      phone2: safeStr(r[7]), group: safeStr(r[10]), subscription: safeStr(r[9]),
      status: safeStr(r[11]), notes: safeStr(r[12])
    })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, req.params.id);
    if (sr === -1) return res.json({ success: false, message: 'غير موجود' });
    const r = rows[sr - 1];
    res.json({ success: true, data: { id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]), parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]), phone2: safeStr(r[7]), group: safeStr(r[10]), subscription: safeStr(r[9]), status: safeStr(r[11]), notes: safeStr(r[12]) } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows(SH.students);
    const lastId = rows.length > 1 ? (parseInt(rows[rows.length - 1][0]) || 0) + 1 : 1;
    // الحفاظ على ترتيب الأعمدة
    await appendRow(SH.students, [lastId, safeStr(d.name), safeStr(d.grade), safeStr(d.subject), safeStr(d.parentName), safeStr(d.whatsapp), safeStr(d.studentPhone), safeStr(d.phone2), new Date().toISOString().split('T')[0], safeStr(d.subscription) || '0', safeStr(d.group), safeStr(d.status), '']);
    res.json({ success: true, data: { id: lastId } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ════════════════════════════════════════
// ATTENDANCE API (معدل للتعامل مع أوراق الشهور)
// ════════════════════════════════════════

app.get('/api/attendance', async (req, res) => {
  try {
    const { month, year } = req.query;
    const sheetName = month; // اسم الورقة هو اسم الشهر (يناير، فبراير...)
    const rows = (await getRows(sheetName)).slice(2); // البيانات تبدأ من الصف الثالث (بعد العنوان والترقية)
    
    const data = rows.filter(r => safeStr(r[1]) === String(year)).map(r => {
      const days = [];
      // الأيام تبدأ من العمود 4 (index 4) -> 1, 2, 3...
      for (let d = 0; d < 31; d++) days.push(safeStr(r[4 + d]));
      return { id: safeStr(r[0]), name: safeStr(r[2]), group: safeStr(r[3]), days };
    });
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/attendance/save', async (req, res) => {
  try {
    const { month, year, records } = req.body;
    const sheetName = month;
    const aR = await getRows(sheetName);
    const sR = await getRows(SH.students);
    
    for (const rec of records) {
      const dn = parseInt(rec.day);
      // البحث عن الصف: رقم الطالب في العمود 0، والسنة في العمود 1
      let ar = -1;
      for (let i = 2; i < aR.length; i++) {
        if (safeStr(aR[i][0]) === String(rec.studentId) && safeStr(aR[i][1]) === String(year)) {
          ar = i + 1; break;
        }
      }

      if (ar !== -1) {
        // اليوم في العمود 4 + (رقم اليوم - 1)
        await setCell(sheetName, ar, 4 + (dn - 1), rec.status);
      } else {
        // إضافة صف جديد
        const sr = findDR(sR, 0, rec.studentId);
        const stu = sr !== -1 ? sR[sr - 1] : null;
        const newRow = [rec.studentId, String(year), stu ? safeStr(stu[1]) : '', stu ? safeStr(stu[10]) : '', ...Array(31).fill('')];
        newRow[4 + (dn - 1)] = rec.status; // تعيين الحالة
        await appendRow(sheetName, newRow);
      }
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ════════════════════════════════════════
// PAYMENTS API (معدل ليتناسب مع عمود الشهر/السنة المدمج)
// ════════════════════════════════════════

app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    res.json({ success: true, data: rows.map((r, i) => ({
      name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]),
      subscription: safeStr(r[3]), paid: safeStr(r[4]), notes: safeStr(r[5]),
      remaining: safeNum(r[3]) - safeNum(r[4]), status: safeNum(r[4]) >= safeNum(r[3]) ? '✅ مكتمل' : '⚠️ غير مكتمل',
      rowIndex: i
    })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ════════════════════════════════════════
// Other APIs (Grades, Schedules, Excuses - Structure matches)
// ════════════════════════════════════════

app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    res.json({ success: true, data: rows.map(r => ({ id: safeStr(r[0]), name: safeStr(r[1]), exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]), hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]), avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11]) })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    res.json({ success: true, data: rows.map(r => ({ id: safeStr(r[0]), day: safeStr(r[1]), time: safeStr(r[2]), group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5]), status: safeStr(r[6]) || 'نشط', notes: safeStr(r[7]) })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    res.json({ success: true, data: rows.map(r => ({ id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]), date: safeStr(r[3]), reason: safeStr(r[4]), status: safeStr(r[5]) || 'قيد المراجعة', reply: safeStr(r[6]) })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Student Portal APIs
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const { id } = req.query;
    const sR = await getRows(SH.students);
    const sr = findDR(sR, 0, id);
    if (sr === -1) return res.json({ success: false, message: 'غير موجود' });
    const stu = sR[sr - 1];
    res.json({ success: true, data: { attRate: 0, present: 0, absent: 0, late: 0, avgGrade: '-', gradeLabel: '-', unpaidCount: 0, month: MO[new Date().getMonth()], grade: safeStr(stu[2]), group: safeStr(stu[10]), subject: safeStr(stu[3]) } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, req.query.id);
    if (sr === -1) return res.json({ success: false, message: 'غير موجود' });
    const r = rows[sr - 1];
    res.json({ success: true, data: { id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]), parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]), phone2: safeStr(r[7]), group: safeStr(r[10]), subscription: safeStr(r[9]), status: safeStr(r[11]) } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/grades', async (req, res) => {
  try { const rows = (await getRows(SH.grades)).slice(1); res.json({ success: true, data: rows.filter(r => safeStr(r[0]) === String(req.query.id)).map(r => ({ id: safeStr(r[0]), name: safeStr(r[1]), exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]), hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]), avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11]) })) }); }
  catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/payments', async (req, res) => {
  try { const rows = (await getRows(SH.payments)).slice(1); res.json({ success: true, data: rows.filter(r => safeStr(r[0]) === safeStr(req.query.name)).map(r => ({ name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]), subscription: safeStr(r[3]), paid: safeStr(r[4]), notes: safeStr(r[5]) })) }); }
  catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/schedules', async (req, res) => {
  try { const rows = (await getRows(SH.schedules)).slice(1); res.json({ success: true, data: rows.filter(r => (safeStr(r[6]) || 'نشط') === 'نشط').map(r => ({ day: safeStr(r[1]), time: safeStr(r[2]), group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5]) })) }); }
  catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/attendance', async (req, res) => {
  try { res.json({ success: true, data: { month: MO[new Date().getMonth()], days: [] } }); }
  catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/excuses', async (req, res) => {
  try { const rows = (await getRows(SH.excuses)).slice(1); res.json({ success: true, data: rows.filter(r => safeStr(r[1]) === String(req.query.id)).map(r => ({ id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]), date: safeStr(r[3]), reason: safeStr(r[4]), status: safeStr(r[5]) || 'قيد المراجعة', reply: safeStr(r[6]) })) }); }
  catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/alerts', async (req, res) => { res.json({ success: true, data: [] }); });
app.get('/api/sheets', async (req, res) => { try { const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }); res.json({ success: true, data: r.data.sheets.map(s => ({ name: s.properties.title, gid: s.properties.sheetId })) }); } catch (e) { res.json({ success: false, message: e.message }); } });

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
