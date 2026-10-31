-- 重症质控闭环 · 简化演示版数据模型
-- 设计原则：原始数据（observations / care_events）→ 规则派生（patient_metrics）→ 指标口径（indicator_defs 中的 SQL）→ 报告（qc_reports）
-- 每一层都保留证据，报告提交时冻结快照，后续数据变更可对比。

CREATE TABLE IF NOT EXISTS users (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  role    TEXT NOT NULL CHECK (role IN ('nurse','doctor','qc','director')),
  title   TEXT NOT NULL,
  dept    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id            TEXT PRIMARY KEY,
  mrn           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  gender        TEXT NOT NULL,
  age           INTEGER NOT NULL,
  bed           TEXT NOT NULL,
  dx            TEXT NOT NULL,
  weight_kg     REAL NOT NULL,
  height_cm     REAL NOT NULL,
  apache_ii     INTEGER,
  admitted_at   TEXT NOT NULL,
  discharged_at TEXT,
  status        TEXT NOT NULL DEFAULT 'in_icu',
  outcome       TEXT,
  allergy       TEXT
);

-- 检验 / 监护原始数据（模拟 LIS 与床旁设备写入）
CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'LIS',
  flag        TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_patient ON observations(patient_id, code, measured_at);

-- 护理事件 / 医嘱执行（评估、送检、抗菌药、DVT 预防、机械通气）
CREATE TABLE IF NOT EXISTS care_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL,
  detail     TEXT,
  at         TEXT NOT NULL,
  by_user    TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_patient ON care_events(patient_id, at);

-- 规则派生层：每个患者一行，evidence 保存规则命中依据
CREATE TABLE IF NOT EXISTS patient_metrics (
  patient_id         TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  period             TEXT NOT NULL,
  baseline_cr        REAL,
  peak_cr            REAL,
  aki_stage          INTEGER,
  aki_onset_at       TEXT,
  pf_ratio           REAL,
  ards_severity      TEXT,
  peep               REAL,
  gcs                INTEGER,
  assessed_24h       INTEGER NOT NULL DEFAULT 0,
  abx_started        INTEGER NOT NULL DEFAULT 0,
  culture_before_abx INTEGER NOT NULL DEFAULT 0,
  dvt_prophylaxis    INTEGER NOT NULL DEFAULT 0,
  vent_started       INTEGER NOT NULL DEFAULT 0,
  stay_hours         REAL,
  evidence           TEXT NOT NULL DEFAULT '{}',
  computed_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_period ON patient_metrics(period);

-- 指标口径：SQL 可审阅，分子分母可追溯到患者明细
CREATE TABLE IF NOT EXISTS indicator_defs (
  code      TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL,
  unit      TEXT NOT NULL,
  target    REAL NOT NULL DEFAULT 0.9,
  direction TEXT NOT NULL DEFAULT 'up',
  formula   TEXT NOT NULL,
  rationale TEXT NOT NULL,
  sql       TEXT NOT NULL,
  owner     TEXT NOT NULL,
  sort      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indicator_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,
  code        TEXT NOT NULL REFERENCES indicator_defs(code),
  numerator   INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  rate        REAL,
  computed_at TEXT NOT NULL,
  computed_by TEXT,
  UNIQUE (period, code)
);

CREATE TABLE IF NOT EXISTS qc_reports (
  period       TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','returned','reported')),
  version      INTEGER NOT NULL DEFAULT 1,
  submit_note  TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  reviewed_by  TEXT,
  reviewed_at  TEXT,
  review_note  TEXT,
  reported_at  TEXT,
  snapshot     TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  role        TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before_json TEXT,
  after_json  TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor_id   TEXT,
  question   TEXT NOT NULL,
  answer     TEXT,
  steps_json TEXT NOT NULL,
  engine     TEXT NOT NULL,
  patient_id TEXT,
  period     TEXT
);
