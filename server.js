const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// YOUR SPREADSHEET ID
const SPREADSHEET_ID = '1emhIjMexXdwWvuMQWHWQx4p0AtfjqcCie5IV0Pl4Rzk';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google Auth Setup
let credentials;
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  } else {
    credentials = require('./service-account.json');
  }
} catch (e) {
  console.error('❌ Auth Error: Missing service-account.json or GOOGLE_CREDENTIALS env var.');
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// Constants & Helpers
let SH = {}; // Sheet Names Map
const SH_DEF = { students:'الطلاب', attendance:'الحضور', payments:'المدفوعات', grades:'الدرجات', schedules:'المواعيد', excuses:'الاعتذارات' };
const MO = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

async function detectSheets() {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const names = r.data.sheets.map(s => s.properties.title);
    for (const k in SH_DEF) {
      const ex = SH_DEF[k];
      // Check if exact name exists, otherwise try to find similar
      SH[k] = names.includes(ex) ? ex : (names.find(n => n.includes(ex.replace('ال',''))) || ex);
    }
    console.log('✅ Sheets Detected:', SH);
  } catch (e) { 
    console.error('Error detecting sheets:', e.message);
    SH = { ...SH_DEF }; 
  }
}

function colL(i) { let s=''; while(i>=0){s=String.fromCharCode(65+(i%26))+s;i=Math.floor(i/26)-1;} return s; }
async function getRows(sn) { try { const r = await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:ZZ`}); return r.data.values||[]; } catch(e) { return []; } }
async function setCell(sn, row, col, val) { try { await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(col)}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[[val]]}}); return true; } catch(e) { return false; } }
async function setRange(sn, row, startCol, vals) { try { const ec = colL(startCol + vals.length - 1); await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(startCol)}${row}:${ec}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}}); return true; } catch(e) { return false; } }
async function appendRow(sn, vals) { try { await sheets.spreadsheets.values.append({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:A`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}}); return true; } catch(e) { return false; } }
async function deleteRow(sn, sheetRow) { try { const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }); const sid = r.data.sheets.find(s => s.properties.title === sn).properties.sheetId; await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:sheetRow-1,endIndex:sheetRow}}}]}}); return true; } catch(e) { return false; } }
async function nextId(sn) { const rows = await getRows(sn); if (rows.length <= 1) return 1; const ids = rows.slice(1).map(r => parseInt(r[0])).filter(id => !isNaN(id)); return ids.length ? Math.max(...ids) + 1 : 1; }
function findDR(allRows, colIdx, val) { for (let i = 1; i < allRows.length; i++) { if (String(allRows[i][colIdx] || '').trim() === String(val).trim()) return i + 1; } return -1; }
function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function safeStr(v) { return v == null ? '' : String(v).trim(); }

