const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function getSession(req) {
  const token = req.get('cookie')?.match(/(?:^|;\s*)showroom_session=([a-f0-9]+)/)?.[1];
  const session = token && sessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function setSession(res, session) {
  for (const [token, storedSession] of sessions) {
    if (storedSession.expiresAt <= Date.now()) sessions.delete(token);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...session, expiresAt: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie', `showroom_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  const session = getSession(req);
  if (session) sessions.delete(session.token);
  res.setHeader('Set-Cookie', 'showroom_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function isAdmin(req) {
  return getSession(req)?.role === 'admin';
}

function allowLoginAttempt(req, res) {
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  if (attempt.resetAt <= Date.now()) {
    attempt.count = 0;
    attempt.resetAt = Date.now() + 15 * 60 * 1000;
  }
  attempt.count += 1;
  loginAttempts.set(key, attempt);
  if (attempt.count > 10) {
    res.status(429).json({ message: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.' });
    return false;
  }
  return true;
}

app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ message: 'طلب غير مسموح.' });
  }
  next();
});

let cars = [
  {
    id: 1,
    brand: 'Toyota',
    model: 'Corolla',
    year: 2022,
    price: 78000,
    mileage: 22000,
    fuelType: 'Gasoline',
    status: 'Available',
    description: 'Car in excellent condition, single owner, full service history.',
    images: [
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1200&q=80'
    ],
    isSold: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 2,
    brand: 'BMW',
    model: '320i',
    year: 2021,
    price: 125000,
    mileage: 18000,
    fuelType: 'Petrol',
    status: 'Available',
    description: 'Sporty compact sedan with premium interior and mild driving.',
    images: [
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?auto=format&fit=crop&w=1200&q=80'
    ],
    isSold: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 3,
    brand: 'Honda',
    model: 'Civic',
    year: 2019,
    price: 92000,
    mileage: 42000,
    fuelType: 'Hybrid',
    status: 'Sold',
    description: 'Sold vehicle kept in good condition with regular maintenance.',
    images: [
      'https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=1200&q=80'
    ],
    isSold: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

let carRequests = [];

function sanitizeCarPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'بيانات السيارة غير صالحة.' };
  }

  const brand = String(payload.brand || '').trim();
  const model = String(payload.model || '').trim();
  const year = Number(payload.year);
  const price = Number(payload.price);
  const mileage = Number(payload.mileage);
  const description = String(payload.description || '').trim();
  const images = Array.isArray(payload.images) ? payload.images : [];

  if (!brand || !model || brand.length > 50 || model.length > 60 || description.length > 1200) {
    return { error: 'أدخل الماركة والموديل، وتأكد من حدود النص.' };
  }
  if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(mileage) || mileage < 0) {
    return { error: 'السنة أو السعر أو المسافة غير صالحة.' };
  }
  if (images.length > 10 || images.some(image => typeof image !== 'string' || image.length > 2048 || !/^https:\/\//i.test(image))) {
    return { error: 'أضف حتى 10 روابط صور آمنة تبدأ بـ https://.' };
  }

  return {
    brand,
    model,
    year,
    price,
    mileage,
    fuelType: ['Gasoline', 'Petrol', 'Hybrid', 'Diesel', 'Electric'].includes(payload.fuelType) ? payload.fuelType : 'Gasoline',
    status: ['Available', 'Reserved', 'Sold'].includes(payload.status) ? payload.status : 'Available',
    description,
    images,
    isSold: payload.status === 'Sold' || Boolean(payload.isSold)
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Car showroom API is running' });
});

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/admin/login', (req, res) => {
  if (!allowLoginAttempt(req, res)) return;
  const adminPin = process.env.ADMIN_PIN || (process.env.NODE_ENV === 'production' ? '' : '32456');
  if (!/^\d{5}$/.test(adminPin)) {
    return res.status(503).json({ message: 'اضبط ADMIN_PIN على خمسة أرقام قبل تسجيل الدخول.' });
  }

  const pin = String(req.body?.pin || '');
  const matches = crypto.timingSafeEqual(
    crypto.createHash('sha256').update(pin).digest(),
    crypto.createHash('sha256').update(adminPin).digest()
  );
  if (!/^\d{5}$/.test(pin) || !matches) {
    return res.status(401).json({ message: 'رمز الدخول غير صحيح.' });
  }

  setSession(res, { role: 'admin' });
  return res.json({ message: 'تم تسجيل الدخول.' });
});

app.post('/api/auth/google', async (req, res) => {
  if (!allowLoginAttempt(req, res)) return;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const credential = String(req.body?.credential || '');
  if (!clientId) return res.status(503).json({ message: 'تسجيل Google غير مفعّل بعد.' });
  if (!credential || credential.length > 5000) return res.status(400).json({ message: 'تعذر التحقق من حساب Google.' });

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!response.ok) return res.status(401).json({ message: 'تعذر التحقق من حساب Google.' });
    const identity = await response.json();
    if (identity.aud !== clientId || identity.email_verified !== 'true' || !identity.email) {
      return res.status(401).json({ message: 'حساب Google غير صالح أو غير موثق.' });
    }
    setSession(res, { role: 'customer', email: identity.email, name: identity.name || '', picture: identity.picture || '' });
    return res.json({ email: identity.email, name: identity.name || '' });
  } catch {
    return res.status(502).json({ message: 'تعذر الاتصال بخدمة Google. حاول لاحقاً.' });
  }
});

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  res.json({ isLoggedIn: Boolean(session && session.role === 'customer'), user: session?.role === 'customer' ? { email: session.email, name: session.name } : null });
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(req, res);
  res.json({ message: 'تم تسجيل الخروج.' });
});

