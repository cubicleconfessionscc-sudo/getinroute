require('./env');
const db = require('./db');
const bcrypt = require('bcryptjs');

const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, '0');
const d = String(today.getDate()).padStart(2, '0');
const TODAY = `${y}-${m}-${d}`;
const YDAY = new Date(today.getTime() - 86400000);
const YDAY_S = `${y}-${String(YDAY.getMonth() + 1).padStart(2, '0')}-${String(YDAY.getDate()).padStart(2, '0')}`;

const ROUTES = [
  {
    name: 'Electronic City → Manyata Tech Park',
    start_point: 'Electronic City Phase 1 Gate',
    end_point: 'Manyata Tech Park',
    speed_limit: 60,
    stops: [
      { sequence: 1, name: 'Electronic City Phase 1 Gate', lat: 12.8448, lng: 77.6604 },
      { sequence: 2, name: 'HSR Layout 27th Main', lat: 12.9121, lng: 77.6446 },
      { sequence: 3, name: 'Koramangala 80ft Rd', lat: 12.9352, lng: 77.6245 },
      { sequence: 4, name: 'Indiranagar 100ft Rd', lat: 12.9716, lng: 77.6412 },
      { sequence: 5, name: 'Hebbal Flyover', lat: 13.0358, lng: 77.5970 },
      { sequence: 6, name: 'Manyata Tech Park', lat: 13.0458, lng: 77.6271 }
    ]
  },
  {
    name: 'Koramangala → Whitefield ITPL',
    start_point: 'Koramangala BDA Complex',
    end_point: 'Whitefield ITPL',
    speed_limit: 50,
    stops: [
      { sequence: 1, name: 'Koramangala BDA Complex', lat: 12.9279, lng: 77.6271 },
      { sequence: 2, name: 'Silk Board Junction', lat: 12.9229, lng: 77.6338 },
      { sequence: 3, name: 'Marathahalli Bridge', lat: 12.9569, lng: 77.7011 },
      { sequence: 4, name: 'Bellandur', lat: 12.9240, lng: 77.6750 },
      { sequence: 5, name: 'Varthur', lat: 12.9450, lng: 77.7341 },
      { sequence: 6, name: 'Whitefield ITPL', lat: 12.9857, lng: 77.7363 }
    ]
  },
  {
    name: 'HSR Layout → MG Road',
    start_point: 'HSR Sector 6',
    end_point: 'MG Road Metro',
    speed_limit: 45,
    stops: [
      { sequence: 1, name: 'HSR Sector 6', lat: 12.9070, lng: 77.6502 },
      { sequence: 2, name: 'Agara Lake', lat: 12.9167, lng: 77.6307 },
      { sequence: 3, name: 'Koramangala Forum', lat: 12.9338, lng: 77.6111 },
      { sequence: 4, name: 'Richmond Circle', lat: 12.9634, lng: 77.6033 },
      { sequence: 5, name: 'MG Road Metro', lat: 12.9757, lng: 77.6052 }
    ]
  },
  {
    name: 'Indiranagar → Bagmane Tech Park',
    start_point: 'Indiranagar Metro',
    end_point: 'Bagmane Tech Park',
    speed_limit: 40,
    stops: [
      { sequence: 1, name: 'Indiranagar Metro', lat: 12.9784, lng: 77.6408 },
      { sequence: 2, name: 'Domlur Flyover', lat: 12.9607, lng: 77.6363 },
      { sequence: 3, name: 'Halasuru', lat: 12.9734, lng: 77.6251 },
      { sequence: 4, name: 'CV Raman Nagar', lat: 12.9874, lng: 77.6584 },
      { sequence: 5, name: 'Bagmane Tech Park', lat: 12.9914, lng: 77.6744 }
    ]
  },
  {
    name: 'Jayanagar → Forum Tech Park',
    start_point: 'Jayanagar 4th Block',
    end_point: 'Forum Tech Park',
    speed_limit: 40,
    stops: [
      { sequence: 1, name: 'Jayanagar 4th Block', lat: 12.9250, lng: 77.5838 },
      { sequence: 2, name: 'South End Circle', lat: 12.9340, lng: 77.5882 },
      { sequence: 3, name: 'Lalbagh West Gate', lat: 12.9507, lng: 77.5842 },
      { sequence: 4, name: 'Forum Tech Park', lat: 12.9868, lng: 77.6400 }
    ]
  }
];