// Middleware to ensure sheets are loaded
app.use(async (req, res, next) => {
  if (Object.keys(SH).length === 0) await detectSheets();
  next();
});

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/setup', async (req, res) => {
  try {
    const ex = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const exN = ex.data.sheets.map(s => s.properties.title);
    const toAdd = [
      {n:'الطلاب',h:['الرقم','الاسم','الصف','المادة','ولي الأمر','واتساب','تليفون الطالب','تليفون ثاني','المجموعة','الاشتراك','الحالة','ملاحظات']},
      {n:'الحضور',h:['رقم الطالب','اسم الطالب','المجموعة','الشهر','السنة',...Array.from({length:31},(_,i)=>String(i+1))]},
      {n:'المدفوعات',h:['اسم الطالب','المجموعة','الشهر','السنة','الاشتراك','المدفوع','المتبقي','الحالة','ملاحظات']},
      {n:'الدرجات',h:['الرقم','الاسم','امتحان1','امتحان2','امتحان3','امتحان4','واجب1','واجب2','واجب3','المتوسط','التقدير','ملاحظات']},
      {n:'المواعيد',h:['الرقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات']},
      {n:'الاعتذارات',h:['الرقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','الرد']}
    ];
    let c = 0;
    for (const s of toAdd) {
      if (!exN.includes(s.n)) {
        await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{addSheet:{properties:{title:s.n}}}]}});
        await appendRow(s.n, s.h);
        c++;
      }
    }
    await detectSheets();
    res.json({ success:true, message:`Created ${c} sheets`, sheets:SH });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      // Default admin credentials (change in production)
      if (user === 'admin' && pass === 'admin123') return res.json({ success:true, data:{role:'admin',name:'المدير'} });
      return res.json({ success:false, message:'بيانات خاطئة' });
    }
    // Student Login
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, user);
    if (sr === -1) return res.json({ success:false, message:'رقم الطالب غير موجود' });
    const wa = safeStr(rows[sr-1][5]); // WhatsApp column
    const last4 = wa.length >= 4 ? wa.slice(-4) : '';
    // Allow login with last 4 digits of phone or default '1234'
    if (pass === last4 || pass === '1234') return res.json({success:true,data:{role:'student',name:safeStr(rows[sr-1][1]),studentId:safeStr(rows[sr-1][0])}});
    res.json({ success:false, message:'رمز التحقق خاطئ' });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// --- Admin APIs ---

