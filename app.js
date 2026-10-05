const carsGrid = document.getElementById('cars-grid');
const loginForm = document.getElementById('login-form');
const loginSection = document.getElementById('login-section');
const dashboard = document.getElementById('dashboard');
const adminCarsTable = document.getElementById('admin-cars-table');
const carForm = document.getElementById('car-form');
const carIdInput = document.getElementById('car-id');
const resetBtn = document.getElementById('reset-btn');
let allCars = [];
let adminCars = [];
let customerUser = null;
let pendingRequestCarId = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function requestJson(url, options = {}) {
  if (window.location.protocol === 'file:') {
    const page = window.location.pathname.endsWith('/admin.html') ? 'admin.html' : '';
    throw new Error(`شغّل npm start ثم افتح http://localhost:3000/${page}`);
  }
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'تعذر إكمال الطلب.');
  return data;
}

function formatPrice(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function fuelLabel(value) {
  return ({ Gasoline: 'بنزين', Petrol: 'بنزين', Hybrid: 'هجين', Diesel: 'ديزل', Electric: 'كهرباء' })[value] || value;
}

function statusLabel(value) {
  return ({ Available: 'متاحة', Reserved: 'محجوزة', Sold: 'مباعة' })[value] || value;
}

function requestStatusLabel(value) {
  return ({ pending: 'جديد', contacted: 'تم التواصل', completed: 'مكتمل', cancelled: 'ملغي' })[value] || value;
}

function renderCars() {
  if (!carsGrid) return;
  const search = document.getElementById('car-search').value.trim().toLowerCase();
  const fuel = document.getElementById('fuel-filter').value;
  const sort = document.getElementById('sort-cars').value;
  const filtered = allCars.filter((car) => `${car.brand} ${car.model} ${car.year}`.toLowerCase().includes(search) && (fuel === 'all' || car.fuelType === fuel));
  if (sort === 'price-asc') filtered.sort((left, right) => left.price - right.price);
  if (sort === 'price-desc') filtered.sort((left, right) => right.price - left.price);
  if (sort === 'year-desc') filtered.sort((left, right) => right.year - left.year);
  document.getElementById('results-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'سيارة' : 'سيارات'}`;
  if (!filtered.length) {
    carsGrid.innerHTML = '<div class="empty-state"><span>لا توجد نتائج</span><p>جرّب تغيير كلمات البحث أو خيارات التصفية.</p></div>';
    return;
  }
  carsGrid.innerHTML = filtered.map((car, index) => {
    const image = car.images?.[0] || 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80';
    const canRequest = car.status === 'Available' && !car.isSold;
    return `<article class="car-card" style="--card-index:${index}"><div class="car-image-wrap"><img src="${escapeHtml(image)}" alt="${escapeHtml(`${car.brand} ${car.model}`)}" loading="lazy" /><span class="car-status">${escapeHtml(statusLabel(car.status))}</span></div><div class="car-body"><div class="car-top"><h3>${escapeHtml(car.brand)} <span>${escapeHtml(car.model)}</span></h3><span class="car-year">${escapeHtml(car.year)}</span></div><p class="car-price">${formatPrice(car.price)}</p><div class="car-specs"><span>${Number(car.mileage).toLocaleString('en-US')} كم</span><span>${escapeHtml(fuelLabel(car.fuelType))}</span></div><p class="car-description">${escapeHtml(car.description || 'تواصل معنا لمعرفة المزيد عن تفاصيل السيارة.')}</p><button class="button button-car-request" type="button" data-action="request-car" data-id="${car.id}" ${canRequest ? '' : 'disabled'}>${canRequest ? 'اطلب هذه السيارة' : 'غير متاحة للطلب'} ${canRequest ? '<span aria-hidden="true">←</span>' : ''}</button></div></article>`;
  }).join('');
}

async function fetchCars() {
  if (!carsGrid) return;
  try {
    const data = await requestJson('/api/cars');
    allCars = data.cars;
    renderCars();
  } catch (error) {
    carsGrid.innerHTML = `<div class="empty-state"><span>تعذر تحميل السيارات</span><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function updateCustomerSession() {
  const loginButton = document.getElementById('open-login');
  if (!loginButton) return;
  const greeting = document.getElementById('user-greeting');
  const logoutButton = document.getElementById('customer-logout');
  try {
    const data = await requestJson('/api/auth/session');
    customerUser = data.isLoggedIn ? data.user : null;
    loginButton.classList.toggle('hidden', data.isLoggedIn);
    logoutButton.classList.toggle('hidden', !data.isLoggedIn);
    greeting.classList.toggle('hidden', !data.isLoggedIn);
    greeting.textContent = data.user?.name || data.user?.email || '';
  } catch { loginButton.classList.remove('hidden'); }
}

function setGoogleStatus(message, isError = false) {
  const status = document.getElementById('google-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function startGoogleLogin(credential) {
  try {
    await requestJson('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
    document.getElementById('login-dialog').close();
    await updateCustomerSession();
    if (pendingRequestCarId) {
      const carId = pendingRequestCarId;
      pendingRequestCarId = null;
      showCarRequestDialog(carId);
    }
  } catch (error) { setGoogleStatus(error.message, true); }
}

function showCarRequestDialog(carId) {
  const car = allCars.find((item) => item.id === carId);
  if (!car) return;
  const form = document.getElementById('car-request-form');
  form.dataset.carId = car.id;
  form.reset();
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = false;
  submitButton.innerHTML = 'إرسال الطلب <span aria-hidden="true">←</span>';
  document.getElementById('request-car-name').textContent = `${car.brand} ${car.model} · ${car.year} · ${formatPrice(car.price)}`;
  document.getElementById('request-message').textContent = customerUser?.name ? `الطلب باسم ${customerUser.name}` : '';
  document.getElementById('request-message').classList.remove('is-error');
  document.getElementById('car-request-dialog').showModal();
}

async function setupGoogleLogin() {
  const slot = document.getElementById('google-button');
  if (!slot || slot.dataset.loading === 'true' || slot.dataset.ready === 'true') return;
  slot.dataset.loading = 'true';
  try {
    const config = await requestJson('/api/config');
    if (!config.googleClientId) {
      setGoogleStatus('تسجيل Google غير مفعّل بعد. أضف GOOGLE_CLIENT_ID إلى إعدادات الخادم.');
      slot.dataset.loading = 'false';
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: ({ credential }) => startGoogleLogin(credential) });
      window.google.accounts.id.renderButton(slot, { type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', text: 'continue_with', locale: 'ar', width: 340 });
      slot.dataset.ready = 'true';
      slot.dataset.loading = 'false';
      setGoogleStatus('');
    };
    script.onerror = () => {
      slot.dataset.loading = 'false';
      setGoogleStatus('تعذر تحميل تسجيل Google. تحقق من اتصالك بالإنترنت.', true);
    };
    document.head.appendChild(script);
  } catch (error) {
    slot.dataset.loading = 'false';
    setGoogleStatus(error.message, true);
  }
}

if (carsGrid) {
  ['car-search', 'fuel-filter', 'sort-cars'].forEach((id) => document.getElementById(id).addEventListener(id === 'car-search' ? 'input' : 'change', renderCars));
  document.getElementById('open-login').addEventListener('click', () => {
    document.getElementById('login-dialog').showModal();
    setupGoogleLogin();
  });
  document.getElementById('close-login').addEventListener('click', () => document.getElementById('login-dialog').close());
  document.getElementById('login-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  carsGrid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="request-car"]');
    if (!button) return;
    const carId = Number(button.dataset.id);
    if (!customerUser) {
      pendingRequestCarId = carId;
      setGoogleStatus('سجّل الدخول بحساب Google لمتابعة طلب السيارة.');
      document.getElementById('login-dialog').showModal();
      setupGoogleLogin();
      return;
    }
    showCarRequestDialog(carId);
  });
  document.getElementById('close-request').addEventListener('click', () => document.getElementById('car-request-dialog').close());
  document.getElementById('car-request-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  document.getElementById('car-request-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('request-message');
    message.textContent = 'جارٍ إرسال الطلب…';
    message.classList.remove('is-error');
    try {
      const result = await requestJson('/api/car-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carId: Number(form.dataset.carId), phone: document.getElementById('request-phone').value, note: document.getElementById('request-note').value })
      });
      message.textContent = result.message;
      form.querySelector('button[type="submit"]').disabled = true;
      form.querySelector('button[type="submit"]').textContent = 'تم استلام طلبك';
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('is-error');
    }
  });
  document.getElementById('customer-logout').addEventListener('click', async () => {
    await requestJson('/api/auth/logout', { method: 'POST' });
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    await updateCustomerSession();
  });
  fetchCars();
  updateCustomerSession();
}

function setAdminMessage(message, isError = false) {
  const element = document.getElementById('admin-login-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

async function ensureAdminSession() {
  if (!dashboard || !loginSection) return;
  try {
    const data = await requestJson('/api/admin/session');
    loginSection.classList.toggle('hidden', data.isLoggedIn);
    dashboard.classList.toggle('hidden', !data.isLoggedIn);
    if (data.isLoggedIn) await Promise.all([loadAdminCars(), loadAdminRequests()]);
  } catch (error) {
    loginSection.classList.remove('hidden');
    dashboard.classList.add('hidden');
    setAdminMessage(error.message, true);
  }
}

async function loadAdminCars() {
  const data = await requestJson('/api/admin/cars');
  adminCars = data.cars;
  document.getElementById('total-cars').textContent = adminCars.length;
  document.getElementById('available-cars').textContent = adminCars.filter((car) => !car.isSold).length;
  document.getElementById('sold-cars').textContent = adminCars.filter((car) => car.isSold).length;
  adminCarsTable.innerHTML = adminCars.map((car) => `<tr><td><strong>${escapeHtml(car.brand)} ${escapeHtml(car.model)}</strong><small>${escapeHtml(car.year)} · ${Number(car.mileage).toLocaleString('en-US')} كم</small></td><td>${formatPrice(car.price)}</td><td><span class="table-status ${car.isSold ? 'status-sold' : ''}">${escapeHtml(statusLabel(car.status))}</span></td><td><div class="action-group"><button class="table-action" type="button" data-action="edit" data-id="${car.id}" aria-label="تعديل ${escapeHtml(car.brand)} ${escapeHtml(car.model)}">تعديل</button>${car.isSold ? '' : `<button class="table-action" type="button" data-action="sold" data-id="${car.id}">تم البيع</button>`}<button class="table-action action-delete" type="button" data-action="delete" data-id="${car.id}">حذف</button></div></td></tr>`).join('');
}

async function loadAdminRequests() {
  const data = await requestJson('/api/admin/car-requests');
  const table = document.getElementById('admin-requests-table');
  const empty = document.getElementById('requests-empty');
  document.getElementById('request-count').textContent = `${data.requests.length} طلب`;
  empty.classList.toggle('hidden', data.requests.length > 0);
  table.innerHTML = data.requests.map((request) => {
    const date = new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.createdAt));
    return `<tr><td><strong>${escapeHtml(request.car.brand)} ${escapeHtml(request.car.model)}</strong><small>${escapeHtml(request.car.year)} · ${formatPrice(request.car.price)}</small></td><td><strong>${escapeHtml(request.customer.name || 'عميل')}</strong><small>${escapeHtml(request.customer.email)}</small></td><td><a class="request-phone" dir="ltr" href="tel:${escapeHtml(request.customer.phone)}">${escapeHtml(request.customer.phone)}</a>${request.note ? `<small>${escapeHtml(request.note)}</small>` : ''}</td><td>${escapeHtml(date)}</td><td><div class="request-status-control"><select aria-label="حالة الطلب" data-request-status="${escapeHtml(request.id)}"><option value="pending" ${request.status === 'pending' ? 'selected' : ''}>جديد</option><option value="contacted" ${request.status === 'contacted' ? 'selected' : ''}>تم التواصل</option><option value="completed" ${request.status === 'completed' ? 'selected' : ''}>مكتمل</option><option value="cancelled" ${request.status === 'cancelled' ? 'selected' : ''}>ملغي</option></select><button class="table-action" type="button" data-action="save-request" data-id="${escapeHtml(request.id)}">حفظ</button></div><small class="request-status-label">${escapeHtml(requestStatusLabel(request.status))}</small></td></tr>`;
  }).join('');
}

function resetCarForm() {
  carForm.reset();
  carIdInput.value = '';
  document.getElementById('year').value = new Date().getFullYear();
  document.getElementById('fuelType').value = 'Gasoline';
  document.getElementById('status').value = 'Available';
  document.getElementById('form-heading').textContent = 'إضافة سيارة';
  document.getElementById('save-btn').innerHTML = 'حفظ السيارة <span aria-hidden="true">←</span>';
  document.getElementById('car-form-message').textContent = '';
}

if (loginForm) {
  document.getElementById('admin-pin').addEventListener('input', (event) => {
    event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 5);
  });
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAdminMessage('جارٍ التحقق…');
    try {
      await requestJson('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: document.getElementById('admin-pin').value }) });
      loginForm.reset();
      await ensureAdminSession();
    } catch (error) { setAdminMessage(error.message, true); }
  });
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await requestJson('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  });
  carForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('car-form-message');
    message.textContent = 'جارٍ الحفظ…';
    message.classList.remove('is-error');
    const payload = {
      brand: document.getElementById('brand').value.trim(), model: document.getElementById('model').value.trim(),
      year: Number(document.getElementById('year').value), price: Number(document.getElementById('price').value), mileage: Number(document.getElementById('mileage').value),
      fuelType: document.getElementById('fuelType').value, status: document.getElementById('status').value,
      description: document.getElementById('description').value.trim(), images: document.getElementById('images').value.split(',').map((image) => image.trim()).filter(Boolean)
    };
    const method = carIdInput.value ? 'PUT' : 'POST';
    const url = carIdInput.value ? `/api/admin/cars/${carIdInput.value}` : '/api/admin/cars';
    try {
      const result = await requestJson(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      resetCarForm();
      message.textContent = result.message;
      await loadAdminCars();
    } catch (error) { message.textContent = error.message; message.classList.add('is-error'); }
  });
  resetBtn.addEventListener('click', resetCarForm);
  adminCarsTable.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const car = adminCars.find((item) => item.id === id);
    if (!car) return;
    if (button.dataset.action === 'edit') {
      carIdInput.value = car.id;
      ['brand', 'model', 'year', 'price', 'mileage', 'fuelType', 'status', 'description'].forEach((field) => { document.getElementById(field).value = car[field]; });
      document.getElementById('images').value = (car.images || []).join(', ');
      document.getElementById('form-heading').textContent = 'تعديل السيارة';
      document.getElementById('save-btn').innerHTML = 'حفظ التعديلات <span aria-hidden="true">←</span>';
      document.getElementById('brand').focus();
      return;
    }
    if (button.dataset.action === 'delete' && !window.confirm(`حذف ${car.brand} ${car.model} من المخزون؟`)) return;
    try {
      const action = button.dataset.action;
      const url = action === 'sold' ? `/api/admin/cars/${id}/sold` : `/api/admin/cars/${id}`;
      await requestJson(url, { method: action === 'sold' ? 'PATCH' : 'DELETE' });
      await loadAdminCars();
    } catch (error) { window.alert(error.message); }
  });
  document.getElementById('admin-requests-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="save-request"]');
    if (!button) return;
    const requestId = button.dataset.id;
    const status = document.querySelector(`[data-request-status="${CSS.escape(requestId)}"]`).value;
    const message = document.getElementById('requests-message');
    try {
      const result = await requestJson(`/api/admin/car-requests/${encodeURIComponent(requestId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
      });
      message.textContent = result.message;
      message.classList.remove('is-error');
      await loadAdminRequests();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('is-error');
    }
  });
  ensureAdminSession();
  resetCarForm();
}
