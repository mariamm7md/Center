require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// GOOGLE APPS SCRIPT API URL
// ═══════════════════════════════════════════════════════════════
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwhfecD1-mDiMaW0c4wUIvYOx_10wfrD3oRfRCIdA-m2HAjAB5BHTi0oyPdyr_n_a2d/exec';

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(helmet({ 
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// Call Apps Script via GET
async function callAppsScript(action, params = {}) {
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('action', action);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParams.append(key, value);
      }
    }
    
    const url = `${APPS_SCRIPT_URL}?${queryParams.toString()}`;
    console.log(`[GET] ${action}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const text = await response.text();
    console.log(`[GET Response] ${text.substring(0, 100)}...`);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError.message);
      return { success: false, message: 'Invalid JSON response', data: [] };
    }
  } catch (error) {
    console.error('[GET Error]', error.message);
    return { success: false, message: error.message, data: [] };
  }
}

// Call Apps Script via POST
async function postToAppsScript(action, data = {}) {
  try {
    const payload = { action, ...data };
    console.log(`[POST] ${action}`, JSON.stringify(data).substring(0, 100));
    
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
    
    const text = await response.text();
    console.log(`[POST Response] ${text.substring(0, 100)}...`);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError.message);
      return { success: false, message: 'Invalid JSON response' };
    }
  } catch (error) {
    console.error('[POST Error]', error.message);
    return { success: false, message: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  const result = await callAppsScript('test');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// LOGIN API
// ═══════════════════════════════════════════════════════════════
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    
    // Admin login
    if (role === 'admin') {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      
      if (user === adminUser && pass === adminPass) {
        return res.json({ 
          success: true, 
          data: { 
            role: 'admin', 
            name: 'Admin', 
            id: 'admin' 
          } 
        });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }
    
    // Student login via Apps Script
    const result = await callAppsScript('verifyLogin', { 
      studentId: user, 
      code: pass 
    });
    res.json(result);
    
  } catch (error) {
    console.error('Login Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const result = await callAppsScript('dashboard');
    res.json(result);
  } catch (error) {
    console.error('Dashboard Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const result = await callAppsScript('getStudents');
    res.json(result);
  } catch (error) {
    console.error('Get Students Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addStudent', req.body);
    res.json(result);
  } catch (error) {
    console.error('Add Student Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateStudent', req.body);
    res.json(result);
  } catch (error) {
    console.error('Update Student Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const result = await postToAppsScript('deleteStudent', req.body);
    res.json(result);
  } catch (error) {
    console.error('Delete Student Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const result = await callAppsScript('getPayments');
    res.json(result);
  } catch (error) {
    console.error('Get Payments Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addPayment', req.body);
    res.json(result);
  } catch (error) {
    console.error('Add Payment Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GRADES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const result = await callAppsScript('getGrades');
    res.json(result);
  } catch (error) {
    console.error('Get Grades Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateGrade', req.body);
    res.json(result);
  } catch (error) {
    console.error('Update Grade Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await callAppsScript('getSchedules');
    res.json(result);
  } catch (error) {
    console.error('Get Schedules Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addSchedule', req.body);
    res.json(result);
  } catch (error) {
    console.error('Add Schedule Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE API
// ═══════════════════════════════════════════════════════════════
app.post('/api/attendance/mark', async (req, res) => {
  try {
    const result = await postToAppsScript('markAttendance', req.body);
    res.json(result);
  } catch (error) {
    console.error('Mark Attendance Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCUSES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  try {
    const result = await callAppsScript('getExcuses');
    res.json(result);
  } catch (error) {
    console.error('Get Excuses Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.post('/api/excuses/add', async (req, res) => {
  try {
    const result = await postToAppsScript('addExcuse', req.body);
    res.json(result);
  } catch (error) {
    console.error('Add Excuse Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const result = await postToAppsScript('updateExcuse', req.body);
    res.json(result);
  } catch (error) {
    console.error('Update Excuse Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL API
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const result = await callAppsScript('studentDashboard', { id: req.query.id });
    res.json(result);
  } catch (error) {
    console.error('Student Dashboard Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const result = await callAppsScript('studentProfile', { id: req.query.id });
    res.json(result);
  } catch (error) {
    console.error('Student Profile Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const result = await callAppsScript('studentGrades', { id: req.query.id });
    res.json(result);
  } catch (error) {
    console.error('Student Grades Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const result = await callAppsScript('studentPayments', { name: req.query.name });
    res.json(result);
  } catch (error) {
    console.error('Student Payments Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const result = await callAppsScript('studentAttendance', { id: req.query.id });
    res.json(result);
  } catch (error) {
    console.error('Student Attendance Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const result = await callAppsScript('getSchedules');
    res.json(result);
  } catch (error) {
    console.error('Student Schedules Error:', error.message);
    res.json({ success: false, message: error.message, data: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  console.log('  🚀 Smart Educational Center Server');
  console.log('═════════════════════════════════════════════════════');
  console.log(`  📡 Port: ${PORT}`);
  console.log(`  🔗 API: Apps Script Connected`);
  console.log(`  👤 Admin: ${process.env.ADMIN_USER || 'admin'}`);
  console.log('═════════════════════════════════════════════════════');
  console.log('');
});
