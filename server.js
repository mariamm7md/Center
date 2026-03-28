const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1TMDiMSAtyjk4iPAsLsMoo-uf7nUeJuOwKeOtPZ3o3xw';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══ Google Auth ═══
let credentials;
try {
  credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : require('./service-account.json');
} catch (e) {
  console.error('❌ لم يتم العثور على بيانات المصادقة');
  app.get('*', (req, res) => {
    res.status(500).send(`<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#070b12;color:#e4e9f2;font-family:system-ui;text-align:center;padding:20px"><div><div style="font-size:60px;margin-bottom:20px">⚠️</div><h2 style="color:#ff5757;margin-bottom:12px">خطأ في المصادقة</h2><p style="color:#6b7a94">أضف متغير <code style="background:#1c2d48;padding:2px 8px;border-radius:4px;color:#00d4aa">GOOGLE_CREDENTIALS</code> في Railway</p></div></div>`);
  });
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

// ═══ Sheet Names ═══
let SH = {};
const SH_DEF = { students:'الطلاب', attendance:'الحضور', payments:'المدفوعات', grades:'الدرجات', schedules:'المواعيد', excuses:'الاعتذارات' };
const MO_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

async function detectSheets() {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const names = r.data.sheets.map(s => s.properties.title);
    for (const k in SH_DEF) {
      const ex = SH_DEF[k];
      SH[k] = names.includes(ex) ? ex : (names.find(n => n.includes(ex.replace('ال',''))) || ex);
    }
  } catch (e) { SH = { ...SH_DEF }; }
}

// ═══ Helpers — صف صفري (row 1 = هيدر، row 2 = أول بيانات) ═══
function colL(i) { let s=''; while(i>=0){s=String.fromCharCode(65+(i%26))+s;i=Math.floor(i/26)-1;} return s; }

async function getRows(sn) {
  try { const r = await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:ZZ`}); return r.data.values||[]; }
  catch(e) { return []; }
}

async function setCell(sn, row, col, val) {
  try { await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(col)}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[[val]]}}); return true; }
  catch(e) { console.error('setCell err:',e.message); return false; }
}

async function setRange(sn, row, startCol, vals) {
  try {
    const endCol = colL(startCol + vals[0].length - 1);
    await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${colL(startCol)}${row}:${endCol}${row}`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}});
    return true;
  } catch(e) { console.error('setRange err:',e.message); return false; }
}

