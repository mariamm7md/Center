require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Google Apps Script API URL
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxnvlHejzKFH3DUGX3LPF8m96W21jzZvK34touTD_e7ktYpv_s9qBvEY_EW2G42WF-X/exec';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// Generic API call to Apps Script
async function callAppsScript(action, data = {}) {
  try {
    const url = `${APPS_SCRIPT_URL}?action=${action}&${new URLSearchParams(data).toString()}`;
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error('Apps Script error:', e.message);
    return { success: false, message: e.message };
  }
}

async function postAppsScript(action, data = {}) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    return await res.json();
  } catch (e) {
    console.error('Apps Script POST error:', e.message);
    return { success: false, message: e.message };
  }
}

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Login
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
    
    // Student - call Apps Script
    const result = await callAppsScript('verifyLogin', { studentId: user, code: pass });
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const result = await callAppsScript('dashboard');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Students
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
    const result = await postAppsScript('addStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const result = await postAppsScript('updateStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const result = await postAppsScript('deleteStudent', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Payments
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
    const result = await postAppsScript('addPayment', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Grades
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
    const result = await postAppsScript('updateGrade', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Schedules
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await callAppsScript('getSchedules');
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Attendance
app.post('/api/attendance/mark', async (req, res) => {
  try {
    const result = await postAppsScript('markAttendance', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Excuses
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
    const result = await postAppsScript('updateExcuse', req.body);
    res.json(result);
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Student Portal
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

// Start
app.listen(PORT, () => {
  console.log('═════════════════════════════════════════════════════');
  console.log('🚀 Smart Educational Center');
  console.log('═════════════════════════════════════════════════════');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 API: ${APPS_SCRIPT_URL}`);
  console.log('═════════════════════════════════════════════════════');
});