const VEHICLES = [
  { vehicle_name: 'Volvo AC Bus', plate: 'KA-01-AB-1234', type: 'Bus', capacity: 42, line: 1, trip: 1 },
  { vehicle_name: 'Force Traveller', plate: 'KA-02-CD-5678', type: 'Van', capacity: 12, line: 1, trip: 2 },
  { vehicle_name: 'Maruti Ertiga', plate: 'KA-03-EF-9012', type: 'Cab', capacity: 6, line: 2, trip: 1 },
  { vehicle_name: 'Toyota Innova', plate: 'KA-04-GH-3456', type: 'Cab', capacity: 6, line: 2, trip: 2 },
  { vehicle_name: 'Tata Nexon EV', plate: 'KA-05-IJ-7890', type: 'Cab', capacity: 4, line: 3, trip: 1 },
  { vehicle_name: 'Mahindra XUV700', plate: 'KA-06-KL-1122', type: 'Cab', capacity: 6, line: 3, trip: 2 },
  { vehicle_name: 'Swift Dzire', plate: 'KA-07-MN-3344', type: 'Cab', capacity: 4, line: 4, trip: 1 },
  { vehicle_name: 'Hyundai Creta', plate: 'KA-08-OP-5566', type: 'Cab', capacity: 5, line: 4, trip: 2 },
  { vehicle_name: 'Mini Van', plate: 'KA-09-QR-7788', type: 'Van', capacity: 9, line: 5, trip: 1 },
  { vehicle_name: 'Sedan AC', plate: 'KA-10-ST-9900', type: 'Cab', capacity: 4, line: 5, trip: 2 },
  { vehicle_name: 'Kia Carens', plate: 'KA-11-UV-1212', type: 'Cab', capacity: 6, line: 6, trip: 1 },
  { vehicle_name: 'Tempo Traveller', plate: 'KA-12-WX-3434', type: 'Van', capacity: 15, line: 6, trip: 2 }
];

const DRIVERS = [
  { name: 'Ramesh Kumar', phone: '+91 98450 11001' },
  { name: 'Suresh Reddy', phone: '+91 98450 11002' },
  { name: 'Venkatesh Rao', phone: '+91 98450 11003' },
  { name: 'Arun Prakash', phone: '+91 98450 11004' },
  { name: 'Mohan Das', phone: '+91 98450 11005' },
  { name: 'Karthik Subram', phone: '+91 98450 11006' },
  { name: 'Rajesh Naidu', phone: '+91 98450 11007' },
  { name: 'Santhosh V', phone: '+91 98450 11008' },
  { name: 'Ganesh Iyer', phone: '+91 98450 11009' },
  { name: 'Prakash Patel', phone: '+91 98450 11010' },
  { name: 'Vijay Kumar', phone: '+91 98450 11011' },
  { name: 'Dinesh Yadav', phone: '+91 98450 11012' }
];

const EMPLOYEES = [
  { name: 'Priya Sharma', dept: 'Engineering', design: 'Software Engineer' },
  { name: 'Arjun Mehta', dept: 'Engineering', design: 'Senior Developer' },
  { name: 'Divya Nair', dept: 'HR', design: 'HR Executive' },
  { name: 'Rahul Verma', dept: 'Sales', design: 'Account Manager' },
  { name: 'Sneha Patel', dept: 'Finance', design: 'Analyst' },
  { name: 'Vikram Singh', dept: 'Engineering', design: 'QA Engineer' },
  { name: 'Ananya Iyer', dept: 'Design', design: 'UI Designer' },
  { name: 'Kiran Kumar', dept: 'Operations', design: 'Coordinator' },
  { name: 'Meera Krishnan', dept: 'Engineering', design: 'DevOps Engineer' },
  { name: 'Rohit Das', dept: 'Marketing', design: 'Digital Marketer' },
  { name: 'Pooja Menon', dept: 'Support', design: 'Support Lead' },
  { name: 'Aditya Rao', dept: 'Engineering', design: 'Data Engineer' }
];

const PENDING_EMPLOYEES = [
  { name: 'Sara Fernandes', dept: 'Finance', design: 'Accountant' },
  { name: 'Nikhil Bansal', dept: 'Sales', design: 'BDE' },
  { name: 'Ishita Gupta', dept: 'HR', design: 'HR Recruiter' }
];

