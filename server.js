// --- تحديث قسم المدفوعات للمدير ---
async function loadAdminPayments() { 
  const list = await api('payments'); 
  let html = `<div class="card"><div class="card-header"><div class="card-title"><div class="card-icon"><i class="fas fa-plus"></i></div>${t('addPayment')}</div></div>`; 
  html += '<div class="form-row">'; 
  html += `<div class="form-group"><label>${t('studentName')}</label><input class="form-input" id="payName"></div>`; 
  html += `<div class="form-group"><label>${t('group')}</label><select class="form-input" id="payGroup">${buildOptions(GROUPS)}</select></div>`; 
  html += `<div class="form-group"><label>${t('month')}</label><input class="form-input" id="payMonth" value="${getCurrentMonth()} ${getCurrentYear()}"></div>`; 
  html += '</div><div class="form-row">'; 
  html += `<div class="form-group"><label>${t('subscription')}</label><input class="form-input" type="number" id="paySub" value="500"></div>`; 
  html += `<div class="form-group"><label>${t('paid')}</label><input class="form-input" type="number" id="payAmount"></div>`; 
  html += `<div class="form-group"><label>${t('notes')}</label><input class="form-input" id="payNotes"></div>`; 
  html += '</div>'; 
  html += `<button class="btn btn-accent" onclick="addPayment()"><i class="fas fa-save"></i> ${t('save')}</button></div>`;

  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-icon"><i class="fas fa-money-bill-wave"></i></div>${t('payments')}</div></div>`; 
  html += '<div class="table-wrapper"><table><thead><tr>'; 
  html += `<th>${t('name')}</th><th>${t('group')}</th><th>${t('month')}</th><th>${t('subscription')}</th><th>${t('paid')}</th><th>${t('remaining')}</th><th>الحالة</th></tr></thead><tbody id="paymentsTableBody"></tbody></table></div></div>`; 
  document.getElementById('sec_adminPayments').innerHTML = html; 
  
  const tb = document.getElementById('paymentsTableBody'); 
  if (!list || !list.length) { tb.innerHTML = `<tr><td colspan="7">${emptyState('fa-money-bill-wave', t('noData'))}</td></tr>`; return; } 
  tb.innerHTML = list.map(p => { 
    const statusBadge = p.status && p.status.includes('مكتمل') ? badge(t('complete'), 'badge-success') : badge(t('incomplete'), 'badge-warn'); 
    return `<tr><td><b>${safeVal(p.name)}</b></td><td>${safeVal(p.group)}</td><td>${safeVal(p.monthYear)}</td><td>${safeVal(p.subscription)}</td><td style="color:var(--accent);font-weight:bold">${safeVal(p.paid)}</td><td style="color:var(--danger)">${safeVal(p.remaining)}</td><td>${statusBadge}</td></tr>`; 
  }).join(''); 
}

async function addPayment() {
  const name = getVal('payName');
  if (!name) return showToast(t('studentName') + '!', 'error');
  await api('payments/add', { name, group: getVal('payGroup'), monthYear: getVal('payMonth'), subscription: getVal('paySub'), paid: getVal('payAmount'), notes: getVal('payNotes') });
  showToast(t('save'), 'success');
  loadAdminPayments();
}

