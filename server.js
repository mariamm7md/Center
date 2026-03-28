const express = require('express');
const { google } = require('googleapis');
const path = require('path');

// ====================== إعدادات ======================
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '19X6mghrTsNwMTD2bjz3iy3iBn0aZpLi7F3EXjYy_fpM';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====================== Google Auth ======================
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ====================== أدوات مساعدة ======================
async function getValues(range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    return res.data.values || [];
  } catch (e) { return []; }
}

async function updateValues(range, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range,
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });
}

async function appendValues(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range,
    valueInputOption: 'USER_ENTERED',
    resource: { values }
  });
}

function colLetter(c) {
  let s = '';
  while (c >= 0) { s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26) - 1; }
  return s;
}

function cleanPhone(p) { return p ? p.toString().replace(/\D/g, '') : ''; }

async function getSheetList() {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return res.data.sheets.map(s => ({ name: s.properties.title, gid: s.properties.sheetId }));
}

async function ensureSheet(name, headers) {
  const list = await getSheetList();
  if (!list.some(s => s.name === name)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: name } } }] }
    });
    if (headers) await appendValues(`'${name}'!A1`, [headers]);
  }
}

async function getMaxId(sheetName, col) {
  const rows = await getValues(`'${sheetName}'!A2:A`);
  let max = 0;
  rows.forEach(r => { const v = parseInt(r[0]); if (v > max) max = v; });
  return max;
}

function ok(data) { return { success: true, data }; }
function fail(msg) { return { success: false, message: msg }; }