app.get('/api/dashboard', async (req, res) => {
  try {
    const sR = await getRows(SH.students), ts = sR.length - 1;
    const as = sR.slice(1).filter(s => safeStr(s[10]).includes('نشط')).length;
    const pR = await getRows(SH.payments);
    let tp = 0, rm = 0; pR.slice(1).forEach(p => { tp += safeNum(p[5]); rm += safeNum(p[6]); });
    const now = new Date(), cm = MO[now.getMonth()], cy = String(now.getFullYear()), td = now.getDate();
    const aR = await getRows(SH.attendance);
    let tP = 0, tA = 0;
    aR.slice(1).forEach(r => {
      if (safeStr(r[3]) === cm && safeStr(r[4]) === cy) {
        const v = safeStr(r[4 + td]); // Column index 4 + day
        if (v === 'ح') tP++; if (v === 'غ') tA++;
      }
    });
    const eR = await getRows(SH.excuses);
    const pe = eR.slice(1).filter(e => safeStr(e[5]).includes('قيد')).length;
    res.json({success:true,data:{totalStudents:ts,activeStudents:as,totalPaid:tp,remaining:rm,currentMonth:cm,todayPresent:tP,todayAbsent:tA,pendingExcuses:pe}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows(SH.students)).slice(1);
    res.json({success:true,data:rows.map(r => ({id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10]),notes:safeStr(r[11])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, req.params.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    const r = rows[sr - 1];
    res.json({success:true,data:{id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10]),notes:safeStr(r[11])}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.students);
    await appendRow(SH.students, [id,safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription) || '0',safeStr(d.status),'']);
    res.json({ success: true, data:{id} });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.students);
    const sr = findDR(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await setRange(SH.students, sr, 1, [safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription)||'0',safeStr(d.status),safeStr(d.notes)||'']);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, req.body.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await deleteRow(SH.students, sr);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/attendance', async (req, res) => {
  try {
    const { month, year } = req.query;
    const rows = (await getRows(SH.attendance)).slice(1);
    const data = rows.filter(r => safeStr(r[3]) === (month||'') && safeStr(r[4]) === String(year||'')).map(r => {
      const days = [];
      for (let d = 0; d < 31; d++) days.push(safeStr(r[5 + d]));
      return { id:safeStr(r[0]), name:safeStr(r[1]), group:safeStr(r[2]), days };
    });
    res.json({ success: true, data });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/attendance/save', async (req, res) => {
  try {
    const { month, year, records } = req.body;
    const aR = await getRows(SH.attendance);
    const sR = await getRows(SH.students); // For fetching student details if new row needed

    for (const rec of records) {
      const dn = parseInt(rec.day);
      const ar = findDR(aR, 0, rec.studentId);
      
      // Check if row exists for this student in this month/year
      let existingRow = -1;
      for(let i=1; i<aR.length; i++) {
        if(safeStr(aR[i][0]) == rec.studentId && safeStr(aR[i][3]) == month && safeStr(aR[i][4]) == String(year)) {
          existingRow = i + 1; // 1-based index
          break;
        }
      }

      if (existingRow !== -1) {
        // Update existing cell
        await setCell(SH.attendance, existingRow, 4 + dn, rec.status);
      } else {
        // Create new row for this month
        const stuIdx = findDR(sR, 0, rec.studentId);
        const stu = stuIdx !== -1 ? sR[stuIdx - 1] : null;
        const days = Array(31).fill('');
        days[dn - 1] = rec.status;
        const newRow = [
          rec.studentId, 
          stu ? safeStr(stu[1]) : '', // Name
          stu ? safeStr(stu[8]) : '', // Group
          month, 
          String(year), 
          ...days
        ];
        await appendRow(SH.attendance, newRow);
      }
    }
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    res.json({ success:true, data: rows.map((r, i) => ({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8]),rowIndex:i+2}))}); // rowIndex is sheet row
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const d = req.body, sub = safeNum(d.subscription), pd = safeNum(d.paid), rem = sub - pd;
    const st = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await appendRow(SH.payments, [safeStr(d.studentName),safeStr(d.group),safeStr(d.month), String(d.year||''), sub, pd, rem, st, safeStr(d.notes)]);
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/payments/update', async (req, res) => {
  try {
    const { rowIndex, newPaid } = req.body;
    const rows = await getRows(SH.payments);
    // rowIndex from frontend needs to be the actual sheet row number now
    if (!rows[rowIndex-1]) return res.json({ success:false, message:'صف غير موجود' });
    const row = rows[rowIndex-1];
    const sub = safeNum(row[4]), up = safeNum(row[5]) + safeNum(newPaid), rem = sub - up;
    const st = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await setRange(SH.payments, rowIndex, 6, [up, rem, st]); // Columns F, G, H
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    res.json({ success:true, data: rows.map(r => ({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.grades);
    const sr = findDR(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await setRange(SH.grades, sr, 3, [safeStr(d.exam1),safeStr(d.exam2),safeStr(d.exam3),safeStr(d.exam4),safeStr(d.hw1),safeStr(d.hw2),safeStr(d.hw3),safeStr(d.avg),safeStr(d.grade),safeStr(d.notes)]);
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    res.json({ success:true, data: rows.map(r => ({id:safeStr(r[0]),day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5]),status:safeStr(r[6])||'نشط',notes:safeStr(r[7])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.schedules);
    await appendRow(SH.schedules, [id,safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),'نشط',safeStr(d.notes)]);
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.schedules);
    const sr = findDR(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await setRange(SH.schedules, sr, 2, [safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),safeStr(d.status)||'نشط',safeStr(d.notes)]);
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/delete', async (req, res) => {
  try {
    const rows = await getRows(SH.schedules);
    const sr = findDR(rows, 0, req.body.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await deleteRow(SH.schedules, sr);
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    res.json({ success:true, data: rows.map(r => ({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.excuses);
    const sr = findDR(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await setRange(SH.excuses, sr, 6, [safeStr(d.status), safeStr(d.reply)]); // Status & Reply columns
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/alerts', async (req, res) => {
  try {
    const now = new Date(), cm = MO[now.getMonth()], cy = String(now.getFullYear()), td = now.getDate();
    const aR = (await getRows(SH.attendance)).slice(1);
    const sR = await getRows(SH.students);
    const alerts = [];
    aR.forEach(r => {
      if (safeStr(r[3]) === cm && safeStr(r[4]) === cy && safeStr(r[4 + td]) === 'غ') {
        const sid = safeStr(r[0]);
        const sr2 = findDR(sR, 0, sid);
        const name = sr2 !== -1 ? safeStr(sR[sr2-1][1]) : sid;
        const wa = sr2 !== -1 ? safeStr(sR[sr2-1][5]) : '';
        alerts.push({ name, whatsapp: wa, message: `عذراً، تم تسجيل غياب ${name} اليوم.` });
      }
    });
    res.json({ success: true, data: alerts });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/sheets', async (req, res) => {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    res.json({ success:true, data: r.data.sheets.map(s => ({name:s.properties.title, gid:s.properties.sheetId})) });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// --- Student APIs ---

app.get('/api/student/dashboard', async (req, res) => {
  try {
    const { id } = req.query, now = new Date(), cm = MO[now.getMonth()], cy = String(now.getFullYear());
    const sR = await getRows(SH.students);
    const sr = findDR(sR, 0, id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    const stu = sR[sr - 1];
    const aR = (await getRows(SH.attendance)).slice(1);
    let p = 0, a = 0, l = 0;
    
    aR.forEach(r => {
      if (safeStr(r[0]) === safeStr(id) && safeStr(r[3]) === cm && safeStr(r[4]) === cy) {
        for (let d = 0; d < 31; d++) { const v = safeStr(r[5 + d]); if (v === 'ح') p++; else if (v === 'غ') a++; else if (v === 'ت') l++; }
      }
    });
    const tot = p + a + l, rate = tot > 0 ? Math.round((p / tot) * 100) : 0;
    const gR = (await getRows(SH.grades)).slice(1);
    const gRow = gR.find(r => safeStr(r[0]) === safeStr(id));
    const pR = (await getRows(SH.payments)).slice(1);
    const uc = pR.filter(p => safeStr(p[0]) === safeStr(stu[1]) && safeStr(p[7]).includes('غير')).length;
    res.json({ success: true, data: {attRate: rate, present: p, absent: a, late: l, avgGrade: gRow ? safeStr(gRow[9]) : '-', gradeLabel: gRow ? safeStr(gRow[10]) : '-', unpaidCount: uc, month: cm, grade: safeStr(stu[2]), group: safeStr(stu[8]), subject: safeStr(stu[3])} });
  } catch (e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDR(rows, 0, req.query.id);
    if (sr === -1) return res.json({ success:false, message: 'غير موجود' });
    const r = rows[sr - 1];
    res.json({ success: true, data: {id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10])} });
  } catch(e) { res.json({ success:false, message: e.message }); }
});

app.post('/api/student/profile/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.students);
    const sr = findDR(rows, 0, d.studentId);
    if (sr === -1) return res.json({ success:false, message: 'غير موجود' });
    await setRange(SH.students, sr, 6, [safeStr(d.whatsapp), safeStr(d.studentPhone), safeStr(d.phone2)]); // Update phone columns
    res.json({ success: true });
  } catch(e) { res.json({ success:false, message: e.message }); }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const now = new Date(), cm = MO[now.getMonth()], cy = String(now.getFullYear());
    const rows = (await getRows(SH.attendance)).slice(1);
    const row = rows.find(r => safeStr(r[0]) === String(req.query.id) && safeStr(r[3]) === cm && safeStr(r[4]) === cy);
    const days = [];
    if (row) { for (let d = 0; d < 31; d++) days.push(safeStr(row[5 + d])); }
    res.json({ success: true, data: { month: cm, days } });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === String(req.query.id)).map(r => ({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === safeStr(req.query.name)).map(r => ({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8])}));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    const data = rows.filter(r => safeStr(r[1]) === String(req.query.id)).map(r => ({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.excuses), now = new Date();
    await appendRow(SH.excuses, [id, safeStr(d.studentId), safeStr(d.studentName), `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`, safeStr(d.reason), 'قيد المراجعة', '']);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    const data = rows.filter(r => (safeStr(r[6]) || 'نشط') === 'نشط').map(r => ({day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5])}));
    res.json({ success: true, data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Start Server
app.listen(PORT, async () => {
  await detectSheets();
  console.log(`🚀 Server running on port ${PORT}`);
});