// --- تحديث قسم المواعيد للمدير ---
async function loadAdminSchedules() { 
  const list = await api('schedules'); 
  let html = `<div class="card"><div class="card-header"><div class="card-title"><div class="card-icon"><i class="fas fa-plus"></i></div>${t('addSchedule')}</div></div>`;
  html += '<div class="form-row">';
  html += `<div class="form-group"><label>${t('day')}</label><select class="form-input" id="schDay">${buildOptions(['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'])}</select></div>`;
  html += `<div class="form-group"><label>${t('time')}</label><input class="form-input" id="schTime" placeholder="16:00 - 17:30"></div>`;
  html += `<div class="form-group"><label>${t('group')}</label><select class="form-input" id="schGroup">${buildOptions(GROUPS)}</select></div>`;
  html += `<div class="form-group"><label>${t('teacher')}</label><input class="form-input" id="schTeacher" value="أ/ محمد"></div>`;
  html += `<button class="btn btn-accent" style="margin-top:22px" onclick="addSchedule()"><i class="fas fa-save"></i> ${t('add')}</button>`;
  html += '</div></div>';

  html += `<div class="card"><div class="card-header"><div class="card-title"><div class="card-icon"><i class="fas fa-clock"></i></div>${t('schedules')}</div></div>`; 
  html += '<div class="table-wrapper"><table><thead><tr>'; 
  html += `<th>${t('day')}</th><th>${t('time')}</th><th>${t('group')}</th><th>${t('subject')}</th><th>${t('teacher')}</th><th>${t('status')}</th><th>إجراء</th></tr></thead><tbody id="schedulesTableBody"></tbody></table></div></div>`; 
  document.getElementById('sec_adminSchedules').innerHTML = html; 
  
  const tb = document.getElementById('schedulesTableBody'); 
  if (!list || !list.length) { tb.innerHTML = `<tr><td colspan="7">${emptyState('fa-clock', t('noSchedules'))}</td></tr>`; return; } 
  tb.innerHTML = list.map(s => { 
    const statusBadge = s.status === 'نشط' ? badge(t('active'), 'badge-success') : badge(t('inactive'), 'badge-danger'); 
    return `<tr><td>${safeVal(s.day)}</td><td>${safeVal(s.time)}</td><td>${safeVal(s.group)}</td><td>${safeVal(s.subject)}</td><td>${safeVal(s.teacher)}</td><td>${statusBadge}</td><td><button class="btn btn-sm btn-danger" onclick="deleteSchedule(${s.id})"><i class="fas fa-trash"></i></button></td></tr>`; 
  }).join(''); 
}

async function addSchedule() {
  await api('schedules/add', { day: getVal('schDay'), time: getVal('schTime'), group: getVal('schGroup'), subject: 'كيمياء', teacher: getVal('schTeacher') });
  showToast(t('save'), 'success');
  loadAdminSchedules();
}
async function deleteSchedule(id) {
  if (await confirmDialog(t('confirmDelete'))) {
    await api('schedules/delete', { id });
    showToast(t('delete'), 'success');
    loadAdminSchedules();
  }
}

// --- تحديث قسم الاعتذارات للمدير (للرد والموافقة/الرفض) ---
async function loadAdminExcuses() { 
  const list = await api('excuses'); 
  let html = `<div class="card"><div class="card-header"><div class="card-title"><div class="card-icon"><i class="fas fa-envelope-open-text"></i></div>${t('excuses')}</div></div>`; 
  html += '<div class="table-wrapper"><table><thead><tr>'; 
  html += `<th>ID</th><th>${t('name')}</th><th>التاريخ</th><th>${t('reason')}</th><th>${t('status')}</th><th>الرد</th><th>إجراء</th></tr></thead><tbody id="excusesTableBody"></tbody></table></div></div>`; 
  document.getElementById('sec_adminExcuses').innerHTML = html; 
  
  const tb = document.getElementById('excusesTableBody'); 
  if (!list || !list.length) { tb.innerHTML = `<tr><td colspan="7">${emptyState('fa-envelope-open-text', t('noData'))}</td></tr>`; return; } 
  tb.innerHTML = list.map(e => { 
    let statusBadge; 
    if (e.status && e.status.includes('قيد')) statusBadge = badge(t('pending'), 'badge-warn'); 
    else if (e.status && e.status.includes('مقبول')) statusBadge = badge(t('approved'), 'badge-success'); 
    else statusBadge = badge(t('rejected'), 'badge-danger'); 
    return `<tr><td>${safeVal(e.id)}</td><td><b>${safeVal(e.studentName)}</b></td><td>${safeVal(e.date)}</td><td style="white-space:normal;max-width:200px">${safeVal(e.reason)}</td><td>${statusBadge}</td><td>${safeVal(e.reply)}</td><td>
      <div class="btn-group">
        <button class="btn btn-sm btn-outline" style="color:var(--accent);border-color:var(--accent)" onclick="replyExcuse(${e.id}, '✅ مقبول')"><i class="fas fa-check"></i></button>
        <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="replyExcuse(${e.id}, '❌ مرفوض')"><i class="fas fa-times"></i></button>
      </div>
    </td></tr>`; 
  }).join(''); 
}

async function replyExcuse(id, status) {
  const reply = await promptDialog('اكتب رد الإدارة للطالب:', '');
  if (reply !== null) {
    await api('excuses/update', { id, status, reply });
    showToast('تم التحديث', 'success');
    loadAdminExcuses();
  }
}