// ====================== LOGIN ======================
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json(ok({ role: 'admin', name: 'المدير' }));
      return res.json(fail('بيانات الدخول غير صحيحة'));
    }
    if (role === 'student') {
      const rows = await getValues("'بيانات_الطلاب'!A2:H");
      for (const r of rows) {
        if (String(r[0]) === String(user)) {
          const phone = cleanPhone(r[6]), wa = cleanPhone(r[5]);
          if (phone.slice(-4) === pass || wa.slice(-4) === pass || pass === '1234')
            return res.json(ok({ role: 'student', name: r[1], studentId: r[0] }));
          return res.json(fail('رمز التحقق غير صحيح'));
        }
      }
      return res.json(fail('رقم الطالب غير موجود'));
    }
    res.json(fail('نوع الدخول غير معروف'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== ADMIN DASHBOARD ======================
app.get('/api/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const homeData = await getValues("'🏠 الرئيسية'!B4:F4");
    const totalStudents = homeData[0] ? (homeData[0][0] || 0) : 0;

    const stuRows = await getValues("'بيانات_الطلاب'!A2:L");
    let activeStudents = 0;
    stuRows.forEach(r => { if (r[0] && (r[11] === '✅ نشط' || r[11] === 'نشط')) activeStudents++; });

    const payRows = await getValues("'المدفوعات'!A2:F");
    let totalPaid = 0, totalRemaining = 0;
    payRows.forEach(r => {
      if (r[0]) { const p = (r[4]||0)*1, s = (r[3]||0)*1; totalPaid += p; totalRemaining += Math.max(0, s - p); }
    });

    let todayPresent = 0, todayAbsent = 0;
    const monthName = MONTHS_AR[now.getMonth()];
    const attRows = await getValues(`'${monthName}'!A5:${colLetter(4 + now.getDate() - 1)}`);
    attRows.forEach(r => {
      if (r[0] && String(r[1]) === String(now.getFullYear())) {
        const v = r[4 + now.getDate() - 1];
        if (v === 'ح') todayPresent++;
        if (v === 'غ') todayAbsent++;
      }
    });

    let pendingExcuses = 0;
    await ensureSheet('الاعتذارات', ['رقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','رد الإدارة']);
    const excRows = await getValues("'الاعتذارات'!A2:F");
    excRows.forEach(r => { if (r[0] && (r[4] === '⏳ قيد المراجعة' || r[4] === 'قيد المراجعة')) pendingExcuses++; });

    res.json(ok({
      totalStudents, activeStudents, totalPaid, totalRemaining,
      currentMonth: monthName + ' ' + now.getFullYear(),
      todayPresent, todayAbsent, pendingExcuses
    }));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== STUDENTS ======================
app.get('/api/students', async (req, res) => {
  try {
    const rows = await getValues("'بيانات_الطلاب'!A2:M");
    const out = [];
    rows.forEach(r => {
      if (r[0] && r[1]) out.push({
        id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'',
        parentName: r[4]||'', whatsapp: cleanPhone(r[5]),
        studentPhone: r[6]||'', phone2: r[7]||'', subscription: (r[8]||0)*1,
        group: r[9]||'مجموعة 1', joinDate: r[10]||'',
        status: r[11]||'✅ نشط', notes: r[12]||''
      });
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = await getValues("'بيانات_الطلاب'!A2:M");
    for (const r of rows) {
      if (String(r[0]) === String(req.params.id)) return res.json(ok({
        id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'',
        parentName: r[4]||'', whatsapp: r[5]||'', studentPhone: r[6]||'',
        phone2: r[7]||'', subscription: (r[8]||0)*1, group: r[9]||'مجموعة 1', status: r[11]||'✅ نشط'
      }));
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const maxId = await getMaxId('بيانات_الطلاب') + 1;
    const d = req.body;
    await appendValues("'بيانات_الطلاب'!A:M', [[
      maxId, d.name, d.grade, d.subject||'كيمياء', d.parentName,
      d.whatsapp, d.studentPhone, d.phone2, d.subscription, d.group,
      new Date().toISOString(), d.status, ''
    ]]);
    res.json(ok('تم إضافة الطالب'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getValues("'بيانات_الطلاب'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        const row = i + 2;
        const updates = [
          { col: 1, val: d.name }, { col: 2, val: d.grade }, { col: 3, val: d.subject },
          { col: 4, val: d.parentName }, { col: 5, val: d.whatsapp }, { col: 6, val: d.studentPhone },
          { col: 7, val: d.phone2 }, { col: 8, val: d.group }, { col: 9, val: d.subscription },
          { col: 11, val: d.status }
        ];
        for (const u of updates) {
          await updateValues(`'بيانات_الطلاب'!${colLetter(u.col)}${row}`, [[u.val]]);
        }
        return res.json(ok('تم التعديل'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const rows = await getValues("'بيانات_الطلاب'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.id)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: { requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } }] }
        });
        return res.json(ok('تم الحذف'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== ATTENDANCE ======================
app.get('/api/attendance', async (req, res) => {
  try {
    const { month, year } = req.query;
    const rows = await getValues(`'${month}'!A5:AI`);
    const out = [];
    rows.forEach(r => {
      if (r[0] && r[2] && String(r[1]) === String(year)) {
        const days = [];
        for (let d = 4; d < 35; d++) days.push(r[d] || '');
        out.push({ id: r[0], name: r[2], group: r[3]||'', days });
      }
    });
    res.json(ok(out));
  } catch (e) { res.json(ok([])); }
});

app.post('/api/attendance/save', async (req, res) => {
  try {
    const { month, year, day, records } = req.body;
    const col = 4 + day - 1;
    const rows = await getValues(`'${month}'!A5:D`);
    for (const rec of records) {
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === String(rec.studentId) && String(rows[i][1]) === String(year)) {
          await updateValues(`'${month}'!${colLetter(col)}${i + 5}`, [[rec.status]]);
          break;
        }
      }
    }
    res.json(ok('تم حفظ الحضور'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== PAYMENTS ======================
app.get('/api/payments', async (req, res) => {
  try {
    const rows = await getValues("'المدفوعات'!A2:F");
    const out = [];
    rows.forEach((r, i) => {
      if (r[0]) {
        const paid = (r[4]||0)*1, sub = (r[3]||0)*1, rem = sub - paid;
        out.push({ rowIndex: i+2, name: r[0], group: r[1], monthYear: r[2]||'',
          subscription: sub, paid, remaining: rem,
          status: rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل', notes: r[5]||'' });
      }
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const d = req.body;
    const my = d.month + ' ' + d.year;
    const rows = await getValues("'المدفوعات'!A2:F");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(d.studentName).trim() && String(rows[i][2]).trim() === my) {
        const cur = (rows[i][4]||0)*1 + d.paid;
        await updateValues(`'المدفوعات'!E${i+2}`, [[cur]]);
        return res.json(ok('تم إضافة المبلغ للسجل السابق'));
      }
    }
    await appendValues("'المدفوعات'!A:F', [[d.studentName, d.group, my, d.subscription, d.paid, d.notes||'']]);
    res.json(ok('تم تسجيل دفعة جديدة'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/payments/update', async (req, res) => {
  try {
    const { rowIndex, newPaid } = req.body;
    const rows = await getValues(`'المدفوعات'!E${rowIndex}:E${rowIndex}`);
    const cur = ((rows[0]&&rows[0][0])||0)*1 + newPaid;
    await updateValues(`'المدفوعات'!E${rowIndex}`, [[cur]]);
    res.json(ok('تم التحديث'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== GRADES ======================
app.get('/api/grades', async (req, res) => {
  try {
    const rows = await getValues("'الدرجات'!A2:L");
    const out = [];
    rows.forEach(r => {
      if (r[0]) out.push({
        id: r[0], name: r[1], exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5],
        hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]||'', notes: r[11]||''
      });
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getValues("'الدرجات'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        const row = i + 2;
        await updateValues(`'الدرجات'!C${row}:I${row}`, [[d.exam1,d.exam2,d.exam3,d.exam4,d.hw1,d.hw2,d.hw3]]);
        await updateValues(`'الدرجات'!J${row}:L${row}`, [[d.avg, d.grade, d.notes||'']]);
        return res.json(ok('تم الحفظ'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== SCHEDULES ======================
app.get('/api/schedules', async (req, res) => {
  try {
    await ensureSheet('المواعيد', ['رقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات']);
    const rows = await getValues("'المواعيد'!A2:H");
    const out = [];
    rows.forEach(r => {
      if (r[0]) out.push({ id: r[0], day: r[1]||'', time: r[2]||'', group: r[3]||'',
        subject: r[4]||'', teacher: r[5]||'', status: r[6]||'نشط', notes: r[7]||'' });
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const maxId = await getMaxId('المواعيد') + 1;
    const d = req.body;
    await appendValues("'المواعيد'!A:H', [[maxId, d.day, d.time, d.group, d.subject, d.teacher, 'نشط', d.notes||'']]);
    res.json(ok('تم إضافة الموعد'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/schedules/update', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getValues("'المواعيد'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        await updateValues(`'المواعيد'!B${i+2}:H${i+2}`, [[d.day,d.time,d.group,d.subject,d.teacher,d.status,d.notes||'']]);
        return res.json(ok('تم التحديث'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/schedules/delete', async (req, res) => {
  try {
    const rows = await getValues("'المواعيد'!A2:A");
    const list = await getSheetList();
    const sheetId = list.find(s => s.name === 'المواعيد')?.sheetId;
    if (sheetId === undefined) return res.json(fail('الشيت غير موجود'));
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.id)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i+1, endIndex: i+2 } } }] }
        });
        return res.json(ok('تم الحذف'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== EXCUSES ======================
app.get('/api/excuses', async (req, res) => {
  try {
    await ensureSheet('الاعتذارات', ['رقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','رد الإدارة']);
    const rows = await getValues("'الاعتذارات'!A2:G');
    const out = [];
    rows.forEach(r => {
      if (r[0]) out.push({ id: r[0], studentId: r[1], studentName: r[2],
        date: r[3] ? new Date(r[3]).toLocaleDateString('ar-EG') : '',
        reason: r[4]||'', status: r[5]||'⏳ قيد المراجعة', reply: r[6]||'' });
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/excuses/add', async (req, res) => {
  try {
    const maxId = await getMaxId('الاعتذارات') + 1;
    const d = req.body;
    await appendValues("'الاعتذارات'!A:G', [[maxId, d.studentId, d.studentName, new Date().toISOString(), d.reason, '⏳ قيد المراجعة', '']]);
    res.json(ok('تم إرسال الاعتذار'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const { id, status, reply } = req.body;
    const rows = await getValues("'الاعتذارات'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        await updateValues(`'الاعتذارات'!F${i+2}:G${i+2}`, [[status, reply||'']]);
        return res.json(ok('تم التحديث'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== ALERTS ======================
app.get('/api/alerts', async (req, res) => {
  try {
    const now = new Date();
    const monthName = MONTHS_AR[now.getMonth()];
    const dayCol = 4 + now.getDate() - 1;
    const attRows = await getValues(`'${monthName}'!A5:${colLetter(dayCol)}`);
    const stuRows = await getValues("'بيانات_الطلاب'!A2:F");
    const out = [];
    attRows.forEach(r => {
      if (r[0] && String(r[1]) === String(now.getFullYear()) && r[dayCol] === 'غ') {
        let wa = '';
        stuRows.forEach(s => { if (String(s[0]) === String(r[0]) && s[5]) wa = cleanPhone(s[5]); });
        if (wa) out.push({ name: r[2], whatsapp: wa,
          message: `مرحباً ولي أمر الطالب/ة ${r[2]}، يرجى العلم أنه تم تسجيل غياب للطالب اليوم.` });
      }
    });
    res.json(ok(out));
  } catch (e) { res.json(ok([])); }
});

// ====================== SHEETS LIST ======================
app.get('/api/sheets', async (req, res) => {
  try { res.json(ok(await getSheetList())); } catch (e) { res.json(fail(e.toString())); }
});

// ====================== STUDENT ENDPOINTS ======================
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const sid = req.query.id;
    const now = new Date();
    const monthName = MONTHS_AR[now.getMonth()];
    let present = 0, absent = 0, late = 0;
    const attRows = await getValues(`'${monthName}'!A5:AI`);
    for (const r of attRows) {
      if (String(r[0]) === String(sid) && String(r[1]) === String(now.getFullYear())) {
        for (let d = 4; d < 35; d++) { if (r[d]==='ح') present++; if (r[d]==='غ') absent++; if (r[d]==='ت') late++; }
        break;
      }
    }
    const total = present + absent + late;
    let avgGrade = '-', gradeLabel = '-';
    const grRows = await getValues("'الدرجات'!A2:L");
    for (const r of grRows) { if (String(r[0]) === String(sid)) { avgGrade = r[9]||'-'; gradeLabel = r[10]||'-'; break; } }
    // اسم الطالب
    let stuName = '';
    const stuRows = await getValues("'بيانات_الطلاب'!A2:B");
    for (const r of stuRows) { if (String(r[0]) === String(sid)) { stuName = r[1]; break; } }
    let unpaidCount = 0;
    if (stuName) {
      const payRows = await getValues("'المدفوعات'!A2:F");
      payRows.forEach(r => { if (r[0] && String(r[0]).trim() === String(stuName).trim() && (r[3]||0)*1 - (r[4]||0)*1 > 0) unpaidCount++; });
    }
    res.json(ok({ present, absent, late, attRate: total ? ((present/total)*100).toFixed(0) : 0, avgGrade, gradeLabel, unpaidCount, month: monthName }));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getValues("'بيانات_الطلاب'!A2:M");
    for (const r of rows) {
      if (String(r[0]) === String(req.query.id)) return res.json(ok({
        id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'',
        parentName: r[4]||'', whatsapp: r[5]||'', studentPhone: r[6]||'',
        phone2: r[7]||'', subscription: (r[8]||0)*1, group: r[9]||'مجموعة 1', status: r[11]||'✅ نشط'
      }));
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/student/profile/update', async (req, res) => {
  try {
    const { studentId, studentPhone, whatsapp, phone2 } = req.body;
    const rows = await getValues("'بيانات_الطلاب'!A2:A");
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(studentId)) {
        const row = i + 2;
        if (studentPhone !== undefined) await updateValues(`'بيانات_الطلاب'!G${row}`, [[studentPhone]]);
        if (whatsapp !== undefined) await updateValues(`'بيانات_الطلاب'!F${row}`, [[whatsapp]]);
        if (phone2 !== undefined) await updateValues(`'بيانات_الطلاب'!H${row}`, [[phone2]]);
        return res.json(ok('تم التحديث'));
      }
    }
    res.json(fail('لم يتم العثور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const now = new Date();
    const monthName = MONTHS_AR[now.getMonth()];
    const rows = await getValues(`'${monthName}'!A5:AI`);
    for (const r of rows) {
      if (String(r[0]) === String(req.query.id) && String(r[1]) === String(now.getFullYear())) {
        const days = []; for (let d = 4; d < 35; d++) days.push(r[d] || '');
        return res.json(ok({ month: monthName, group: r[3]||'', days }));
      }
    }
    res.json(ok({ month: monthName, days: [], group: '' }));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/student/attendance/mark', async (req, res) => {
  try {
    const { studentId, status } = req.body;
    const now = new Date();
    const monthName = MONTHS_AR[now.getMonth()];
    const dayCol = 4 + now.getDate() - 1;
    const rows = await getValues(`'${monthName}'!A5:D`);
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(studentId) && String(rows[i][1]) === String(now.getFullYear())) {
        await updateValues(`'${monthName}'!${colLetter(dayCol)}${i+5}`, [[status]]);
        return res.json(ok('تم تسجيل الحضور'));
      }
    }
    res.json(fail('لم يتم العثور عليك في سجل الحضور'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const rows = await getValues("'الدرجات'!A2:L");
    const out = [];
    rows.forEach(r => { if (String(r[0]) === String(req.query.id)) out.push({
      id: r[0], name: r[1], exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5],
      hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]||'', notes: r[11]||''
    }); });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const name = req.query.name;
    const rows = await getValues("'المدفوعات'!A2:F");
    const out = [];
    rows.forEach(r => {
      if (r[0] && String(r[0]).trim() === String(name).trim()) {
        const paid = (r[4]||0)*1, sub = (r[3]||0)*1, rem = sub - paid;
        out.push({ monthYear: r[2]||'', subscription: sub, paid, remaining: rem,
          status: rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل', notes: r[5]||'' });
      }
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/excuses', async (req, res) => {
  try {
    await ensureSheet('الاعتذارات', ['رقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','رد الإدارة']);
    const rows = await getValues("'الاعتذارات'!A2:G");
    const out = [];
    rows.forEach(r => {
      if (r[0] && String(r[1]) === String(req.query.id)) out.push({
        id: r[0], date: r[3] ? new Date(r[3]).toLocaleDateString('ar-EG') : '',
        reason: r[4]||'', status: r[5]||'⏳ قيد المراجعة', reply: r[6]||''
      });
    });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const maxId = await getMaxId('الاعتذارات') + 1;
    await appendValues("'الاعتذارات'!A:G', [[maxId, req.body.studentId, req.body.studentName, new Date().toISOString(), req.body.reason, '⏳ قيد المراجعة', '']]);
    res.json(ok('تم إرسال الاعتذار'));
  } catch (e) { res.json(fail(e.toString())); }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    await ensureSheet('المواعيد', ['رقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات']);
    const rows = await getValues("'المواعيد'!A2:H");
    const out = [];
    rows.forEach(r => { if (r[0] && r[6] !== 'ملغي') out.push({
      day: r[1]||'', time: r[2]||'', group: r[3]||'',
      subject: r[4]||'', teacher: r[5]||''
    }); });
    res.json(ok(out));
  } catch (e) { res.json(fail(e.toString())); }
});

// ====================== SERVE & START ======================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));