function reset() {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM speed_events; DELETE FROM notifications; DELETE FROM feedback;
    DELETE FROM checkins; DELETE FROM schedules; DELETE FROM vehicles;
    DELETE FROM routes; DELETE FROM users; DELETE FROM chat_messages; DELETE FROM sms_log;
  `);
  db.exec('DELETE FROM sqlite_sequence;');
  db.exec('PRAGMA foreign_keys = ON;');
}

function seed() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existing > 0 && process.argv[2] !== '--fresh') {
    console.log('DB already seeded. Use "npm run seed -- --fresh" to reseed.');
    return;
  }
  reset();

  const insertRoute = db.prepare(`INSERT INTO routes (name, start_point, end_point, speed_limit, stops) VALUES (?,?,?,?,?)`);
  const routeIds = [];
  for (const r of ROUTES) {
    const info = insertRoute.run(r.name, r.start_point, r.end_point, r.speed_limit, JSON.stringify(r.stops));
    routeIds.push(Number(info.lastInsertRowid));
  }

  const insertUser = db.prepare(`INSERT INTO users (role, emp_id, email, name, phone, department, designation, password_hash, approved, vehicle_id) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertVehicle = db.prepare(`INSERT INTO vehicles (vehicle_name, plate, type, capacity, line, trip, route_id, driver_name, driver_phone, status) VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const adminPwd = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10);
  const adminInfo = insertUser.run('admin', 'ADMIN', 'admin@getinroute.com', 'Operations Admin', '+91 98450 00000', 'Operations', 'Fleet Manager', adminPwd, 1, null);
  const adminId = Number(adminInfo.lastInsertRowid);

  const empPwd = bcrypt.hashSync('Emp@123', 10);
  const empIds = [];
  EMPLOYEES.forEach((e, i) => {
    const id = `E${1001 + i}`;
    const info = insertUser.run('employee', id, `${id.toLowerCase()}@getinroute.com`, e.name, `+91 98${String(40000000 + i * 1111).slice(0, 10)}`, e.dept, e.design, empPwd, 1, null);
    empIds.push(Number(info.lastInsertRowid));
  });

  const pendingIds = [];
  PENDING_EMPLOYEES.forEach((e, i) => {
    const id = `E${1101 + i}`;
    const info = insertUser.run('employee', id, `${id.toLowerCase()}@getinroute.com`, e.name, `+91 98550 ${String(20000 + i * 1000)}`, e.dept, e.design, empPwd, 0, null);
    pendingIds.push(Number(info.lastInsertRowid));
  });

  const drivePwd = bcrypt.hashSync('Drive@123', 10);
  const vehicleIds = [];
  VEHICLES.forEach((v, i) => {
    const drv = DRIVERS[i % DRIVERS.length];
    const routeId = routeIds[i % routeIds.length];
    const info = insertVehicle.run(v.vehicle_name, v.plate, v.type, v.capacity, v.line, v.trip, routeId, drv.name, drv.phone, 'idle');
    vehicleIds.push(Number(info.lastInsertRowid));
    const dId = `D${2001 + i}`;
    insertUser.run('driver', dId, `${dId.toLowerCase()}@getinroute.com`, drv.name, drv.phone, 'Transport', 'Driver', drivePwd, 1, Number(info.lastInsertRowid));
  });

  const insertSched = db.prepare(`INSERT INTO schedules (employee_id, vehicle_id, route_id, date, pickup_time, drop_time, login_time, logout_time, sequence, status, approved) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCheckin = db.prepare(`INSERT INTO checkins (schedule_id, user_id, type, lat, lng, time) VALUES (?,?,?,?,?,?)`);
  const insertFeedback = db.prepare(`INSERT INTO feedback (user_id, role, schedule_id, rating, message) VALUES (?,?,?,?,?)`);
  const insertNotif = db.prepare(`INSERT INTO notifications (user_id, title, message) VALUES (?,?,?)`);
  const insertSpeed = db.prepare(`INSERT INTO speed_events (vehicle_id, vehicle_name, driver_name, speed, speed_limit, lat, lng) VALUES (?,?,?,?,?,?,?)`);

  const pickupTimes = ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15'];
  const dropTimes = ['18:05', '18:20', '18:35', '18:50', '19:05', '19:20'];

  // Today: 6 employees on route 1 vehicle 1 (in_progress so it moves), 3 on route 2 vehicle 2 (confirmed)
  for (let i = 0; i < 6; i++) {
    insertSched.run(empIds[i], vehicleIds[0], routeIds[0], TODAY, pickupTimes[i], dropTimes[i], '09:30', '18:00', i + 1, i < 3 ? 'in_progress' : 'confirmed', 1);
  }
  for (let i = 6; i < 9; i++) {
    insertSched.run(empIds[i], vehicleIds[1], routeIds[1], TODAY, pickupTimes[i - 6], dropTimes[i - 6], '09:30', '18:00', i - 5, 'confirmed', 1);
  }
  // One schedule pending approval
  insertSched.run(pendingIds[0], vehicleIds[2], routeIds[2], TODAY, '08:30', '18:30', '09:30', '18:00', 1, 'scheduled', 0);

  // Yesterday completed trips with checkins + feedback
  const s1 = insertSched.run(empIds[0], vehicleIds[0], routeIds[0], YDAY_S, '08:00', '18:05', '09:30', '18:00', 1, 'completed', 1);
  const s2 = insertSched.run(empIds[1], vehicleIds[0], routeIds[0], YDAY_S, '08:15', '18:20', '09:30', '18:00', 2, 'completed', 1);
  const s3 = insertSched.run(empIds[6], vehicleIds[1], routeIds[1], YDAY_S, '08:00', '18:05', '09:30', '18:00', 1, 'completed', 1);
  const s4 = insertSched.run(empIds[7], vehicleIds[1], routeIds[1], YDAY_S, '08:15', '18:20', '09:30', '18:00', 2, 'completed', 1);
  const s5 = insertSched.run(empIds[2], vehicleIds[2], routeIds[2], YDAY_S, '08:30', '18:30', '09:30', '18:00', 1, 'completed', 1);

  [s1, s2, s3, s4, s5].forEach((s, idx) => {
    const schedId = Number(s.lastInsertRowid);
    const empIdx = [0, 1, 6, 7, 2][idx];
    const empId = empIds[empIdx];
    const stops = ROUTES[[0, 0, 1, 1, 2][idx]].stops;
    const stop = stops[0];
    insertCheckin.run(schedId, empId, 'checkin', stop.lat, stop.lng, `${YDAY_S} 08:${30 + idx * 5}`);
    const last = stops[stops.length - 1];
    insertCheckin.run(schedId, empId, 'checkout', last.lat, last.lng, `${YDAY_S} 18:${10 + idx * 5}`);
    insertFeedback.run(empId, 'employee', schedId, 4 + (idx % 2), idx % 2 ? 'Smooth ride, driver was polite.' : 'Great punctuality, cab was clean.');
  });

  // Some driver feedback
  const dS = insertSched.run(empIds[3], vehicleIds[1], routeIds[1], YDAY_S, '08:30', '18:35', '09:30', '18:00', 1, 'completed', 1);
  insertFeedback.run(empIds[3], 'employee', Number(dS.lastInsertRowid), 5, 'Excellent service.');
  insertFeedback.run(empIds[0], 'driver', Number(s1.lastInsertRowid), 5, 'Passengers boarded on time.');

  // A couple of past speed events + notifications so dashboard is alive
  insertSpeed.run(vehicleIds[0], VEHICLES[0].vehicle_name, DRIVERS[0].name, 78, 60, 12.9352, 77.6245);
  insertSpeed.run(vehicleIds[1], VEHICLES[1].vehicle_name, DRIVERS[1].name, 63, 50, 12.9569, 77.7011);
  insertNotif.run(adminId, '⚠ Speed Limit Breached', `Volvo AC Bus crossed 60 km/h (78 km/h) near Koramangala.`);
  insertNotif.run(adminId, '⚠ Speed Limit Breached', `Force Traveller crossed 50 km/h (63 km/h) near Marathahalli.`);
  insertNotif.run(adminId, 'New Employee Registration', `Sara Fernandes (E1101) requested registration. Review to approve or reject.`);

  // Vehicles on in-progress trips get live status
  db.prepare("UPDATE vehicles SET live_status='en_route', current_stop=0 WHERE id=?").run(vehicleIds[0]);
  db.prepare("UPDATE vehicles SET live_status='active', current_stop=0 WHERE id=?").run(vehicleIds[1]);

  // Some chat history between admin and a driver
  const driverUser = db.prepare("SELECT id FROM users WHERE role='driver' LIMIT 1").get();
  const insertChat = db.prepare(`INSERT INTO chat_messages (sender_id, receiver_id, message, created_at) VALUES (?,?,?,?)`);
  insertChat.run(driverUser.id, adminId, 'Good morning sir, ready for the morning trip on Route 1.', `${TODAY} 07:45:00`);
  insertChat.run(adminId, driverUser.id, 'Good morning! 6 employees today, start by 8:00 from Electronic City.', `${TODAY} 07:48:00`);
  insertChat.run(driverUser.id, adminId, 'Noted. Will update once everyone boards.', `${TODAY} 07:50:00`);

  // A sample SMS log entry
  db.prepare(`INSERT INTO sms_log (to_phone, message, provider, status) VALUES (?,?,?,?)`)
    .run('+91 98450 00000', '[GetinRoute] Speed alert: Volvo AC Bus hit 78 km/h (limit 60) near Koramangala.', 'simulated', 'delivered');

  console.log(`Seeded DB: ${EMPLOYEES.length + PENDING_EMPLOYEES.length} employees, ${VEHICLES.length} vehicles/drivers, ${ROUTES.length} routes.`);
  console.log('Logins ->');
  console.log('  Admin:      admin@getinroute.com / Admin@123');
  console.log('  Employee:   E1001 / Emp@123');
  console.log('  Driver:     D2001 / Drive@123');
}

if (process.env.SEED_DEMO === '1') {
  seed();
} else {
  console.log('[seed] Skipping demo seed. Set SEED_DEMO=1 to load demo data (dev only).');
}
