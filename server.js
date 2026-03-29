require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Apps Script API URL
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwhfecD1-mDiMaW0c4wUIvYOx_10wfrD3oRfRCIdA-m2HAjAB5BHTi0oyPdyr_n_a2d/exec';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// API Call Functions
async function callAppsScript(action, params = {}) {
  try {
    const url = `${APPS_SCRIPT_URL}?action=${action}&${new URLSearchParams(params).toString()}`;
    console.log('GET:', url);
    const res = await fetch(url);
    const json = await res.json();
    console.log('Response:', JSON.stringify(json).substring(0, 200));
    return json;
  } catch (e) {
    console.error('GET Error:', e.message);
    return { success: false, message: e.message };
  }
}

async function postToAppsScript(action, data = {}) {
  try {
    const payload = { action, ...data };
    console.log('POST:', action, JSON.stringify(data).substring(0, 100));
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log('Response:', JSON.stringify(json).substring(0, 200));
    return json;
  } catch (e) {
    console.error('POST Error:', e.message);
    return { success: false, message: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  const result = await callAppsScript('test');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// LOGIN
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
    
    // Student login
    const result = await callAppsScript('verifyLogin', { studentId: user, code: pass });
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const result = await callAppsScript('dashboard');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS
// ═══════════════════════════════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const result = await callAppsScript('getStudents');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const result = await postToAppsScript('deleteStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const result = await callAppsScript('getPayments');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addPayment', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GRADES
// ═══════════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const result = await callAppsScript('getGrades');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateGrade', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES
// ═══════════════════════════════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await callAppsScript('getSchedules');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════
app.post('/api/attendance/mark', async (req, res) => {
  try {
    const result = await postToAppsScript('markAttendance', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCUSES
// ═══════════════════════════════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  try {
    const result = await callAppsScript('getExcuses');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateExcuse', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const result = await callAppsScript('studentDashboard', { id: req.query.id });
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const result = await callAppsScript('studentProfile', { id: req.query.id });
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const result = await callAppsScript('studentGrades', { id: req.query.id });
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const result = await callAppsScript('studentPayments', { name: req.query.name });
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const result = await callAppsScript('studentAttendance', { id: req.query.id });
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const result = await callAppsScript('getSchedules');
    res.json(result);
  } catch (e) {
    res.json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('═════════════════════════════════════════════════════');
  console.log('🚀 Smart Educational Center');
  console.log('═════════════════════════════════════════════════════');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 API: Connected to Apps Script`);
  console.log('═════════════════════════════════════════════════════');
});