app.get('/api/admin/session', (req, res) => {
  const session = getSession(req);
  res.json({ isLoggedIn: session?.role === 'admin', email: session?.role === 'admin' ? session.email : null });
});

app.post('/api/admin/logout', (req, res) => {
  clearSession(req, res);
  res.json({ message: 'تم تسجيل الخروج.' });
});

app.get('/api/cars', (req, res) => {
  const availableCars = cars.filter(car => !car.isSold);
  res.json({ cars: availableCars });
});

app.post('/api/car-requests', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'customer') {
    return res.status(401).json({ message: 'سجّل الدخول بحساب Google قبل إرسال الطلب.' });
  }

  const carId = Number(req.body?.carId);
  const phone = String(req.body?.phone || '').trim();
  const normalizedPhone = phone.replace(/[\s()-]/g, '');
  const note = String(req.body?.note || '').trim();
  const car = cars.find(item => item.id === carId);

  if (!Number.isInteger(carId) || !car) {
    return res.status(404).json({ message: 'السيارة المطلوبة غير موجودة.' });
  }
  if (car.isSold || car.status !== 'Available') {
    return res.status(409).json({ message: 'هذه السيارة لم تعد متاحة للطلب.' });
  }
  if (!/^\+?\d{7,15}$/.test(normalizedPhone)) {
    return res.status(400).json({ message: 'رقم الهاتف إلزامي، وأدخله مع رمز الدولة ليتمكن المعرض من التواصل معك.' });
  }
  if (note.length > 500) {
    return res.status(400).json({ message: 'الملاحظات يجب ألا تتجاوز 500 حرف.' });
  }

  const existingRequest = carRequests.find(request =>
    request.customerEmail === session.email &&
    request.car.id === carId &&
    ['pending', 'contacted'].includes(request.status)
  );
  if (existingRequest) {
    return res.status(409).json({ message: 'لديك طلب مفتوح لهذه السيارة بالفعل.', request: existingRequest });
  }

  const now = new Date().toISOString();
  const carRequest = {
    id: crypto.randomUUID(),
    car: { id: car.id, brand: car.brand, model: car.model, year: car.year, price: car.price },
    customer: { email: session.email, name: session.name || '', phone },
    note,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  carRequests.unshift(carRequest);
  return res.status(201).json({ message: 'وصل طلبك، وسيتواصل معك فريق المعرض.', request: carRequest });
});

app.get('/api/customer/car-requests', (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== 'customer') {
    return res.status(401).json({ message: 'سجّل الدخول لعرض طلباتك.' });
  }

  const requests = carRequests.filter(request => request.customer.email === session.email);
  return res.json({ requests });
});

app.get('/api/admin/car-requests', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  return res.json({ requests: carRequests });
});

app.patch('/api/admin/car-requests/:id', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  const validStatuses = ['pending', 'contacted', 'completed', 'cancelled'];
  const status = req.body?.status;
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'حالة الطلب غير صالحة.' });
  }

  const carRequest = carRequests.find(item => item.id === req.params.id);
  if (!carRequest) {
    return res.status(404).json({ message: 'الطلب غير موجود.' });
  }

  carRequest.status = status;
  carRequest.updatedAt = new Date().toISOString();
  return res.json({ message: 'تم تحديث حالة الطلب.', request: carRequest });
});

app.get('/api/admin/cars', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  return res.json({ cars });
});

app.post('/api/admin/cars', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  const payload = sanitizeCarPayload(req.body);
  if (payload.error) return res.status(400).json({ message: payload.error });
  const newCar = {
    id: Date.now(),
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  cars.unshift(newCar);

  return res.status(201).json({ message: 'Car added successfully', car: newCar });
});

app.put('/api/admin/cars/:id', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  const carId = Number(req.params.id);
  const carIndex = cars.findIndex(car => car.id === carId);

  if (carIndex === -1) {
    return res.status(404).json({ message: 'Car not found' });
  }

  const payload = sanitizeCarPayload(req.body);
  if (payload.error) return res.status(400).json({ message: payload.error });

  const updatedCar = {
    ...cars[carIndex],
    ...payload,
    updatedAt: new Date().toISOString()
  };

  cars[carIndex] = updatedCar;

  return res.json({ message: 'Car updated successfully', car: updatedCar });
});

app.delete('/api/admin/cars/:id', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  const carId = Number(req.params.id);
  const initialLength = cars.length;
  cars = cars.filter(car => car.id !== carId);

  if (cars.length === initialLength) {
    return res.status(404).json({ message: 'Car not found' });
  }

  return res.json({ message: 'Car removed successfully' });
});

app.patch('/api/admin/cars/:id/sold', (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }

  const carId = Number(req.params.id);
  const car = cars.find(item => item.id === carId);

  if (!car) {
    return res.status(404).json({ message: 'Car not found' });
  }

  car.isSold = true;
  car.status = 'Sold';
  car.updatedAt = new Date().toISOString();

  return res.json({ message: 'Car marked as sold', car });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Car showroom app running at http://localhost:${PORT}`);
});