async function appendRow(sn, vals) {
  try { await sheets.spreadsheets.values.append({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:A`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}}); return true; }
  catch(e) { console.error('appendRow err:',e.message); return false; }
}

async function deleteRow(sn, sheetRow) {
  try {
    const r = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
    const sid = r.data.sheets.find(s => s.properties.title === sn).properties.sheetId;
    await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:sheetRow-1,endIndex:sheetRow}}}]}});
    return true;
  } catch(e) { console.error('deleteRow err:',e.message); return false; }
}

async function nextId(sn) {
  const rows = await getRows(sn);
  if (rows.length <= 1) return 1;
  const ids = rows.slice(1).map(r => parseInt(r[0])).filter(id => !isNaN(id));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

// ابحث في البيانات فقط (بعد الهيدر) وارجع رقم الصف في الشيت (1-based)
function findDataRow(allRows, colIdx, val) {
  for (let i = 1; i < allRows.length; i++) {
    if (String(allRows[i][colIdx] || '').trim() === String(val).trim()) return i + 1; // +1 لأن الشيت يبدأ من 1
  }
  return -1;
}

function safeNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function safeStr(v) { return v == null ? '' : String(v).trim(); }

// ═══ Serve ═══
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ═══ Setup ═══
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
    res.json({ success:true, message:`تم إنشاء ${c} أوراق`, sheets:SH });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Login ═══
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    if (role === 'admin') {
      if (user === 'admin' && pass === 'admin123') return res.json({ success:true, data:{role:'admin',name:'المدير'} });
      return res.json({ success:false, message:'بيانات خاطئة' });
    }
    const rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, user);
    if (sr === -1) return res.json({ success:false, message:'رقم الطالب غير موجود' });
    const wa = safeStr(rows[sr-1][5]);
    const last4 = wa.length >= 4 ? wa.slice(-4) : '';
    if (pass === last4 || pass === '1234') return res.json({ success:true, data:{role:'student',name:safeStr(rows[sr-1][1]),studentId:safeStr(rows[sr-1][0])} });
    res.json({ success:false, message:'رمز التحقق خاطئ' });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Dashboard ═══
app.get('/api/dashboard', async (req, res) => {
  try {
    const sRows = await getRows(SH.students);
    const ts = sRows.length - 1;
    const as = sRows.slice(1).filter(s => safeStr(s[10]).includes('نشط')).length;
    const pRows = await getRows(SH.payments);
    let tp=0, rm=0; pRows.slice(1).forEach(p=>{tp+=safeNum(p[5]);rm+=safeNum(p[6]);});
    const now=new Date(), cm=MO_AR[now.getMonth()], cy=String(now.getFullYear()), td=now.getDate();
    const aRows = await getRows(SH.attendance);
    let tP=0, tA=0;
    aRows.slice(1).forEach(r=>{if(safeStr(r[3])===cm&&safeStr(r[4])===cy){const v=safeStr(r[4+td]);if(v==='ح')tP++;if(v==='غ')tA++;}});
    const eRows = await getRows(SH.excuses);
    const pe = eRows.slice(1).filter(e => safeStr(e[5]).includes('قيد')).length;
    res.json({success:true,data:{totalStudents:ts,activeStudents:as,totalPaid:tp,remaining:rm,currentMonth:cm,todayPresent:tP,todayAbsent:tA,pendingExcuses:pe}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Students CRUD ═══
app.get('/api/students', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    res.json({success:true,data:rows.slice(1).map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10]),notes:safeStr(r[11])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, req.params.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    const r = rows[sr-1];
    res.json({success:true,data:{id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10]),notes:safeStr(r[11])}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.students);
    await appendRow(SH.students, [id,safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription)||'0',safeStr(d.status),'']);
    res.json({ success:true, data:{id} });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    // B=1,L=11 → 11 قيمة
    await setRange(SH.students, sr, 1, [safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription)||'0',safeStr(d.status),safeStr(d.notes)||'']);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, req.body.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await deleteRow(SH.students, sr);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Attendance ═══
app.get('/api/attendance', async (req, res) => {
  try {
    const {month,year} = req.query;
    const rows = (await getRows(SH.attendance)).slice(1);
    const data = rows.filter(r => safeStr(r[3]) === (month||'') && safeStr(r[4]) === String(year||'')).map(r => {
      const days = [];
      for (let d=0; d<31; d++) days.push(safeStr(r[5+d]));
      return {id:safeStr(r[0]),name:safeStr(r[1]),group:safeStr(r[2]),days};
    });
    res.json({success:true,data});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/attendance/save', async (req, res) => {
  try {
    const {month,year,records} = req.body;
    const aRows = await getRows(SH.attendance);
    const sRows = await getRows(SH.students);

    for (const rec of records) {
      const dn = parseInt(rec.day);
      const dc = colL(4 + dn); // العمود F = يوم 1
      const ar = findDataRow(aRows, 0, rec.studentId);

      if (ar !== -1) {
        // تحقق أن الشهر والسنة متطابقين
        if (safeStr(aRows[ar-1][3]) === month && safeStr(aRows[ar-1][4]) === String(year)) {
          await setCell(SH.attendance, ar, 4+dn, rec.status);
        }
      } else {
        // أنشئ صف جديد
        const stu = findDataRow(sRows, 0, rec.studentId);
        const nr = [rec.studentId, stu!==-1?safeStr(sRows[stu-1][1]):'', stu!==-1?safeStr(sRows[stu-1][8]):'', month, String(year)];
        const days = Array(31).fill('');
        days[dn-1] = rec.status;
        await appendRow(SH.attendance, [...nr, ...days]);
      }
    }
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Payments ═══
app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    res.json({success:true,data:rows.map((r,i) => ({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8]),rowIndex:i}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const d = req.body, sub=safeNum(d.subscription), pd=safeNum(d.paid), rem=sub-pd;
    const st = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await appendRow(SH.payments, [safeStr(d.studentName),safeStr(d.group),safeStr(d.month),String(d.year||''),sub,pd,rem,st,safeStr(d.notes)]);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/payments/update', async (req, res) => {
  try {
    const {rowIndex,newPaid} = req.body;
    const rows = await getRows(SH.payments);
    const sr = rowIndex + 2; // +2 لأن rowIndex 0-based و rows تتضمن الهيدر
    if (!rows[sr-1]) return res.json({ success:false, message:'غير موجود' });
    const row = rows[sr-1];
    const sub = safeNum(row[4]), up = safeNum(row[5]) + safeNum(newPaid), rem = sub - up;
    const st = rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل';
    await setRange(SH.payments, sr, 5, [up, rem, st]); // F=5, G=6, H=7
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Grades ═══
app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.grades);
    const sr = findDataRow(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    // C=2 إلى L=11 → 9 قيم
    await setRange(SH.grades, sr, 2, [safeStr(d.exam1),safeStr(d.exam2),safeStr(d.exam3),safeStr(d.exam4),safeStr(d.hw1),safeStr(d.hw2),safeStr(d.hw3),safeStr(d.avg),safeStr(d.grade),safeStr(d.notes)]);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Schedules ═══
app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5]),status:safeStr(r[6])||'نشط',notes:safeStr(r[7])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.schedules);
    await appendRow(SH.schedules, [id,safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),'نشط',safeStr(d.notes)]);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.schedules);
    const sr = findDataRow(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    // B=1 إلى H=7 → 7 قيم
    await setRange(SH.schedules, sr, 1, [safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),safeStr(d.status)||'نشط',safeStr(d.notes)]);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/schedules/delete', async (req, res) => {
  try {
    const rows = await getRows(SH.schedules);
    const sr = findDataRow(rows, 0, req.body.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    await deleteRow(SH.schedules, sr);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Excuses ═══
app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.excuses);
    const sr = findDataRow(rows, 0, d.id);
    if (sr === -1) return res.json({ success:false, message:'غير موجود' });
    // F=5, G=6 → 2 قيم
    await setRange(SH.excuses, sr, 5, [safeStr(d.status), safeStr(d.reply)]);
    res.json({ success:true });
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Alerts ═══
app.get('/api/alerts', async (req, res) => {
  try {
    const now=new Date(), cm=MO_AR[now.getMonth()], cy=String(now.getFullYear()), td=now.getDate();
    const aRows = (await getRows(SH.attendance)).slice(1);
    const sRows = await getRows(SH.students);
    const alerts = [];
    aRows.forEach(r => {
      if (safeStr(r[3])===cm && safeStr(r[4])===cy && safeStr(r[4+td])==='غ') {
        const sid = safeStr(r[0]);
        const sr = findDataRow(sRows, 0, sid);
        const name = sr!==-1 ? safeStr(sRows[sr-1][1]) : sid;
        const wa = sr!==-1 ? safeStr(sRows[sr-1][5]) : '';
        alerts.push({name, whatsapp:wa, message:`عذراً، تم تسجيل غياب ${name} اليوم في المركز. يرجى التواصل معنا.`});
      }
    });
    res.json({success:true,data:alerts});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Downloads ═══
app.get('/api/sheets', async (req, res) => {
  try {
    const r = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
    res.json({success:true,data:r.data.sheets.map(s=>({name:s.properties.title,gid:s.properties.sheetId}))});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Student Endpoints ═══
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const {id} = req.query, now=new Date(), cm=MO_AR[now.getMonth()], cy=String(now.getFullYear());
    const sRows = await getRows(SH.students);
    const sr = findDataRow(sRows, 0, id);
    if (sr === -1) return res.json({success:false,message:'غير موجود'});
    const stu = sRows[sr-1];

    const aRows = (await getRows(SH.attendance)).slice(1);
    let p=0,a=0,l=0;
    aRows.forEach(r => {
      if(safeStr(r[0])===safeStr(id) && safeStr(r[3])===cm && safeStr(r[4])===cy) {
        for(let d=0;d<31;d++){const v=safeStr(r[5+d]);if(v==='ح')p++;else if(v==='غ')a++;else if(v==='ت')l++;}
      }
    });
    const tot=p+a+l, rate=tot>0?Math.round((p/tot)*100):0;

    const gRows = (await getRows(SH.grades)).slice(1);
    const gRow = gRows.find(r => safeStr(r[0])===safeStr(id));

    const pRows = (await getRows(SH.payments)).slice(1);
    const uc = pRows.filter(p => safeStr(p[0])===safeStr(stu[1]) && safeStr(p[7]).includes('غير')).length;

    res.json({success:true,data:{attRate:rate,present:p,absent:a,late:l,avgGrade:gRow?safeStr(gRow[9]):'-',gradeLabel:gRow?safeStr(gRow[10]):'-',unpaidCount:uc,month:cm,grade:sv(stu[2]),group:sv(stu[8]),subject:sv(stu[3])}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, req.query.id);
    if (sr === -1) return res.json({success:false,message:'غير موجود'});
    const r = rows[sr-1];
    res.json({success:true,data:{id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10])}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/student/profile/update', async (req, res) => {
  try {
    const d = req.body, rows = await getRows(SH.students);
    const sr = findDataRow(rows, 0, d.studentId);
    if (sr === -1) return res.json({success:false,message:'غير موجود'});
    // F=5, G=6, H=7 → 3 قيم
    await setRange(SH.students, sr, 5, [safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2)]);
    res.json({success:true});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const now=new Date(), cm=MO_AR[now.getMonth()], cy=String(now.getFullYear());
    const rows = (await getRows(SH.attendance)).slice(1);
    const row = rows.find(r => safeStr(r[0])===String(req.query.id) && safeStr(r[3])===cm && safeStr(r[4])===cy);
    const days = [];
    if (row) { for(let d=0;d<31;d++) days.push(safeStr(row[5+d])); }
    res.json({success:true,data:{month:cm,days}});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/student/attendance/mark', async (req, res) => {
  try {
    const {studentId,status} = req.body, now=new Date(), today=now.getDate();
    const cm=MO_AR[now.getMonth()], cy=String(now.getFullYear()), dc=colL(4+today);
    const sRows = await getRows(SH.students);
    const sr = findDataRow(sRows, 0, studentId);
    const stu = sr!==-1 ? sRows[sr-1] : null;

    const aRows = await getRows(SH.attendance);
    const ar = findDataRow(aRows, 0, studentId);

    if (ar !== -1 && safeStr(aRows[ar-1][3])===cm && safeStr(aRows[ar-1][4])===cy) {
      await setCell(SH.attendance, ar, 4+today, status);
    } else {
      const nr = [studentId, stu?safeStr(stu[1]):'', stu?safeStr(stu[8]):'', cm, cy];
      const days = Array(31).fill('');
      days[today-1] = status;
      await appendRow(SH.attendance, [...nr, ...days]);
    }
    res.json({success:true});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const rows = (await getRows(SH.grades)).slice(1);
    const data = rows.filter(r => safeStr(r[0])===String(req.query.id)).map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}));
    res.json({success:true,data});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const rows = (await getRows(SH.payments)).slice(1);
    const data = rows.filter(r => safeStr(r[0])===safeStr(req.query.name)).map(r=>({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8])}));
    res.json({success:true,data});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/excuses', async (req, res) => {
  try {
    const rows = (await getRows(SH.excuses)).slice(1);
    const data = rows.filter(r => safeStr(r[1])===String(req.query.id)).map(r=>({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}));
    res.json({success:true,data});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.post('/api/student/excuses/add', async (req, res) => {
  try {
    const d = req.body, id = await nextId(SH.excuses), now=new Date();
    await appendRow(SH.excuses, [id,safeStr(d.studentId),safeStr(d.studentName),`${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`,safeStr(d.reason),'قيد المراجعة','']);
    res.json({success:true});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const rows = (await getRows(SH.schedules)).slice(1);
    const data = rows.filter(r => (safeStr(r[6])||'نشط')==='نشط').map(r=>({day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5])}));
    res.json({success:true,data});
  } catch(e) { res.json({ success:false, message:e.message }); }
});

// ═══ Error Handler ═══
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message);
  res.status(500).json({ success:false, message:'خطأ في الخادم: ' + err.message });
});

// ═══ Start ═══
app.listen(PORT, async () => {
  await detectSheets();
  console.log(`\n🚀 Server: http://localhost:${PORT}`);
  console.log(`📄 Sheet: ${SPREADSHEET_ID}`);
  console.log(`⚙️  Setup: /api/setup\n`);
});
