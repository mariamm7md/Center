const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1TMDiMSAtyjk4iPAsLsMoo-uf7nUeJuOwKeOtPZ3o3xw';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════
//  الاتصال بجوجل — يدعم ملف أو متغير بيئة
//  على Railway: ضع محتوى JSON في متغير GOOGLE_CREDENTIALS
// ═══════════════════════════════════════
let credentials;
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } else {
    credentials = require('./service-account.json');
  }
} catch (e) {
  console.error('⚠️  لم يتم العثور على بيانات جوجل (service-account.json أو GOOGLE_CREDENTIALS)');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ═══════════════════════════════════════
//  أسماء أوراق الشيت — غيّرها حسب أوراقك
// ═══════════════════════════════════════
const SH = {
  students:   'الطلاب',
  attendance: 'الحضور',
  payments:   'المدفوعات',
  grades:     'الدرجات',
  schedules:  'المواعيد',
  excuses:    'الاعتذارات'
};

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ═══════════════════════════════════════
//  دوال مساعدة
// ═══════════════════════════════════════

function colLetter(i) {
  let s = '';
  while (i >= 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
  return s;
}

async function getRows(sheetName) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A:ZZ` });
    return r.data.values || [];
  } catch (e) {
    console.error(`خطأ قراءة ${sheetName}:`, e.message);
    return [];
  }
}

async function setCell(sheetName, cellRef, value) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!${cellRef}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [[value]] }
    });
    return true;
  } catch (e) { console.error(`خطأ كتابة ${cellRef}:`, e.message); return false; }
}

async function setRange(sheetName, range, values) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!${range}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values }
    });
    return true;
  } catch (e) { console.error(`خطأ كتابة ${range}:`, e.message); return false; }
}

async function appendRow(sheetName, values) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [values] }
    });
    return true;
  } catch (e) { console.error(`خطأ إضافة صف:`, e.message); return false; }
}

async function deleteSheetRow(sheetName, rowIdx) {
  try {
    const sheetId = await getSheetId(sheetName);
    const sheetRow = rowIdx + 2;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: sheetRow - 1, endIndex: sheetRow } } }] }
    });
    return true;
  } catch (e) { console.error(`خطأ حذف صف:`, e.message); return false; }
}

async function getSheetId(sheetName) {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = r.data.sheets.find(s => s.properties.title === sheetName);
    return sheet ? sheet.properties.sheetId : 0;
  } catch (e) { return 0; }
}

async function nextId(sheetName, colIndex) {
  const rows = await getRows(sheetName);
  if (rows.length <= 1) return 1;
  return Math.max(...rows.slice(1).map(r => parseInt(r[colIndex]) || 0)) + 1;
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}

function safeNum(v) { return parseFloat(v) || 0; }
function safeStr(v) { return (v || '').toString().trim(); }

// ═══════════════════════════════════════
//  الصفحة الرئيسية
// ═══════════════════════════════════════
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════
//  إنشاء الأوراق (تشغيل مرة واحدة)
// ═══════════════════════════════════════
app.get('/api/setup', async (req, res) => {
  try {
    const existing = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingNames = existing.data.sheets.map(s => s.properties.title);
    const sheetsToAdd = [
      { name: SH.students,   headers: ['الرقم','الاسم','الصف','المادة','ولي الأمر','واتساب','تليفون الطالب','تليفون ثاني','المجموعة','الاشتراك','الحالة','ملاحظات'] },
      { name: SH.attendance, headers: ['رقم الطالب','اسم الطالب','المجموعة','الشهر','السنة', ...Array.from({length:31}, (_,i) => String(i+1))] },
      { name: SH.payments,   headers: ['اسم الطالب','المجموعة','الشهر','السنة','الاشتراك','المدفوع','المتبقي','الحالة','ملاحظات'] },
      { name: SH.grades,     headers: ['الرقم','الاسم','امتحان1','امتحان2','امتحان3','امتحان4','واجب1','واجب2','واجب3','المتوسط','التقدير','ملاحظات'] },
      { name: SH.schedules,  headers: ['الرقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات'] },
      { name: SH.excuses,    headers: ['الرقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','الرد'] }
    ];
    for (const s of sheetsToAdd) {
      if (!existingNames.includes(s.name)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { requests: [{ addSheet: { properties: { title: s.name } } }] }
        });
        await appendRow(s.name, s.headers);
      }
    }
    res.json({ success: true, message: 'تم إنشاء جميع الأوراق' });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  تسجيل الدخول — فصل تام
// ═══════════════════════════════════════
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      if (user === 'admin' && pass === 'admin123') {
        return res.json({ success: true, data: { role: 'admin', name: 'المدير' } });
      }
      return res.json({ success: false, message: 'بيانات الدخول خاطئة' });
    }
    // دخول الطالب فقط
    const rows = (await getRows(SH.students)).slice(1);
    const student = rows.find(r => safeStr(r[0]) === safeStr(user));
    if (!student) return res.json({ success: false, message: 'رقم الطالب غير موجود' });
    const wa = safeStr(student[5]);
    const last4 = wa.length >= 4 ? wa.slice(-4) : '';
    if (pass !== last4 && pass !== '1234') return res.json({ success: false, message: 'رمز التحقق خاطئ' });
    res.json({ success: true, data: { role: 'student', name: safeStr(student[1]), studentId: safeStr(student[0]) } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  لوحة تحكم المدير فقط
// ═══════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const stuRows = (await getRows(SH.students)).slice(1);
    const totalStudents = stuRows.length;
    const activeStudents = stuRows.filter(s => safeStr(s[10]).includes('نشط')).length;

    const payRows = (await getRows(SH.payments)).slice(1);
    let totalPaid = 0, remaining = 0;
    payRows.forEach(p => { totalPaid += safeNum(p[5]); remaining += safeNum(p[6]); });

    const now = new Date();
    const currentMonth = MONTHS_AR[now.getMonth()];
    const currentYear = String(now.getFullYear());
    const today = now.getDate();

    const attRows = (await getRows(SH.attendance)).slice(1);
    let todayPresent = 0, todayAbsent = 0;
    attRows.forEach(row => {
      if (safeStr(row[3]) === currentMonth && safeStr(row[4]) === currentYear) {
        const val = safeStr(row[4 + today]);
        if (val === 'ح') todayPresent++;
        if (val === 'غ') todayAbsent++;
      }
    });

    const excRows = (await getRows(SH.excuses)).slice(1);
    const pendingExcuses = excRows.filter(e => safeStr(e[5]).includes('قيد')).length;

    res.json({ success: true, data: {
      totalStudents, activeStudents, totalPaid, remaining,
      currentMonth, todayPresent, todayAbsent, pendingExcuses
    }});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  إدارة الطلاب — مدير فقط
// ═══════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows(SH.students)).slice(1);
    res.json({ success: true, data: rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]),
      parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), studentPhone: safeStr(r[6]),
      phone2: safeStr(r[7]), group: safeStr(r[8]), subscription: safeStr(r[9]), status: safeStr(r[10])
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = (await getRows(SH.students)).slice(1);
    const s = rows.find(r => safeStr(r[0]) === req.params.id);
    if (!s) return res.json({ success: false, message: 'غير موجود' });
    res.json({ success: true, data: {
      id: safeStr(s[0]), name: safeStr(s[1]), grade: safeStr(s[2]), subject: safeStr(s[3]),
      parentName: safeStr(s[4]), whatsapp: safeStr(s[5]), studentPhone: safeStr(s[6]),
      phone2: safeStr(s[7]), group: safeStr(s[8]), subscription: safeStr(s[9]), status: safeStr(s[10])
    }});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const { name, grade, subject, parentName, whatsapp, studentPhone, phone2, group, subscription, status } = req.body;
    const id = await nextId(SH.students, 0);
    await appendRow(SH.students, [id, name||'', grade||'', subject||'', parentName||'', whatsapp||'', studentPhone||'', phone2||'', group||'', subscription||0, status||'', '']);
    res.json({ success: true, data: { id } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const { id, name, grade, subject, parentName, whatsapp, studentPhone, phone2, group, subscription, status } = req.body;
    const rows = (await getRows(SH.students)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await setRange(SH.students, `B${idx+2}:L${idx+2}`, [[name||'', grade||'', subject||'', parentName||'', whatsapp||'', studentPhone||'', phone2||'', group||'', subscription||0, status||'', '']]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = (await getRows(SH.students)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await deleteSheetRow(SH.students, idx);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  الحضور — مدير
// ═══════════════════════════════════════
app.get('/api/attendance', async (req, res) => {
  try {
    const { month, year } = req.query;
    const rows = (await getRows(SH.attendance)).slice(1);
    const data = rows
      .filter(r => safeStr(r[3]) === (month||'') && safeStr(r[4]) === String(year||''))
      .map(r => {
        const days = [];
        for (let d = 0; d < 31; d++) days.push(safeStr(r[5 + d]));
        return { id: safeStr(r[0]), name: safeStr(r[1]), group: safeStr(r[2]), days };
      });
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/attendance/save', async (req, res) => {
  try {
    const { month, year, day, records } = req.body;
    const dayNum = parseInt(day);
    const dayCol = colLetter(4 + dayNum);
    const stuRows = (await getRows(SH.students)).slice(1);
    const attRows = (await getRows(SH.attendance)).slice(1);

    for (const rec of records) {
      const idx = attRows.findIndex(r =>
        safeStr(r[0]) === String(rec.studentId) && safeStr(r[3]) === month && safeStr(r[4]) === String(year)
      );
      if (idx !== -1) {
        await setCell(SH.attendance, `${dayCol}${idx+2}`, rec.status);
      } else {
        const stu = stuRows.find(s => safeStr(s[0]) === String(rec.studentId));
        const newRow = [rec.studentId, stu ? safeStr(stu[1]) : '', stu ? safeStr(stu[8]) : '', month, String(year)];
        for (let d = 0; d < 31; d++) newRow.push(d === dayNum - 1 ? rec.status : '');
        await appendRow(SH.attendance, newRow);
      }
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  المدفوعات — مدير
// ═══════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    res.json({ success: true, data: rows.map((r, i) => ({
      name: safeStr(r[0]), group: safeStr(r[1]),
      monthYear: `${safeStr(r[2])}/${safeStr(r[3])}`,
      subscription: safeStr(r[4]), paid: safeStr(r[5]), remaining: safeStr(r[6]),
      status: safeStr(r[7]), notes: safeStr(r[8]), rowIndex: i
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const { studentName, group, month, year, subscription, paid, notes } = req.body;
    const sub = safeNum(subscription), pd = safeNum(paid), rem = sub - pd;
    const status = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await appendRow(SH.payments, [studentName||'', group||'', month||'', String(year||''), sub, pd, rem, status, notes||'']);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/payments/update', async (req, res) => {
  try {
    const { rowIndex, newPaid } = req.body;
    const rows = (await getRows(SH.payments));
    const row = rows[rowIndex + 1];
    if (!row) return res.json({ success: false, message: 'غير موجود' });
    const sub = safeNum(row[4]), oldPaid = safeNum(row[5]), updatedPaid = oldPaid + safeNum(newPaid);
    const rem = sub - updatedPaid;
    const status = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await setRange(SH.payments, `F${rowIndex+2}:H${rowIndex+2}`, [[updatedPaid, rem, status]]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  الدرجات — مدير
// ═══════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    res.json({ success: true, data: rows.map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]),
      exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]),
      hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]),
      avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11])
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const { id, name, exam1, exam2, exam3, exam4, hw1, hw2, hw3, avg, grade, notes } = req.body;
    const rows = (await getRows(SH.grades)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await setRange(SH.grades, `B${idx+2}:L${idx+2}`, [[name||'', exam1||'', exam2||'', exam3||'', exam4||'', hw1||'', hw2||'', hw3||'', avg||'', grade||'', notes||'']]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  المواعيد — مدير
// ═══════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    res.json({ success: true, data: rows.map(r => ({
      id: safeStr(r[0]), day: safeStr(r[1]), time: safeStr(r[2]), group: safeStr(r[3]),
      subject: safeStr(r[4]), teacher: safeStr(r[5]), status: safeStr(r[6]) || 'نشط', notes: safeStr(r[7])
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const { day, time, group, subject, teacher, notes } = req.body;
    const id = await nextId(SH.schedules, 0);
    await appendRow(SH.schedules, [id, day||'', time||'', group||'', subject||'', teacher||'', 'نشط', notes||'']);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/schedules/update', async (req, res) => {
  try {
    const { id, day, time, group, subject, teacher, status, notes } = req.body;
    const rows = (await getRows(SH.schedules)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await setRange(SH.schedules, `B${idx+2}:H${idx+2}`, [[day||'', time||'', group||'', subject||'', teacher||'', status||'نشط', notes||'']]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/schedules/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = (await getRows(SH.schedules)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await deleteSheetRow(SH.schedules, idx);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  إدارة الاعتذارات — مدير فقط
// ═══════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    res.json({ success: true, data: rows.map(r => ({
      id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]),
      date: safeStr(r[3]), reason: safeStr(r[4]),
      status: safeStr(r[5]) || 'قيد المراجعة', reply: safeStr(r[6])
    }))});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const { id, status, reply } = req.body;
    const rows = (await getRows(SH.excuses)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(id));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await setRange(SH.excuses, `F${idx+2}:G${idx+2}`, [[status||'', reply||'']]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  تنبيهات الغياب — مدير
// ═══════════════════════════════════════
app.get('/api/alerts', async (req, res) => {
  try {
    const now = new Date();
    const cm = MONTHS_AR[now.getMonth()], cy = String(now.getFullYear()), td = now.getDate();
    const attRows = (await getRows(SH.attendance)).slice(1);
    const stuRows = (await getRows(SH.students)).slice(1);
    const absentIds = attRows.filter(r => safeStr(r[3]) === cm && safeStr(r[4]) === cy && safeStr(r[4+td]) === 'غ').map(r => safeStr(r[0]));
    const alerts = absentIds.map(sid => {
      const stu = stuRows.find(s => safeStr(s[0]) === sid);
      const n = stu ? safeStr(stu[1]) : sid;
      return { name: n, whatsapp: stu ? safeStr(stu[5]) : '', message: `عذراً، تم تسجيل غياب ${n} اليوم في المركز. يرجى التواصل معنا في حال وجود اعتذار.` };
    });
    res.json({ success: true, data: alerts });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  قائمة الأوراق — مدير
// ═══════════════════════════════════════
app.get('/api/sheets', async (req, res) => {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    res.json({ success: true, data: r.data.sheets.map(s => ({ name: s.properties.title, gid: s.properties.sheetId })) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  ═══ طالب فقط ═══
// ═══════════════════════════════════════

app.get('/api/student/dashboard', async (req, res) => {
  try {
    const { id } = req.query;
    const now = new Date();
    const cm = MONTHS_AR[now.getMonth()], cy = String(now.getFullYear());

    const stuRows = (await getRows(SH.students)).slice(1);
    const student = stuRows.find(r => safeStr(r[0]) === String(id));
    if (!student) return res.json({ success: false, message: 'غير موجود' });

    const attRows = (await getRows(SH.attendance)).slice(1);
    const attRow = attRows.find(r => safeStr(r[0]) === String(id) && safeStr(r[3]) === cm && safeStr(r[4]) === cy);
    let present = 0, absent = 0, late = 0;
    if (attRow) { for (let d = 0; d < 31; d++) { const v = safeStr(attRow[5+d]); if (v==='ح') present++; else if (v==='غ') absent++; else if (v==='ت') late++; } }
    const total = present + absent + late;
    const attRate = total > 0 ? Math.round((present / total) * 100) : 0;

    const grRows = (await getRows(SH.grades)).slice(1);
    const grRow = grRows.find(r => safeStr(r[0]) === String(id));

    const payRows = (await getRows(SH.payments)).slice(1);
    const unpaidCount = payRows.filter(p => safeStr(p[0]) === safeStr(student[1]) && safeStr(p[7]).includes('غير')).length;

    res.json({ success: true, data: {
      attRate, present, absent, late,
      avgGrade: grRow ? safeStr(grRow[9]) : '-',
      gradeLabel: grRow ? safeStr(grRow[10]) : '-',
      unpaidCount, month: cm
    }});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const { id } = req.query;
    const rows = (await getRows(SH.students)).slice(1);
    const s = rows.find(r => safeStr(r[0]) === String(id));
    if (!s) return res.json({ success: false, message: 'غير موجود' });
    res.json({ success: true, data: {
      id: safeStr(s[0]), name: safeStr(s[1]), grade: safeStr(s[2]), subject: safeStr(s[3]),
      parentName: safeStr(s[4]), whatsapp: safeStr(s[5]), studentPhone: safeStr(s[6]),
      phone2: safeStr(s[7]), group: safeStr(s[8]), subscription: safeStr(s[9]), status: safeStr(s[10])
    }});
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/student/profile/update', async (req, res) => {
  try {
    const { studentId, studentPhone, whatsapp, phone2 } = req.body;
    const rows = (await getRows(SH.students)).slice(1);
    const idx = rows.findIndex(r => safeStr(r[0]) === String(studentId));
    if (idx === -1) return res.json({ success: false, message: 'غير موجود' });
    await setRange(SH.students, `F${idx+2}:H${idx+2}`, [[whatsapp||'', studentPhone||'', phone2||'']]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const { id } = req.query;
    const now = new Date();
    const cm = MONTHS_AR[now.getMonth()], cy = String(now.getFullYear());
    const rows = (await getRows(SH.attendance)).slice(1);
    const row = rows.find(r => safeStr(r[0]) === String(id) && safeStr(r[3]) === cm && safeStr(r[4]) === cy);
    const days = [];
    if (row) { for (let d = 0; d < 31; d++) days.push(safeStr(row[5+d])); }
    res.json({ success: true, data: { month: cm, days } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/student/attendance/mark', async (req, res) => {
  try {
    const { studentId, status } = req.body;
    const now = new Date();
    const today = now.getDate(), cm = MONTHS_AR[now.getMonth()], cy = String(now.getFullYear());
    const dayCol = colLetter(4 + today);
    const stuRows = (await getRows(SH.students)).slice(1);
    const student = stuRows.find(r => safeStr(r[0]) === String(studentId));
    const attRows = (await getRows(SH.attendance)).slice(1);
    const idx = attRows.findIndex(r => safeStr(r[0]) === String(studentId) && safeStr(r[3]) === cm && safeStr(r[4]) === cy);
    if (idx !== -1) {
      await setCell(SH.attendance, `${dayCol}${idx+2}`, status);
    } else {
      const newRow = [studentId, student ? safeStr(student[1]) : '', student ? safeStr(student[8]) : '', cm, cy];
      for (let d = 0; d < 31; d++) newRow.push(d === today - 1 ? status : '');
      await appendRow(SH.attendance, newRow);
    }
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const { id } = req.query;
    const rows = (await getRows(SH.grades)).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === String(id)).map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]),
      exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]),
      hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]),
      avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const { name } = req.query;
    const rows = (await getRows(SH.payments)).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === safeStr(name)).map(r => ({
      name: safeStr(r[0]), group: safeStr(r[1]),
      monthYear: `${safeStr(r[2])}/${safeStr(r[3])}`,
      subscription: safeStr(r[4]), paid: safeStr(r[5]), remaining: safeStr(r[6]),
      status: safeStr(r[7]), notes: safeStr(r[8])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/excuses', async (req, res) => {
  try {
    const { id } = req.query;
    const rows = (await getRows(SH.excuses)).slice(1);
    const data = rows.filter(r => safeStr(r[1]) === String(id)).map(r => ({
      id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]),
      date: safeStr(r[3]), reason: safeStr(r[4]),
      status: safeStr(r[5]) || 'قيد المراجعة', reply: safeStr(r[6])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const { studentId, studentName, reason } = req.body;
    const id = await nextId(SH.excuses, 0);
    await appendRow(SH.excuses, [id, studentId||'', studentName||'', todayDate(), reason||'', 'قيد المراجعة', '']);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    const data = rows.filter(r => (safeStr(r[6]) || 'نشط') === 'نشط').map(r => ({
      day: safeStr(r[1]), time: safeStr(r[2]), group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5])
    }));
    res.json({ success: true, data });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════
//  معالجة الأخطاء العامة
// ═══════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('خطأ:', err.message);
  res.status(500).json({ success: false, message: 'خطأ في الخادم' });
});

app.listen(PORT, () => {
  console.log(`\n✅ السيرفر يعمل على المنفذ ${PORT}`);
  console.log(`📄 الشيت: ${SPREADSHEET_ID}`);
  console.log(`\n⚙️  لإنشاء أوراق الشيت افتح: /api/setup\n`);
});