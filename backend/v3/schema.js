'use strict';
/* V3 additive schema — SQLite + PostgreSQL dialects. Frozen 36-table schema is
   NEVER touched here; every table below is brand-new (CREATE TABLE IF NOT EXISTS). */

const COLS = {
  idSQL: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
  idPG: 'id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY'
};

const DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS platform_subscription_plans (
  ${COLS.idSQL},
  name TEXT NOT NULL, description TEXT,
  price REAL, currency TEXT DEFAULT 'INR',
  billing_interval TEXT DEFAULT 'monthly',
  trial_duration_days INTEGER DEFAULT 10,
  entitlements TEXT DEFAULT '{}',
  limits TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_agreements (
  ${COLS.idSQL},
  company_id INTEGER, plan_id INTEGER,
  reference TEXT, effective_date TEXT, renewal_date TEXT,
  agreed_price REAL, currency TEXT DEFAULT 'INR',
  billing_interval TEXT DEFAULT 'monthly',
  terms TEXT DEFAULT '{}', document_ref TEXT,
  status TEXT DEFAULT 'draft',
  created_by INTEGER, approved_by INTEGER, approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_subscriptions (
  ${COLS.idSQL},
  company_id INTEGER NOT NULL, plan_id INTEGER, agreement_id INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  trial_start_at TEXT, trial_end_at TEXT,
  subscription_start_at TEXT, subscription_end_at TEXT,
  renewal_date TEXT, payment_due_date TEXT,
  grace_until TEXT, payment_required_after_trial INTEGER DEFAULT 1,
  last_payment_verified_at TEXT,
  updated_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_subscriptions_company ON platform_subscriptions(company_id);
CREATE TABLE IF NOT EXISTS platform_subscription_periods (
  ${COLS.idSQL},
  subscription_id INTEGER, period_start TEXT, period_end TEXT,
  status TEXT, amount REAL, currency TEXT DEFAULT 'INR',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS platform_payments (
  ${COLS.idSQL},
  subscription_id INTEGER, company_id INTEGER,
  amount REAL, currency TEXT DEFAULT 'INR',
  payment_date TEXT, method TEXT DEFAULT 'manual', provider TEXT,
  external_reference TEXT, submitted_by INTEGER,
  status TEXT DEFAULT 'SUBMITTED',
  verification_status TEXT DEFAULT 'PENDING',
  submitted_at TEXT DEFAULT (datetime('now','localtime')),
  notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_payment_verifications (
  ${COLS.idSQL},
  payment_id INTEGER, verified_by INTEGER,
  status TEXT NOT NULL, decision_at TEXT, reason TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS platform_entitlements (
  ${COLS.idSQL},
  subscription_id INTEGER, feature TEXT NOT NULL,
  granted INTEGER DEFAULT 1, source TEXT DEFAULT 'plan',
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_entitlements ON platform_entitlements(subscription_id, feature);
CREATE TABLE IF NOT EXISTS platform_subscription_events (
  ${COLS.idSQL},
  subscription_id INTEGER, company_id INTEGER,
  from_state TEXT, to_state TEXT,
  reason TEXT, actor_id INTEGER, actor_role TEXT,
  payment_reference TEXT, ip TEXT, result TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_platform_events_sub ON platform_subscription_events(subscription_id, created_at);
CREATE TABLE IF NOT EXISTS platform_trial_records (
  ${COLS.idSQL},
  company_id INTEGER, subscription_id INTEGER,
  trial_start_at TEXT, trial_end_at TEXT,
  duration_days INTEGER DEFAULT 10, status TEXT DEFAULT 'ACTIVE',
  approved_by INTEGER, approval_at TEXT,
  ended_reason TEXT, once_guard INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_trial_guard ON platform_trial_records(company_id, once_guard);
CREATE TABLE IF NOT EXISTS platform_invoices (
  ${COLS.idSQL},
  subscription_id INTEGER, company_id INTEGER, invoice_no TEXT,
  period_start TEXT, period_end TEXT,
  amount REAL, currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'DRAFT', payment_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_providers (
  ${COLS.idSQL},
  name TEXT NOT NULL, kind TEXT DEFAULT 'manual',
  config_meta TEXT DEFAULT '{}', enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS policy_rules (
  ${COLS.idSQL},
  company_id INTEGER, vertical TEXT DEFAULT 'company',
  name TEXT NOT NULL, rule_key TEXT NOT NULL,
  rule_type TEXT DEFAULT 'number', value TEXT DEFAULT '',
  scope TEXT DEFAULT 'company', enabled INTEGER DEFAULT 1,
  created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rules_key ON policy_rules(company_id, vertical, rule_key);
CREATE TABLE IF NOT EXISTS feature_flags (
  ${COLS.idSQL},
  flag_key TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 0, rollout_pct INTEGER DEFAULT 100,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_models (
  ${COLS.idSQL},
  model_key TEXT NOT NULL, version TEXT NOT NULL,
  config TEXT DEFAULT '{}', status TEXT DEFAULT 'candidate',
  deployed_at TEXT, rolled_back_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models ON ai_models(model_key, version);
CREATE TABLE IF NOT EXISTS ai_recommendations (
  ${COLS.idSQL},
  kind TEXT NOT NULL, subject_type TEXT, subject_id INTEGER,
  recommendation TEXT DEFAULT '{}',
  confidence REAL, status TEXT DEFAULT 'PENDING',
  reason TEXT, supporting_data TEXT DEFAULT '{}',
  warnings TEXT DEFAULT '{}', expected_impact TEXT DEFAULT '{}',
  created_by INTEGER, reviewed_by INTEGER, reviewed_at TEXT,
  executed_at TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_recs_status ON ai_recommendations(kind, status, created_at);
CREATE TABLE IF NOT EXISTS ai_eval_events (
  ${COLS.idSQL},
  model_key TEXT, version TEXT, kind TEXT,
  prediction TEXT DEFAULT '{}', actual TEXT DEFAULT '{}',
  error REAL, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ai_eval ON ai_eval_events(model_key, version, kind, created_at);
CREATE TABLE IF NOT EXISTS eta_predictions (
  ${COLS.idSQL},
  schedule_id INTEGER, vehicle_id INTEGER, route_id INTEGER,
  predicted_at TEXT, eta_minutes REAL, delay_minutes REAL,
  confidence REAL, factors TEXT DEFAULT '{}',
  actual_minutes REAL, actual_delay REAL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_eta_pred ON eta_predictions(schedule_id, created_at);
CREATE TABLE IF NOT EXISTS intelligence_insights (
  ${COLS.idSQL},
  company_id INTEGER, vertical TEXT DEFAULT 'company',
  kind TEXT, question TEXT, answer TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS addresses (
  ${COLS.idSQL},
  owner_type TEXT, owner_id INTEGER,
  address_line TEXT, landmark TEXT, locality TEXT, city TEXT, state TEXT,
  postal_code TEXT, country TEXT DEFAULT 'IN',
  latitude REAL, longitude REAL,
  formatted_address TEXT, provider_reference TEXT,
  accuracy TEXT, source TEXT DEFAULT 'manual',
  is_current INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_addresses_owner ON addresses(owner_type, owner_id, is_current);
CREATE TABLE IF NOT EXISTS recent_locations (
  ${COLS.idSQL},
  user_id INTEGER, formatted_address TEXT,
  latitude REAL, longitude REAL, source TEXT,
  used_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_recent_locations ON recent_locations(user_id, used_at);
CREATE TABLE IF NOT EXISTS vehicle_documents (
  ${COLS.idSQL},
  vehicle_id INTEGER, doc_type TEXT, doc_number TEXT,
  issue_date TEXT, expiry_date TEXT, file_ref TEXT,
  status TEXT DEFAULT 'active', verified_by INTEGER, verified_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS driver_documents (
  ${COLS.idSQL},
  driver_id INTEGER, doc_type TEXT, doc_number TEXT,
  issue_date TEXT, expiry_date TEXT, file_ref TEXT,
  status TEXT DEFAULT 'active', verified_by INTEGER, verified_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_rates (
  ${COLS.idSQL},
  company_id INTEGER, rate_key TEXT, name TEXT,
  unit TEXT DEFAULT 'trip', base_amount REAL, currency TEXT DEFAULT 'INR',
  per_unit_amount REAL, waiting_rate REAL, cancellation_fee REAL,
  no_show_fee REAL, tax_rate REAL DEFAULT 0,
  effective_from TEXT, effective_to TEXT, status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_records (
  ${COLS.idSQL},
  company_id INTEGER, vendor_id INTEGER, schedule_id INTEGER, vehicle_id INTEGER,
  record_type TEXT DEFAULT 'trip', quantity REAL DEFAULT 1,
  unit_amount REAL, tax REAL, gross_amount REAL, net_amount REAL,
  currency TEXT DEFAULT 'INR', trip_date TEXT,
  status TEXT DEFAULT 'DRAFT',
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_records_company ON billing_records(company_id, trip_date);
CREATE TABLE IF NOT EXISTS billing_invoices (
  ${COLS.idSQL},
  company_id INTEGER, vendor_id INTEGER, invoice_no TEXT,
  period_start TEXT, period_end TEXT,
  gross_amount REAL, adjustments REAL DEFAULT 0, tax REAL DEFAULT 0,
  net_amount REAL, currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'DRAFT',
  issued_at TEXT, paid_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_reconciliation (
  ${COLS.idSQL},
  invoice_id INTEGER, payment_date TEXT, amount REAL,
  matched_amount REAL, mismatch REAL DEFAULT 0,
  status TEXT DEFAULT 'PENDING', verified_by INTEGER, verified_at TEXT,
  notes TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS billing_adjustments (
  ${COLS.idSQL},
  invoice_id INTEGER, record_id INTEGER,
  type TEXT, amount REAL, currency TEXT DEFAULT 'INR',
  reason TEXT, created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notification_templates (
  ${COLS.idSQL},
  name TEXT NOT NULL, channel TEXT DEFAULT 'push',
  subject TEXT, body TEXT, vars TEXT DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  ${COLS.idSQL},
  user_id INTEGER, company_id INTEGER, channel TEXT,
  template_id INTEGER, to_ref TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'PENDING', attempts INTEGER DEFAULT 0,
  provider_ref TEXT, sent_at TEXT, error TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_outbox ON notification_outbox(status, created_at);
CREATE TABLE IF NOT EXISTS branches (
  ${COLS.idSQL},
  company_id INTEGER, name TEXT, city TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cities (
  ${COLS.idSQL},
  company_id INTEGER, name TEXT, state TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS platform_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT DEFAULT '{}', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS integration_configs (
  ${COLS.idSQL},
  company_id INTEGER, kind TEXT, provider TEXT,
  config_meta TEXT DEFAULT '{}', enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  ${COLS.idSQL},
  company_id INTEGER, vertical TEXT DEFAULT 'company',
  actor_id INTEGER, actor_role TEXT,
  action TEXT NOT NULL, category TEXT,
  entity_type TEXT, entity_id INTEGER,
  old_value TEXT, new_value TEXT, reason TEXT, ip TEXT, result TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs ON audit_logs(category, entity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at);
CREATE TABLE IF NOT EXISTS operational_events (
  ${COLS.idSQL},
  tenant_type TEXT NOT NULL DEFAULT 'company',
  tenant_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  dedupe_key TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  processed_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON operational_events(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe ON operational_events(tenant_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS operational_incidents (
  ${COLS.idSQL},
  company_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  source TEXT,
  severity TEXT,
  priority_score REAL,
  status TEXT NOT NULL DEFAULT 'detected',
  assignee_id INTEGER,
  detail TEXT,
  ack_at TEXT, assigned_at TEXT, escalated_at TEXT, mitigated_at TEXT, resolved_at TEXT, reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON operational_incidents(company_id, status, created_at);
CREATE TABLE IF NOT EXISTS automation_rules (
  ${COLS.idSQL},
  company_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  owner_id INTEGER,
  owner_role TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  conditions TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  level INTEGER NOT NULL DEFAULT 1,
  max_confidence INTEGER,
  last_run TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auto_rules_event ON automation_rules(event_type, enabled);
CREATE TABLE IF NOT EXISTS automation_executions (
  ${COLS.idSQL},
  rule_id INTEGER,
  event_id INTEGER,
  company_id INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT,
  outcome TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_auto_exec_rule ON automation_executions(rule_id, created_at);

/* ---- No-show records + employee transport suspension (spec 11-15) ---- */
CREATE TABLE IF NOT EXISTS employee_no_show_log (
  ${COLS.idSQL},
  employee_id INTEGER NOT NULL,
  schedule_id INTEGER,
  date TEXT NOT NULL,
  time TEXT,
  vehicle_id INTEGER,
  company_id INTEGER DEFAULT 0,
  vendor_id INTEGER DEFAULT 0,
  marked_by INTEGER,
  marked_by_role TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_noshow_emp ON employee_no_show_log(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_noshow_sched ON employee_no_show_log(schedule_id);
CREATE TABLE IF NOT EXISTS employee_suspensions (
  ${COLS.idSQL},
  employee_id INTEGER NOT NULL,
  company_id INTEGER DEFAULT 0,
  trigger_type TEXT DEFAULT 'no_show',
  no_show_count INTEGER DEFAULT 0,
  threshold INTEGER DEFAULT 3,
  status TEXT DEFAULT 'suspended',
  reason TEXT,
  note TEXT,
  suspended_by INTEGER,
  suspended_by_role TEXT DEFAULT 'system',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  admin_reason TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_susp_emp ON employee_suspensions(employee_id, status);

/* ---- Announcements (Admin-only publishing, targeted Employee/Driver/School/Both) ---- */
CREATE TABLE IF NOT EXISTS announcements (
  ${COLS.idSQL},
  company_id INTEGER,
  audience TEXT NOT NULL DEFAULT 'both',
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  starts_at TEXT,
  expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ann_scope ON announcements(company_id, enabled, starts_at, expires_at);

/* ---- Roster Auto-Run (per-company daily regeneration of schedules from routes) ---- */
CREATE TABLE IF NOT EXISTS roster_auto_runs (
  ${COLS.idSQL},
  company_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  default_pickup TEXT,
  default_drop TEXT,
  directions TEXT DEFAULT '["toOffice","toHome"]',
  last_run_date TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  UNIQUE (company_id)
);
`;

const DDL_PG = `
CREATE TABLE IF NOT EXISTS platform_subscription_plans (
  ${COLS.idPG},
  name TEXT NOT NULL, description TEXT,
  price DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  billing_interval TEXT DEFAULT 'monthly',
  trial_duration_days INTEGER DEFAULT 10,
  entitlements TEXT DEFAULT '{}',
  limits TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_agreements (
  ${COLS.idPG},
  company_id BIGINT, plan_id BIGINT,
  reference TEXT, effective_date TEXT, renewal_date TEXT,
  agreed_price DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  billing_interval TEXT DEFAULT 'monthly',
  terms TEXT DEFAULT '{}', document_ref TEXT,
  status TEXT DEFAULT 'draft',
  created_by BIGINT, approved_by BIGINT, approved_at TEXT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_subscriptions (
  ${COLS.idPG},
  company_id BIGINT NOT NULL, plan_id BIGINT, agreement_id BIGINT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  trial_start_at TEXT, trial_end_at TEXT,
  subscription_start_at TEXT, subscription_end_at TEXT,
  renewal_date TEXT, payment_due_date TEXT,
  grace_until TEXT, payment_required_after_trial INTEGER DEFAULT 1,
  last_payment_verified_at TEXT,
  updated_by BIGINT, created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_subscriptions_company ON platform_subscriptions(company_id);
CREATE TABLE IF NOT EXISTS platform_subscription_periods (
  ${COLS.idPG},
  subscription_id BIGINT, period_start TEXT, period_end TEXT,
  status TEXT, amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS platform_payments (
  ${COLS.idPG},
  subscription_id BIGINT, company_id BIGINT,
  amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  payment_date TEXT, method TEXT DEFAULT 'manual', provider TEXT,
  external_reference TEXT, submitted_by BIGINT,
  status TEXT DEFAULT 'SUBMITTED',
  verification_status TEXT DEFAULT 'PENDING',
  submitted_at TEXT DEFAULT log_now(),
  notes TEXT, created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_payment_verifications (
  ${COLS.idPG},
  payment_id BIGINT, verified_by BIGINT,
  status TEXT NOT NULL, decision_at TEXT, reason TEXT, notes TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS platform_entitlements (
  ${COLS.idPG},
  subscription_id BIGINT, feature TEXT NOT NULL,
  granted INTEGER DEFAULT 1, source TEXT DEFAULT 'plan',
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_entitlements ON platform_entitlements(subscription_id, feature);
CREATE TABLE IF NOT EXISTS platform_subscription_events (
  ${COLS.idPG},
  subscription_id BIGINT, company_id BIGINT,
  from_state TEXT, to_state TEXT,
  reason TEXT, actor_id BIGINT, actor_role TEXT,
  payment_reference TEXT, ip TEXT, result TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_platform_events_sub ON platform_subscription_events(subscription_id, created_at);
CREATE TABLE IF NOT EXISTS platform_trial_records (
  ${COLS.idPG},
  company_id BIGINT, subscription_id BIGINT,
  trial_start_at TEXT, trial_end_at TEXT,
  duration_days INTEGER DEFAULT 10, status TEXT DEFAULT 'ACTIVE',
  approved_by BIGINT, approval_at TEXT,
  ended_reason TEXT, once_guard INTEGER DEFAULT 1,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_trial_guard ON platform_trial_records(company_id, once_guard);
CREATE TABLE IF NOT EXISTS platform_invoices (
  ${COLS.idPG},
  subscription_id BIGINT, company_id BIGINT, invoice_no TEXT,
  period_start TEXT, period_end TEXT,
  amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'DRAFT', payment_id BIGINT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS platform_providers (
  ${COLS.idPG},
  name TEXT NOT NULL, kind TEXT DEFAULT 'manual',
  config_meta TEXT DEFAULT '{}', enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS policy_rules (
  ${COLS.idPG},
  company_id BIGINT, vertical TEXT DEFAULT 'company',
  name TEXT NOT NULL, rule_key TEXT NOT NULL,
  rule_type TEXT DEFAULT 'number', value TEXT DEFAULT '',
  scope TEXT DEFAULT 'company', enabled INTEGER DEFAULT 1,
  created_by BIGINT, created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rules_key ON policy_rules(company_id, vertical, rule_key);
CREATE TABLE IF NOT EXISTS feature_flags (
  ${COLS.idPG},
  flag_key TEXT NOT NULL UNIQUE,
  enabled INTEGER DEFAULT 0, rollout_pct INTEGER DEFAULT 100,
  description TEXT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_models (
  ${COLS.idPG},
  model_key TEXT NOT NULL, version TEXT NOT NULL,
  config TEXT DEFAULT '{}', status TEXT DEFAULT 'candidate',
  deployed_at TEXT, rolled_back_at TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models ON ai_models(model_key, version);
CREATE TABLE IF NOT EXISTS ai_recommendations (
  ${COLS.idPG},
  kind TEXT NOT NULL, subject_type TEXT, subject_id BIGINT,
  recommendation TEXT DEFAULT '{}',
  confidence REAL, status TEXT DEFAULT 'PENDING',
  reason TEXT, supporting_data TEXT DEFAULT '{}',
  warnings TEXT DEFAULT '{}', expected_impact TEXT DEFAULT '{}',
  created_by BIGINT, reviewed_by BIGINT, reviewed_at TEXT,
  executed_at TEXT, created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_ai_recs_status ON ai_recommendations(kind, status, created_at);
CREATE TABLE IF NOT EXISTS ai_eval_events (
  ${COLS.idPG},
  model_key TEXT, version TEXT, kind TEXT,
  prediction TEXT DEFAULT '{}', actual TEXT DEFAULT '{}',
  error REAL, created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_ai_eval ON ai_eval_events(model_key, version, kind, created_at);
CREATE TABLE IF NOT EXISTS eta_predictions (
  ${COLS.idPG},
  schedule_id BIGINT, vehicle_id BIGINT, route_id BIGINT,
  predicted_at TEXT, eta_minutes REAL, delay_minutes REAL,
  confidence REAL, factors TEXT DEFAULT '{}',
  actual_minutes REAL, actual_delay REAL,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_eta_pred ON eta_predictions(schedule_id, created_at);
CREATE TABLE IF NOT EXISTS intelligence_insights (
  ${COLS.idPG},
  company_id BIGINT, vertical TEXT DEFAULT 'company',
  kind TEXT, question TEXT, answer TEXT DEFAULT '{}',
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS addresses (
  ${COLS.idPG},
  owner_type TEXT, owner_id BIGINT,
  address_line TEXT, landmark TEXT, locality TEXT, city TEXT, state TEXT,
  postal_code TEXT, country TEXT DEFAULT 'IN',
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  formatted_address TEXT, provider_reference TEXT,
  accuracy TEXT, source TEXT DEFAULT 'manual',
  is_current INTEGER DEFAULT 1,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_addresses_owner ON addresses(owner_type, owner_id, is_current);
CREATE TABLE IF NOT EXISTS recent_locations (
  ${COLS.idPG},
  user_id BIGINT, formatted_address TEXT,
  latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, source TEXT,
  used_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_recent_locations ON recent_locations(user_id, used_at);
CREATE TABLE IF NOT EXISTS vehicle_documents (
  ${COLS.idPG},
  vehicle_id BIGINT, doc_type TEXT, doc_number TEXT,
  issue_date TEXT, expiry_date TEXT, file_ref TEXT,
  status TEXT DEFAULT 'active', verified_by BIGINT, verified_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS driver_documents (
  ${COLS.idPG},
  driver_id BIGINT, doc_type TEXT, doc_number TEXT,
  issue_date TEXT, expiry_date TEXT, file_ref TEXT,
  status TEXT DEFAULT 'active', verified_by BIGINT, verified_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_rates (
  ${COLS.idPG},
  company_id BIGINT, rate_key TEXT, name TEXT,
  unit TEXT DEFAULT 'trip', base_amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  per_unit_amount DOUBLE PRECISION, waiting_rate DOUBLE PRECISION, cancellation_fee DOUBLE PRECISION,
  no_show_fee DOUBLE PRECISION, tax_rate DOUBLE PRECISION DEFAULT 0,
  effective_from TEXT, effective_to TEXT, status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_records (
  ${COLS.idPG},
  company_id BIGINT, vendor_id BIGINT, schedule_id BIGINT, vehicle_id BIGINT,
  record_type TEXT DEFAULT 'trip', quantity REAL DEFAULT 1,
  unit_amount DOUBLE PRECISION, tax DOUBLE PRECISION, gross_amount DOUBLE PRECISION, net_amount DOUBLE PRECISION,
  currency TEXT DEFAULT 'INR', trip_date TEXT,
  status TEXT DEFAULT 'DRAFT',
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_records_company ON billing_records(company_id, trip_date);
CREATE TABLE IF NOT EXISTS billing_invoices (
  ${COLS.idPG},
  company_id BIGINT, vendor_id BIGINT, invoice_no TEXT,
  period_start TEXT, period_end TEXT,
  gross_amount DOUBLE PRECISION, adjustments DOUBLE PRECISION DEFAULT 0, tax DOUBLE PRECISION DEFAULT 0,
  net_amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'DRAFT',
  issued_at TEXT, paid_at TEXT,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS billing_reconciliation (
  ${COLS.idPG},
  invoice_id BIGINT, payment_date TEXT, amount DOUBLE PRECISION,
  matched_amount DOUBLE PRECISION, mismatch DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'PENDING', verified_by BIGINT, verified_at TEXT,
  notes TEXT, created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS billing_adjustments (
  ${COLS.idPG},
  invoice_id BIGINT, record_id BIGINT,
  type TEXT, amount DOUBLE PRECISION, currency TEXT DEFAULT 'INR',
  reason TEXT, created_by BIGINT,
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS notification_templates (
  ${COLS.idPG},
  name TEXT NOT NULL, channel TEXT DEFAULT 'push',
  subject TEXT, body TEXT, vars TEXT DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  ${COLS.idPG},
  user_id BIGINT, company_id BIGINT, channel TEXT,
  template_id BIGINT, to_ref TEXT, subject TEXT, body TEXT,
  status TEXT DEFAULT 'PENDING', attempts INTEGER DEFAULT 0,
  provider_ref TEXT, sent_at TEXT, error TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_notif_outbox ON notification_outbox(status, created_at);
CREATE TABLE IF NOT EXISTS branches (
  ${COLS.idPG},
  company_id BIGINT, name TEXT, city TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS cities (
  ${COLS.idPG},
  company_id BIGINT, name TEXT, state TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE TABLE IF NOT EXISTS platform_config (
  id BIGINT PRIMARY KEY CHECK (id = 1),
  data TEXT DEFAULT '{}', updated_at TEXT
);
CREATE TABLE IF NOT EXISTS integration_configs (
  ${COLS.idPG},
  company_id BIGINT, kind TEXT, provider TEXT,
  config_meta TEXT DEFAULT '{}', enabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT log_now(), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  ${COLS.idPG},
  company_id BIGINT, vertical TEXT DEFAULT 'company',
  actor_id BIGINT, actor_role TEXT,
  action TEXT NOT NULL, category TEXT,
  entity_type TEXT, entity_id BIGINT,
  old_value TEXT, new_value TEXT, reason TEXT, ip TEXT, result TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs ON audit_logs(category, entity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at);
CREATE TABLE IF NOT EXISTS operational_events (
  ${COLS.idPG},
  tenant_type TEXT NOT NULL DEFAULT 'company',
  tenant_id BIGINT NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  dedupe_key TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT log_now(),
  processed_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON operational_events(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe ON operational_events(tenant_id, type, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS operational_incidents (
  ${COLS.idPG},
  company_id BIGINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  source TEXT,
  severity TEXT,
  priority_score DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'detected',
  assignee_id BIGINT,
  detail TEXT,
  ack_at TEXT, assigned_at TEXT, escalated_at TEXT, mitigated_at TEXT, resolved_at TEXT, reviewed_at TEXT,
  created_at TEXT DEFAULT log_now(),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON operational_incidents(company_id, status, created_at);
CREATE TABLE IF NOT EXISTS automation_rules (
  ${COLS.idPG},
  company_id BIGINT NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  owner_id BIGINT,
  owner_role TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  conditions TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  level INTEGER NOT NULL DEFAULT 1,
  max_confidence INTEGER,
  last_run TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT log_now(),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auto_rules_event ON automation_rules(event_type, enabled);
CREATE TABLE IF NOT EXISTS automation_executions (
  ${COLS.idPG},
  rule_id BIGINT,
  event_id BIGINT,
  company_id BIGINT NOT NULL DEFAULT 0,
  triggered_by TEXT,
  outcome TEXT,
  detail TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_auto_exec_rule ON automation_executions(rule_id, created_at);

/* ---- No-show records + employee transport suspension (spec 11-15) ---- */
CREATE TABLE IF NOT EXISTS employee_no_show_log (
  ${COLS.idPG},
  employee_id BIGINT NOT NULL,
  schedule_id BIGINT,
  date TEXT NOT NULL,
  time TEXT,
  vehicle_id BIGINT,
  company_id BIGINT DEFAULT 0,
  vendor_id BIGINT DEFAULT 0,
  marked_by BIGINT,
  marked_by_role TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT DEFAULT log_now()
);
CREATE INDEX IF NOT EXISTS idx_noshow_emp ON employee_no_show_log(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_noshow_sched ON employee_no_show_log(schedule_id);
CREATE TABLE IF NOT EXISTS employee_suspensions (
  ${COLS.idPG},
  employee_id BIGINT NOT NULL,
  company_id BIGINT DEFAULT 0,
  trigger_type TEXT DEFAULT 'no_show',
  no_show_count INTEGER DEFAULT 0,
  threshold INTEGER DEFAULT 3,
  status TEXT DEFAULT 'suspended',
  reason TEXT,
  note TEXT,
  suspended_by BIGINT,
  suspended_by_role TEXT DEFAULT 'system',
  reviewed_by BIGINT,
  reviewed_at TEXT,
  admin_reason TEXT,
  created_at TEXT DEFAULT log_now(),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_susp_emp ON employee_suspensions(employee_id, status);

/* ---- Announcements (Admin-only publishing, targeted Employee/Driver/School/Both) ---- */
CREATE TABLE IF NOT EXISTS announcements (
  ${COLS.idPG},
  company_id BIGINT,
  audience TEXT NOT NULL DEFAULT 'both',
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  starts_at TEXT,
  expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT,
  created_at TEXT DEFAULT log_now(),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ann_scope ON announcements(company_id, enabled, starts_at, expires_at);

/* ---- Roster Auto-Run (per-company daily regeneration of schedules from routes) ---- */
CREATE TABLE IF NOT EXISTS roster_auto_runs (
  ${COLS.idPG},
  company_id BIGINT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  default_pickup TEXT,
  default_drop TEXT,
  directions TEXT DEFAULT '["toOffice","toHome"]',
  last_run_date TEXT,
  created_by BIGINT,
  created_at TEXT DEFAULT log_now(),
  updated_at TEXT,
  UNIQUE (company_id)
);
`;

function ensureSchema(db) {
  const pg = !!process.env.DATABASE_URL;
  db.exec(pg ? DDL_PG : DDL_SQLITE);
  // Idempotent column migrations shared by both engines.
  const addCol = (table, colDef) => {
    try { db.exec(pg ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${colDef}` : `ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch (e) {}
  };
  addCol('users', 'parking_line TEXT');
  addCol('users', 'stand_selected TEXT');
  addCol('route_employees', 'pickup_seq INTEGER');
  addCol('route_employees', 'drop_seq INTEGER');
  addCol('schedules', 'auto_generated INTEGER DEFAULT 0');
  addCol('operational_events', 'acknowledged_at TEXT');
  addCol('operational_events', 'dismissed_by BIGINT');
  addCol('routes', 'auto_managed INTEGER DEFAULT 0');
}

/* Idempotent boot defaults: platform config singleton, feature flags, default plan */
function ensureDefaults(db) {
  try {
    const row = db.prepare('SELECT data FROM platform_config WHERE id = 1').get();
    if (!row) {
      db.prepare('INSERT INTO platform_config (id, data, updated_at) VALUES (1, ?, ?)')
        .run(JSON.stringify({
          trialEnabled: true,
          defaultTrialDays: 10,
          trialOncePerCompany: true,
          trialRequiresOwnerApproval: true,
          paymentRequiredAfterTrial: true,
          gracePeriodDays: 7,
          enforceSince: null
        }), now());
    }
    const flagDefaults = [
      ['MAP_PROVIDER', 1, 'osm', 'Map provider: osm|google'],
      ['VENDOR_MODULE', 1, null, 'Vendor management module enabled'],
      ['BILLING_MODULE', 1, null, 'Operational/vendor billing engine enabled'],
      ['ANALYTICS', 1, null, 'Advanced analytics enabled'],
      ['AI_COMMAND_CENTER', 1, null, 'AI command center enabled'],
      ['AI_ROUTE_OPTIMIZATION', 1, null, 'Route intelligence enabled'],
      ['AI_VEHICLE_ALLOCATION', 1, null, 'Vehicle intelligence enabled'],
      ['AI_DRIVER_ALLOCATION', 1, null, 'Driver intelligence enabled'],
      ['AI_DELAY_PREDICTION', 1, null, 'ETA + delay prediction enabled'],
      ['AI_SAFETY', 1, null, 'Safety intelligence enabled'],
      ['AI_TRANSPORT_MANAGER', 1, null, 'Natural-language transport manager enabled'],
      ['SIMULATION_MODE', 0, null, 'Simulation / digital twin enabled'],
      ['ADDRESS_AUTOCOMPLETE', 1, null, 'Address autocomplete + location picker'],
      ['DOCUMENT_MANAGEMENT', 1, null, 'Vehicle/driver document tracking'],
      ['INTEGRATIONS', 0, null, 'Enterprise integrations + SSO (readiness)'],
      ['PLATFORM_SUBSCRIPTION_MODULE', 1, null, 'Platform subscription + trial + payment control plane'],
      ['FREE_TRIAL_ENABLED', 1, null, '10-day free trial enabled'],
      ['MANUAL_PAYMENT_VERIFICATION', 1, null, 'Manual payment verification authoritative'],
      ['SUBSCRIPTION_ENFORCEMENT', 0, null, '0=shadow/log only, 1=enforce access']
    ];
    const ins = db.prepare('INSERT OR IGNORE INTO feature_flags (flag_key, enabled, rollout_pct, description) VALUES (?, ?, 100, ?)');
    for (const [k, v, d] of flagDefaults) ins.run(k, v, d);
    const plan = db.prepare('SELECT id FROM platform_subscription_plans WHERE is_current = 1').get();
    if (!plan) {
      db.prepare('INSERT INTO platform_subscription_plans (name, description, price, currency, billing_interval, trial_duration_days, entitlements, limits, is_current) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('Standard', 'Standard transportation platform plan', 0, 'INR', 'monthly', 10,
          JSON.stringify(['core', 'tracking', 'chat', 'safety', 'analytics']),
          JSON.stringify({ employees: 10000, vehicles: 750 }), 1);
    }
  } catch (e) { console.error('[v3] ensureDefaults failed:', e.message); }
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function addDays(dateMinSec, days) {
  const [d, t] = dateMinSec.split(' ');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mi, ss] = t.split(':').map(Number);
  const dt = new Date(y, m - 1, dd, hh, mi, ss);
  dt.setDate(dt.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

module.exports = { DDL_SQLITE, DDL_PG, ensureSchema, ensureDefaults, now, addDays };