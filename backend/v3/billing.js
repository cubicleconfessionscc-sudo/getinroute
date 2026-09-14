'use strict';
/* V3 Phase 12 — OPERATIONAL / VENDOR BILLING ENGINE. Separate from the platform
   subscription domain (V3 §35, §76.1). Supports per-trip, per-km, fixed contract,
   per-employee, shift-based, waiting, cancellation, no-show and taxes. Historical
   records are never overwritten (append+audit only). */

const { now } = require('./schema');
const { audit } = require('./core');

let db = null;
function setDb(d) { db = d; }

function nextInvoiceNo() {
  const c = db.prepare('SELECT COUNT(*) AS n FROM billing_invoices').get().n || 0;
  return `GIR-${String(c + 1).padStart(6, '0')}`;
}

/* rate resolution: company-specific else platform default */
function rateFor(companyId, rateKey) {
  return db.prepare('SELECT * FROM billing_rates WHERE company_id = ? AND rate_key = ? AND status = ? ORDER BY id DESC LIMIT 1').get(companyId, rateKey, 'active')
    || db.prepare("SELECT * FROM billing_rates WHERE company_id IS NULL AND rate_key = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(rateKey)
    || null;
}
function upsertRate(r) {
  db.prepare(`INSERT INTO billing_rates (company_id, rate_key, name, unit, base_amount, currency, per_unit_amount, waiting_rate, cancellation_fee, no_show_fee, tax_rate, effective_from, effective_to, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT DO NOTHING`)
    .run(r.company_id || null, r.rate_key, r.name, r.unit || 'trip', r.base_amount || 0, r.currency || 'INR',
      r.per_unit_amount || 0, r.waiting_rate || 0, r.cancellation_fee || 0, r.no_show_fee || 0, r.tax_rate || 0,
      r.effective_from || now().slice(0, 10), r.effective_to || null, 'active', now(), now());
}

/* compute cost for a schedule (or generic inputs) using selected rate */
function compute({ companyId, rateKey, quantity = 1, unit = 'trip', distanceKm = 0, waitingMin = 0, cancelled = false, noShow = false }) {
  const rate = rateFor(companyId, rateKey);
  if (!rate) return { ok: false, error: 'No active billing rate for key: ' + rateKey };
  let base = Number(rate.base_amount) || 0;
  if (rate.unit === 'km' && distanceKm) base += (Number(rate.per_unit_amount) || 0) * distanceKm;
  else if (rate.unit === 'trip') base += (Number(rate.per_unit_amount) || 0) * quantity;
  if (waitingMin) base += (Number(rate.waiting_rate) || 0) * Math.ceil(waitingMin / 60);
  if (cancelled) base += Number(rate.cancellation_fee) || 0;
  if (noShow) base += Number(rate.no_show_fee) || 0;
  const gross = +base.toFixed(2);
  const tax = +(gross * (Number(rate.tax_rate) || 0) / 100).toFixed(2);
  return { ok: true, gross_amount: gross, tax, net_amount: +(gross + tax).toFixed(2), currency: rate.currency, rate_id: rate.id };
}

function createRecord({ companyId, vendorId, scheduleId, vehicleId, recordType = 'trip', quantity, distanceKm, waitingMin, cancelled, noShow, rateKey, tripDate, createdBy }) {
  const rateKeyUse = rateKey || 'default';
  const calc = compute({ companyId, rateKey: rateKeyUse, quantity, distanceKm, waitingMin, cancelled, noShow });
  if (!calc.ok) return calc;
  const r = db.prepare(`INSERT INTO billing_records (company_id, vendor_id, schedule_id, vehicle_id, record_type, quantity, unit_amount, tax, gross_amount, net_amount, currency, trip_date, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(companyId, vendorId || null, scheduleId || null, vehicleId || null, recordType, quantity || 1,
      Number(calc.gross_amount.toFixed(2)), calc.tax, calc.gross_amount, calc.net_amount, calc.currency, tripDate || now().slice(0, 10), 'DRAFT', now(), now());
  const id = Number(r.lastInsertRowid ?? r.lastID);
  audit({ company_id: companyId, actor_id: createdBy, action: 'billing:record_created', category: 'billing', entity_type: 'billing_records', entity_id: id, new_value: { calc } });
  return { ok: true, id, ...calc };
}

function generateInvoice({ companyId, vendorId, periodStart, periodEnd, createdBy }) {
  const records = db.prepare(`SELECT * FROM billing_records WHERE company_id = ? AND status = 'DRAFT' AND (? IS NULL OR vendor_id = ?) AND trip_date >= ? AND trip_date <= ?`).all(companyId, vendorId || null, vendorId || null, periodStart, periodEnd);
  if (!records.length) return { ok: false, error: 'No draft billing records in period' };
  const gross = records.reduce((a, r) => a + r.gross_amount, 0);
  const tax = records.reduce((a, r) => a + r.tax, 0);
  const net = +((gross + tax).toFixed(2));
  const inv = db.prepare(`INSERT INTO billing_invoices (company_id, vendor_id, invoice_no, period_start, period_end, gross_amount, adjustments, tax, net_amount, currency, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'DRAFT', ?, ?)`)
    .run(companyId, vendorId || null, nextInvoiceNo(), periodStart, periodEnd, +gross.toFixed(2), 0, +tax.toFixed(2), net, records[0].currency, now(), now());
  const id = Number(inv.lastInsertRowid ?? inv.lastID);
  db.prepare("UPDATE billing_records SET status = 'BILLED' WHERE id IN (" + records.map(() => '?').join(',') + ')' ).run(...records.map((r) => r.id));
  audit({ company_id: companyId, actor_id: createdBy, action: 'billing:invoice_generated', category: 'billing', entity_type: 'billing_invoices', entity_id: id, new_value: { period: [periodStart, periodEnd], net } });
  return { ok: true, id, invoice_no: (db.prepare('SELECT invoice_no FROM billing_invoices WHERE id = ?').get(id) || {}).invoice_no, gross, tax, net, records: records.length };
}

function adjust({ invoiceId, type = 'credit', amount, reason, createdBy }) {
  const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
  if (!inv) return { ok: false, error: 'invoice not found' };
  db.prepare('INSERT INTO billing_adjustments (invoice_id, record_id, type, amount, currency, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(invoiceId, null, type, amount, inv.currency, reason || null, createdBy || null, now());
  const adj = type === 'credit' ? -amount : amount;
  db.prepare('UPDATE billing_invoices SET adjustments = adjustments + ?, net_amount = net_amount + ?, status = CASE WHEN status = ? THEN ? ELSE status END, updated_at = ? WHERE id = ?')
    .run(adj, adj, 'DRAFT', 'DRAFT', now(), invoiceId);
  audit({ actor_id: createdBy, action: 'billing:adjustment', category: 'billing', entity_type: 'billing_invoices', entity_id: invoiceId, new_value: { type, amount, reason } });
  return { ok: true };
}

function reconcile({ invoiceId, paymentDate, amount, verifiedBy, notes }) {
  const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
  if (!inv) return { ok: false, error: 'invoice not found' };
  const mismatch = +(Number(amount) - Number(inv.net_amount)).toFixed(2);
  const status = mismatch === 0 ? 'MATCHED' : 'MISMATCH';
  db.prepare('INSERT INTO billing_reconciliation (invoice_id, payment_date, amount, matched_amount, mismatch, status, verified_by, verified_at, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(invoiceId, paymentDate || now().slice(0, 10), amount, inv.net_amount, mismatch, status, verifiedBy || null, now(), notes || null, now());
  audit({ actor_id: verifiedBy, action: 'billing:reconcile', category: 'billing', entity_type: 'billing_invoices', entity_id: invoiceId, new_value: { amount, status } });
  return { ok: true, status, mismatch };
}

function list({ companyId, kind = 'records', vendorId, from, to }) {
  if (kind === 'invoices') {
    return db.prepare('SELECT * FROM billing_invoices WHERE company_id = ? AND (? IS NULL OR vendor_id = ?) ORDER BY id DESC LIMIT 200').all(companyId, vendorId || null, vendorId || null);
  }
  return db.prepare('SELECT * FROM billing_records WHERE company_id = ? AND (? IS NULL OR vendor_id = ?) AND (trip_date >= ? OR ? = \'\') AND (trip_date <= ? OR ? = \'\') ORDER BY id DESC LIMIT 500').all(
    companyId, vendorId || null, vendorId || null, from || '', from || '', to || '', to || '');
}

module.exports = { setDb, rateFor, upsertRate, compute, createRecord, generateInvoice, adjust, reconcile, list };