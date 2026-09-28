// crow-health-card.js
// Apple Health-style Home Assistant dashboard card — reads Apple Health data
// from the iPhone Companion App's health sensors, with a
// hybrid auto-discover + manual-override entity model, per-module toggles,
// CSV/JSON/PDF export, and an optional AI insights hub.
//
// Shadow DOM custom element, glassmorphism
// dark/light theming, two-tier localStorage + frontend/set_user_data
// persistence, AI calls routed through conversation/process to a
// user-configured agent, iOS-native visual editor.

// ── Module catalog ──────────────────────────────────────────────────────
// Each module describes one Apple Health-style card. `suffixes` are tried
// in order against every detected source device's entity prefix
// (sensor.<prefix>_<suffix>) — first match wins unless a manual override is
// set in config.module_overrides[key]. `composite: true` modules don't map
// to a single entity; they're computed from other modules' resolved values.
const HORSE_MODULES = [
  {
    key: 'vitals', label: 'Vitals', category: 'Highlights', composite: true,
    color: '#FF375F', icon: 'vitals',
    inputs: ['heart_rate', 'blood_oxygen', 'respiratory_rate', 'body_temperature', 'heart_rate_variability'],
  },
  {
    key: 'sleep_score', label: 'Sleep Score', category: 'Highlights', composite: true, adviceEligible: true,
    color: '#5E5CE6', icon: 'sleep',
    inputs: ['sleep_duration', 'rem_sleep', 'deep_sleep', 'core_sleep', 'awake'],
  },
  {
    key: 'heart_rate', label: 'Heart Rate', category: 'Heart',
    color: '#FF2D55', icon: 'heart', unit: 'BPM', decimals: 0,
    suffixes: ['heart_rate'], bands: { low: 60, high: 100 }, plausibleRange: { min: 30, max: 220 },
  },
  {
    key: 'resting_heart_rate', label: 'Resting Heart Rate', category: 'Heart', dailyLine: true,
    color: '#FF2D55', icon: 'heart', unit: 'BPM', decimals: 0,
    suffixes: ['resting_heart_rate'], bands: { low: 50, high: 90 }, plausibleRange: { min: 30, max: 150 },
  },
  {
    key: 'heart_rate_variability', label: 'Heart Rate Variability', category: 'Heart', dailyLine: true,
    color: '#FF2D55', icon: 'pulse', unit: 'ms', decimals: 0,
    suffixes: ['heart_rate_variability'], bands: { low: 20, high: 200, invert: true }, plausibleRange: { min: 1, max: 300 },
  },
  {
    key: 'walking_heart_rate_average', label: 'Walking Heart Rate Avg', category: 'Heart',
    color: '#FF2D55', icon: 'heart', unit: 'BPM', decimals: 0,
    suffixes: ['walking_heart_rate_average'], bands: { low: 90, high: 140 }, plausibleRange: { min: 30, max: 220 },
  },
  {
    key: 'blood_oxygen', label: 'Blood Oxygen', category: 'Respiratory', dailyLine: true,
    color: '#0A84FF', icon: 'drop', unit: '%', decimals: 0,
    suffixes: ['blood_oxygen'], bands: { low: 95, high: 100, invert: true }, plausibleRange: { min: 50, max: 100 },
  },
  {
    key: 'respiratory_rate', label: 'Respiratory Rate', category: 'Respiratory', adviceEligible: true, dailyLine: true,
    color: '#64D2FF', icon: 'lungs', unit: 'br/min', decimals: 0,
    suffixes: ['respiratory_rate'], bands: { low: 12, high: 20 }, plausibleRange: { min: 4, max: 60 },
  },
  {
    key: 'vo2_max', label: 'VO2 Max', category: 'Respiratory', adviceEligible: true, dailyLine: true,
    color: '#64D2FF', icon: 'lungs', unit: 'mL/kg·min', decimals: 1,
    suffixes: ['vo2_max'], plausibleRange: { min: 5, max: 90 },
  },
  {
    key: 'body_temperature', label: 'Body Temperature', category: 'Body', dailyLine: true,
    color: '#FF9F0A', icon: 'thermometer', unit: '°', decimals: 1,
    suffixes: ['body_temperature'], bands: { low: 36, high: 37.5 }, plausibleRange: { min: 25, max: 45 },
  },
  {
    key: 'basal_body_temperature', label: 'Basal Body Temperature', category: 'Body', dailyLine: true,
    color: '#FF9F0A', icon: 'thermometer', unit: '°', decimals: 1,
    suffixes: ['basal_body_temperature'], bands: { low: 36, high: 37.5 }, plausibleRange: { min: 25, max: 45 },
  },
  {
    key: 'weight', label: 'Weight', category: 'Body', adviceEligible: true,
    color: '#AC8E68', icon: 'scale', unit: 'kg', decimals: 1,
    suffixes: ['weight'], plausibleRange: { min: 20, max: 300 },
  },
  {
    key: 'body_fat_percentage', label: 'Body Fat Percentage', category: 'Body', adviceEligible: true,
    color: '#AC8E68', icon: 'scale', unit: '%', decimals: 1,
    suffixes: ['body_fat_percentage'], plausibleRange: { min: 2, max: 70 },
  },
  {
    key: 'lean_body_mass', label: 'Lean Body Mass', category: 'Body',
    color: '#AC8E68', icon: 'scale', unit: 'kg', decimals: 1,
    suffixes: ['lean_body_mass'], plausibleRange: { min: 10, max: 150 },
  },
  {
    key: 'blood_pressure', label: 'Blood Pressure', category: 'Heart', composite: true,
    color: '#FF2D55', icon: 'heart',
    inputs: ['blood_pressure_systolic', 'blood_pressure_diastolic'],
  },
  {
    key: 'blood_glucose', label: 'Blood Glucose', category: 'Body', dailyLine: true,
    color: '#FF375F', icon: 'drop', unit: 'mg/dL', decimals: 0,
    suffixes: ['blood_glucose', 'glucose', 'dexcom', 'blood_sugar', 'cgm'], plausibleRange: { min: 20, max: 600 }, bands: { low: 70, high: 180 },
  },
  {
    key: 'steps', label: 'Steps', category: 'Activity', resetsDaily: true, adviceEligible: true,
    color: '#30D158', icon: 'steps', unit: 'steps', decimals: 0,
    suffixes: ['steps', 'health_steps'],
  },
  {
    key: 'distance', label: 'Walking + Running Distance', category: 'Activity', resetsDaily: true, adviceEligible: true,
    color: '#30D158', icon: 'steps', unit: 'km', decimals: 2,
    suffixes: ['walking_running_distance', 'distance'],
  },
  {
    key: 'flights_climbed', label: 'Flights Climbed', category: 'Activity', resetsDaily: true, adviceEligible: true,
    color: '#30D158', icon: 'stairs', unit: 'floors', decimals: 0,
    suffixes: ['flights_climbed'],
  },
  {
    key: 'active_energy', label: 'Active Energy', category: 'Activity', resetsDaily: true, adviceEligible: true,
    color: '#FF9500', icon: 'flame', unit: 'kcal', decimals: 0,
    suffixes: ['active_energy'],
  },
  {
    key: 'resting_energy', label: 'Resting Energy', category: 'Activity', resetsDaily: true,
    color: '#FF9500', icon: 'flame', unit: 'kcal', decimals: 0,
    suffixes: ['resting_energy'],
  },
  {
    key: 'average_active_pace', label: 'Average Active Pace', category: 'Activity', adviceEligible: true, dailyLine: true,
    color: '#30D158', icon: 'steps', unit: 'm/s', decimals: 2,
    suffixes: ['average_active_pace'],
  },
  {
    key: 'sleep_duration', label: 'Time Asleep', category: 'Sleep', adviceEligible: true,
    color: '#5E5CE6', icon: 'sleep', unit: '', decimals: 0, format: 'duration_min',
    suffixes: ['sleep_duration'],
  },
  {
    key: 'water', label: 'Water', category: 'Body', resetsDaily: true, adviceEligible: true,
    color: '#0A84FF', icon: 'drop', unit: 'mL', decimals: 0,
    suffixes: ['water'],
  },
  // Blood Pressure's two halves — not shown as their own toggle/drag row
  // (the composite 'blood_pressure' module above represents both), but
  // they need their own auto-detected/overridable entity just like any
  // other module, so they're real catalog entries with `hidden: true`.
  {
    key: 'blood_pressure_systolic', label: 'Blood Pressure — Systolic', category: 'Heart', hidden: true,
    color: '#FF2D55', icon: 'heart', unit: 'mmHg', decimals: 0,
    suffixes: ['blood_pressure_systolic'], bands: { low: 90, high: 120 }, plausibleRange: { min: 50, max: 260 },
  },
  {
    key: 'blood_pressure_diastolic', label: 'Blood Pressure — Diastolic', category: 'Heart', hidden: true,
    color: '#FF9F0A', icon: 'heart', unit: 'mmHg', decimals: 0,
    suffixes: ['blood_pressure_diastolic'], bands: { low: 60, high: 80 }, plausibleRange: { min: 30, max: 160 },
  },
  // Sleep Score's stage inputs — same situation as Blood Pressure's two
  // halves above. These were referenced by key throughout the Sleep
  // Score composite and the Tonight's Stages breakdown, but were never
  // actually registered as catalog entries, so they had no auto-detect
  // suffixes and could never resolve to a real entity — every stage
  // read as "no data" regardless of what sensors existed.
  {
    key: 'rem_sleep', label: 'REM Sleep', category: 'Sleep', hidden: true,
    color: '#5E5CE6', icon: 'sleep', unit: 'min', decimals: 0, format: 'duration_min',
    suffixes: ['rem_sleep'],
  },
  {
    key: 'deep_sleep', label: 'Deep Sleep', category: 'Sleep', hidden: true,
    color: '#BF5AF2', icon: 'sleep', unit: 'min', decimals: 0, format: 'duration_min',
    suffixes: ['deep_sleep'],
  },
  {
    key: 'core_sleep', label: 'Core Sleep', category: 'Sleep', hidden: true,
    color: '#64D2FF', icon: 'sleep', unit: 'min', decimals: 0, format: 'duration_min',
    suffixes: ['core_sleep'],
  },
  {
    key: 'awake', label: 'Awake', category: 'Sleep', hidden: true,
    color: '#8E8E93', icon: 'sleep', unit: 'min', decimals: 0, format: 'duration_min',
    suffixes: ['awake'],
  },
];

// enabled_modules/module_order only ever deal with modules a person can
// see and reorder on the card — hidden sub-modules (Blood Pressure's two
// halves) are never toggled or dragged independently.
const HORSE_MODULE_KEYS = HORSE_MODULES.filter(m => !m.hidden).map(m => m.key);

// Accent presets offered in the editor — the same iOS system-colour
// palette the module catalog above already draws its own colours from.
const HORSE_ACCENT_PRESETS = ['#FF375F', '#FF2D55', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF', '#0A84FF', '#5E5CE6', '#BF5AF2', '#AC8E68'];

// ── Entity auto-detection — keyword scoring ─────────────────────────────
// Score every candidate
// entity by how many of a field's keywords appear in its entity_id or
// friendly name, then offer the highest scorers first (starred) with
// everything else below a divider. Shared by the card (a live, unpersisted
// fallback so a module still shows something before the editor's ever been
// opened) and the editor (which persists the best guess into
// module_overrides once, and lets the search+select override it).
function horseScoreEntity(id, name, keywords) {
  const i = id.toLowerCase(), n = (name || '').toLowerCase();
  return keywords.reduce((s, k) => s + (i.includes(k) || n.includes(k) ? 1 : 0), 0);
}

// A module's own suffix words double as its keywords — they're already
// exactly how HA names the real sensor (e.g. "resting_heart_rate" splits
// into "resting"/"heart"/"rate") — plus any distinct words from its
// display label, so a renamed or differently-suffixed entity can still
// be found by its plain-English name.
function horseModuleKeywords(mod) {
  const words = new Set();
  (mod.suffixes || []).forEach(suffix => suffix.split('_').forEach(w => words.add(w)));
  mod.label.toLowerCase().split(/\W+/).forEach(w => { if (w.length > 2) words.add(w); });
  return Array.from(words);
}

function horseScoredCandidates(pool, keywords, hass) {
  return pool
    .map(e => ({ e, score: horseScoreEntity(e, hass.states[e]?.attributes?.friendly_name || '', keywords) }))
    .sort((a, b) => b.score - a.score || a.e.localeCompare(b.e));
}

// Pulls the spoken text out of a conversation/process result, or null if
// it looks like a failure. HA marks a genuine agent failure with
// response_type 'error', but some agents (Google Generative AI's
// conversation integration, notably) instead return response_type
// 'action_done' with the *provider's own error text* — a raw "Sorry, I
// had a problem…" message, sometimes with a JSON error blob — sitting in
// the speech field as if it were a normal answer. Without this check,
// that error text gets treated as a legitimate AI insight or report
// opinion and printed verbatim.
function horseExtractConversationSpeech(result) {
  const speech = result?.response?.speech?.plain?.speech;
  if (!speech || result?.response?.response_type === 'error') return null;
  if (/^sorry, i had a problem/i.test(speech.trim()) || /"error"\s*:\s*\{/.test(speech)) return null;
  return speech;
}

// ── Value banding — green/amber/red, like Apple Health's own vitals
// colouring ─────────────────────────────────────────────────────────────
// `bands: { low, high }` on a module marks its clinically-typical range:
// inside it is green, just outside (within 15% of the range's width) is
// amber, further out is red. `invert: true` flips this to a one-sided
// check (blood oxygen, HRV) where there's no meaningful "too high" —
// only below `low` is ever a concern, with the amber band sitting at the
// midpoint between `low` and `high`. Modules without `bands` (steps,
// weight, VO2 max, and anything else with no single universal "normal")
// fall back to their own flat accent color everywhere this is used.
const HORSE_BAND_GREEN = '#30D158';
const HORSE_BAND_AMBER = '#FF9F0A';
const HORSE_BAND_RED = '#FF453A';

function horseBandColor(bands, value, fallback) {
  if (!bands || value == null || !Number.isFinite(value)) return fallback;
  const { low, high, invert } = bands;
  if (invert) {
    const mid = low + (high - low) * 0.5;
    if (value < low) return HORSE_BAND_RED;
    if (value < mid) return HORSE_BAND_AMBER;
    return HORSE_BAND_GREEN;
  }
  const margin = (high - low) * 0.15 || 1;
  if (value >= low && value <= high) return HORSE_BAND_GREEN;
  if (value >= low - margin && value <= high + margin) return HORSE_BAND_AMBER;
  return HORSE_BAND_RED;
}

// Same three colors, for Sleep Score's own 0–100 scale rather than a
// module's physical-unit bands.
function horseSleepScoreBandColor(points) {
  if (points >= 70) return HORSE_BAND_GREEN;
  if (points >= 50) return HORSE_BAND_AMBER;
  return HORSE_BAND_RED;
}

// ── Icon library — minimal inline SVG paths, one per module `icon` id ───
const HORSE_ICONS = {
  vitals: '<path d="M3 12h4l2-7 4 14 2-9 2 2h4"/>',
  sleep: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  pulse: '<path d="M2 12h4l2-6 4 12 3-8 2 2h5"/>',
  drop: '<path d="M12 2s6 7.2 6 11.5A6 6 0 0 1 6 13.5C6 9.2 12 2 12 2z"/>',
  lungs: '<path d="M12 3v8m0 0c-1-3-3.5-3-4.5-1.5S6 15 6 17.5 7.5 21 9 20s3-2 3-4m0-4.5c1-3 3.5-3 4.5-1.5S18 15 18 17.5 16.5 21 15 20s-3-2-3-4"/>',
  thermometer: '<path d="M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z"/>',
  scale: '<circle cx="12" cy="13" r="7"/><path d="M12 13l3-3M9 4h6"/>',
  steps: '<path d="M8 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 12l3-2 2 3-1 5-4 1zM16 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM13 12l3-2 2 3-1 5-4 1z"/>',
  stairs: '<path d="M4 20v-4h4v-4h4V8h4V4h4"/>',
  flame: '<path d="M12 2s-5 5-5 10a5 5 0 0 0 10 0c0-2-1-3-1-3s0 2-1 2-1-3-1-4c0 0-2 2-2 5z"/>',
};

function horseIconSvg(key, color) {
  const path = HORSE_ICONS[key] || HORSE_ICONS.heart;
  return `<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:${color};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;">${path}</svg>`;
}

class HorseHealthCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._resolvedEntities = {};      // module key -> entity_id (or null)
    this._historyCache = {};          // entity_id -> { fetchedAt, points: [[ts, val]] }
    this._aiInsight = null;
    this._aiInsightFailed = false;
    this._aiLoading = false;
    this._recapCache = { week: null, month: null }; // period -> { text, fetchedAt }
    this._recapLoading = false;
    this._recapPeriod = 'week';
    this._askPopupOverlay = null;
    this._aiInsightsPopupOverlay = null;
    this._adviceCache = {};           // module key -> { text, fetchedAt }
    this._detailPopupOverlay = null;
    this._exportPopupOverlay = null;
    this._pdfPreviewOverlay = null;
    this._jsPDFLoadPromise = null;
    this._lastResolveSig = null;
  }

  disconnectedCallback() {
    this._closeDetailPopup();
    this._closeExportPopup();
    this._closePdfPreview();
    this._closeStatInfoPopup();
    this._closeAskPopup();
    this._closeAiInsightsPopup();
  }

  static getConfigElement() {
    return document.createElement('crow-health-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Summary',
      accent_color: '#FF375F',
      card_style: 'classic',   // 'classic' | 'glass'
      appearance: 'auto',      // 'auto' | 'light' | 'dark' — applies to Glass
      glass: 50,               // 0-100, only used when card_style is 'glass'
      enabled_modules: [...HORSE_MODULE_KEYS],
      module_order: [...HORSE_MODULE_KEYS],  // display order, drag-reordered in the editor
      module_overrides: {},        // module key -> explicit entity_id, auto-filled by the editor
      history_days: 7,
      ai_features_enabled: false,
      ai_conversation_agent: '',
      ai_daily_summary: true,
      ai_trend_notes: true,
      ai_advice_enabled: true,
      ai_recap_enabled: true,
      ai_ask_enabled: true,
      persistent_storage: false,
      glucose_unit: 'mg/dL', // or 'mmol/L' — see setConfig() for how this adjusts the module's bands/plausible range
    };
  }

  setConfig(config) {
    this._config = {
      ...HorseHealthCard.getStubConfig(),
      ...config,
      module_overrides: { ...(config.module_overrides || {}) },
    };
    this._applyGlucoseUnit();
    this._lastResolveSig = null; // force re-resolve on next hass tick
    this._render();
  }

  // Blood Glucose's unit, plausible range, and clinical bands are
  // mutated in place on the shared HORSE_MODULES entry based on
  // glucose_unit — mg/dL (20-600, bands 70/180) or mmol/L (1.1-33.3,
  // bands 3.9/10.0, matching standard ADA targets). This is the one
  // module whose native unit genuinely varies by region/device, unlike
  // everything else on the card; mutating the catalog entry here is a
  // deliberate shortcut rather than threading a per-instance override
  // through every place that reads mod.unit/bands/plausibleRange.
  _applyGlucoseUnit() {
    const mod = HORSE_MODULES.find(m => m.key === 'blood_glucose');
    if (!mod) return;
    if (this._config.glucose_unit === 'mmol/L') {
      mod.unit = 'mmol/L';
      mod.decimals = 1;
      mod.plausibleRange = { min: 1.1, max: 33.3 };
      mod.bands = { low: 3.9, high: 10.0 };
    } else {
      mod.unit = 'mg/dL';
      mod.decimals = 0;
      mod.plausibleRange = { min: 20, max: 600 };
      mod.bands = { low: 70, high: 180 };
    }
  }

  connectedCallback() { this._render(); }

  getCardSize() { return 6; }

  set hass(hass) {
    const firstRun = !this._hass;
    this._hass = hass;
    if (firstRun) this._loadUserData();

    const sig = this._resolveSignature(hass);
    if (sig !== this._lastResolveSig) {
      this._lastResolveSig = sig;
      this._resolveEntities(hass);
    }
    this._render();
  }

  // A signature that changes when the set of sensor entities, or their
  // states, changes enough to matter — cheap enough to compute every tick
  // since it's just string concatenation, and avoids a full re-render when
  // nothing relevant moved.
  _resolveSignature(hass) {
    let sig = '';
    for (const key of HORSE_MODULE_KEYS) {
      const entityId = this._config.module_overrides[key] || this._resolvedEntities[key];
      if (entityId && hass.states[entityId]) {
        sig += entityId + hass.states[entityId].state + hass.states[entityId].last_changed;
      }
    }
    return sig + Object.keys(hass.states).length;
  }

  // ── Entity resolution ────────────────────────────────────────────────
  // A module's entity is whatever's in module_overrides — set by the
  // editor (which auto-fills its best guess the first time it's opened,
  // in the visual editor). This is a live,
  // unpersisted fallback for the gap before that's ever happened (a
  // freshly-added card, or one configured entirely in YAML): the same
  // keyword-scoring the editor uses, just not written back to config.
  _resolveEntities(hass) {
    const resolved = {};
    const sensors = Object.keys(hass.states).filter(e => e.startsWith('sensor.'));
    HORSE_MODULES.forEach(mod => {
      if (mod.composite) return;
      const override = this._config.module_overrides[mod.key];
      if (override) { resolved[mod.key] = hass.states[override] ? override : null; return; }
      const candidates = horseScoredCandidates(sensors, horseModuleKeywords(mod), hass);
      resolved[mod.key] = (candidates[0] && candidates[0].score > 0) ? candidates[0].e : null;
    });
    this._resolvedEntities = resolved;
  }

  _entityFor(key) {
    return this._config.module_overrides[key] || this._resolvedEntities[key] || null;
  }

  _getMod(key) {
    return HORSE_MODULES.find(m => m.key === key);
  }

  _stateFor(key) {
    const entityId = this._entityFor(key);
    if (!entityId || !this._hass.states[entityId]) return null;
    const s = this._hass.states[entityId];
    if (s.state === 'unknown' || s.state === 'unavailable') return null;
    return s;
  }

  // Some readings from a phone/watch sensor are physiologically
  // impossible — 0 BPM, 0% blood oxygen, 0° body temperature — and are
  // almost always a momentary dropout (sensor not in contact, a sync
  // gap) rather than a real measurement. `plausibleRange` on a module
  // marks the outer bounds of what a real reading could ever be; a
  // value outside it is treated as no data rather than plotted as a
  // dip to zero that would understandably worry someone looking at it.
  _isPlausible(key, value) {
    const mod = this._getMod(key);
    if (!mod || !mod.plausibleRange || value == null) return true;
    return value >= mod.plausibleRange.min && value <= mod.plausibleRange.max;
  }

  _numFor(key) {
    const s = this._stateFor(key);
    if (!s) return null;
    const n = parseFloat(s.state);
    if (!Number.isFinite(n)) return null;
    return this._isPlausible(key, n) ? n : null;
  }

  // ── Persistence (two-tier: localStorage + frontend/set_user_data) ──
  async _loadUserData() {
    try {
      const local = localStorage.getItem('horse_health_prefs');
      if (local) this._prefs = JSON.parse(local);
    } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      try {
        const result = await this._hass.callWS({ type: 'frontend/get_user_data', key: 'horse_health_prefs' });
        if (result?.value) this._prefs = result.value;
      } catch (_) {}
    }
  }

  async _savePrefs(prefs) {
    this._prefs = { ...(this._prefs || {}), ...prefs };
    try { localStorage.setItem('horse_health_prefs', JSON.stringify(this._prefs)); } catch (_) {}
    if (this._config.persistent_storage && this._hass) {
      try { await this._hass.callWS({ type: 'frontend/set_user_data', key: 'horse_health_prefs', value: this._prefs }); } catch (_) {}
    }
  }

  // ── Composite modules ─────────────────────────────────────────────
  _computeSleepScore() {
    const dur = this._numFor('sleep_duration');       // minutes
    const rem = this._numFor('rem_sleep') || 0;
    const deep = this._numFor('deep_sleep') || 0;
    if (dur == null) return null;
    // Simple weighted heuristic: duration toward 480 min (8h) is worth up
    // to 70 points, REM+deep share of total sleep worth up to 30 — close
    // enough to "OK / Good / Excellent" banding without needing Apple's
    // proprietary formula.
    const durationScore = Math.min(70, (dur / 480) * 70);
    const qualityShare = dur > 0 ? (rem + deep) / dur : 0;
    const qualityScore = Math.min(30, qualityShare * 60);
    const points = Math.round(durationScore + qualityScore);
    let label = 'Low';
    if (points >= 85) label = 'Excellent';
    else if (points >= 70) label = 'Good';
    else if (points >= 50) label = 'OK';
    return { points: Math.max(0, Math.min(100, points)), label };
  }

  _computeVitals() {
    const checks = [
      { key: 'heart_rate', low: 40, high: 130 },
      { key: 'blood_oxygen', low: 92, high: 100 },
      { key: 'respiratory_rate', low: 10, high: 22 },
      { key: 'body_temperature', low: 35.5, high: 38.2 },
    ];
    let seen = 0, outOfRange = 0;
    checks.forEach(c => {
      const v = this._numFor(c.key);
      if (v == null) return;
      seen++;
      if (v < c.low || v > c.high) outOfRange++;
    });
    if (seen === 0) return null;
    return {
      typical: outOfRange === 0,
      label: outOfRange === 0 ? 'Typical' : 'Needs Attention',
      subtitle: outOfRange === 0 ? 'All Metrics in Range' : `${outOfRange} metric${outOfRange > 1 ? 's' : ''} outside range`,
    };
  }

  _computeBloodPressure() {
    const sys = this._numFor('blood_pressure_systolic');
    const dia = this._numFor('blood_pressure_diastolic');
    if (sys == null || dia == null) return null;
    return { display: `${Math.round(sys)}/${Math.round(dia)}`, unit: 'mmHg' };
  }

  // ── Blood Glucose extras (trend arrow, Time in Range, A1C estimate,
  // 30-min prediction, sensor life) — ported from a much larger
  // reference diabetes card, scoped down and rebuilt with this card's
  // own rendering so it matches everywhere else, and deliberately
  // excludes anything treatment/dosing-adjacent (insulin tracking,
  // food-impact estimates, appointment prep). ──────────────────────────

  // Direction + rate of change from the two most recent raw readings
  // roughly 15 minutes apart — same "trend arrow" idea CGM apps show,
  // purely descriptive of what already happened, not a forecast.
  // Thresholds are mg/dL-scale (1-2 mg/dL/min); an mmol/L series has
  // the same real-world rate expressed in much smaller numbers
  // (÷18.0182), so the comparison converts to mg/dL-equivalent first
  // rather than needing two separate threshold sets.
  _glucoseTrend(points, unit) {
    if (!points || points.length < 2) return null;
    const last = points[points.length - 1];
    const targetTs = last[0] - 15 * 60000;
    let prev = points[0];
    for (let i = points.length - 2; i >= 0; i--) {
      prev = points[i];
      if (points[i][0] <= targetTs) break;
    }
    const deltaMin = (last[0] - prev[0]) / 60000;
    if (deltaMin < 1) return null;
    const ratePerMin = (last[1] - prev[1]) / deltaMin;
    const rateMgDlEquiv = unit === 'mmol/L' ? ratePerMin * 18.0182 : ratePerMin;
    let direction;
    if (rateMgDlEquiv > 2) direction = 'rising_fast';
    else if (rateMgDlEquiv > 1) direction = 'rising';
    else if (rateMgDlEquiv < -2) direction = 'falling_fast';
    else if (rateMgDlEquiv < -1) direction = 'falling';
    else direction = 'steady';
    return { direction, ratePerMin, fromValue: prev[1], toValue: last[1], deltaMinutes: deltaMin };
  }

  // % of readings below/within/above the clinical target band over
  // whatever series is passed in — the standard "Time in Range" stat
  // used in diabetes management, purely descriptive.
  _glucoseTimeInRange(series, bands) {
    if (!series.length) return null;
    let low = 0, inRange = 0, high = 0;
    series.forEach(([, v]) => {
      if (v < bands.low) low++;
      else if (v > bands.high) high++;
      else inRange++;
    });
    const total = series.length;
    return {
      low: Math.round((low / total) * 100),
      inRange: Math.round((inRange / total) * 100),
      high: Math.round((high / total) * 100),
      lowCount: low,
      inRangeCount: inRange,
      highCount: high,
      readingCount: total,
    };
  }

  // Estimated A1C from an average glucose reading, via the standard
  // ADAG conversion (the same formula behind "estimated A1C" in
  // mainstream CGM apps): A1C% = (avg mg/dL + 46.7) / 28.7. The formula
  // itself is defined in mg/dL, so an mmol/L average is converted first
  // (× 18.0182) — always an estimate from a rolling average, never a
  // substitute for an actual lab-drawn A1C test, and that framing
  // travels with the number everywhere it's shown, not just once.
  _glucoseEstimatedA1C(avg, unit) {
    const avgMgDl = unit === 'mmol/L' ? avg * 18.0182 : avg;
    return (avgMgDl + 46.7) / 28.7;
  }

  // Weighted linear regression over the last ~45 minutes of raw
  // readings, projected 30 minutes ahead — informational only. Recent
  // points are weighted more heavily than older ones within the window.
  // Deliberately not exposed anywhere that could read as a dosing
  // suggestion: no advice-eligibility, no directive language, and nothing
  // downstream (the Ask feature, "Improve This") is allowed to turn this
  // into a recommendation.
  _glucosePrediction(series, unit) {
    if (!series || series.length < 3) return null;
    const lastTs = series[series.length - 1][0];
    const windowPoints = series.filter(p => lastTs - p[0] <= 45 * 60000);
    if (windowPoints.length < 3) return null;
    const t0 = windowPoints[0][0];
    let sw = 0, swt = 0, swv = 0, swtt = 0, swtv = 0;
    windowPoints.forEach(([ts, v], i) => {
      const w = 1 + i / windowPoints.length; // later points weighted more
      const t = (ts - t0) / 60000; // minutes since window start
      sw += w; swt += w * t; swv += w * v; swtt += w * t * t; swtv += w * t * v;
    });
    const denom = sw * swtt - swt * swt;
    if (Math.abs(denom) < 1e-6) return null;
    const slope = (sw * swtv - swt * swv) / denom;
    const intercept = (swv - slope * swt) / sw;
    const tPredict = (lastTs - t0) / 60000 + 30;
    const predicted = intercept + slope * tPredict;
    const [lo, hi] = unit === 'mmol/L' ? [1.1, 33.3] : [20, 600];
    return { value: Math.max(lo, Math.min(hi, predicted)), ratePerMin: slope };
  }

  // Returns whether a (non-composite) module has any usable data right now.
  _moduleHasData(mod) {
    if (mod.key === 'sleep_score') return this._computeSleepScore() != null;
    if (mod.key === 'vitals') return this._computeVitals() != null;
    if (mod.key === 'blood_pressure') return this._computeBloodPressure() != null;
    return this._numFor(mod.key) != null;
  }

  // Modules in the user's drag-reordered sequence — falls back to the
  // catalog's own order for anyone without a saved module_order, and
  // appends any module the stored order doesn't mention yet (e.g. a new
  // module key introduced by a card update after the config was saved).
  _orderedModules() {
    const order = (this._config.module_order && this._config.module_order.length) ? this._config.module_order : HORSE_MODULE_KEYS;
    const byKey = new Map(HORSE_MODULES.map(m => [m.key, m]));
    const ordered = order.map(k => byKey.get(k)).filter(Boolean);
    HORSE_MODULES.forEach(m => { if (!m.hidden && !order.includes(m.key)) ordered.push(m); });
    return ordered;
  }

  _enabledModules() {
    const enabled = new Set(this._config.enabled_modules || []);
    return this._orderedModules().filter(m => enabled.has(m.key) && this._moduleHasData(m));
  }

  // ── Rendering ─────────────────────────────────────────────────────
  _render() {
    if (!this._hass || !this._config) return;
    const accent = this._config.accent_color || '#FF375F';
    const modules = this._enabledModules();
    const askEnabled = this._config.ai_features_enabled && this._config.ai_ask_enabled !== false;

    this.shadowRoot.innerHTML = `
      <style>${this._css(accent)}</style>
      <div class="card">
        ${askEnabled ? `
          <button class="ai-search-bar" id="askQuestionBtn">
            <svg viewBox="0 0 24 24" style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <span class="ai-search-placeholder">Ask about your health…</span>
          </button>
        ` : ''}
        <div class="header">
          <div class="header-title">${this._escape(this._config.title || 'Summary')}</div>
        </div>

        ${this._config.ai_features_enabled ? this._aiInsightsRowHtml() : ''}

        <div class="module-list">
          ${modules.length ? modules.map(m => this._moduleCardHtml(m)).join('') : `
            <div class="empty-state">No health data yet — check the visual editor to confirm a source device and enabled modules.</div>
          `}
        </div>
      </div>
    `;

    const root = this.shadowRoot;
    modules.forEach(m => {
      const el = root.getElementById('mod-' + m.key);
      if (el) el.addEventListener('click', () => this._openDetailPopup(m));
    });

    const askBtn = root.getElementById('askQuestionBtn');
    if (askBtn) askBtn.addEventListener('click', () => this._openAskQuestionPopup());

    const insightsRow = root.getElementById('aiInsightsRowBtn');
    if (insightsRow) insightsRow.addEventListener('click', () => this._openAiInsightsPopup());
  }

  // Compact single row replacing what used to be two permanently
  // expanded cards (Health Insight + Weekly Recap) — tapping it opens
  // a popup with both. Nothing is fetched just to build this row; the
  // preview text is whatever's already cached from a previous popup
  // visit, or an invitation to tap if nothing's been fetched yet.
  _aiInsightsRowHtml() {
    const preview = this._aiInsight
      ? (this._aiInsight.length > 90 ? this._aiInsight.slice(0, 90) + '…' : this._aiInsight)
      : 'Tap for your health insight and recap';
    return `
      <button class="ai-insights-row" id="aiInsightsRowBtn">
        <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:rgba(255,55,95,0.9);flex-shrink:0;"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>
        <div class="ai-insights-row-text">
          <div class="ai-insights-row-title">AI Insights</div>
          <div class="ai-insights-row-preview">${this._escape(preview)}</div>
        </div>
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:${this._Wt('0.3')};stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    `;
  }

  // Popup holding Health Insight + Weekly/Monthly Recap together — a
  // separate document.body overlay like the other popups, with its own
  // small re-render function so Refresh/period-pill taps and in-flight
  // fetches can update just this popup's content without touching (or
  // needing) the main card's own _render().
  _openAiInsightsPopup() {
    this._closeAiInsightsPopup();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10075;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <style>${this._popupCss()}</style>
      <div class="hh-popup-sheet" style="max-height:80vh;">
        <div class="hh-popup-header">
          <button class="hh-popup-close-text" id="hhAiInsightsClose">Close</button>
          <div class="hh-popup-title">AI Insights</div>
          <div style="width:50px;"></div>
        </div>
        <div class="hh-popup-body" id="hhAiInsightsBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._aiInsightsPopupOverlay = overlay;
    overlay.querySelector('#hhAiInsightsClose').addEventListener('click', () => this._closeAiInsightsPopup());
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeAiInsightsPopup(); });
    this._renderAiInsightsPopupBody();

    // Lazy-loaded on open, not on every card render — no reason to
    // spend an AI call before the person has even asked to see this.
    if (!this._aiInsight && !this._aiLoading) this._fetchAiSummary();
    if (this._config.ai_recap_enabled !== false && !this._recapCache[this._recapPeriod] && !this._recapLoading) this._fetchRecap(this._recapPeriod);
  }

  _closeAiInsightsPopup() {
    if (this._aiInsightsPopupOverlay) { this._aiInsightsPopupOverlay.remove(); this._aiInsightsPopupOverlay = null; }
  }

  _renderAiInsightsPopupBody() {
    const overlay = this._aiInsightsPopupOverlay;
    if (!overlay) return;
    const body = overlay.querySelector('#hhAiInsightsBody');
    if (!body) return;
    body.innerHTML = `
      ${this._aiSectionHtml()}
      ${this._config.ai_recap_enabled !== false ? this._recapSectionHtml() : ''}
    `;
    const aiRetry = body.querySelector('#aiInsightRetryBtn');
    if (aiRetry) aiRetry.addEventListener('click', () => this._fetchAiSummary(true));
    body.querySelectorAll('.recap-period-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        this._recapPeriod = btn.dataset.period;
        this._renderAiInsightsPopupBody();
        if (!this._recapCache[this._recapPeriod]) this._fetchRecap(this._recapPeriod);
      });
    });
    const recapRetry = body.querySelector('#recapRetryBtn');
    if (recapRetry) recapRetry.addEventListener('click', () => this._fetchRecap(this._recapPeriod, true));
  }

  _moduleCardHtml(mod) {
    const now = new Date();
    // Default to "now" for composite modules (Sleep Score, Vitals),
    // which are computed live from current values rather than backed by
    // one entity — standard modules below override this with their own
    // entity's actual last_changed, since "now" there was just claiming
    // every reading is current regardless of when it actually happened.
    let timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    let valueHtml = '';
    let widgetHtml = '';
    let subtitle = '';

    if (mod.key === 'sleep_score') {
      const s = this._computeSleepScore();
      valueHtml = `<div class="mod-value">${s.label}</div>`;
      subtitle = `${s.points} points`;
      widgetHtml = this._ringSvg(s.points, mod.color);
    } else if (mod.key === 'vitals') {
      const v = this._computeVitals();
      valueHtml = `<div class="mod-value">${v.label}</div>`;
      subtitle = v.subtitle;
      widgetHtml = this._vitalsBarSvg(v.typical, mod.color);
    } else if (mod.key === 'blood_pressure') {
      const bp = this._computeBloodPressure();
      valueHtml = `<div class="mod-value">${bp.display}<span class="mod-unit">${bp.unit}</span></div>`;
      subtitle = 'Latest';
      widgetHtml = horseIconSvg(mod.icon, mod.color);
      const sysState = this._stateFor('blood_pressure_systolic');
      if (sysState) timeLabel = new Date(sysState.last_changed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      const n = this._numFor(mod.key);
      const display = mod.format === 'duration_min'
        ? this._formatMinutes(n)
        : (mod.decimals ? n.toFixed(mod.decimals) : Math.round(n).toString());
      valueHtml = `<div class="mod-value">${display}<span class="mod-unit">${mod.unit || ''}</span></div>`;

      const entityId = this._entityFor(mod.key);
      const cached = entityId ? this._historyCache[entityId] : null;
      // Daily-resetting counters judge freshness from the recorder's
      // actual history (the same source "Recent History" in the detail
      // popup uses) rather than the live entity's last_changed — that
      // can reflect a reload or a re-set to the same value without a
      // genuine new reading ever coming in, which would make this claim
      // "Today" for data that's actually days old. Needs a wider lookback
      // than the 1-day sparkline window to actually find that date.
      let readingDate = null;
      if (mod.resetsDaily) {
        if (cached && cached.points.length) readingDate = new Date(cached.points[cached.points.length - 1][0]);
      } else {
        const state = this._stateFor(mod.key);
        readingDate = state ? new Date(state.last_changed) : null;
      }
      const readingIsToday = readingDate && readingDate.toDateString() === now.toDateString();
      if (readingDate) {
        const timeOnly = readingDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        // For daily-resetting counters specifically, a bare time next to
        // "Latest" reads as "just now" — spelling out "Today"/the day
        // removes that ambiguity rather than leaving it to be inferred.
        timeLabel = mod.resetsDaily
          ? (readingIsToday ? `Today ${timeOnly}` : `${readingDate.toLocaleDateString([], { weekday: 'short' })} ${timeOnly}`)
          : timeOnly;
      }
      // Daily-resetting counters (Steps, Water, Flights Climbed, etc.)
      // showing "Latest" next to a reading from a previous day claims
      // it's today's total when it isn't — show which day it's actually
      // from instead.
      subtitle = (mod.resetsDaily && readingDate && !readingIsToday)
        ? readingDate.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })
        : 'Latest';

      if (mod.key === 'sleep_duration') {
        widgetHtml = this._miniStageRingSvg();
      } else if (mod.key === 'blood_glucose') {
        widgetHtml = cached ? this._glucoseTrendArrowSvg(this._glucoseTrend(cached.points, mod.unit), mod.color) : horseIconSvg(mod.icon, mod.color);
        if (entityId && !cached) this._prefetchHistory(entityId, 1, mod.plausibleRange);
      } else {
        widgetHtml = cached
          ? (this._isBarsStyleModule(mod) ? this._barsSparklineSvg(cached.points, mod.color) : this._dottedLineSparklineSvg(cached.points, mod.color))
          : horseIconSvg(mod.icon, mod.color);
        if (entityId && !cached) this._prefetchHistory(entityId, mod.resetsDaily ? (this._config.history_days || 7) : 1, mod.plausibleRange);
      }
    }

    return `
      <div class="mod-card" id="mod-${mod.key}">
        <div class="mod-row-top">
          <div class="mod-row-left">
            <div class="mod-icon" style="background:${mod.color}22;">${horseIconSvg(mod.icon, mod.color)}</div>
            <div class="mod-label" style="color:${mod.color};">${this._escape(mod.label)}</div>
          </div>
          <div class="mod-time">${timeLabel} <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:var(--hh-text-tertiary);stroke-width:2.5;"><path d="M9 6l6 6-6 6"/></svg></div>
        </div>
        <div class="mod-row-bottom">
          <div class="mod-row-values">
            ${valueHtml}
            <div class="mod-subtitle">${this._escape(subtitle)}</div>
          </div>
          <div class="mod-widget">${widgetHtml}</div>
        </div>
      </div>
    `;
  }

  _ringSvg(points, color) {
    const r = 22, c = 2 * Math.PI * r;
    const offset = c * (1 - Math.min(1, Math.max(0, points / 100)));
    return `
      <svg viewBox="0 0 56 56" style="width:52px;height:52px;">
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}33" stroke-width="6"/>
        <circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 28 28)"/>
        <text x="28" y="33" text-anchor="middle" font-size="15" font-weight="700" fill="var(--hh-text-primary)" font-family="-apple-system,sans-serif">${points}</text>
      </svg>
    `;
  }

  _vitalsBarSvg(typical, color) {
    const dots = [0, 1, 2, 3, 4].map(i =>
      `<circle cx="${8 + i * 12}" cy="18" r="4" fill="${typical ? color : '#8E8E93'}"/>`
    ).join('');
    return `<svg viewBox="0 0 64 36" style="width:60px;height:34px;"><rect x="2" y="4" width="60" height="28" rx="6" fill="${color}18"/>${dots}</svg>`;
  }

  // Apple Health's own mini-widgets aren't one generic sparkline shape —
  // Heart Rate uses a vertical "signal strength" bar set with the latest
  // reading picked out as a dot, while most other scalar metrics
  // (Resting Heart Rate, Steps, Weight, etc.) use a thin dotted line
  // with only the last point highlighted. Matching that distinction
  // here rather than using one filled jagged line for everything.
  // Which mini-widget shape a module gets: Heart Rate and count/activity
  // metrics (Steps, Distance, Flights Climbed, Active/Resting Energy,
  // Water) use the bar "signal strength" style — matching how Apple
  // Health treats cumulative/activity numbers — while continuous
  // physiological readings (Resting HR, HRV, Blood Oxygen, Weight, etc.)
  // stay as the dotted trend line.
  _isBarsStyleModule(mod) {
    if (mod.key === 'heart_rate') return true;
    return ['steps', 'km', 'floors', 'kcal', 'mL'].includes(mod.unit);
  }

  _barsSparklineSvg(points, color) {
    // Bar width is inversely related to point count with no cap — with
    // very few points (a sparse counter early in the day, say) that
    // produces very wide, barely-tall bars that render as an oval blob
    // rather than anything recognizable as bars. Capping the width and
    // requiring enough points for a bar chart to mean anything (falling
    // back to the plain icon otherwise) fixes both at once.
    if (!points || points.length < 4) return horseIconSvg('heart', color);
    const vals = points.slice(-8).map(p => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const w = 60, h = 32, pad = 2, n = vals.length;
    const barW = Math.max(2, Math.min(8, (w - pad * 2) / n - 3));
    const gap = n > 1 ? (w - pad * 2 - barW * n) / (n - 1) : 0;
    let bars = '';
    vals.forEach((v, i) => {
      const bh = 6 + ((v - min) / range) * (h - pad * 2 - 6);
      const x = pad + i * (barW + gap);
      const y = h - pad - bh;
      const isLast = i === n - 1;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(barW / 2).toFixed(1)}" fill="${isLast ? color : 'rgba(142,142,147,0.5)'}"/>`;
      if (isLast) bars += `<circle cx="${(x + barW / 2).toFixed(1)}" cy="${(y - 2).toFixed(1)}" r="2.2" fill="${color}"/>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" style="width:60px;height:32px;">${bars}</svg>`;
  }

  _dottedLineSparklineSvg(points, color) {
    if (!points || points.length < 2) return horseIconSvg('heart', color);
    const vals = points.slice(-8).map(p => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const w = 60, h = 32, pad = 4, n = vals.length;
    const step = n > 1 ? (w - pad * 2) / (n - 1) : 0;
    const coords = vals.map((v, i) => [pad + i * step, h - pad - ((v - min) / range) * (h - pad * 2)]);
    const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dots = coords.map(([x, y], i) => {
      const isLast = i === coords.length - 1;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isLast ? 2.6 : 1.6}" fill="${isLast ? color : 'rgba(142,142,147,0.6)'}"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" style="width:60px;height:32px;"><path d="${path}" fill="none" stroke="rgba(142,142,147,0.5)" stroke-width="1.3"/>${dots}</svg>`;
  }

  // Small segmented ring for Time Asleep's front-card widget — same
  // stage colors as the Tonight's Stages ring in the detail popup, just
  // scaled down with no legend, replacing the line-graph style that
  // doesn't fit a duration-of-stages metric.
  _miniStageRingSvg() {
    const items = [
      { value: this._numFor('awake') || 0, color: '#FF6961' },
      { value: this._numFor('rem_sleep') || 0, color: '#64D2FF' },
      { value: this._numFor('core_sleep') || 0, color: '#5E5CE6' },
      { value: this._numFor('deep_sleep') || 0, color: '#3A2E8C' },
    ].filter(i => i.value > 0);
    if (!items.length) return horseIconSvg('sleep', '#5E5CE6');
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const size = 32, r = 13, thickness = 6, cx = size / 2, cy = size / 2;
    let angle = -90;
    const arcs = items.map(i => {
      const deg = (i.value / total) * 360;
      const seg = this._ringArcSvgSegment(cx, cy, r, thickness, angle, angle + deg, i.color);
      angle += deg;
      return seg;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" style="width:32px;height:32px;">${arcs}</svg>`;
  }

  // Front-card trend arrow for Blood Glucose — angled up/flat/down,
  // doubled for the "fast" variants (the same convention CGM apps use:
  // one arrow for a moderate rate of change, two for a steep one).
  _glucoseTrendArrowSvg(trend, color) {
    if (!trend) return horseIconSvg('drop', color);
    const arrows = {
      rising_fast: 'M8 20L16 6M16 6l-5 1.5M16 6l1.5 5M8 26L16 12M16 12l-5 1.5M16 12l1.5 5',
      rising: 'M6 20L18 8M18 8l-6 1M18 8l1 6',
      steady: 'M4 16h20M18 11l6 5-6 5',
      falling: 'M6 8L18 20M18 20l-6-1M18 20l1-6',
      falling_fast: 'M8 6L16 20M16 20l-5-1.5M16 20l1.5-5M8 12L16 26M16 26l-5-1.5M16 26l1.5-5',
    };
    const d = arrows[trend.direction] || arrows.steady;
    return `<svg viewBox="0 0 32 32" style="width:32px;height:32px;"><path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ── History fetching (for sparklines + detail popup) ────────────────
  async _prefetchHistory(entityId, days, plausibleRange = null) {
    if (!this._hass) return;
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    try {
      const result = await this._hass.callApi(
        'GET',
        `history/period/${start.toISOString()}?filter_entity_id=${entityId}&end_time=${end.toISOString()}&minimal_response`
      );
      let series = (result?.[0] || [])
        .map(p => [new Date(p.last_changed).getTime(), parseFloat(p.state)])
        .filter(p => Number.isFinite(p[1]));
      if (plausibleRange) {
        series = series.filter(p => p[1] >= plausibleRange.min && p[1] <= plausibleRange.max);
      }
      this._historyCache[entityId] = { fetchedAt: Date.now(), points: series };
      this._render();
    } catch (_) { /* history not available — sparkline just falls back to icon */ }
  }

  // ── Detail popup with larger chart + stats ──────────────────────────
  async _openDetailPopup(mod) {
    this._closeDetailPopup();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div class="hh-popup-sheet">
        <div class="hh-popup-header hh-popup-header-nav">
          <button class="hh-popup-close-text" id="hhDetailClose">Close</button>
          <div class="hh-popup-title">${this._escape(mod.label)}</div>
          <div class="hh-popup-header-spacer"></div>
        </div>
        <div class="hh-popup-body" id="hhDetailBody">
          <div class="hh-loading">Loading…</div>
        </div>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = this._popupCss();
    overlay.prepend(style);
    document.body.appendChild(overlay);
    this._detailPopupOverlay = overlay;
    overlay.querySelector('#hhDetailClose').addEventListener('click', () => this._closeDetailPopup());
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeDetailPopup(); });

    const body = overlay.querySelector('#hhDetailBody');
    const days = this._config.history_days || 7;
    this._pendingTileWiring = []; // filled by _buildTileRow, read below after the DOM exists

    let parts;
    try {
      if (mod.key === 'sleep_score') parts = await this._buildSleepScoreDetail(mod, days);
      else if (mod.key === 'vitals') parts = await this._buildVitalsDetail(mod);
      else if (mod.key === 'blood_pressure') parts = await this._buildBloodPressureDetail(mod, days);
      else if (mod.key === 'sleep_duration') parts = await this._buildTimeAsleepDetail(mod);
      else if (mod.key === 'blood_glucose') parts = await this._buildBloodGlucoseDetail(mod, days);
      else parts = await this._buildStandardDetail(mod, days);
    } catch (e) {
      body.innerHTML = `<div class="hh-loading">Couldn't load history — the recorder may not have this entity, or history is disabled.</div>`;
      return;
    }

    const aiAvailable = !!this._config.ai_features_enabled;
    const adviceAvailable = aiAvailable && this._config.ai_advice_enabled !== false && !!mod.adviceEligible;
    const cachedAdvice = adviceAvailable ? this._adviceCache[mod.key] : null;
    body.innerHTML = `
      ${parts.headline || ''}
      ${aiAvailable ? `
        <p class="hh-insight-text" id="hhInsightBox">Getting an AI read on this…</p>
      ` : ''}
      ${parts.chart || ''}
      ${adviceAvailable ? `
        <div class="hh-advice-card" id="hhAdviceCard">
          <div class="hh-advice-header">
            <span class="hh-advice-title">
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41M12 8a4 4 0 0 0-1 7.87V17h2v-1.13A4 4 0 0 0 12 8z"/></svg>
              Improve This
            </span>
            <button class="hh-advice-refresh" id="hhAdviceRefresh">Refresh</button>
          </div>
          <p class="hh-insight-text" id="hhAdviceText" style="margin:0;">${cachedAdvice ? this._escape(cachedAdvice.text) : 'Thinking of a few tips…'}</p>
        </div>
      ` : ''}
      <div class="hh-divider"></div>
      <button class="hh-export-full-btn" id="hhDetailExport">
        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        Export
      </button>
      ${parts.recent || ''}
    `;
    const exportBtn = overlay.querySelector('#hhDetailExport');
    if (exportBtn) exportBtn.addEventListener('click', () => this._openModuleExportPopup(mod));
    if (aiAvailable) this._fetchModuleAiInsight(mod, overlay);
    if (adviceAvailable) {
      const refreshBtn = overlay.querySelector('#hhAdviceRefresh');
      if (refreshBtn) refreshBtn.addEventListener('click', () => this._fetchModuleAdvice(mod, overlay));
      if (!cachedAdvice) this._fetchModuleAdvice(mod, overlay); // auto-loads once per module per session, same as the insight text above
    }
    if (typeof parts.wire === 'function') parts.wire(overlay);

    // Preview tiles (Sleep Score's Sleep/Vitals cards) push into another
    // module's own detail popup, replacing this one — same as tapping a
    // tile in Apple Health navigates forward rather than opening a
    // second sheet on top.
    overlay.querySelectorAll('.hh-tile[data-tile-index]').forEach(el => {
      const tile = this._pendingTileWiring[parseInt(el.dataset.tileIndex, 10)];
      if (tile && tile.onTap) el.addEventListener('click', () => tile.onTap());
    });
  }

  // Icon + big colored value + sublabel — same "headline" block shape as
  // Trend-arrow-plus-status header on every report popup.
  _headlineHtml(color, iconKey, label, sublabel) {
    return `
      <div class="hh-headline-row">
        <div class="hh-headline-icon" style="background:${color}22;">${horseIconSvg(iconKey, color)}</div>
        <div>
          <div class="hh-headline-label" style="color:${color};">${this._escape(label)}</div>
          <div class="hh-headline-sublabel">${this._escape(sublabel)}</div>
        </div>
      </div>
    `;
  }

  // Uses the same longer, range-aware opinion as the PDF/CSV/JSON reports
  // (_fetchModuleOpinion) rather than a separate shorter one-liner, so the
  // text on screen always matches what a report would say.
  async _fetchModuleAiInsight(mod, overlay) {
    const textEl = overlay.querySelector('#hhInsightBox');
    if (!textEl) return;
    const days = this._config.history_days || 7;
    const opinion = await this._fetchModuleOpinion(mod, days);
    textEl.textContent = opinion || 'No insight available right now.';
  }

  // "How can I improve this" — deliberately a separate call and a
  // separate prompt from the opinion above, not a variant of it: the
  // opinion describes what the data shows, this suggests what to do
  // about it, and blending the two risks the opinion drifting into
  // advice-giving it's not supposed to do. Only offered on modules
  // marked `adviceEligible` in the catalog — general lifestyle metrics
  // (Activity, Sleep, Water, Weight) where safe, non-clinical tips make
  // sense — never on vitals, blood pressure, or anything else where
  // "how to improve" edges into medical territory.
  _buildAdvicePrompt(mod) {
    const row = this._moduleSnapshotRow(mod);
    const readingText = `${row.value ?? '—'}${row.unit ? ' ' + row.unit : ''}${row.note ? ' — ' + row.note : ''}`;
    return `You are a health and fitness assistant. Based on this ${mod.label} reading (${readingText}), suggest one or two short, practical, general-audience lifestyle tips that could help improve it. Only suggest safe, everyday lifestyle habits — activity, sleep routine, hydration, general pacing, breathing or relaxation techniques — never medication, supplements, dosing, or any clinical treatment, and never diagnose or reference a medical condition. This is general wellness guidance, not medical advice, and should not be framed as such. Keep it brief, plain, and encouraging — max 3 sentences.`;
  }

  async _fetchModuleAdvice(mod, overlay) {
    const card = overlay.querySelector('#hhAdviceCard');
    if (!card) return;
    const textEl = card.querySelector('#hhAdviceText');
    const refreshBtn = card.querySelector('#hhAdviceRefresh');
    if (textEl) textEl.textContent = 'Thinking of a few tips…';
    if (refreshBtn) refreshBtn.textContent = '…';

    try {
      const prompt = this._buildAdvicePrompt(mod);
      const result = await this._hass.callWS({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent || undefined,
      });
      const text = horseExtractConversationSpeech(result) || 'No advice available right now.';
      this._adviceCache[mod.key] = { text, fetchedAt: Date.now() };
      if (textEl) textEl.textContent = text;
      if (refreshBtn) refreshBtn.textContent = 'Refresh';
    } catch (e) {
      if (textEl) textEl.textContent = 'Could not reach the AI assistant — check the conversation agent in the visual editor.';
      if (refreshBtn) refreshBtn.textContent = 'Refresh';
    }
  }

  // `plausibleRange`, when passed, drops readings outside it — same
  // sensor-dropout filtering as _numFor/_isPlausible, applied here to
  // the whole history series so a brief 0 BPM glitch doesn't survive
  // into the chart, stats, or export as a real dip.
  async _fetchHistorySeries(entityId, rangeDays, plausibleRange = null) {
    const end = new Date();
    const start = this._startForRange(rangeDays);
    const result = await this._hass.callApi(
      'GET',
      `history/period/${start.toISOString()}?filter_entity_id=${entityId}&end_time=${end.toISOString()}&minimal_response`
    );
    let points = (result?.[0] || [])
      .map(p => [new Date(p.last_changed).getTime(), parseFloat(p.state)])
      .filter(p => Number.isFinite(p[1]));
    if (plausibleRange) {
      points = points.filter(p => p[1] >= plausibleRange.min && p[1] <= plausibleRange.max);
    }
    return points;
  }

  // rangeDays accepts 'today' (since local midnight), 'all' (bounded to
  // the last year — see below), or a plain number of days back from now
  // — shared by the on-card detail popup (always a plain number, from
  // config.history_days) and the export popup's range picker (any of
  // the three).
  _startForRange(rangeDays) {
    if (rangeDays === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      return d;
    }
    // 'All' queries from the literal Unix epoch used to be genuinely
    // unbounded — against a long-running recorder database that's a huge,
    // slow query for a mobile WKWebView to wait on, and a slow enough
    // history/period call can make the app appear to hang and reload,
    // dropping the export sheet back to its default state. Capping at a
    // year (recorder purges older data on most setups anyway) keeps this
    // fast while still covering "basically everything" in practice.
    if (rangeDays === 'all') return new Date(Date.now() - 365 * 86400000);
    return new Date(Date.now() - rangeDays * 86400000);
  }

  _rangeLabelFor(rangeDays) {
    if (rangeDays === 'today') return 'Today';
    if (rangeDays === 'all') return 'All time';
    return `Last ${rangeDays} days`;
  }

  // "Today, 14:32" for a timestamp from today, "Mon, 14:32" otherwise —
  // "Today, 14:32" for a timestamp from today, "Mon, 14:32" otherwise.
  _formatRecentTimestamp(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (sameDay) return `Today, ${time}`;
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short' })}, ${time}`;
  }

  // Standard (single-entity) module detail: headline + line chart + per-day
  // bar chart + a recent-readings list, in that order — mirrors
  // Report-popup layout: headline, chart card, Export, Recent History.
  async _buildStandardDetail(mod, days) {
    const entityId = this._entityFor(mod.key);
    if (!entityId) {
      return { headline: '', chart: `<div class="hh-loading">This metric isn't mapped to a sensor yet — set it up in the visual editor.</div>`, recent: '' };
    }
    const fmt = v => mod.format === 'duration_min' ? this._formatMinutes(v) : v.toFixed(mod.decimals || 0);
    const unitSuffix = (mod.unit && mod.format !== 'duration_min') ? ' ' + mod.unit : '';
    const n = this._numFor(mod.key);
    const bandFn = v => horseBandColor(mod.bands, v, mod.color);

    const series = await this._fetchHistorySeries(entityId, days, mod.plausibleRange);
    this._historyCache[entityId] = { fetchedAt: Date.now(), points: series };
    if (!series.length) {
      const headline = this._headlineHtml(n != null ? bandFn(n) : mod.color, mod.icon, n != null ? `${fmt(n)}${unitSuffix}` : '—', 'Latest reading');
      return { headline, chart: `<div class="hh-loading">No history recorded for this sensor yet.</div>`, recent: '' };
    }

    // Daily-resetting counters (Steps, Distance, Flights Climbed, Active/
    // Resting Energy) restart at 0 each day, so every raw state-change is
    // a partial running total for that day, not an independent sample —
    // averaging or line-charting them against each other treats a 07:43
    // reading and a 08:00 reading from the same day as two separate data
    // points on a "7 day trend", which isn't what they are. Using each
    // day's last value instead gives one honest total per day.
    const isCounter = !!mod.resetsDaily;
    const dailyTotals = isCounter ? this._dailyLastValues(series) : null;
    // Staleness is judged from the recorder's actual history — the same
    // data "Recent History" below is built from — not the live entity's
    // last_changed. last_changed reflects whenever the live state object
    // last changed for any reason (a reload, a re-set to the same value),
    // which isn't necessarily a genuine new reading; the recorder only
    // gets a new row when a real state change was recorded, which is a
    // more trustworthy signal for "is there actually fresh data here."
    const mostRecentDailyDate = isCounter && dailyTotals.length ? dailyTotals[dailyTotals.length - 1].date : null;
    const isStale = mostRecentDailyDate != null && new Date(mostRecentDailyDate).toDateString() !== new Date().toDateString();
    const staleDateStr = isStale ? new Date(mostRecentDailyDate).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' }) : null;
    const headlineSublabel = isStale ? `Last updated ${staleDateStr}` : 'Latest reading';
    const headline = this._headlineHtml(n != null ? bandFn(n) : mod.color, mod.icon, n != null ? `${fmt(n)}${unitSuffix}` : '—', headlineSublabel);

    if (isCounter) {
      if (dailyTotals.length < 1) {
        return { headline, chart: `<div class="hh-loading">No daily totals recorded for this range yet.</div>`, recent: '' };
      }
      const dayVals = dailyTotals.map(d => d.value);
      const min = Math.min(...dayVals), max = Math.max(...dayVals);
      const avg = dayVals.reduce((a, b) => a + b, 0) / dayVals.length;
      const latest = dayVals[dayVals.length - 1];
      // Don't call it "Today" unless the most recent daily total actually
      // is from today — otherwise this repeats the exact misleading claim
      // that prompted this fix in the first place.
      const latestLabel = isStale ? 'Latest' : 'Today';
      const chart = `
        ${isStale ? `<p class="hh-insight-text" style="color:rgba(255,159,10,0.9);">No new data since ${staleDateStr} — this may not reflect today.</p>` : ''}
        <div class="hh-section-label">${this._rangeLabelFor(days).toUpperCase()} — DAILY TOTALS</div>
        <div class="hh-chart-wrap">${this._buildDailyBarChart(dailyTotals, mod.color, unitSuffix, 'hhBarMain', mod.bands ? bandFn : null)}</div>
        <div class="hh-stat-row">
          <div class="hh-stat hh-stat-clickable" data-stat="latest"><div class="hh-stat-label">${latestLabel}</div><div class="hh-stat-value" style="color:${bandFn(latest)};">${fmt(latest)}</div></div>
          <div class="hh-stat hh-stat-clickable" data-stat="average"><div class="hh-stat-label">Average</div><div class="hh-stat-value" style="color:${bandFn(avg)};">${fmt(avg)}</div></div>
          <div class="hh-stat hh-stat-clickable" data-stat="min"><div class="hh-stat-label">Min</div><div class="hh-stat-value" style="color:${bandFn(min)};">${fmt(min)}</div></div>
          <div class="hh-stat hh-stat-clickable" data-stat="max"><div class="hh-stat-label">Max</div><div class="hh-stat-value" style="color:${bandFn(max)};">${fmt(max)}</div></div>
        </div>
      `;
      const recentDays = dailyTotals.slice(-8).reverse();
      const recent = recentDays.length ? `
        <div class="hh-section-label">RECENT HISTORY</div>
        <div class="hh-recent-list">
          ${recentDays.map((d, idx) => {
            const c = bandFn(d.value);
            return `
            <div class="hh-recent-row hh-recent-row-clickable" data-recent-idx="${idx}">
              <div class="hh-recent-time">${new Date(d.date).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
              <div class="hh-recent-pill" style="border-color:${c}55;color:${c};">${fmt(d.value)}${unitSuffix}</div>
            </div>
          `;
          }).join('')}
        </div>
      ` : '';
      const wire = (root) => {
        const barSvg = root.querySelector('#hhBarMain');
        if (barSvg) this._attachBarChartCrosshair(barSvg, dailyTotals, mod.color, { unitSuffix, bandColorFn: mod.bands ? bandFn : null });

        const statInfo = {
          latest: { label: latestLabel, value: latest, ts: dailyTotals[dailyTotals.length - 1].date },
          average: { label: 'Average', value: avg, ts: null },
          min: { label: 'Min', value: min, ts: (dailyTotals.find(d => d.value === min) || {}).date },
          max: { label: 'Max', value: max, ts: (dailyTotals.find(d => d.value === max) || {}).date },
        };
        root.querySelectorAll('.hh-stat-clickable').forEach(el => {
          el.addEventListener('click', () => {
            const key = el.dataset.stat;
            const s = statInfo[key];
            const valueText = `${fmt(s.value)}${unitSuffix}`;
            const dateStr = s.ts ? new Date(s.ts).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' }) : null;
            const detailText = key === 'average'
              ? `Across ${dailyTotals.length} day${dailyTotals.length === 1 ? '' : 's'}, ranging from ${fmt(min)}${unitSuffix} to ${fmt(max)}${unitSuffix}.`
              : dateStr
                ? `${s.label === 'Today' ? 'Recorded' : 'On'} ${dateStr} — the ${dailyTotals.length}-day average is ${fmt(avg)}${unitSuffix}.`
                : `Calculated from ${dailyTotals.length} day${dailyTotals.length === 1 ? '' : 's'}.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on the ${s.label.toLowerCase()} ${mod.label} total of ${valueText}${dateStr ? ' on ' + dateStr : ''}. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, s.label, valueText, detailText, aiPrompt);
          });
        });

        root.querySelectorAll('.hh-recent-row-clickable').forEach(el => {
          const d = recentDays[parseInt(el.dataset.recentIdx, 10)];
          if (!d) return;
          el.addEventListener('click', () => {
            const dateStr = new Date(d.date).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' });
            const valueText = `${fmt(d.value)}${unitSuffix}`;
            const diff = d.value - avg;
            const diffText = Math.abs(diff) < 0.05 ? 'right at' : `${diff > 0 ? 'above' : 'below'} your`;
            const detailText = `${mod.label} total for ${dateStr} — ${diffText} the ${dailyTotals.length}-day average of ${fmt(avg)}${unitSuffix}.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on a ${mod.label} total of ${valueText} on ${dateStr}. No medical advice or diagnoses.`;
            this._openStatInfoPopup(bandFn(d.value), mod.label, valueText, detailText, aiPrompt);
          });
        });
      };
      return { headline, chart, recent, wire };
    }

    const vals = series.map(p => p[1]);
    const min = Math.min(...vals), max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const latest = vals[vals.length - 1];
    const daily = this._dailyAverages(series);
    // dailyLine metrics (Resting HR, HRV, Blood Oxygen, Respiratory
    // Rate, VO2 Max, Body/Basal Temperature, Blood Glucose) are already
    // roughly one reading a day, so the main chart IS the per-day view —
    // no separate "Per Day" bar section underneath duplicating it.
    const chart = mod.dailyLine ? `
      <div class="hh-section-label">${this._rangeLabelFor(days).toUpperCase()}</div>
      <div class="hh-chart-wrap">${this._dailyLineChartSvg(daily, mod.color, 'hhLineMain', mod.bands)}</div>
      <div class="hh-stat-row">
        <div class="hh-stat hh-stat-clickable" data-stat="latest"><div class="hh-stat-label">Latest</div><div class="hh-stat-value" style="color:${bandFn(latest)};">${fmt(latest)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="average"><div class="hh-stat-label">Average</div><div class="hh-stat-value" style="color:${bandFn(avg)};">${fmt(avg)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="min"><div class="hh-stat-label">Min</div><div class="hh-stat-value" style="color:${bandFn(min)};">${fmt(min)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="max"><div class="hh-stat-label">Max</div><div class="hh-stat-value" style="color:${bandFn(max)};">${fmt(max)}</div></div>
      </div>
    ` : `
      <div class="hh-section-label">${this._rangeLabelFor(days).toUpperCase()}</div>
      <div class="hh-chart-wrap">${this._largeChartSvg(series, mod.color, 'hhLineMain', mod.bands)}</div>
      <div class="hh-stat-row">
        <div class="hh-stat hh-stat-clickable" data-stat="latest"><div class="hh-stat-label">Latest</div><div class="hh-stat-value" style="color:${bandFn(latest)};">${fmt(latest)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="average"><div class="hh-stat-label">Average</div><div class="hh-stat-value" style="color:${bandFn(avg)};">${fmt(avg)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="min"><div class="hh-stat-label">Min</div><div class="hh-stat-value" style="color:${bandFn(min)};">${fmt(min)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-stat="max"><div class="hh-stat-label">Max</div><div class="hh-stat-value" style="color:${bandFn(max)};">${fmt(max)}</div></div>
      </div>
      ${daily.length > 1 ? `
        <div class="hh-section-label">PER DAY</div>
        <div class="hh-chart-wrap">${this._buildDailyBarChart(daily, mod.color, unitSuffix, 'hhBarMain', mod.bands ? bandFn : null)}</div>
      ` : ''}
    `;
    const recentPts = series.slice(-8).reverse();
    const recent = recentPts.length ? `
      <div class="hh-section-label">RECENT HISTORY</div>
      <div class="hh-recent-list">
        ${recentPts.map(([ts, val], idx) => {
          const c = bandFn(val);
          return `
          <div class="hh-recent-row hh-recent-row-clickable" data-recent-idx="${idx}">
            <div class="hh-recent-time">${this._formatRecentTimestamp(ts)}</div>
            <div class="hh-recent-pill" style="border-color:${c}55;color:${c};">${fmt(val)}${unitSuffix}</div>
          </div>
        `;
        }).join('')}
      </div>
    ` : '';
    const wire = (root) => {
      const lineSvg = root.querySelector('#hhLineMain');
      if (lineSvg) {
        if (mod.dailyLine) {
          this._attachDailyLineCrosshair(lineSvg, daily, mod.color, { unitSuffix, decimals: mod.decimals, formatFn: mod.format === 'duration_min' ? fmt : null, bands: mod.bands });
        } else {
          this._attachLineChartCrosshair(lineSvg, this._resampleSeriesRange(series), mod.color, { unitSuffix, decimals: mod.decimals, formatFn: mod.format === 'duration_min' ? fmt : null, bands: mod.bands });
        }
      }
      const barSvg = root.querySelector('#hhBarMain');
      if (barSvg && daily.length > 1) this._attachBarChartCrosshair(barSvg, daily, mod.color, { unitSuffix, bandColorFn: mod.bands ? bandFn : null });

      // Tapping a Latest/Average/Min/Max card shows when that reading
      // happened (or, for Average, how many readings it's drawn from) —
      // the numbers alone don't say that.
      const statInfo = {
        latest: { label: 'Latest', value: latest, ts: series[series.length - 1][0] },
        average: { label: 'Average', value: avg, ts: null },
        min: { label: 'Min', value: min, ts: (series.find(p => p[1] === min) || [])[0] },
        max: { label: 'Max', value: max, ts: (series.find(p => p[1] === max) || [])[0] },
      };
      root.querySelectorAll('.hh-stat-clickable').forEach(el => {
        el.addEventListener('click', () => {
          const key = el.dataset.stat;
          const s = statInfo[key];
          const valueText = `${fmt(s.value)}${unitSuffix}`;
          const rangeLabel = this._rangeLabelFor(days).toLowerCase();
          const detailText = key === 'average'
            ? `From ${series.length} reading${series.length === 1 ? '' : 's'} over ${rangeLabel}, ranging from ${fmt(min)}${unitSuffix} to ${fmt(max)}${unitSuffix}.`
            : s.ts
              ? `Recorded ${this._formatRecentTimestamp(s.ts)} — the ${rangeLabel} average is ${fmt(avg)}${unitSuffix}.`
              : `Calculated from ${series.length} reading${series.length === 1 ? '' : 's'} over ${rangeLabel}.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on the ${s.label.toLowerCase()} ${mod.label} reading of ${valueText}${s.ts ? ' recorded ' + this._formatRecentTimestamp(s.ts) : ' over ' + rangeLabel}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(mod.color, s.label, valueText, detailText, aiPrompt);
        });
      });

      // Recent History rows
      root.querySelectorAll('.hh-recent-row-clickable').forEach(el => {
        const pt = recentPts[parseInt(el.dataset.recentIdx, 10)];
        if (!pt) return;
        el.addEventListener('click', () => {
          const [ts, val] = pt;
          const valueText = `${fmt(val)}${unitSuffix}`;
          const diff = val - avg;
          const diffText = Math.abs(diff) < (unitSuffix ? 0.05 : 0.5) ? 'right at' : `${diff > 0 ? 'above' : 'below'} your`;
          const detailText = `Recorded ${this._formatRecentTimestamp(ts)} — ${diffText} the ${this._rangeLabelFor(days).toLowerCase()} average of ${fmt(avg)}${unitSuffix}.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this ${mod.label} reading of ${valueText} recorded ${this._formatRecentTimestamp(ts)}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(bandFn(val), mod.label, valueText, detailText, aiPrompt);
        });
      });
    };
    return { headline, chart, recent, wire };
  }

  // Blood Glucose gets everything _buildStandardDetail already does
  // (daily-line chart, stats, recent history — it's a dailyLine module)
  // plus glucose-specific extras appended below: trend, Time in Range,
  // estimated A1C, a 30-minute prediction, and sensor life. Extras are
  // wrapped in their own try/catch — if any of them fail to load, the
  // base popup (which is the important part) still works.
  async _buildBloodGlucoseDetail(mod, days) {
    const base = await this._buildStandardDetail(mod, days);
    const entityId = this._entityFor(mod.key);
    if (!entityId) return base;

    let extraHtml = '';
    let wireExtra = null;

    try {
      const [tirSeries, recentSeries, a1cSeries] = await Promise.all([
        this._fetchHistorySeries(entityId, 14, mod.plausibleRange),
        this._fetchHistorySeries(entityId, 1, mod.plausibleRange),
        this._fetchHistorySeries(entityId, 90, mod.plausibleRange),
      ]);

      const trend = this._glucoseTrend(recentSeries, mod.unit);
      const trendLabels = { rising_fast: 'Rising quickly', rising: 'Rising', steady: 'Steady', falling: 'Falling', falling_fast: 'Falling quickly' };
      const trendHtml = trend ? `
        <div class="hh-glucose-trend-row" data-glucose-info="trend" style="cursor:pointer;">
          ${this._glucoseTrendArrowSvg(trend, mod.color)}
          <div class="hh-glucose-trend-label">${trendLabels[trend.direction]}</div>
        </div>
      ` : '';

      const tir = tirSeries.length ? this._glucoseTimeInRange(tirSeries, mod.bands) : null;
      const tirHtml = tir ? `
        <div class="hh-glucose-card">
          <div class="hh-glucose-card-title">Time in Range — Last 14 Days</div>
          <div class="hh-glucose-tir-bar">
            <div class="hh-glucose-tir-seg" data-tir="low" style="width:${tir.low}%;background:#FF3B30;"></div>
            <div class="hh-glucose-tir-seg" data-tir="inRange" style="width:${tir.inRange}%;background:#34C759;"></div>
            <div class="hh-glucose-tir-seg" data-tir="high" style="width:${tir.high}%;background:#FF9500;"></div>
          </div>
          <div class="hh-glucose-tir-legend">
            <span class="hh-glucose-tir-legend-item" data-tir="low" style="color:#FF3B30;">Low ${tir.low}%</span>
            <span class="hh-glucose-tir-legend-item" data-tir="inRange" style="color:#34C759;">In Range ${tir.inRange}%</span>
            <span class="hh-glucose-tir-legend-item" data-tir="high" style="color:#FF9500;">High ${tir.high}%</span>
          </div>
        </div>
      ` : '';

      let a1cHtml = '';
      if (a1cSeries.length) {
        const avg = a1cSeries.reduce((s, p) => s + p[1], 0) / a1cSeries.length;
        const a1c = this._glucoseEstimatedA1C(avg, mod.unit);
        const spanDays = Math.max(1, Math.round((a1cSeries[a1cSeries.length - 1][0] - a1cSeries[0][0]) / 86400000));
        a1cHtml = `
          <div class="hh-glucose-card" data-glucose-info="a1c" style="cursor:pointer;">
            <div class="hh-glucose-card-title">Estimated A1C</div>
            <div class="hh-glucose-value">${a1c.toFixed(1)}%</div>
            <div class="hh-glucose-card-note">Estimated from your average glucose over the last ${spanDays} day${spanDays === 1 ? '' : 's'}. Not a substitute for a lab-drawn A1C test — talk to your doctor about your actual results.</div>
          </div>
        `;
      }

      const prediction = this._glucosePrediction(recentSeries, mod.unit);
      let predictHtml = '';
      if (prediction) {
        const rateMgDlEquiv = mod.unit === 'mmol/L' ? prediction.ratePerMin * 18.0182 : prediction.ratePerMin;
        const predTrendLabel = rateMgDlEquiv > 1 ? 'rising' : rateMgDlEquiv < -1 ? 'falling' : 'steady';
        const predValue = mod.unit === 'mmol/L' ? prediction.value.toFixed(1) : Math.round(prediction.value);
        predictHtml = `
          <div class="hh-glucose-card" data-glucose-info="prediction" style="cursor:pointer;">
            <div class="hh-glucose-card-title">Estimated in 30 Minutes</div>
            <div class="hh-glucose-value" style="color:${mod.color};">${predValue} ${mod.unit}</div>
            <div class="hh-glucose-card-note">Based on your ${predTrendLabel} trend over the last 45 minutes. Informational only — never used to work out insulin dosing, and not a substitute for checking how you actually feel.</div>
          </div>
        `;
      }

      extraHtml = `
        <div class="hh-divider"></div>
        <div class="hh-section-label">GLUCOSE</div>
        ${trendHtml}
        ${predictHtml}
        ${tirHtml}
        ${a1cHtml}
      `;

      wireExtra = (root) => {
        // Time in Range bar/legend — tap either a segment or its label
        // for an AI note on that portion specifically.
        const tirLabels = { low: 'Low', inRange: 'In Range', high: 'High' };
        const tirColors = { low: '#FF3B30', inRange: '#34C759', high: '#FF9500' };
        const tirCounts = { low: 'lowCount', inRange: 'inRangeCount', high: 'highCount' };
        root.querySelectorAll('[data-tir]').forEach(el => {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            const key = el.dataset.tir;
            const pct = tir[key];
            const count = tir[tirCounts[key]];
            const label = tirLabels[key];
            const valueText = `${pct}%`;
            const rangeText = key === 'low' ? `below ${mod.bands.low} ${mod.unit}` : key === 'high' ? `above ${mod.bands.high} ${mod.unit}` : `between ${mod.bands.low}\u2013${mod.bands.high} ${mod.unit}`;
            const detailText = `${count} of ${tir.readingCount} readings (${pct}%) were ${rangeText} over the last 14 days.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this Time in Range stat: ${count} of ${tir.readingCount} readings (${pct}%) over the last 14 days were "${label}" (${rangeText}). No medical advice or diagnoses.`;
            this._openStatInfoPopup(tirColors[key], `Time in Range — ${label}`, valueText, detailText, aiPrompt);
          });
        });

        // Trend, Prediction, A1C — same tap-for-an-AI-note pattern as
        // everything else on the card.
        const fmtG = v => mod.unit === 'mmol/L' ? v.toFixed(1) : Math.round(v);

        const trendInfoEl = root.querySelector('[data-glucose-info="trend"]');
        if (trendInfoEl && trend) {
          trendInfoEl.addEventListener('click', () => {
            const label = trendLabels[trend.direction];
            const valueText = label;
            const mins = Math.round(trend.deltaMinutes);
            const detailText = `Went from ${fmtG(trend.fromValue)} to ${fmtG(trend.toValue)} ${mod.unit} over the last ${mins} minute${mins === 1 ? '' : 's'} (${trend.ratePerMin >= 0 ? '+' : ''}${trend.ratePerMin.toFixed(2)} ${mod.unit}/min).`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on a glucose trend of "${label}" — went from ${fmtG(trend.fromValue)} to ${fmtG(trend.toValue)} ${mod.unit} over ${mins} minutes. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, 'Glucose Trend', valueText, detailText, aiPrompt);
          });
        }

        const predictInfoEl = root.querySelector('[data-glucose-info="prediction"]');
        if (predictInfoEl && prediction) {
          predictInfoEl.addEventListener('click', () => {
            const predValue = mod.unit === 'mmol/L' ? prediction.value.toFixed(1) : Math.round(prediction.value);
            const valueText = `${predValue} ${mod.unit}`;
            const currentValue = recentSeries.length ? fmtG(recentSeries[recentSeries.length - 1][1]) : null;
            const rateMgDlEquiv = mod.unit === 'mmol/L' ? prediction.ratePerMin * 18.0182 : prediction.ratePerMin;
            const predTrendLabelFull = rateMgDlEquiv > 1 ? 'rising' : rateMgDlEquiv < -1 ? 'falling' : 'holding steady';
            const detailText = `${currentValue != null ? `Currently ${currentValue} ${mod.unit}, ` : ''}${predTrendLabelFull} at roughly ${prediction.ratePerMin >= 0 ? '+' : ''}${prediction.ratePerMin.toFixed(2)} ${mod.unit}/min over the last 45 minutes. Informational only — never used for dosing.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on an estimated glucose of ${valueText} in 30 minutes, based on a recent trend of ${predTrendLabelFull}${currentValue != null ? ` from a current reading of ${currentValue} ${mod.unit}` : ''}. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, 'Estimated in 30 Minutes', valueText, detailText, aiPrompt);
          });
        }

        const a1cInfoEl = root.querySelector('[data-glucose-info="a1c"]');
        if (a1cInfoEl && a1cSeries.length) {
          a1cInfoEl.addEventListener('click', () => {
            const avg = a1cSeries.reduce((s, p) => s + p[1], 0) / a1cSeries.length;
            const a1c = this._glucoseEstimatedA1C(avg, mod.unit);
            const valueText = `${a1c.toFixed(1)}%`;
            const spanDays = Math.max(1, Math.round((a1cSeries[a1cSeries.length - 1][0] - a1cSeries[0][0]) / 86400000));
            const detailText = `From an average glucose of ${fmtG(avg)} ${mod.unit} across ${a1cSeries.length} readings over the last ${spanDays} day${spanDays === 1 ? '' : 's'}. Not a substitute for a lab-drawn A1C test — talk to your doctor about your actual results.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on an estimated A1C of ${valueText}, from an average glucose of ${fmtG(avg)} ${mod.unit} over ${spanDays} days. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, 'Estimated A1C', valueText, detailText, aiPrompt);
          });
        }
      };
    } catch (e) { /* extras are a bonus — the base popup above still works without them */ }

    return {
      ...base,
      chart: (base.chart || '') + extraHtml,
      wire: (root) => {
        if (typeof base.wire === 'function') base.wire(root);
        if (wireExtra) wireExtra(root);
      },
    };
  }

  // Sleep Score detail: today's REM/Deep/Core/Awake donut, plus the score
  // recomputed for each of the last N days from the underlying sensors'
  // daily-last values (the score itself has no single entity/history).
  async _buildSleepScoreDetail(mod, days) {
    const score = await this._computeSleepScoreRich();
    if (!score) return { headline: '', chart: `<div class="hh-loading">No sleep data yet.</div>`, recent: '' };

    const headline = `
      <div class="hh-headline-row" style="align-items:flex-start;">
        <div>
          <div class="hh-headline-label" style="color:${horseSleepScoreBandColor(score.points)};">${this._escape(score.label)}</div>
        </div>
      </div>
    `;
    const ringCard = this._buildSegmentedRingCard(score.components, score.points);

    const donutItems = [
      { label: 'REM', value: this._numFor('rem_sleep') || 0, color: '#5E5CE6' },
      { label: 'Deep', value: this._numFor('deep_sleep') || 0, color: '#BF5AF2' },
      { label: 'Core', value: this._numFor('core_sleep') || 0, color: '#64D2FF' },
      { label: 'Awake', value: this._numFor('awake') || 0, color: '#8E8E93' },
    ];

    // Preview tiles — Sleep (proportional stage bar) and Vitals (dot
    // status row), each pushing into that module's own full detail.
    const vitalsChecks = this._vitalsChecks();
    const tileRow = this._buildTileRow([
      {
        title: 'Sleep',
        visual: this._miniStageBar(donutItems),
        caption: this._formatMinutes(this._numFor('sleep_duration') || 0),
        onTap: () => this._openDetailPopup(this._getMod('sleep_duration')),
      },
      {
        title: 'Vitals',
        visual: this._miniVitalsDots(vitalsChecks),
        caption: this._computeVitals()?.label || 'No data',
        color: this._computeVitals()?.typical ? '#30D158' : '#FF9F0A',
        onTap: () => this._openDetailPopup(this._getMod('vitals')),
      },
    ]);

    let dailyBarHtml = '', recent = '', sleepScores = [], recentScores = [];
    try {
      const scores = await this._sleepScoreDailySeries(days);
      sleepScores = scores;
      if (scores.length > 1) {
        dailyBarHtml = `<div class="hh-section-label">PER DAY</div><div class="hh-chart-wrap">${this._buildDailyBarChart(scores, mod.color, ' pts', 'hhBarSleep', horseSleepScoreBandColor)}</div>`;
        recentScores = scores.slice(-8).reverse();
        recent = `
          <div class="hh-section-label">RECENT HISTORY</div>
          <div class="hh-recent-list">
            ${recentScores.map((d, idx) => {
              const c = horseSleepScoreBandColor(d.value);
              return `
              <div class="hh-recent-row hh-recent-row-clickable" data-recent-idx="${idx}">
                <div class="hh-recent-time">${new Date(d.date).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
                <div class="hh-recent-pill" style="border-color:${c}55;color:${c};">${d.value} pts</div>
              </div>
            `;
            }).join('')}
          </div>
        `;
      }
    } catch (_) { /* per-day trend is a bonus view — the ring above still works without it */ }

    // Highlights — a bedtime-consistency narrative + the two-value
    // comparison and per-day trend, same shape as Apple Health's
    // Highlights card under the ring.
    let highlights = '';
    if (score.avgBedtimeLabel && score.lastBedtimeLabel) {
      const diffLabel = score.bedtimeDiffMin != null ? `${score.bedtimeDiffMin} minute${score.bedtimeDiffMin === 1 ? '' : 's'}` : '';
      highlights = `
        <div class="hh-divider"></div>
        <div class="hh-section-label">HIGHLIGHTS</div>
        <p class="hh-insight-text" style="margin-bottom:12px;">Last night's bedtime was ${diffLabel} off your recent average.</p>
        <div class="hh-stat-row" style="grid-template-columns:1fr 1fr;">
          <div class="hh-stat hh-stat-clickable" data-bedtime-stat="average"><div class="hh-stat-label">Average Bedtime</div><div class="hh-stat-value">${score.avgBedtimeLabel}</div></div>
          <div class="hh-stat hh-stat-clickable" data-bedtime-stat="last"><div class="hh-stat-label">Last Night's Bedtime</div><div class="hh-stat-value">${score.lastBedtimeLabel}</div></div>
        </div>
        ${score.bedtimeDaily.length > 1 ? `<div class="hh-chart-wrap">${this._buildDailyBarChart(score.bedtimeDaily, '#64D2FF', '', 'hhBarBedtime', null, v => this._formatTimeOfDay(v))}</div>` : ''}
      `;
    }

    const chart = `
      ${ringCard}
      ${tileRow}
      ${highlights}
      <div class="hh-divider"></div>
      <div class="hh-section-label">TONIGHT'S BREAKDOWN</div>
      <div class="hh-chart-wrap">${this._buildDonutChart(donutItems, { centerLabel: this._formatMinutes((this._numFor('sleep_duration') || 0)), centerSublabel: 'asleep' })}</div>
      ${dailyBarHtml}
    `;
    const wire = (root) => {
      const barSvg = root.querySelector('#hhBarSleep');
      if (barSvg && sleepScores.length > 1) this._attachBarChartCrosshair(barSvg, sleepScores, mod.color, { unitSuffix: ' pts', bandColorFn: horseSleepScoreBandColor });
      const bedtimeSvg = root.querySelector('#hhBarBedtime');
      if (bedtimeSvg && score.bedtimeDaily.length > 1) {
        this._attachBarChartCrosshair(bedtimeSvg, score.bedtimeDaily, '#64D2FF', {
          formatFn: v => this._formatTimeOfDay(v),
        });
      }

      // Ring legend (Duration/Bedtime/Interruptions)
      const scoreTotal = score.components.reduce((s, c) => s + c.max, 0) || 1;
      root.querySelectorAll('.hh-ring-legend-item').forEach(el => {
        const c = score.components[parseInt(el.dataset.ringLegendIdx, 10)];
        if (!c) return;
        el.addEventListener('click', () => {
          const valueText = `${c.score}/${c.max} points`;
          const share = Math.round((c.max / scoreTotal) * 100);
          const detailText = `${c.label} makes up ${share}% of your ${score.points}-point Sleep Score, and scored ${c.score} of a possible ${c.max}.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on the "${c.label}" component of a Sleep Score, which scored ${c.score} out of ${c.max} points. No medical advice or diagnoses.`;
          this._openStatInfoPopup(c.color, c.label, valueText, detailText, aiPrompt);
        });
      });

      // Tonight's Breakdown donut legend (REM/Deep/Core/Awake)
      const usableDonut = donutItems.filter(i => i.value > 0);
      const donutTotal = usableDonut.reduce((s, i) => s + i.value, 0) || 1;
      root.querySelectorAll('.hh-donut-legend-item').forEach(el => {
        const i = usableDonut[parseInt(el.dataset.donutLegendIdx, 10)];
        if (!i) return;
        el.addEventListener('click', () => {
          const valueText = this._formatMinutes(i.value);
          const pct = Math.round((i.value / donutTotal) * 100);
          const detailText = `${pct}% of tonight's ${this._formatMinutes(this._numFor('sleep_duration') || 0)} total.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on ${i.label} sleep of ${this._formatMinutes(i.value)} for tonight. No medical advice or diagnoses.`;
          this._openStatInfoPopup(i.color, i.label, valueText, detailText, aiPrompt);
        });
      });

      // Highlights bedtime stats
      root.querySelectorAll('[data-bedtime-stat]').forEach(el => {
        el.addEventListener('click', () => {
          const isAvg = el.dataset.bedtimeStat === 'average';
          const label = isAvg ? 'Average Bedtime' : "Last Night's Bedtime";
          const valueText = isAvg ? score.avgBedtimeLabel : score.lastBedtimeLabel;
          const diffMin = score.bedtimeDiffMin;
          const diffText = (diffMin != null && !isAvg)
            ? `${diffMin} minute${diffMin === 1 ? '' : 's'} off your ${score.avgBedtimeLabel} average.`
            : `Your typical bedtime over the last several nights.`;
          const detailText = diffText;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this bedtime info: ${label} is ${valueText}${!isAvg ? ` (${diffText})` : ''}. No medical advice or diagnoses.`;
          this._openStatInfoPopup('#64D2FF', label, valueText, detailText, aiPrompt);
        });
      });

      // Recent History rows (Sleep Score per night)
      const scoreAvg = sleepScores.length ? sleepScores.reduce((s, d) => s + d.value, 0) / sleepScores.length : null;
      root.querySelectorAll('.hh-recent-row-clickable').forEach(el => {
        const d = recentScores[parseInt(el.dataset.recentIdx, 10)];
        if (!d) return;
        el.addEventListener('click', () => {
          const dateStr = new Date(d.date).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' });
          const valueText = `${d.value} points`;
          const detailText = scoreAvg != null
            ? `Sleep Score for ${dateStr} — the ${sleepScores.length}-night average is ${Math.round(scoreAvg)} points.`
            : `Sleep Score for ${dateStr}.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on a Sleep Score of ${d.value} points recorded on ${dateStr}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(horseSleepScoreBandColor(d.value), 'Sleep Score', valueText, detailText, aiPrompt);
        });
      });
    };
    return { headline, chart, recent, wire };
  }

  // The five vitals checked for the Vitals module/tile — shared so the
  // full Vitals detail and the Sleep Score preview tile can never
  // disagree about what counts as "typical".
  _vitalsChecks() {
    const checks = [
      { key: 'heart_rate', label: 'Heart Rate', low: 40, high: 130, unit: 'BPM' },
      { key: 'blood_oxygen', label: 'Blood Oxygen', low: 92, high: 100, unit: '%' },
      { key: 'respiratory_rate', label: 'Respiratory Rate', low: 10, high: 22, unit: 'br/min' },
      { key: 'body_temperature', label: 'Body Temperature', low: 35.5, high: 38.2, unit: '°' },
      { key: 'heart_rate_variability', label: 'HRV', low: 10, high: 200, unit: 'ms' },
    ];
    return checks.map(c => {
      const v = this._numFor(c.key);
      if (v == null) return null;
      const inRange = v >= c.low && v <= c.high;
      return { label: c.label, value: v, display: `${v}${c.unit}`, color: inRange ? '#30D158' : '#FF9F0A', low: c.low, high: c.high, unit: c.unit };
    }).filter(Boolean);
  }

  // Vitals detail: one colored bar per underlying vital, green within its
  // normal range and orange outside it — mirrors Apple Health's Vitals
  // list rather than a single time series (it isn't one metric).
  // Time Asleep detail — Apple Health's own Sleep screen shape: a
  // D/W/M/6M range control, a big split "Xhr Ymin" headline with the
  // date, tonight's stage breakdown for "D", and a Trends narrative +
  // per-night bar chart for the wider ranges. Deliberately not a real
  // hypnogram — the underlying sensors report nightly stage totals, not
  // a minute-by-minute stage-change history to draw a timeline from.
  async _buildTimeAsleepDetail(mod) {
    const dur = this._numFor('sleep_duration');
    const hrs = Math.floor((dur || 0) / 60), mins = Math.round((dur || 0) % 60);
    const headline = `
      <div class="hh-section-label" style="margin-top:0;">Time Asleep</div>
      <div class="hh-sleep-big">${hrs}<span class="hh-sleep-big-unit">hr</span> ${mins}<span class="hh-sleep-big-unit">min</span></div>
      <div class="hh-sleep-date">${new Date().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      <div class="hh-segmented" id="hhSleepSeg">
        <button class="hh-segmented-btn selected" data-days="1">D</button>
        <button class="hh-segmented-btn" data-days="7">W</button>
        <button class="hh-segmented-btn" data-days="30">M</button>
        <button class="hh-segmented-btn" data-days="180">6M</button>
      </div>
    `;
    const chart = `<div id="hhSleepContent"><div class="hh-loading">Loading…</div></div>`;
    const wire = (root) => {
      const contentEl = root.querySelector('#hhSleepContent');
      const seg = root.querySelector('#hhSleepSeg');
      const renderFor = async (daysSel) => {
        contentEl.innerHTML = `<div class="hh-loading">Loading…</div>`;
        const { html, wireChart } = await this._buildTimeAsleepContent(mod, daysSel);
        contentEl.innerHTML = html;
        if (wireChart) wireChart(root);
      };
      seg.querySelectorAll('.hh-segmented-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          seg.querySelectorAll('.hh-segmented-btn').forEach(b => b.classList.toggle('selected', b === btn));
          renderFor(parseInt(btn.dataset.days, 10));
        });
      });
      renderFor(1);
    };
    return { headline, chart, recent: '', wire };
  }

  async _buildTimeAsleepContent(mod, daysSel) {
    if (daysSel === 1) {
      // Row order and colors match Apple Health's own Sleep screen
      // (Awake, REM, Core, Deep, top to bottom).
      const stageItems = [
        { label: 'Awake', value: this._numFor('awake') || 0, color: '#FF6961' },
        { label: 'REM', value: this._numFor('rem_sleep') || 0, color: '#64D2FF' },
        { label: 'Core', value: this._numFor('core_sleep') || 0, color: '#5E5CE6' },
        { label: 'Deep', value: this._numFor('deep_sleep') || 0, color: '#3A2E8C' },
      ];
      const ringComponents = stageItems
        .filter(i => i.value > 0)
        .map(i => ({ label: i.label, score: i.value, max: i.value, color: i.color }));
      const centerLabel = this._formatMinutes(this._numFor('sleep_duration') || 0);
      const usableStages = stageItems.filter(i => i.value > 0);
      const stageTotal = usableStages.reduce((s, i) => s + i.value, 0) || 1;
      return {
        html: `
          <div class="hh-section-label">Tonight's Stages</div>
          <div class="hh-chart-wrap">${this._buildSegmentedRingCard(ringComponents, null, { legendFormat: 'duration', centerLabel, centerFontSize: centerLabel.length > 5 ? 16 : 24 })}</div>
          <div class="hh-chart-wrap">${this._buildStageRowsChart(stageItems)}</div>
        `,
        wireChart: (root) => {
          const openStage = i => {
            const valueText = this._formatMinutes(i.value);
            const pct = Math.round((i.value / stageTotal) * 100);
            const detailText = `${pct}% of tonight's ${centerLabel} total.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on ${i.label} sleep of ${valueText} for tonight. No medical advice or diagnoses.`;
            this._openStatInfoPopup(i.color, i.label, valueText, detailText, aiPrompt);
          };
          root.querySelectorAll('.hh-ring-legend-item').forEach(el => {
            const i = ringComponents[parseInt(el.dataset.ringLegendIdx, 10)];
            if (i) el.addEventListener('click', () => openStage({ label: i.label, value: i.score, color: i.color }));
          });
          root.querySelectorAll('.hh-stage-row-item').forEach(el => {
            const i = usableStages[parseInt(el.dataset.stageRowIdx, 10)];
            if (i) el.addEventListener('click', () => openStage(i));
          });
        },
      };
    }

    const entityId = this._entityFor('sleep_duration');
    if (!entityId) return { html: `<div class="hh-loading">Time Asleep isn't mapped to a sensor yet — set it up in the visual editor.</div>` };
    const series = await this._fetchHistorySeries(entityId, daysSel);
    if (!series.length) return { html: `<div class="hh-loading">No history recorded for this range yet.</div>` };
    const daily = this._dailyLastValues(series);
    if (daily.length < 2) return { html: `<div class="hh-loading">Not enough nights recorded yet for a trend.</div>` };

    const vals = daily.map(d => d.value);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals), max = Math.max(...vals);
    const mid = Math.floor(daily.length / 2);
    const firstHalfAvg = daily.slice(0, mid).reduce((s, d) => s + d.value, 0) / Math.max(1, mid);
    const secondHalfAvg = daily.slice(mid).reduce((s, d) => s + d.value, 0) / Math.max(1, daily.length - mid);
    const diff = secondHalfAvg - firstHalfAvg;
    let trendText;
    if (Math.abs(diff) < 15) trendText = 'On average, your sleep duration has stayed about the same over this period.';
    else if (diff < 0) trendText = 'On average, you\u2019ve been sleeping less over this period.';
    else trendText = 'On average, you\u2019ve been sleeping more over this period.';

    const recent = daily.slice(-8).reverse();
    const html = `
      <div class="hh-section-label">Trends</div>
      <p class="hh-insight-text">${this._escape(trendText)}</p>
      <div class="hh-stat-row">
        <div class="hh-stat hh-stat-clickable" data-sleep-stat="average"><div class="hh-stat-label">Average</div><div class="hh-stat-value">${this._formatMinutes(avg)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-sleep-stat="min"><div class="hh-stat-label">Min</div><div class="hh-stat-value">${this._formatMinutes(min)}</div></div>
        <div class="hh-stat hh-stat-clickable" data-sleep-stat="max"><div class="hh-stat-label">Max</div><div class="hh-stat-value">${this._formatMinutes(max)}</div></div>
      </div>
      <div class="hh-chart-wrap">${this._buildDailyBarChart(daily, mod.color, ' min', 'hhSleepBar', null, v => this._formatMinutes(v))}</div>
      <div class="hh-section-label">Recent History</div>
      <div class="hh-recent-list">
        ${recent.map((d, idx) => `
          <div class="hh-recent-row hh-recent-row-clickable" data-recent-idx="${idx}">
            <div class="hh-recent-time">${new Date(d.date).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
            <div class="hh-recent-pill" style="border-color:${mod.color}55;color:${mod.color};">${this._formatMinutes(d.value)}</div>
          </div>
        `).join('')}
      </div>
    `;
    return {
      html,
      wireChart: (root) => {
        const barSvg = root.querySelector('#hhSleepBar');
        if (barSvg) this._attachBarChartCrosshair(barSvg, daily, mod.color, { formatFn: v => this._formatMinutes(v) });

        const sleepStatInfo = {
          average: { value: avg, ts: null },
          min: { value: min, ts: (daily.find(d => d.value === min) || {}).date },
          max: { value: max, ts: (daily.find(d => d.value === max) || {}).date },
        };
        root.querySelectorAll('[data-sleep-stat]').forEach(el => {
          el.addEventListener('click', () => {
            const key = el.dataset.sleepStat;
            const s = sleepStatInfo[key];
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            const valueText = this._formatMinutes(s.value);
            const detailText = key === 'average'
              ? `Across ${daily.length} nights, ranging from ${this._formatMinutes(min)} to ${this._formatMinutes(max)}.`
              : s.ts
                ? `Recorded on ${new Date(s.ts).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' })} — the ${daily.length}-night average is ${this._formatMinutes(avg)}.`
                : `Calculated from ${daily.length} nights.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on the ${label.toLowerCase()} time asleep of ${valueText}${s.ts ? ' on ' + new Date(s.ts).toLocaleDateString() : ''}. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, label, valueText, detailText, aiPrompt);
          });
        });

        root.querySelectorAll('.hh-recent-row-clickable').forEach(el => {
          const d = recent[parseInt(el.dataset.recentIdx, 10)];
          if (!d) return;
          el.addEventListener('click', () => {
            const dateStr = new Date(d.date).toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' });
            const valueText = this._formatMinutes(d.value);
            const diff = d.value - avg;
            const diffText = Math.abs(diff) < 1 ? 'right at' : `${diff > 0 ? 'above' : 'below'} your`;
            const detailText = `Time asleep on ${dateStr} — ${diffText} the ${daily.length}-night average of ${this._formatMinutes(avg)}.`;
            const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on ${valueText} of sleep recorded on ${dateStr}. No medical advice or diagnoses.`;
            this._openStatInfoPopup(mod.color, 'Time Asleep', valueText, detailText, aiPrompt);
          });
        });
      },
    };
  }

  // Vitals detail: one colored bar per underlying vital, green within its
  // normal range and orange outside it — mirrors Apple Health's Vitals
  // list rather than a single time series (it isn't one metric).
  async _buildVitalsDetail(mod) {
    const items = this._vitalsChecks();
    const v = this._computeVitals();
    const headline = v ? this._headlineHtml(v.typical ? '#30D158' : '#FF9F0A', mod.icon, v.label, v.subtitle) : '';
    const chart = `
      <div class="hh-section-label">STATUS</div>
      <div class="hh-chart-wrap">${this._miniVitalsDots(items)}</div>
      <div class="hh-section-label">VITALS</div>
      <div class="hh-chart-wrap">${this._buildColoredBarList(items)}</div>
    `;
    const wire = (root) => {
      root.querySelectorAll('.hh-vitals-bar-item').forEach(el => {
        const i = items[parseInt(el.dataset.vitalsIdx, 10)];
        if (!i) return;
        el.addEventListener('click', () => {
          const inRange = i.color === '#30D158';
          const detailText = `Typical range is ${i.low}\u2013${i.high}${i.unit} — this reading is ${inRange ? 'within' : 'outside'} it.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this vital sign reading: ${i.label} is ${i.display}, which is ${inRange ? 'within' : 'outside'} the typical range of ${i.low}\u2013${i.high}${i.unit}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(i.color, i.label, i.display, detailText, aiPrompt);
        });
      });
    };
    return { headline, chart, recent: '', wire };
  }

  // Blood Pressure detail: systolic + diastolic each get their own line
  // chart, plus a recent-readings list pairing the two.
  async _buildBloodPressureDetail(mod, days) {
    const sysMod = this._getMod('blood_pressure_systolic');
    const diaMod = this._getMod('blood_pressure_diastolic');
    const sysEntity = this._entityFor('blood_pressure_systolic');
    const diaEntity = this._entityFor('blood_pressure_diastolic');
    const bp = this._computeBloodPressure();
    const bpColor = bp ? horseBandColor(sysMod.bands, parseFloat(bp.display.split('/')[0]), mod.color) : mod.color;
    const headline = bp ? this._headlineHtml(bpColor, mod.icon, `${bp.display} ${bp.unit}`, 'Latest reading') : '';
    if (!sysEntity || !diaEntity) {
      return { headline, chart: `<div class="hh-loading">Blood pressure needs both systolic and diastolic sensors mapped in the visual editor.</div>`, recent: '' };
    }
    const [sysSeries, diaSeries] = await Promise.all([
      this._fetchHistorySeries(sysEntity, days, sysMod.plausibleRange),
      this._fetchHistorySeries(diaEntity, days, diaMod.plausibleRange),
    ]);
    if (!sysSeries.length && !diaSeries.length) {
      return { headline, chart: `<div class="hh-loading">No history recorded for this sensor yet.</div>`, recent: '' };
    }
    const sysBandFn = v => horseBandColor(sysMod.bands, v, '#FF2D55');
    const diaBandFn = v => horseBandColor(diaMod.bands, v, '#FF9F0A');
    const statSummary = series => {
      const vals = series.map(p => p[1]);
      return { latest: vals[vals.length - 1], avg: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), count: vals.length };
    };
    const statRow = (label, series, bandFn) => {
      if (!series.length) return '';
      const s = statSummary(series);
      return `<div class="hh-stat hh-stat-clickable" data-bp-stat="${label.toLowerCase()}"><div class="hh-stat-label">${label}</div><div class="hh-stat-value" style="color:${bandFn(s.latest)};">${Math.round(s.latest)}</div><div class="hh-range-label" style="margin-top:2px;">avg ${Math.round(s.avg)}</div></div>`;
    };
    const chart = `
      <div class="hh-section-label">SYSTOLIC</div>
      <div class="hh-chart-wrap">${this._largeChartSvg(sysSeries, '#FF2D55', 'hhLineSys', sysMod.bands)}</div>
      <div class="hh-section-label">DIASTOLIC</div>
      <div class="hh-chart-wrap">${this._largeChartSvg(diaSeries, '#FF9F0A', 'hhLineDia', diaMod.bands)}</div>
      <div class="hh-stat-row">
        ${statRow('Systolic', sysSeries, sysBandFn)}
        ${statRow('Diastolic', diaSeries, diaBandFn)}
      </div>
    `;
    const pairCount = Math.min(sysSeries.length, diaSeries.length, 8);
    const recentPairs = [];
    for (let i = 1; i <= pairCount; i++) {
      const sys = sysSeries[sysSeries.length - i];
      const dia = diaSeries[diaSeries.length - i];
      if (sys && dia) recentPairs.push({ ts: sys[0], sysVal: sys[1], diaVal: dia[1], display: `${Math.round(sys[1])}/${Math.round(dia[1])}`, color: sysBandFn(sys[1]) });
    }
    const recent = recentPairs.length ? `
      <div class="hh-section-label">RECENT HISTORY</div>
      <div class="hh-recent-list">
        ${recentPairs.map((r, idx) => `
          <div class="hh-recent-row hh-recent-row-clickable" data-recent-idx="${idx}">
            <div class="hh-recent-time">${this._formatRecentTimestamp(r.ts)}</div>
            <div class="hh-recent-pill" style="border-color:${r.color}55;color:${r.color};">${r.display}</div>
          </div>
        `).join('')}
      </div>
    ` : '';
    const wire = (root) => {
      const sysSvg = root.querySelector('#hhLineSys');
      if (sysSvg) this._attachLineChartCrosshair(sysSvg, this._resampleSeriesRange(sysSeries), '#FF2D55', { unitSuffix: ' mmHg', decimals: 0, bands: sysMod.bands });
      const diaSvg = root.querySelector('#hhLineDia');
      if (diaSvg) this._attachLineChartCrosshair(diaSvg, this._resampleSeriesRange(diaSeries), '#FF9F0A', { unitSuffix: ' mmHg', decimals: 0, bands: diaMod.bands });

      root.querySelectorAll('[data-bp-stat]').forEach(el => {
        el.addEventListener('click', () => {
          const isSys = el.dataset.bpStat === 'systolic';
          const series = isSys ? sysSeries : diaSeries;
          const color = isSys ? '#FF2D55' : '#FF9F0A';
          const s = statSummary(series);
          const valueText = `${Math.round(s.latest)} mmHg`;
          const detailText = `From ${s.count} reading${s.count === 1 ? '' : 's'} over ${this._rangeLabelFor(days).toLowerCase()}: average ${Math.round(s.avg)}, ranging from ${Math.round(s.min)} to ${Math.round(s.max)} mmHg.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this ${isSys ? 'systolic' : 'diastolic'} blood pressure reading: latest ${Math.round(s.latest)} mmHg, average ${Math.round(s.avg)}, min ${Math.round(s.min)}, max ${Math.round(s.max)} over ${this._rangeLabelFor(days).toLowerCase()}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(color, isSys ? 'Systolic' : 'Diastolic', valueText, detailText, aiPrompt);
        });
      });

      root.querySelectorAll('.hh-recent-row-clickable').forEach(el => {
        const r = recentPairs[parseInt(el.dataset.recentIdx, 10)];
        if (!r) return;
        el.addEventListener('click', () => {
          const sysSummary = statSummary(sysSeries);
          const diff = r.sysVal - sysSummary.avg;
          const diffText = Math.abs(diff) < 1 ? 'right at' : `${diff > 0 ? 'above' : 'below'} your`;
          const detailText = `Recorded ${this._formatRecentTimestamp(r.ts)} — systolic is ${diffText} the ${this._rangeLabelFor(days).toLowerCase()} average of ${Math.round(sysSummary.avg)} mmHg.`;
          const aiPrompt = `You are a health dashboard assistant. In one short, plain, non-alarmist sentence, comment on this blood pressure reading of ${r.display} mmHg (systolic/diastolic) recorded ${this._formatRecentTimestamp(r.ts)}. No medical advice or diagnoses.`;
          this._openStatInfoPopup(r.color, 'Blood Pressure', `${r.display} mmHg`, detailText, aiPrompt);
        });
      });
    };
    return { headline, chart, recent, wire };
  }

  // Buckets a series into ~targetCount time slots, keeping each bucket's
  // min AND max (not just an average) — used to draw independent
  // min-max range bars per slot, Apple Health's own style for a dense
  // sensor like heart rate. A connected line+fill chart makes any dip
  // toward a bucket's local low look like it's touching the chart floor
  // (reading as "dropped to zero" even at a legitimate value); separate
  // range bars have no shared baseline or connecting line to create
  // that illusion — each bar's bottom is just that bucket's own low.
  _resampleSeriesRange(points, targetCount = 40) {
    if (!points || !points.length) return [];
    if (points.length === 1) return [{ ts: points[0][0], min: points[0][1], max: points[0][1] }];
    const bucketSize = points.length / targetCount;
    const result = [];
    for (let i = 0; i < targetCount; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
      const slice = points.slice(start, end);
      if (!slice.length) continue;
      const vals = slice.map(p => p[1]);
      const avgTs = slice.reduce((s, p) => s + p[0], 0) / slice.length;
      result.push({ ts: avgTs, min: Math.min(...vals), max: Math.max(...vals) });
    }
    return result;
  }

  // `bands`, when passed, colors each bar by its own midpoint value
  // (green/amber/red) instead of one flat color.
  _largeChartSvg(rawPoints, color, id = '', bands = null) {
    const buckets = this._resampleSeriesRange(rawPoints);
    const allVals = buckets.flatMap(b => [b.min, b.max]);
    const lo = Math.min(...allVals), hi = Math.max(...allVals);
    const range = hi - lo || 1;
    const w = 320, h = 140, padX = 8, padY = 10;
    const n = buckets.length;
    const slot = n > 0 ? (w - padX * 2) / n : 0;
    const barW = Math.max(2.5, Math.min(7, slot * 0.55));
    const yAt = v => padY + (1 - (v - lo) / range) * (h - padY * 2);

    const bars = buckets.map((b, i) => {
      const x = padX + i * slot + slot / 2;
      const y1 = yAt(b.max), y2 = yAt(b.min);
      const barColor = bands ? horseBandColor(bands, (b.min + b.max) / 2, color) : color;
      const yTop = Math.min(y1, y2), h2 = Math.max(1.5, Math.abs(y2 - y1));
      return `<rect x="${(x - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h2.toFixed(1)}" rx="${(barW / 2).toFixed(1)}" fill="${barColor}"/>`;
    }).join('');

    return `
      <svg ${id ? `id="${id}"` : ''} viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;">
        ${bars}
      </svg>
    `;
  }

  // Connected line with a dot per day — for metrics that are naturally
  // once-a-day readings (Resting Heart Rate, HRV, Blood Oxygen,
  // Respiratory Rate, VO2 Max, Body/Basal Temperature, Blood Glucose),
  // matching Apple Health's own view for these. The range-bar chart
  // above suits Heart Rate's genuinely continuous, many-readings-a-day
  // data; bucketing an already-sparse one-reading-a-day metric into 40
  // slots would just spread single points across mostly-empty bars.
  // `dailyPoints` is the same {date, value} shape _dailyAverages returns.
  _dailyLineChartSvg(dailyPoints, color, id = '', bands = null) {
    if (!dailyPoints.length) return `<div class="hh-chart-empty">No data in this range</div>`;
    const vals = dailyPoints.map(d => d.value);
    const rawLo = Math.min(...vals), rawHi = Math.max(...vals);
    const vpad = (rawHi - rawLo) * 0.15 || 1;
    const lo = rawLo - vpad, hi = rawHi + vpad;
    const range = hi - lo || 1;
    const w = 320, h = 140, padX = 16, padY = 14;
    const n = dailyPoints.length;
    const xAt = i => n > 1 ? padX + (i / (n - 1)) * (w - padX * 2) : w / 2;
    const yAt = v => padY + (1 - (v - lo) / range) * (h - padY * 2);

    const path = dailyPoints.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(d.value).toFixed(1)}`).join(' ');
    const dots = dailyPoints.map((d, i) => {
      const dotColor = bands ? horseBandColor(bands, d.value, color) : color;
      return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.value).toFixed(1)}" r="4" fill="${dotColor}"/>`;
    }).join('');

    return `
      <svg ${id ? `id="${id}"` : ''} viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;">
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
    `;
  }

  // ── Report-style chart helpers (dark SVG bars/rings with a small
  // same visual language: dark SVG bars/rings with a small legend) ────

  // Groups raw [timestamp, value] history points into one point per
  // calendar day (mean of that day's readings) — used for the "Per day"
  // bar chart under a module's line chart, and for composite modules
  // (like Sleep Score) that have to be recomputed day-by-day rather than
  // read straight off a single entity's history.
  _dailyAverages(points) {
    const byDay = new Map();
    points.forEach(([ts, val]) => {
      const day = new Date(ts); day.setHours(0, 0, 0, 0);
      const key = day.getTime();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(val);
    });
    return Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([date, vals]) => ({ date, value: vals.reduce((a, b) => a + b, 0) / vals.length }));
  }

  // Last reading of each calendar day — better than an average for
  // cumulative/point-in-time sensors like sleep stage minutes, where the
  // day's final state is the meaningful daily total, not the mean of
  // every intermediate value the sensor passed through.
  _dailyLastValues(points) {
    const byDay = new Map();
    points.forEach(([ts, val]) => {
      const day = new Date(ts); day.setHours(0, 0, 0, 0);
      byDay.set(day.getTime(), val);
    });
    return Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]).map(([date, value]) => ({ date, value }));
  }

  // `bandColorFn`, when passed, is called with each day's own value and
  // returns that bar's color individually (green/amber/red) instead of
  // every bar sharing the flat module color.
  _buildDailyBarChart(dailyValues, color, unitSuffix = '', id = '', bandColorFn = null, axisFormatFn = null) {
    if (!dailyValues || !dailyValues.length) {
      return `<div class="hh-chart-empty">No data in this range</div>`;
    }
    const W = 320, H = 130;
    const pad = { top: 8, right: 8, bottom: 18, left: 26 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...dailyValues.map(d => d.value), 1);
    const n = dailyValues.length;
    const slot = plotW / n;
    const barW = Math.max(2, slot - (n > 20 ? 1 : 6));
    const baseY = pad.top + plotH;
    let bars = '';
    dailyValues.forEach((d, i) => {
      const x = pad.left + i * slot + (slot - barW) / 2;
      const h = (d.value / maxVal) * plotH;
      const barColor = bandColorFn ? bandColorFn(d.value) : color;
      bars += `<rect x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" fill="${barColor}" rx="2"/>`;
    });
    const fmtDate = ts => new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    const xLabels = `<text x="${pad.left}" y="${H - 5}" fill="${this._Wt('0.3')}" font-size="8" text-anchor="start">${fmtDate(dailyValues[0].date)}</text>
      <text x="${W - pad.right}" y="${H - 5}" fill="${this._Wt('0.3')}" font-size="8" text-anchor="end">${fmtDate(dailyValues[n - 1].date)}</text>`;
    const yLabelText = axisFormatFn ? axisFormatFn(maxVal) : `${Math.round(maxVal)}${unitSuffix}`;
    const yLabel = `<text x="${(pad.left - 4).toFixed(1)}" y="${(pad.top + 7).toFixed(1)}" fill="${this._Wt('0.35')}" font-size="7" text-anchor="end">${yLabelText}</text>`;
    return `<svg ${id ? `id="${id}"` : ''} viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;display:block;">${yLabel}${bars}${xLabels}</svg>`;
  }

  // ── Chart crosshair — press-and-drag to read values ─────────────────
  // A dotted vertical line plus
  // a value pill that follows the finger/pointer, snapping to (line
  // charts: interpolating between) the nearest real data points. Touch
  // and mouse are both wired — touchstart/move
  // begin and continue the drag, mouseup/touchend release it, and a tap
  // outside the plot area clears it.
  // Snaps to whichever bucket the finger/pointer is over and shows its
  // min–max range (like Apple's own "63–117 BPM" range display) rather
  // than interpolating a single value along a line — there's no line to
  // interpolate along anymore, each bucket is an independent bar.
  _attachLineChartCrosshair(svg, buckets, color, opts = {}) {
    if (!svg || !buckets || !buckets.length) return;
    const w = 320, h = 140, padX = 8, padY = 10;
    const n = buckets.length;
    const slot = (w - padX * 2) / n;
    const allVals = buckets.flatMap(b => [b.min, b.max]);
    const lo = Math.min(...allVals), hi = Math.max(...allVals);
    const range = hi - lo || 1;
    const yAt = v => padY + (1 - (v - lo) / range) * (h - padY * 2);
    const fmt = opts.formatFn ? opts.formatFn : (v => v.toFixed(opts.decimals || 0));
    const unitSuffix = opts.unitSuffix || '';
    const fmtTime = ts => {
      const d = new Date(ts);
      const sameDay = d.toDateString() === new Date().toDateString();
      const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      return sameDay ? time : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${time}`;
    };

    let crosshairGroup = null;
    const clientXtoSvgX = clientX => {
      const rect = svg.getBoundingClientRect();
      return (clientX - rect.left) * (w / rect.width);
    };

    const show = svgX => {
      const cx = Math.max(padX, Math.min(w - padX, svgX));
      const idx = Math.max(0, Math.min(n - 1, Math.floor((cx - padX) / slot)));
      const bucket = buckets[idx];
      const barCenterX = padX + idx * slot + slot / 2;
      const label = bucket.min === bucket.max ? `${fmt(bucket.max)}${unitSuffix}` : `${fmt(bucket.min)}\u2013${fmt(bucket.max)}${unitSuffix}`;
      const timeStr = fmtTime(bucket.ts);
      const pillColor = opts.bands ? horseBandColor(opts.bands, (bucket.min + bucket.max) / 2, color) : color;

      if (crosshairGroup) crosshairGroup.remove();
      crosshairGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const ns = 'http://www.w3.org/2000/svg';

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', barCenterX.toFixed(1)); line.setAttribute('y1', '4');
      line.setAttribute('x2', barCenterX.toFixed(1)); line.setAttribute('y2', String(h - padY));
      line.setAttribute('stroke', this._Wt('0.5'));
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '4 3');
      crosshairGroup.appendChild(line);

      const lblW = Math.max(70, 13 + label.length * 7), lblH = 40;
      const lblX = Math.max(padX + lblW / 2, Math.min(w - padX - lblW / 2, barCenterX));
      const lblY = 5;
      const bgRect = document.createElementNS(ns, 'rect');
      bgRect.setAttribute('x', (lblX - lblW / 2).toFixed(1));
      bgRect.setAttribute('y', lblY.toString());
      bgRect.setAttribute('width', lblW.toString());
      bgRect.setAttribute('height', lblH.toString());
      bgRect.setAttribute('rx', '6');
      bgRect.setAttribute('fill', 'rgba(0,0,0,0.80)');
      bgRect.setAttribute('stroke', pillColor);
      bgRect.setAttribute('stroke-width', '1.5');
      crosshairGroup.appendChild(bgRect);

      const valText = document.createElementNS(ns, 'text');
      valText.setAttribute('x', lblX.toFixed(1)); valText.setAttribute('y', (lblY + 17).toFixed(1));
      valText.setAttribute('fill', pillColor); valText.setAttribute('font-size', '14');
      valText.setAttribute('font-weight', '700'); valText.setAttribute('text-anchor', 'middle');
      valText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      valText.textContent = label;
      crosshairGroup.appendChild(valText);

      const timeText = document.createElementNS(ns, 'text');
      timeText.setAttribute('x', lblX.toFixed(1)); timeText.setAttribute('y', (lblY + 32).toFixed(1));
      timeText.setAttribute('fill', this._Wt('0.65')); timeText.setAttribute('font-size', '10');
      timeText.setAttribute('font-weight', '500'); timeText.setAttribute('text-anchor', 'middle');
      timeText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      timeText.textContent = timeStr;
      crosshairGroup.appendChild(timeText);

      svg.appendChild(crosshairGroup);
    };
    const clear = () => { if (crosshairGroup) { crosshairGroup.remove(); crosshairGroup = null; } };

    svg.style.cursor = 'crosshair';
    let isDragging = false;

    svg.addEventListener('touchstart', e => {
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX < padX || svgX > w - padX) return;
      isDragging = true; show(svgX);
    }, { passive: false });
    svg.addEventListener('touchmove', e => {
      if (!isDragging) return;
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX >= padX && svgX <= w - padX) show(svgX);
    }, { passive: false });
    svg.addEventListener('touchend', e => { e.stopPropagation(); isDragging = false; }, { passive: false });
    svg.addEventListener('touchcancel', () => { isDragging = false; });

    svg.addEventListener('mousedown', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) return;
      isDragging = true; show(svgX);
    });
    svg.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX >= padX && svgX <= w - padX) show(svgX);
    });
    svg.addEventListener('mouseup', e => {
      e.stopPropagation();
      if (!isDragging) return;
      isDragging = false;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) clear();
    });
    svg.addEventListener('mouseleave', () => { isDragging = false; });
    svg.addEventListener('click', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) clear();
    });
  }

  // Same idea for the daily bar chart, snapping to whichever bar the
  // finger/pointer is over rather than interpolating.
  // Matches _dailyLineChartSvg's exact point layout (points at the
  // extreme edges, not centered in slots like the bar chart) — snaps to
  // the nearest day's dot by x-distance rather than flooring into a
  // slot, so the crosshair always lands exactly on a plotted point.
  _attachDailyLineCrosshair(svg, dailyPoints, color, opts = {}) {
    if (!svg || !dailyPoints || !dailyPoints.length) return;
    const w = 320, h = 140, padX = 16, padY = 14;
    const n = dailyPoints.length;
    const xAt = i => n > 1 ? padX + (i / (n - 1)) * (w - padX * 2) : w / 2;
    const unitSuffix = opts.unitSuffix || '';
    const fmt = opts.formatFn ? opts.formatFn : (v => v.toFixed(opts.decimals || 0));
    const fmtDate = ts => new Date(ts).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' });

    let group = null;
    const clientXtoSvgX = clientX => {
      const rect = svg.getBoundingClientRect();
      return (clientX - rect.left) * (w / rect.width);
    };

    const show = svgX => {
      const cx = Math.max(padX, Math.min(w - padX, svgX));
      let idx = 0, best = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(xAt(i) - cx);
        if (d < best) { best = d; idx = i; }
      }
      const d = dailyPoints[idx];
      const px = xAt(idx);
      const label = `${fmt(d.value)}${unitSuffix}`;
      const dateStr = fmtDate(d.date);
      const pillColor = opts.bands ? horseBandColor(opts.bands, d.value, color) : color;

      if (group) group.remove();
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const ns = 'http://www.w3.org/2000/svg';

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', px.toFixed(1)); line.setAttribute('y1', '4');
      line.setAttribute('x2', px.toFixed(1)); line.setAttribute('y2', String(h - padY));
      line.setAttribute('stroke', this._Wt('0.5'));
      line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '4 3');
      group.appendChild(line);

      const lblW = 86, lblH = 40;
      const lblX = Math.max(padX + lblW / 2, Math.min(w - padX - lblW / 2, px));
      const bgRect = document.createElementNS(ns, 'rect');
      bgRect.setAttribute('x', (lblX - lblW / 2).toFixed(1)); bgRect.setAttribute('y', '5');
      bgRect.setAttribute('width', lblW.toString()); bgRect.setAttribute('height', lblH.toString());
      bgRect.setAttribute('rx', '6'); bgRect.setAttribute('fill', 'rgba(0,0,0,0.80)');
      bgRect.setAttribute('stroke', pillColor); bgRect.setAttribute('stroke-width', '1.5');
      group.appendChild(bgRect);

      const valText = document.createElementNS(ns, 'text');
      valText.setAttribute('x', lblX.toFixed(1)); valText.setAttribute('y', '22');
      valText.setAttribute('fill', pillColor); valText.setAttribute('font-size', '14');
      valText.setAttribute('font-weight', '700'); valText.setAttribute('text-anchor', 'middle');
      valText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      valText.textContent = label;
      group.appendChild(valText);

      const dateText = document.createElementNS(ns, 'text');
      dateText.setAttribute('x', lblX.toFixed(1)); dateText.setAttribute('y', '37');
      dateText.setAttribute('fill', this._Wt('0.65')); dateText.setAttribute('font-size', '10');
      dateText.setAttribute('font-weight', '500'); dateText.setAttribute('text-anchor', 'middle');
      dateText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      dateText.textContent = dateStr;
      group.appendChild(dateText);

      svg.appendChild(group);
    };
    const clear = () => { if (group) { group.remove(); group = null; } };

    svg.style.cursor = 'crosshair';
    let isDragging = false;

    svg.addEventListener('touchstart', e => {
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX < padX || svgX > w - padX) return;
      isDragging = true; show(svgX);
    }, { passive: false });
    svg.addEventListener('touchmove', e => {
      if (!isDragging) return;
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX >= padX && svgX <= w - padX) show(svgX);
    }, { passive: false });
    svg.addEventListener('touchend', e => { e.stopPropagation(); isDragging = false; }, { passive: false });
    svg.addEventListener('touchcancel', () => { isDragging = false; });

    svg.addEventListener('mousedown', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) return;
      isDragging = true; show(svgX);
    });
    svg.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX >= padX && svgX <= w - padX) show(svgX);
    });
    svg.addEventListener('mouseup', e => {
      e.stopPropagation();
      if (!isDragging) return;
      isDragging = false;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) clear();
    });
    svg.addEventListener('mouseleave', () => { isDragging = false; });
    svg.addEventListener('click', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < padX || svgX > w - padX) clear();
    });
  }

  _attachBarChartCrosshair(svg, dailyValues, color, opts = {}) {
    if (!svg || !dailyValues || !dailyValues.length) return;
    const W = 320, H = 130;
    const pad = { top: 8, right: 8, bottom: 18, left: 26 };
    const plotW = W - pad.left - pad.right;
    const n = dailyValues.length;
    const slot = plotW / n;
    const unitSuffix = opts.unitSuffix || '';
    const fmtDate = ts => new Date(ts).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' });

    let group = null;
    const clientXtoSvgX = clientX => {
      const rect = svg.getBoundingClientRect();
      return (clientX - rect.left) * (W / rect.width);
    };

    const show = svgX => {
      const cx = Math.max(pad.left, Math.min(W - pad.right, svgX));
      const idx = Math.max(0, Math.min(n - 1, Math.floor((cx - pad.left) / slot)));
      const d = dailyValues[idx];
      const barCenterX = pad.left + idx * slot + slot / 2;
      const label = opts.formatFn ? opts.formatFn(d.value) : `${Math.round(d.value)}${unitSuffix}`;
      const dateStr = fmtDate(d.date);
      const pillColor = opts.bandColorFn ? opts.bandColorFn(d.value) : color;

      if (group) group.remove();
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const ns = 'http://www.w3.org/2000/svg';

      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', barCenterX.toFixed(1)); line.setAttribute('y1', String(pad.top));
      line.setAttribute('x2', barCenterX.toFixed(1)); line.setAttribute('y2', String(H - pad.bottom));
      line.setAttribute('stroke', this._Wt('0.5'));
      line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '3 3');
      group.appendChild(line);

      const lblW = 86, lblH = 34;
      const lblX = Math.max(pad.left + lblW / 2, Math.min(W - pad.right - lblW / 2, barCenterX));
      const bgRect = document.createElementNS(ns, 'rect');
      bgRect.setAttribute('x', (lblX - lblW / 2).toFixed(1)); bgRect.setAttribute('y', '2');
      bgRect.setAttribute('width', lblW.toString()); bgRect.setAttribute('height', lblH.toString());
      bgRect.setAttribute('rx', '6'); bgRect.setAttribute('fill', 'rgba(0,0,0,0.80)');
      bgRect.setAttribute('stroke', pillColor); bgRect.setAttribute('stroke-width', '1.5');
      group.appendChild(bgRect);

      const valText = document.createElementNS(ns, 'text');
      valText.setAttribute('x', lblX.toFixed(1)); valText.setAttribute('y', '16');
      valText.setAttribute('fill', pillColor); valText.setAttribute('font-size', '13');
      valText.setAttribute('font-weight', '700'); valText.setAttribute('text-anchor', 'middle');
      valText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      valText.textContent = label;
      group.appendChild(valText);

      const dateText = document.createElementNS(ns, 'text');
      dateText.setAttribute('x', lblX.toFixed(1)); dateText.setAttribute('y', '29');
      dateText.setAttribute('fill', this._Wt('0.65')); dateText.setAttribute('font-size', '9');
      dateText.setAttribute('font-weight', '500'); dateText.setAttribute('text-anchor', 'middle');
      dateText.setAttribute('font-family', "-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif");
      dateText.textContent = dateStr;
      group.appendChild(dateText);

      svg.appendChild(group);
    };
    const clear = () => { if (group) { group.remove(); group = null; } };

    svg.style.cursor = 'crosshair';
    let isDragging = false;

    svg.addEventListener('touchstart', e => {
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX < pad.left || svgX > W - pad.right) return;
      isDragging = true; show(svgX);
    }, { passive: false });
    svg.addEventListener('touchmove', e => {
      if (!isDragging) return;
      e.stopPropagation(); e.preventDefault();
      const svgX = clientXtoSvgX(e.touches[0].clientX);
      if (svgX >= pad.left && svgX <= W - pad.right) show(svgX);
    }, { passive: false });
    svg.addEventListener('touchend', e => { e.stopPropagation(); isDragging = false; }, { passive: false });
    svg.addEventListener('touchcancel', () => { isDragging = false; });

    svg.addEventListener('mousedown', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < pad.left || svgX > W - pad.right) return;
      isDragging = true; show(svgX);
    });
    svg.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX >= pad.left && svgX <= W - pad.right) show(svgX);
    });
    svg.addEventListener('mouseup', e => {
      e.stopPropagation();
      if (!isDragging) return;
      isDragging = false;
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < pad.left || svgX > W - pad.right) clear();
    });
    svg.addEventListener('mouseleave', () => { isDragging = false; });
    svg.addEventListener('click', e => {
      e.stopPropagation();
      const svgX = clientXtoSvgX(e.clientX);
      if (svgX < pad.left || svgX > W - pad.right) clear();
    });
  }

  // Ring/donut breakdown for a small number of categories — items:
  // [{ label, value, color }]. Used for Sleep Score's REM/Deep/Core/Awake
  // split.
  _buildDonutChart(items, { centerLabel = null, centerSublabel = null, size = 120, thickness = 16 } = {}) {
    const usable = (items || []).filter(i => i.value > 0);
    if (!usable.length) return `<div class="hh-chart-empty">No data</div>`;
    const total = usable.reduce((s, i) => s + i.value, 0);
    const r = (size - thickness) / 2;
    const cx = size / 2, cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    const segs = usable.map(i => {
      const dash = (i.value / total) * circumference;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += dash;
      return seg;
    }).join('');
    const ring = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg);display:block;">${segs}</svg>`;
    const centerText = centerLabel !== null ? `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="font-size:18px;font-weight:700;color:var(--hh-text-primary);line-height:1.1;">${centerLabel}</div>
        ${centerSublabel ? `<div style="font-size:9px;color:var(--hh-text-secondary);margin-top:1px;text-align:center;">${centerSublabel}</div>` : ''}
      </div>` : '';
    const legend = usable.map((i, idx) => {
      const pct = Math.round((i.value / total) * 100);
      return `<div class="hh-donut-legend-item" data-donut-legend-idx="${idx}" style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;">
        <span style="width:10px;height:10px;border-radius:2px;background:${i.color};flex-shrink:0;"></span>
        <span style="flex:1;font-size:12px;font-weight:500;color:var(--hh-text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i.label}</span>
        <span style="font-size:12px;font-weight:700;color:var(--hh-text-primary);flex-shrink:0;">${pct}%</span>
      </div>`;
    }).join('');
    return `<div style="display:flex;gap:18px;align-items:center;">
      <div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;">${ring}${centerText}</div>
      <div style="flex:1;min-width:0;">${legend}</div>
    </div>`;
  }

  // A vertical list of labeled bars, each its own color — used for the
  // Vitals detail view (one bar per underlying vital, green if within its
  // normal range, red if not).
  _buildColoredBarList(items) {
    if (!items.length) return `<div class="hh-chart-empty">No data</div>`;
    const maxVal = Math.max(...items.map(i => i.value), 1);
    return items.map((i, idx) => `
      <div class="hh-vitals-bar-item" data-vitals-idx="${idx}" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
        <div style="width:86px;flex-shrink:0;font-size:11px;color:var(--hh-text-secondary);text-align:right;">${this._escape(i.label)}</div>
        <div style="flex:1;background:rgba(128,128,128,0.15);border-radius:4px;height:14px;overflow:hidden;">
          <div style="width:${Math.max(2, (i.value / maxVal) * 100)}%;height:100%;background:${i.color};border-radius:4px;"></div>
        </div>
        <div style="width:56px;flex-shrink:0;font-size:11px;color:var(--hh-text-primary);">${i.display}</div>
      </div>`).join('');
  }

  // ── Apple Health-style building blocks ──────────────────────────────
  // Ported from the actual Health app screens: a segmented weighted ring
  // with a fraction legend (Sleep Score), 2-up preview tiles that push
  // into another module's detail popup, and a dot-on-a-track mini chart
  // (Vitals). Used by _buildSleepScoreDetail and _buildVitalsDetail.

  // One donut arc, `startDeg`→`endDeg` (0deg = 3 o'clock, clockwise),
  // with a small gap on each side so adjacent segments read as distinct
  // wedges rather than one continuous ring.
  _ringArcSvgSegment(cx, cy, r, thickness, startDeg, endDeg, color) {
    const gap = 1.5;
    const s = startDeg + gap, e = endDeg - gap;
    if (e <= s) return '';
    const rad = d => (d * Math.PI) / 180;
    const outer = r, inner = r - thickness;
    const large = (e - s) % 360 > 180 ? 1 : 0;
    const p1 = [cx + outer * Math.cos(rad(s)), cy + outer * Math.sin(rad(s))];
    const p2 = [cx + outer * Math.cos(rad(e)), cy + outer * Math.sin(rad(e))];
    const p3 = [cx + inner * Math.cos(rad(e)), cy + inner * Math.sin(rad(e))];
    const p4 = [cx + inner * Math.cos(rad(s)), cy + inner * Math.sin(rad(s))];
    const d = `M${p1[0].toFixed(2)},${p1[1].toFixed(2)} A${outer},${outer} 0 ${large} 1 ${p2[0].toFixed(2)},${p2[1].toFixed(2)} L${p3[0].toFixed(2)},${p3[1].toFixed(2)} A${inner},${inner} 0 ${large} 0 ${p4[0].toFixed(2)},${p4[1].toFixed(2)} Z`;
    return `<path d="${d}" fill="${color}"/>`;
  }

  // Legend (colored dot + label + "earned/max") on the left, a ring
  // sized by each component's *max* share with the total score centered
  // inside, on the right — same layout as the real Sleep Score screen's
  // "Duration 38/50 · Bedtime 30/30 · Interruptions 0/20" breakdown.
  // `opts.legendFormat: 'duration'` shows "Label: 53m" instead of
  // "Label: score/max" — used for Time Asleep's stage ring, where the
  // components are actual durations rather than a weighted score.
  // `opts.centerLabel`/`opts.centerFontSize` override the big centered
  // number for the same reason (a duration string needs a smaller font
  // than a two-digit score to fit).
  _buildSegmentedRingCard(components, totalPoints, opts = {}) {
    const totalMax = components.reduce((s, c) => s + c.max, 0) || 1;
    const size = 92, r = 40, thickness = 15, cx = size / 2, cy = size / 2;
    let angle = -90;
    const arcs = components.map(c => {
      const deg = (c.max / totalMax) * 360;
      const seg = this._ringArcSvgSegment(cx, cy, r, thickness, angle, angle + deg, c.color);
      angle += deg;
      return seg;
    }).join('');
    const legend = components.map((c, idx) => {
      const text = opts.legendFormat === 'duration'
        ? `${this._escape(c.label)}: ${this._formatMinutes(c.score)}`
        : `${this._escape(c.label)}: ${c.score}/${c.max}`;
      return `
      <div class="hh-ring-legend-item" data-ring-legend-idx="${idx}" style="display:flex;align-items:center;gap:8px;margin-bottom:7px;cursor:pointer;">
        <span style="width:9px;height:9px;border-radius:50%;background:${c.color};flex-shrink:0;"></span>
        <span style="font-size:13px;color:var(--hh-text-primary);">${text}</span>
      </div>`;
    }).join('');
    const centerLabel = opts.centerLabel != null ? opts.centerLabel : totalPoints;
    const centerFontSize = opts.centerFontSize || 27;
    return `
      <div style="display:flex;align-items:center;gap:16px;margin:4px 0 4px;">
        <div style="flex:1;min-width:0;">${legend}</div>
        <div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;">
          <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:${centerFontSize}px;font-weight:800;color:var(--hh-text-primary);text-align:center;">${centerLabel}</div>
        </div>
      </div>
    `;
  }

  // Four labeled rows (Awake/REM/Core/Deep), each a single bar sized
  // proportionally to that stage's own total duration — the "graph" for
  // Time Asleep's stage breakdown. This is deliberately a totals
  // comparison, not the actual multi-row timeline Apple Health draws:
  // the underlying sensors report one number per stage for the whole
  // night, not when each stage occurred, so there's no sequence to plot.
  _buildStageRowsChart(items) {
    const usable = items.filter(i => i.value > 0);
    if (!usable.length) return `<div class="hh-chart-empty">No data</div>`;
    const maxVal = Math.max(...usable.map(i => i.value), 1);
    return `<div style="display:flex;flex-direction:column;gap:12px;">${usable.map((i, idx) => `
      <div class="hh-stage-row-item" data-stage-row-idx="${idx}" style="cursor:pointer;">
        <div style="font-size:11px;font-weight:600;color:var(--hh-text-secondary);margin-bottom:5px;">${this._escape(i.label)}</div>
        <div style="background:rgba(128,128,128,0.12);border-radius:6px;height:24px;overflow:hidden;">
          <div style="width:${Math.max(4, (i.value / maxVal) * 100)}%;height:100%;background:${i.color};border-radius:6px;"></div>
        </div>
      </div>
    `).join('')}</div>`;
  }

  // A row of 2-up preview cards — title + chevron, a small visual, a
  // caption underneath — each one pushing into another module's own
  // detail popup on tap (same as Apple Health's Sleep/Vitals tiles under
  // the Sleep Score ring). Registers click targets in
  // this._pendingTileWiring for the popup's wire() step to hook up.
  _buildTileRow(tiles) {
    const startIdx = this._pendingTileWiring.length;
    tiles.forEach(t => this._pendingTileWiring.push(t));
    return `
      <div class="hh-tile-row">
        ${tiles.map((t, i) => `
          <div class="hh-tile" data-tile-index="${startIdx + i}">
            <div class="hh-tile-header"><span>${this._escape(t.title)}</span>
              <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:var(--hh-text-tertiary);"><path d="M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"/></svg>
            </div>
            <div class="hh-tile-visual">${t.visual}</div>
            <div class="hh-tile-caption" style="color:${t.color || 'var(--hh-text-primary)'};">${this._escape(t.caption)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Proportional horizontal stage bar for the Sleep preview tile — a
  // segmented strip (not a real minute-by-minute timeline, since the
  // underlying sensors only report nightly totals per stage, not a
  // stage-change history to reconstruct one from).
  _miniStageBar(donutItems) {
    const usable = donutItems.filter(i => i.value > 0);
    if (!usable.length) return `<div class="hh-chart-empty" style="padding:8px 0;">No data</div>`;
    const segs = usable.map(i => `<div style="flex:${i.value};background:${i.color};height:100%;"></div>`).join('');
    return `<div style="display:flex;height:26px;border-radius:6px;overflow:hidden;background:rgba(128,128,128,0.12);">${segs}</div>`;
  }

  // Dot-per-vital on a plain track for the Vitals preview tile — evenly
  // spaced (this is a status glance, not a value axis), colored by each
  // vital's own band.
  _miniVitalsDots(items) {
    if (!items.length) return `<div class="hh-chart-empty" style="padding:8px 0;">No data</div>`;
    const n = items.length;
    const dots = items.map((it, i) => {
      const x = n > 1 ? 8 + i * ((100 - 16) / (n - 1)) : 50;
      return `<circle cx="${x.toFixed(1)}" cy="14" r="4.5" fill="${it.color}"/>`;
    }).join('');
    return `<svg viewBox="0 0 100 28" style="width:100%;height:28px;"><line x1="4" y1="14" x2="96" y2="14" stroke="rgba(128,128,128,0.3)" stroke-width="1"/>${dots}</svg>`;
  }

  // Minutes since local midnight, with early-morning times (00:00–11:59)
  // pushed a day forward — otherwise a 00:30 bedtime sorts as "earlier"
  // than 23:45 the night before instead of later, breaking the rolling
  // average and the "how close to usual" comparison.
  _minutesOfDay(ts) {
    const d = new Date(ts);
    let m = d.getHours() * 60 + d.getMinutes();
    if (d.getHours() < 12) m += 1440;
    return m;
  }

  _formatTimeOfDay(minutesOfDay) {
    const m = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }

  // First recorded timestamp of each calendar day for a history series —
  // the closest proxy available for "went to bed" without a dedicated
  // bedtime sensor: the Companion App/Health integration's first posted
  // reading of the night is usually close to when sleep tracking began.
  _dailyFirstTimestamps(points) {
    const byDay = new Map();
    points.forEach(([ts]) => {
      const day = new Date(ts); day.setHours(0, 0, 0, 0);
      const key = day.getTime();
      if (!byDay.has(key) || ts < byDay.get(key)) byDay.set(key, ts);
    });
    return Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]).map(([date, ts]) => ({ date, ts }));
  }

  // The richer, weighted Sleep Score breakdown shown in its detail
  // popup — Duration/Bedtime/Interruptions scored separately, matching
  // what the segmented ring displays. This is deliberately separate from
  // the simple _computeSleepScore() used by the card face, PDF, and AI
  // summary: those need a fast synchronous number, while this needs a
  // history fetch (for the bedtime-consistency component) and is only
  // ever called from the detail popup, which is already async.
  async _computeSleepScoreRich() {
    const dur = this._numFor('sleep_duration');
    if (dur == null) return null;
    const rem = this._numFor('rem_sleep') || 0;
    const deep = this._numFor('deep_sleep') || 0;
    const awake = this._numFor('awake') || 0;

    const durationScore = Math.round(Math.min(50, (dur / 480) * 50));
    // Awake minutes is the closest proxy available for "interruptions" —
    // the underlying sensors report total time awake, not a count of
    // distinct wake events, so this scores against minutes rather than
    // an event count Apple's own version uses.
    const interruptionsScore = Math.round(Math.max(0, Math.min(20, 20 - (Math.max(0, awake - 10) / 50) * 20)));

    let bedtimeScore = 30, avgBedtimeLabel = null, lastBedtimeLabel = null, bedtimeDiffMin = null, bedtimeDaily = [];
    try {
      const durEntity = this._entityFor('sleep_duration');
      if (durEntity) {
        const series = await this._fetchHistorySeries(durEntity, 8);
        const days = this._dailyFirstTimestamps(series);
        bedtimeDaily = days.map(d => ({ date: d.date, value: this._minutesOfDay(d.ts) }));
        if (days.length >= 2) {
          const priorDays = days.slice(0, -1);
          const avgMinutes = priorDays.reduce((sum, d) => sum + this._minutesOfDay(d.ts), 0) / priorDays.length;
          const lastDay = days[days.length - 1];
          const lastMinutes = this._minutesOfDay(lastDay.ts);
          bedtimeDiffMin = Math.round(Math.abs(lastMinutes - avgMinutes));
          bedtimeScore = Math.round(Math.max(0, Math.min(30, 30 - (Math.max(0, bedtimeDiffMin - 15) / 90) * 30)));
          avgBedtimeLabel = this._formatTimeOfDay(avgMinutes);
          lastBedtimeLabel = this._formatTimeOfDay(lastMinutes);
        }
      }
    } catch (_) { /* bedtime consistency is a bonus component — falls back to full credit without history */ }

    const points = durationScore + bedtimeScore + interruptionsScore;
    let label = 'Low';
    if (points >= 85) label = 'Excellent';
    else if (points >= 70) label = 'Good';
    else if (points >= 50) label = 'OK';

    return {
      points, label,
      components: [
        { key: 'duration', label: 'Duration', score: durationScore, max: 50, color: '#5E5CE6' },
        { key: 'bedtime', label: 'Bedtime', score: bedtimeScore, max: 30, color: '#64D2FF' },
        { key: 'interruptions', label: 'Interruptions', score: interruptionsScore, max: 20, color: '#FF6961' },
      ],
      avgBedtimeLabel, lastBedtimeLabel, bedtimeDiffMin, bedtimeDaily,
    };
  }

  _closeDetailPopup() {
    if (this._detailPopupOverlay) { this._detailPopupOverlay.remove(); this._detailPopupOverlay = null; }
  }

  // ── AI insights hub ──────────────────────────────────────────────────
  _aiSectionHtml() {
    return `
      <div class="ai-card">
        <div class="ai-card-header">
          <div class="ai-card-title">
            <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:rgba(255,55,95,0.9);"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>
            Health Insight
          </div>
        </div>
        <div class="ai-card-body">${this._escape(this._aiInsight || 'Getting an AI summary of your recent metrics…')}</div>
        ${this._aiInsightFailed ? `<button class="ai-retry-btn" id="aiInsightRetryBtn">Try again</button>` : ''}
      </div>
    `;
  }

  async _fetchAiSummary(forceRefresh) {
    if (!this._config.ai_features_enabled || !this._hass) return;
    if (this._aiLoading) return;
    this._aiLoading = true;
    this._render();
    this._renderAiInsightsPopupBody();
    try {
      const modules = this._enabledModules().filter(m => !m.composite || m.key === 'vitals' || m.key === 'sleep_score');
      const lines = modules.map(m => {
        if (m.key === 'sleep_score') { const s = this._computeSleepScore(); return s ? `Sleep Score: ${s.label} (${s.points})` : null; }
        if (m.key === 'vitals') { const v = this._computeVitals(); return v ? `Vitals: ${v.label} — ${v.subtitle}` : null; }
        const n = this._numFor(m.key);
        if (n == null) return null;
        const display = m.format === 'duration_min' ? this._formatMinutes(n) : n;
        return `${m.label}: ${display}${(m.unit && m.format !== 'duration_min') ? ' ' + m.unit : ''}`;
      }).filter(Boolean);

      const prompt = `You are a health dashboard assistant. Given today's readings below, write one short, plain, non-alarmist sentence (max 30 words) highlighting the most notable thing worth knowing — or say things look steady if nothing stands out. Do not give medical advice or diagnoses.\n\n${lines.join('\n')}`;

      const result = await this._hass.callWS({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent || undefined,
      });
      const text = horseExtractConversationSpeech(result);
      this._aiInsight = text || 'No insight available right now.';
      this._aiInsightFailed = !text;
    } catch (e) {
      this._aiInsight = 'Could not reach the AI assistant — check the conversation agent in the visual editor.';
      this._aiInsightFailed = true;
    } finally {
      this._aiLoading = false;
      this._render();
      this._renderAiInsightsPopupBody();
    }
  }

  // Shared by the recap and the ask-a-question popup — a plain-text
  // summary line per enabled module (average and range over the given
  // period, not just today's single value like the Health Insight card
  // above uses), plus Sleep Score and Vitals. Fetching every module's
  // history sequentially rather than in parallel is deliberate: this
  // isn't on any interactive path (no popup open is waiting on it), so
  // there's no reason to burst a dozen simultaneous history queries at
  // Home Assistant when one at a time is fine.
  async _gatherRangeContextLines(periodDays) {
    const lines = [];
    const modules = this._enabledModules().filter(m => !m.composite);
    for (const mod of modules) {
      try {
        const history = await this._moduleHistorySeries(mod, periodDays);
        const series = history.primary || [];
        if (!series.length) continue;
        const vals = mod.resetsDaily ? this._dailyLastValues(series).map(d => d.value) : series.map(p => p[1]);
        if (!vals.length) continue;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const min = Math.min(...vals), max = Math.max(...vals);
        const fmt = v => mod.format === 'duration_min' ? this._formatMinutes(v) : v.toFixed(mod.decimals || 0);
        const unit = (mod.unit && mod.format !== 'duration_min') ? ' ' + mod.unit : '';
        lines.push(`${mod.label}: avg ${fmt(avg)}${unit}, range ${fmt(min)}-${fmt(max)}${unit}`);
      } catch (_) { /* one module's history failing shouldn't drop the rest */ }
    }
    try {
      const scores = await this._sleepScoreDailySeries(periodDays);
      if (scores.length) {
        const vals = scores.map(s => s.value);
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        lines.push(`Sleep Score: avg ${avg} points over ${scores.length} night${scores.length === 1 ? '' : 's'}`);
      }
    } catch (_) { /* same — a bonus line, not required */ }
    const v = this._computeVitals();
    if (v) lines.push(`Vitals (current): ${v.label} — ${v.subtitle}`);
    return lines;
  }

  _recapSectionHtml() {
    const cached = this._recapCache[this._recapPeriod];
    const periodLabel = this._recapPeriod === 'week' ? 'Week' : 'Month';
    return `
      <div class="ai-card recap-card">
        <div class="ai-card-header">
          <div class="ai-card-title">
            <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:rgba(255,55,95,0.9);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
            ${periodLabel}ly Recap
          </div>
        </div>
        <div class="recap-period-pills">
          <button class="recap-period-pill ${this._recapPeriod === 'week' ? 'selected' : ''}" data-period="week">Week</button>
          <button class="recap-period-pill ${this._recapPeriod === 'month' ? 'selected' : ''}" data-period="month">Month</button>
        </div>
        <div class="ai-card-body">${this._escape(cached?.text || `Getting your ${periodLabel.toLowerCase()}ly recap…`)}</div>
        ${cached?.failed ? `<button class="ai-retry-btn" id="recapRetryBtn">Try again</button>` : ''}
      </div>
    `;
  }

  async _fetchRecap(period, forceRefresh) {
    if (!this._config.ai_features_enabled || !this._hass) return;
    if (this._recapLoading) return;
    if (!forceRefresh && this._recapCache[period]) return;
    this._recapLoading = true;
    this._renderAiInsightsPopupBody();
    try {
      const periodDays = period === 'month' ? 30 : 7;
      const periodLabel = period === 'month' ? 'monthly' : 'weekly';
      // Capped at 8 lines and asking for a shorter reply — the original
      // prompt could run to a dozen-plus module lines once every enabled
      // module was included, and a longer, more complex request is more
      // likely to hit a length or complexity limit on some conversation
      // agents (which is what silently tripped the "no recap" fallback).
      const lines = (await this._gatherRangeContextLines(periodDays)).slice(0, 8);
      const prompt = lines.length
        ? `You are a health dashboard assistant. Write a short, friendly ${periodLabel} recap (3-4 sentences) from this data:\n${lines.join('\n')}\n\nMention 2-3 specific metrics with their numbers. Conversational, like a quick check-in. No medical advice or diagnoses.`
        : null;
      if (!prompt) {
        this._recapCache[period] = { text: 'Not enough history yet to put together a recap.', fetchedAt: Date.now(), failed: false };
      } else {
        const result = await this._hass.callWS({
          type: 'conversation/process',
          text: prompt,
          agent_id: this._config.ai_conversation_agent || undefined,
        });
        const text = horseExtractConversationSpeech(result);
        this._recapCache[period] = text
          ? { text, fetchedAt: Date.now(), failed: false }
          : { text: 'No recap available right now.', fetchedAt: Date.now(), failed: true };
      }
    } catch (e) {
      this._recapCache[period] = { text: 'Could not reach the AI assistant — check the conversation agent in the visual editor.', fetchedAt: Date.now(), failed: true };
    } finally {
      this._recapLoading = false;
      this._renderAiInsightsPopupBody();
    }
  }

  // Free-text Q&A grounded in the same range-summary data the recap
  // uses. Rendered as a document.body overlay (like the export and stat
  // popups) rather than inline in the card — _render() runs on almost
  // every hass tick, and a plain <input> inside that re-rendered HTML
  // would lose its value and focus on every tick, making it unusable
  // for actually typing a question.
  _openAskQuestionPopup() {
    this._closeAskPopup();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10080;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:24px;';
    overlay.innerHTML = `
      <style>${this._popupCss()}</style>
      <div class="hh-ask-card">
        <div class="hh-stat-info-header">
          <div class="hh-stat-info-title">Ask About Your Health</div>
          <button class="hh-popup-close" id="hhAskClose">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <textarea id="hhAskInput" class="hh-ask-input" rows="2" placeholder="e.g. How has my sleep been this week?"></textarea>
        <button class="hh-ask-submit-btn" id="hhAskSubmit">Ask</button>
        <div id="hhAskAnswer"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._askPopupOverlay = overlay;
    overlay.querySelector('#hhAskClose').addEventListener('click', () => this._closeAskPopup());
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeAskPopup(); });
    const submit = () => this._submitAskQuestion(overlay);
    overlay.querySelector('#hhAskSubmit').addEventListener('click', submit);
    const input = overlay.querySelector('#hhAskInput');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    input.focus();
  }

  _closeAskPopup() {
    if (this._askPopupOverlay) { this._askPopupOverlay.remove(); this._askPopupOverlay = null; }
  }

  async _submitAskQuestion(overlay) {
    const input = overlay.querySelector('#hhAskInput');
    const answerEl = overlay.querySelector('#hhAskAnswer');
    const submitBtn = overlay.querySelector('#hhAskSubmit');
    const question = (input.value || '').trim();
    if (!question) return;
    submitBtn.disabled = true;
    answerEl.innerHTML = `<p class="hh-insight-text" style="margin-top:12px;">Thinking…</p>`;
    try {
      const lines = await this._gatherRangeContextLines(this._config.history_days || 7);
      const prompt = `You are a health dashboard assistant. The user has this recent health data:\n${lines.join('\n')}\n\nAnswer their question using only this data where it's relevant. If the data doesn't contain what's needed to answer, say so honestly rather than guessing. Never give medical advice, diagnoses, or medication guidance — for genuine medical questions, suggest they talk to a healthcare professional instead. Keep the answer conversational and under 5 sentences.\n\nQuestion: "${this._escape(question).replace(/"/g, "'")}"`;
      const result = await this._hass.callWS({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent || undefined,
      });
      const text = horseExtractConversationSpeech(result) || 'No answer available right now.';
      answerEl.innerHTML = `<p class="hh-insight-text" style="margin-top:12px;margin-bottom:0;">${this._escape(text)}</p>`;
    } catch (e) {
      answerEl.innerHTML = `<p class="hh-insight-text" style="margin-top:12px;margin-bottom:0;">Could not reach the AI assistant — check the conversation agent in the visual editor.</p>`;
    } finally {
      submitBtn.disabled = false;
    }
  }

  // ── Export: CSV / JSON / PDF ─────────────────────────────────────────
  // Export sheet: a title + hint, a row of range presets
  // (Today/1d/3d/7d/30d/90d), an Include section (AI Opinion / Raw Data),
  // then CSV/JSON/PDF as a 3-up row of format buttons. Every choice is
  // read fresh when a format button is tapped — nothing is exported
  // until then.
  _openModuleExportPopup(mod, initial = {}) {
    this._closeExportPopup();
    const presets = [
      { key: 'today', label: 'Today' },
      { key: 1, label: '1d' },
      { key: 3, label: '3d' },
      { key: 7, label: '7d' },
      { key: 30, label: '30d' },
      { key: 90, label: '90d' },
    ];
    const configured = this._config.history_days || 7;
    let selectedRange = presets.some(p => p.key === configured) ? configured : 7;
    const aiAvailable = !!this._config.ai_features_enabled;
    const initialOpinion = initial.includeOpinion !== false; // default checked
    const initialRawData = initial.includeRawData !== false; // default checked

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10055;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div class="hh-popup-sheet" style="max-height:85vh;">
        <div class="hh-popup-header">
          <div>
            <div class="hh-popup-title">Export ${this._escape(mod.label)}</div>
            <div class="hh-popup-subtitle">Choose a range and what to include, then a format.</div>
          </div>
          <button class="hh-popup-close" id="hhExportClose">
            <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="hh-popup-body">

          <div class="hh-section-label" style="margin-top:2px;">Range</div>
          <div class="hh-range-pills" id="hhRangePills">
            ${presets.map(p => `<button class="hh-range-pill ${p.key === selectedRange ? 'selected' : ''}" data-range="${p.key}">${p.label}</button>`).join('')}
          </div>

          <div class="hh-section-label">Recent Entries</div>
          <div id="hhExportPreview" class="hh-export-preview">
            <div class="hh-loading" style="padding:16px 0;">Loading…</div>
          </div>

          <div class="hh-section-label">Include</div>
          <div class="hh-export-options">
            ${aiAvailable ? `
              <div class="hh-export-toggle-row">
                <div>
                  <div class="hh-export-toggle-label">AI Opinion</div>
                  <div class="hh-export-toggle-hint">A short written summary of this data over the chosen range.</div>
                </div>
                <label class="hh-mini-toggle"><input type="checkbox" id="hhIncludeOpinion" ${initialOpinion ? 'checked' : ''}><span class="hh-mini-toggle-track"></span></label>
              </div>
            ` : ''}
            <div class="hh-export-toggle-row">
              <div>
                <div class="hh-export-toggle-label">Raw Data</div>
                <div class="hh-export-toggle-hint">${aiAvailable ? 'Charts and the full history, not just the opinion.' : 'The full history for the chosen range.'}</div>
              </div>
              <label class="hh-mini-toggle"><input type="checkbox" id="hhIncludeRawData" ${initialRawData ? 'checked' : ''}><span class="hh-mini-toggle-track"></span></label>
            </div>
          </div>

          <div class="hh-section-label">Format</div>
          <div class="hh-format-row">
            <button class="hh-format-btn" id="hhExportCsv">
              <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
              CSV
            </button>
            <button class="hh-format-btn" id="hhExportJson">
              <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
              JSON
            </button>
            <button class="hh-format-btn" id="hhExportPdf">
              <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
              PDF
            </button>
          </div>
          <div class="hh-export-status" id="hhExportStatus"></div>

        </div>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = this._popupCss();
    overlay.prepend(style);
    document.body.appendChild(overlay);
    this._exportPopupOverlay = overlay;
    overlay.querySelector('#hhExportClose').addEventListener('click', () => this._closeExportPopup());
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeExportPopup(); });

    overlay.querySelectorAll('.hh-range-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.range;
        selectedRange = raw === 'today' || raw === 'all' ? raw : parseInt(raw, 10);
        overlay.querySelectorAll('.hh-range-pill').forEach(b => b.classList.toggle('selected', b === btn));
        refreshPreview();
      });
    });

    // Recent Entries preview — updates live as the range changes, same
    // idea as a report popup showing what a range actually
    // covers before you commit to exporting it.
    const previewEl = overlay.querySelector('#hhExportPreview');
    let previewToken = 0;
    const refreshPreview = async () => {
      const token = ++previewToken;
      previewEl.innerHTML = `<div class="hh-loading" style="padding:16px 0;">Loading…</div>`;
      const html = await this._buildExportPreview(mod, selectedRange);
      if (token === previewToken) previewEl.innerHTML = html; // ignore a stale response if the range changed again mid-fetch
    };
    refreshPreview();

    const opinionCb = overlay.querySelector('#hhIncludeOpinion');
    const rawDataCb = overlay.querySelector('#hhIncludeRawData');
    const formatBtns = Array.from(overlay.querySelectorAll('.hh-format-btn'));
    const statusEl = overlay.querySelector('#hhExportStatus');

    // Exporting with everything unchecked would produce an empty file —
    // catch that up front rather than let someone download nothing.
    const updateFormatAvailability = () => {
      const nothingIncluded = !(opinionCb?.checked) && !rawDataCb.checked;
      formatBtns.forEach(b => b.disabled = nothingIncluded);
      statusEl.textContent = nothingIncluded ? 'Choose at least one thing to include above.' : '';
    };
    if (opinionCb) opinionCb.addEventListener('change', updateFormatAvailability);
    rawDataCb.addEventListener('change', updateFormatAvailability);

    const runExport = async (fn) => {
      formatBtns.forEach(b => b.disabled = true);
      statusEl.textContent = 'Preparing…';
      try {
        await fn();
        this._closeExportPopup();
      } catch (e) {
        statusEl.textContent = 'Could not export — try again.';
        formatBtns.forEach(b => b.disabled = false);
      }
    };

    overlay.querySelector('#hhExportCsv').addEventListener('click', () => runExport(() => this._exportModuleData(mod, 'csv', selectedRange, !!opinionCb?.checked, rawDataCb.checked)));
    overlay.querySelector('#hhExportJson').addEventListener('click', () => runExport(() => this._exportModuleData(mod, 'json', selectedRange, !!opinionCb?.checked, rawDataCb.checked)));
    overlay.querySelector('#hhExportPdf').addEventListener('click', () => runExport(() => this._exportModulePdf(mod, selectedRange, !!opinionCb?.checked, rawDataCb.checked)));
  }

  _closeExportPopup() {
    if (this._exportPopupOverlay) { this._exportPopupOverlay.remove(); this._exportPopupOverlay = null; }
  }

  // Small centered popup used when tapping a Latest/Average/Min/Max (or
  // similar) stat card — just enough context to say when that reading
  // happened, since the bare number doesn't.
  // `aiPrompt`, when given and AI features are enabled, adds a short
  // AI-generated note below the detail text — a separate, scoped call
  // from the module-level opinion, since it comments on just this one
  // stat rather than the whole reading.
  _openStatInfoPopup(color, title, valueText, detailText, aiPrompt = null) {
    this._closeStatInfoPopup();
    const showAi = !!(aiPrompt && this._config?.ai_features_enabled);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10070;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:24px;';
    overlay.innerHTML = `
      <style>${this._popupCss()}</style>
      <div class="hh-stat-info-card">
        <div class="hh-stat-info-header">
          <div class="hh-stat-info-title">${this._escape(title)}</div>
          <button class="hh-popup-close" id="hhStatInfoClose">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="hh-stat-info-value" style="color:${color};">${this._escape(valueText)}</div>
        <div class="hh-stat-info-detail">${this._escape(detailText)}</div>
        ${showAi ? `<p class="hh-insight-text" id="hhStatInfoAi" style="margin-top:12px;margin-bottom:0;">Getting an AI read on this…</p>` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    this._statInfoOverlay = overlay;
    overlay.querySelector('#hhStatInfoClose').addEventListener('click', () => this._closeStatInfoPopup());
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeStatInfoPopup(); });
    if (showAi) this._fetchStatAiNote(aiPrompt, overlay);
  }

  async _fetchStatAiNote(prompt, overlay) {
    const el = overlay.querySelector('#hhStatInfoAi');
    if (!el) return;
    try {
      const result = await this._hass.callWS({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent || undefined,
      });
      el.textContent = horseExtractConversationSpeech(result) || 'No insight available right now.';
    } catch (e) {
      el.textContent = 'Could not reach the AI assistant.';
    }
  }

  _closeStatInfoPopup() {
    if (this._statInfoOverlay) { this._statInfoOverlay.remove(); this._statInfoOverlay = null; }
  }

  // "Recent Entries" preview shown in the export sheet, live-updated as
  // the range changes — a quick look at what a range actually covers
  // before committing to a download, same idea as a report
  // popups. Capped at 15 rows so 90d/All stay scrollable rather than
  // dumping hundreds of readings into a sheet meant to fit on a phone.
  // Shared data source for "Recent Entries" — used by both the export
  // sheet's on-screen preview and the PDF's own Recent Entries section,
  // so the two can never show different readings or different colors.
  async _recentEntriesRows(mod, rangeDays, limit = 15) {
    if (mod.key === 'vitals') {
      return { rows: [], more: 0, note: "No time-series data — Vitals is a status snapshot, not a history." };
    }

    if (mod.key === 'sleep_score') {
      const scores = await this._sleepScoreDailySeries(rangeDays);
      if (!scores.length) return { rows: [], more: 0, note: 'No entries in this range.' };
      const recent = scores.slice(-limit).reverse();
      const rows = recent.map(d => ({
        label: new Date(d.date).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' }),
        display: `${d.value} pts`,
        color: horseSleepScoreBandColor(d.value),
      }));
      return { rows, more: Math.max(0, scores.length - limit) };
    }

    if (mod.key === 'blood_pressure') {
      const sysMod = this._getMod('blood_pressure_systolic');
      const history = await this._moduleHistorySeries(mod, rangeDays);
      const sysSeries = history.systolic || [], diaSeries = history.diastolic || [];
      if (!sysSeries.length && !diaSeries.length) return { rows: [], more: 0, note: 'No entries in this range.' };
      const pairCount = Math.min(sysSeries.length, diaSeries.length, limit);
      const rows = [];
      for (let i = 1; i <= pairCount; i++) {
        const sys = sysSeries[sysSeries.length - i];
        const dia = diaSeries[diaSeries.length - i];
        if (sys && dia) rows.push({
          label: this._formatRecentTimestamp(sys[0]),
          display: `${Math.round(sys[1])}/${Math.round(dia[1])}`,
          color: horseBandColor(sysMod.bands, sys[1], '#FF2D55'),
        });
      }
      const total = Math.min(sysSeries.length, diaSeries.length);
      return { rows, more: Math.max(0, total - limit) };
    }

    // Standard single-entity module
    const history = await this._moduleHistorySeries(mod, rangeDays);
    const series = history.primary || [];
    if (!series.length) return { rows: [], more: 0, note: 'No entries in this range.' };
    const fmt = v => mod.format === 'duration_min' ? this._formatMinutes(v) : v.toFixed(mod.decimals || 0);
    const unitSuffix = (mod.unit && mod.format !== 'duration_min') ? ' ' + mod.unit : '';

    // Daily-resetting counters: one row per day (that day's final total),
    // not every intraday state-change — see _buildStandardDetail for why.
    if (mod.resetsDaily) {
      const dailyTotals = this._dailyLastValues(series);
      const recentDays = dailyTotals.slice(-limit).reverse();
      const rows = recentDays.map(d => ({
        label: new Date(d.date).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' }),
        display: `${fmt(d.value)}${unitSuffix}`,
        color: horseBandColor(mod.bands, d.value, mod.color),
      }));
      return { rows, more: Math.max(0, dailyTotals.length - limit) };
    }

    const recent = series.slice(-limit).reverse();
    const rows = recent.map(([ts, val]) => ({
      label: this._formatRecentTimestamp(ts),
      display: `${fmt(val)}${unitSuffix}`,
      color: horseBandColor(mod.bands, val, mod.color),
    }));
    return { rows, more: Math.max(0, series.length - limit) };
  }

  async _buildExportPreview(mod, rangeDays) {
    try {
      const { rows, more, note } = await this._recentEntriesRows(mod, rangeDays);
      if (note) return `<div class="hh-chart-empty">${this._escape(note)}</div>`;
      if (!rows.length) return `<div class="hh-chart-empty">No entries in this range.</div>`;
      const rowsHtml = rows.map(r => `<div class="hh-recent-row"><div class="hh-recent-time">${r.label}</div><div class="hh-recent-pill" style="border-color:${r.color}55;color:${r.color};">${r.display}</div></div>`).join('');
      const moreHtml = more ? `<div class="hh-range-label" style="margin-top:8px;">+${more} more in the export</div>` : '';
      return `<div class="hh-recent-list">${rowsHtml}</div>${moreHtml}`;
    } catch (e) {
      return `<div class="hh-chart-empty">Couldn't load a preview for this range.</div>`;
    }
  }

  // Current value + note for one module, in the same {metric, value, unit,
  // note} shape used by both the CSV/JSON export and the PDF.
  _moduleSnapshotRow(mod) {
    if (mod.key === 'sleep_score') { const s = this._computeSleepScore(); return { metric: mod.label, value: s?.label, note: s ? `${s.points} points` : null, unit: '' }; }
    if (mod.key === 'vitals') { const v = this._computeVitals(); return { metric: mod.label, value: v?.label, note: v?.subtitle, unit: '' }; }
    if (mod.key === 'blood_pressure') { const bp = this._computeBloodPressure(); return { metric: mod.label, value: bp?.display, unit: bp?.unit }; }
    const n = this._numFor(mod.key);
    return { metric: mod.label, value: mod.format === 'duration_min' ? this._formatMinutes(n) : n, unit: mod.format === 'duration_min' ? '' : (mod.unit || '') };
  }

  // Fetches (or reuses cached) history for whichever entity/entities back
  // this module — used by both export formats so CSV/JSON and PDF always
  // agree on the same underlying series. rangeDays defaults to the
  // configured detail-popup range, but the export sheet always passes an
  // explicit choice from its range pills.
  async _moduleHistorySeries(mod, rangeDays = this._config.history_days || 7) {
    if (mod.key === 'blood_pressure') {
      const sysMod = this._getMod('blood_pressure_systolic');
      const diaMod = this._getMod('blood_pressure_diastolic');
      const sysEntity = this._entityFor('blood_pressure_systolic');
      const diaEntity = this._entityFor('blood_pressure_diastolic');
      const [systolic, diastolic] = await Promise.all([
        sysEntity ? this._fetchHistorySeries(sysEntity, rangeDays, sysMod.plausibleRange) : Promise.resolve([]),
        diaEntity ? this._fetchHistorySeries(diaEntity, rangeDays, diaMod.plausibleRange) : Promise.resolve([]),
      ]);
      return { systolic, diastolic };
    }
    if (mod.key === 'sleep_score' || mod.key === 'vitals') return {}; // composite, no single series
    const entityId = this._entityFor(mod.key);
    if (!entityId) return { primary: [] };
    try { return { primary: await this._fetchHistorySeries(entityId, rangeDays, mod.plausibleRange) }; }
    catch (_) { return { primary: [] }; }
  }

  // A short (2–4 sentence) written summary of this module over the
  // chosen range — distinct from the on-screen insight line, which only
  // ever comments on the current reading. Used by every export format
  // when "Include AI Opinion" is checked. Returns null (rather than
  // throwing) on failure so a report can still complete without it.
  async _fetchModuleOpinion(mod, rangeDays) {
    try {
      const row = this._moduleSnapshotRow(mod);
      const fmtVal = v => mod.format === 'duration_min' ? this._formatMinutes(v) : v.toFixed(1);
      let statsLine = '';
      if (!mod.composite) {
        const history = await this._moduleHistorySeries(mod, rangeDays);
        const series = history.primary || history.systolic || [];
        if (series.length) {
          // Daily-resetting counters: compare day totals, not raw
          // intraday partial-count readings (see _buildStandardDetail).
          const vals = mod.resetsDaily ? this._dailyLastValues(series).map(d => d.value) : series.map(p => p[1]);
          if (vals.length) {
            const min = Math.min(...vals), max = Math.max(...vals);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const basis = mod.resetsDaily ? `over ${vals.length} day${vals.length === 1 ? '' : 's'}` : `Over ${this._rangeLabelFor(rangeDays)}`;
            statsLine = ` ${basis}, it ranged from ${fmtVal(min)} to ${fmtVal(max)}, averaging ${fmtVal(avg)}.`;
          }
        }
      }
      const formatNote = mod.format === 'duration_min' ? ' Use the exact hours/minutes format given (e.g. "6h 38m") in your reply — do not convert or restate these as a raw number of minutes.' : '';
      const prompt = `You are a health dashboard assistant writing a short report summary (2-4 plain, non-alarmist sentences, no medical advice or diagnoses) for a "${mod.label}" report. Current reading: ${row.value ?? '—'}${row.unit ? ' ' + row.unit : ''}${row.note ? ' — ' + row.note : ''}.${statsLine}${formatNote} Mention the overall trend and anything notable, or say it's been steady if nothing stands out.`;
      const result = await this._hass.callWS({
        type: 'conversation/process',
        text: prompt,
        agent_id: this._config.ai_conversation_agent || undefined,
      });
      return horseExtractConversationSpeech(result);
    } catch (e) {
      return null;
    }
  }

  async _exportModuleData(mod, format, rangeDays = this._config.history_days || 7, includeOpinion = false, includeRawData = true) {
    const row = this._moduleSnapshotRow(mod);
    const history = includeRawData ? await this._moduleHistorySeries(mod, rangeDays) : null;
    const opinion = includeOpinion ? await this._fetchModuleOpinion(mod, rangeDays) : null;
    let text, mime, filename;
    const slug = mod.key.replace(/_/g, '-');
    if (format === 'json') {
      text = JSON.stringify({
        exported_at: new Date().toISOString(),
        range: this._rangeLabelFor(rangeDays),
        metric: mod.label,
        current: row,
        ...(opinion ? { opinion } : {}),
        ...(includeRawData ? { history } : {}),
      }, null, 2);
      mime = 'application/json';
      filename = `horse-health-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
    } else {
      const lines = [`current_value,${row.value ?? ''},${row.unit || ''}${row.note ? ',' + row.note : ''}`];
      if (opinion) lines.push('', `opinion,"${opinion.replace(/"/g, '""')}"`);
      if (includeRawData) {
        lines.push('', 'timestamp,value');
        const series = history.primary || history.systolic || [];
        series.forEach(([ts, val]) => lines.push(`${new Date(ts).toISOString()},${val}`));
      }
      text = lines.join('\n');
      mime = 'text/csv';
      filename = `horse-health-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    }
    this._downloadText(text, mime, filename);
  }

  _downloadText(text, mime, filename) {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (_) {
      // WKWebView fallback — copy to clipboard since the download
      // attribute isn't always honoured inside the HA Companion app.
      try { navigator.clipboard.writeText(text); } catch (_) {}
    }
  }

  _ensureJsPDF() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (this._jsPDFLoadPromise) return this._jsPDFLoadPromise;
    this._jsPDFLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.onload = () => { if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error('jsPDF failed to initialise')); };
      script.onerror = () => { this._jsPDFLoadPromise = null; reject(new Error('Could not load PDF library')); };
      document.head.appendChild(script);
    });
    return this._jsPDFLoadPromise;
  }

  // ── PDF drawing primitives — same masthead/footer/chart language as
  // a shared PDF theme, so every module's export looks like it
  // came from the same product. Vector-drawn (not rasterised), so charts
  // stay crisp at any zoom and the file stays small.
  _pdfTheme(doc) {
    const hexToRgb = hex => {
      const h = (hex || '#000000').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const n = parseInt(full, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const inkRgb = [28, 28, 30];
    const mutedRgb = [130, 130, 136];
    const zebraRgb = [246, 246, 248];
    const accentRgb = hexToRgb(this._config.accent_color || '#FF375F');
    return {
      hexToRgb, inkRgb, mutedRgb, zebraRgb, accentRgb,
      setInk: () => doc.setTextColor(...inkRgb),
      setMuted: () => doc.setTextColor(...mutedRgb),
      setAccent: () => doc.setTextColor(...accentRgb),
    };
  }

  _pdfMasthead(doc, theme, titleSuffix, marginX, y, pageW) {
    const mastheadName = (this._config.title || '').trim() || 'Health Summary';
    doc.setFontSize(18); doc.setFont(undefined, 'bold'); theme.setInk();
    doc.text(mastheadName, marginX, y);
    doc.setFontSize(18); theme.setAccent();
    doc.text('  ' + titleSuffix, marginX + doc.getTextWidth(mastheadName), y);
    y += 8;
    doc.setDrawColor(...theme.accentRgb);
    doc.setLineWidth(1.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 18;
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); theme.setMuted();
    doc.text(`Generated ${new Date().toLocaleString()}`, marginX, y);
    return y + 28;
  }

  _pdfFooter(doc, theme, marginX, pageW, pageH) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(8); theme.setMuted();
      doc.text(`Page ${p} of ${pageCount}`, pageW - marginX, pageH - 24, { align: 'right' });
      doc.text(this._config.title || 'Health Summary', marginX, pageH - 24);
    }
  }

  // Line/area chart for one metric's history — the print equivalent of
  // the on-card sparkline/detail chart.
  // Same range-bar approach as the on-screen chart: one filled bar per
  // bucket spanning that bucket's own min-to-max, no connecting line and
  // no shared-baseline fill. A connected line dipping toward each
  // bucket's local low reads as a sharp drop on paper the same way it
  // did on screen — independent bars don't have that problem, and the
  // export should show the same shape as what's actually in the app.
  _pdfDrawLineChart(doc, theme, points, marginX, y, pageW, { colorHex = null, unitSuffix = '', decimals = 0, title = null, formatFn = null, bands = null } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!points || !points.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No history recorded in this range.', marginX, y);
      return y + 16;
    }
    const chartH = 110;
    const chartW = pageW - marginX * 2;
    const padTop = 8, padBottom = 18, padLeftAxis = 34, padRight = 6;
    const plotX = marginX + padLeftAxis;
    const plotW = chartW - padLeftAxis - padRight;
    const plotTop = y + padTop;
    const plotH = chartH - padTop - padBottom;

    const buckets = this._resampleSeriesRange(points, 40);
    const allVals = buckets.flatMap(b => [b.min, b.max]);
    const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
    const vpad = (rawMax - rawMin) * 0.1 || 1;
    const min = rawMin - vpad, max = rawMax + vpad;
    const range = (max - min) || 1;
    const n = buckets.length;
    const slot = plotW / n;
    const barW = Math.max(1, Math.min(4, slot * 0.55));
    const yAt = v => plotTop + plotH - ((v - min) / range) * plotH;
    const fmt = v => formatFn ? formatFn(v) : v.toFixed(decimals);

    doc.setFillColor(...theme.zebraRgb);
    doc.roundedRect(marginX, y, chartW, chartH, 6, 6, 'F');

    buckets.forEach((b, i) => {
      const x = plotX + i * slot + slot / 2 - barW / 2;
      const yTop = yAt(b.max), yBottom = yAt(b.min);
      const barH = Math.max(1, yBottom - yTop);
      const barColor = bands ? theme.hexToRgb(horseBandColor(bands, (b.min + b.max) / 2, colorHex || '#0A84FF')) : (colorHex ? theme.hexToRgb(colorHex) : theme.accentRgb);
      doc.setFillColor(...barColor);
      doc.rect(x, yTop, barW, barH, 'F');
    });

    doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setMuted();
    doc.text(`${fmt(max)}${unitSuffix}`, marginX + 2, plotTop + 6);
    doc.text(`${fmt(min)}${unitSuffix}`, marginX + 2, plotTop + plotH);

    const fmtAxis = ts => new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    doc.setFontSize(7.5);
    const firstLabel = fmtAxis(buckets[0].ts);
    const lastLabel = fmtAxis(buckets[buckets.length - 1].ts);
    doc.text(firstLabel, plotX, y + chartH - 5);
    doc.text(lastLabel, plotX + plotW - doc.getTextWidth(lastLabel), y + chartH - 5);

    return y + chartH + 20;
  }

  // Print equivalent of _dailyLineChartSvg — a connected line with a
  // dot per day, for the same once-a-day metrics (Resting HR, HRV,
  // Blood Oxygen, Respiratory Rate, VO2 Max, Body/Basal Temperature,
  // Blood Glucose) that use it on screen, rather than the range-bar
  // chart above.
  _pdfDrawDailyLineChart(doc, theme, dailyPoints, marginX, y, pageW, { colorHex = null, unitSuffix = '', decimals = 0, title = null, formatFn = null, bands = null } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!dailyPoints || !dailyPoints.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data in this range.', marginX, y);
      return y + 16;
    }
    const chartH = 110;
    const chartW = pageW - marginX * 2;
    const padTop = 8, padBottom = 18, padLeftAxis = 34, padRight = 10;
    const plotX = marginX + padLeftAxis;
    const plotW = chartW - padLeftAxis - padRight;
    const plotTop = y + padTop;
    const plotH = chartH - padTop - padBottom;

    const vals = dailyPoints.map(d => d.value);
    const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
    const vpad = (rawMax - rawMin) * 0.15 || 1;
    const min = rawMin - vpad, max = rawMax + vpad;
    const range = (max - min) || 1;
    const n = dailyPoints.length;
    const xAt = i => plotX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const yAt = v => plotTop + plotH - ((v - min) / range) * plotH;
    const fmt = v => formatFn ? formatFn(v) : v.toFixed(decimals);

    doc.setFillColor(...theme.zebraRgb);
    doc.roundedRect(marginX, y, chartW, chartH, 6, 6, 'F');

    doc.setDrawColor(...(colorHex ? theme.hexToRgb(colorHex) : theme.accentRgb));
    doc.setLineWidth(1.2);
    for (let i = 1; i < n; i++) {
      doc.line(xAt(i - 1), yAt(dailyPoints[i - 1].value), xAt(i), yAt(dailyPoints[i].value));
    }
    dailyPoints.forEach((d, i) => {
      const dotColor = bands ? theme.hexToRgb(horseBandColor(bands, d.value, colorHex || '#0A84FF')) : (colorHex ? theme.hexToRgb(colorHex) : theme.accentRgb);
      doc.setFillColor(...dotColor);
      doc.circle(xAt(i), yAt(d.value), 1.6, 'F');
    });

    doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setMuted();
    doc.text(`${fmt(max)}${unitSuffix}`, marginX + 2, plotTop + 6);
    doc.text(`${fmt(min)}${unitSuffix}`, marginX + 2, plotTop + plotH);

    const fmtAxis = ts => new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    doc.setFontSize(7.5);
    const firstLabel = fmtAxis(dailyPoints[0].date);
    const lastLabel = fmtAxis(dailyPoints[n - 1].date);
    doc.text(firstLabel, plotX, y + chartH - 5);
    doc.text(lastLabel, plotX + plotW - doc.getTextWidth(lastLabel), y + chartH - 5);

    return y + chartH + 20;
  }


  _pdfDrawBarChart(doc, theme, dailyValues, marginX, y, pageW, { colorHex = null, unitSuffix = '', title = null, axisFormatFn = null } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!dailyValues || !dailyValues.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data in this range.', marginX, y);
      return y + 16;
    }
    const chartH = 100;
    const chartW = pageW - marginX * 2;
    const padTop = 8, padBottom = 18, padLeftAxis = 26, padRight = 6;
    const plotX = marginX + padLeftAxis;
    const plotW = chartW - padLeftAxis - padRight;
    const plotTop = y + padTop;
    const plotH = chartH - padTop - padBottom;
    const baseY = plotTop + plotH;

    doc.setFillColor(...theme.zebraRgb);
    doc.roundedRect(marginX, y, chartW, chartH, 6, 6, 'F');

    const maxVal = Math.max(...dailyValues.map(d => d.value), 1);
    const n = dailyValues.length;
    const slot = plotW / n;
    const barW = Math.max(1, slot - (n > 40 ? 0.5 : 2));
    doc.setFillColor(...(colorHex ? theme.hexToRgb(colorHex) : theme.accentRgb));
    dailyValues.forEach((d, i) => {
      const h = (d.value / maxVal) * plotH;
      if (h > 0.3) doc.rect(plotX + i * slot, baseY - h, barW, h, 'F');
    });

    doc.setFontSize(7); doc.setFont(undefined, 'normal'); theme.setMuted();
    doc.text(axisFormatFn ? axisFormatFn(maxVal) : `${Math.round(maxVal)}${unitSuffix}`, marginX + 2, plotTop + 6);

    const fmtDate = ts => new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    doc.setFontSize(7.5);
    doc.text(fmtDate(dailyValues[0].date), plotX, y + chartH - 5);
    const lastLabel = fmtDate(dailyValues[n - 1].date);
    doc.text(lastLabel, plotX + plotW - doc.getTextWidth(lastLabel), y + chartH - 5);

    return y + chartH + 20;
  }

  // Fills an arbitrary closed polygon — building block for the ring
  // chart, since jsPDF has no native arc/pie primitive.
  _pdfFillPolygon(doc, points) {
    if (!points || points.length < 3) return;
    const start = points[0];
    const segs = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    doc.lines(segs, start[0], start[1], [1, 1], 'F', true);
  }

  _pdfDrawRing(doc, theme, items, cx, cy, outerR, innerR) {
    const usable = (items || []).filter(i => i.value > 0);
    if (!usable.length) return;
    const total = usable.reduce((s, i) => s + i.value, 0);
    const stepDeg = 4;
    let startDeg = -90;
    usable.forEach(item => {
      const endDeg = startDeg + (item.value / total) * 360;
      const pts = [];
      for (let a = startDeg; a < endDeg; a += stepDeg) {
        const r = a * Math.PI / 180;
        pts.push([cx + outerR * Math.cos(r), cy + outerR * Math.sin(r)]);
      }
      const rEnd = endDeg * Math.PI / 180;
      pts.push([cx + outerR * Math.cos(rEnd), cy + outerR * Math.sin(rEnd)]);
      pts.push([cx + innerR * Math.cos(rEnd), cy + innerR * Math.sin(rEnd)]);
      for (let a = endDeg; a > startDeg; a -= stepDeg) {
        const r = a * Math.PI / 180;
        pts.push([cx + innerR * Math.cos(r), cy + innerR * Math.sin(r)]);
      }
      const rStart = startDeg * Math.PI / 180;
      pts.push([cx + innerR * Math.cos(rStart), cy + innerR * Math.sin(rStart)]);
      doc.setFillColor(...theme.hexToRgb(item.color || this._config.accent_color || '#FF375F'));
      this._pdfFillPolygon(doc, pts);
      startDeg = endDeg;
    });
  }

  // Ring + segmented-bar legend, side by side — print equivalent of
  // _buildDonutChart, used for Sleep Score's REM/Deep/Core/Awake split.
  _pdfDrawDonutWithBars(doc, theme, items, marginX, y, pageW, { title = null } = {}) {
    const usable = (items || []).filter(i => i.value > 0);
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!usable.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data.', marginX, y);
      return y + 16;
    }
    const outerR = 34, innerR = 17;
    const cx = marginX + outerR, cy = y + outerR;
    this._pdfDrawRing(doc, theme, usable, cx, cy, outerR, innerR);

    const barX = marginX + outerR * 2 + 20;
    const barMaxW = pageW - marginX - barX - 60;
    const total = usable.reduce((s, i) => s + i.value, 0);
    let by = y + 4;
    usable.forEach(item => {
      const pct = item.value / total;
      doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); theme.setInk();
      doc.text(String(item.label), barX, by + 8);
      doc.setFillColor(...theme.zebraRgb);
      doc.roundedRect(barX + 70, by, barMaxW, 10, 2, 2, 'F');
      doc.setFillColor(...theme.hexToRgb(item.color || this._config.accent_color || '#FF375F'));
      doc.roundedRect(barX + 70, by, Math.max(barMaxW * pct, 3), 10, 2, 2, 'F');
      theme.setMuted();
      doc.text(`${Math.round(pct * 100)}%`, barX + 74 + barMaxW, by + 8);
      by += 17;
    });
    const ringBottom = y + outerR * 2 + 6;
    return Math.max(ringBottom, by) + 10;
  }

  // A simple status list — one row per vital, a colored dot + label +
  // value, green when in its normal range and orange when not. Values
  // are in incompatible units (BPM, %, br/min, °) so this stays a list
  // rather than a proportional bar chart, matching the on-card colored
  // bar list's intent (status at a glance) without implying they're
  // parts of one whole.
  _pdfDrawStatusList(doc, theme, items, marginX, y, pageW, { title = null } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!items.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No data.', marginX, y);
      return y + 16;
    }
    items.forEach(item => {
      doc.setFillColor(...theme.hexToRgb(item.color));
      doc.circle(marginX + 4, y - 3, 3.5, 'F');
      doc.setFontSize(10); doc.setFont(undefined, 'normal'); theme.setInk();
      doc.text(String(item.label), marginX + 16, y);
      theme.setMuted();
      doc.text(String(item.display), pageW - marginX, y, { align: 'right' });
      y += 18;
    });
    return y + 8;
  }

  // Recent Entries for the PDF — same rows _recentEntriesRows already
  // builds for the on-screen preview, but printed as label-left/value-right
  // rows with the value colored by its own band (green/amber/red), same
  // as the pill colors shown on screen. Paginates automatically for long
  // ranges rather than running off the bottom of the page.
  _pdfDrawRecentEntries(doc, theme, rows, more, marginX, y, pageW, pageH, { title = 'Recent Entries' } = {}) {
    if (title) {
      doc.setFillColor(...theme.accentRgb);
      doc.rect(marginX, y - 10, 3, 13, 'F');
      doc.setFontSize(12); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(title, marginX + 9, y); y += 20;
    }
    if (!rows.length) {
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text('No entries in this range.', marginX, y);
      return y + 16;
    }
    rows.forEach(r => {
      if (y > pageH - 60) { doc.addPage(); y = 50; }
      doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); theme.setInk();
      doc.text(String(r.label), marginX, y);
      doc.setFont(undefined, 'bold'); doc.setTextColor(...theme.hexToRgb(r.color));
      doc.text(String(r.display), pageW - marginX, y, { align: 'right' });
      y += 16;
    });
    if (more) {
      doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); theme.setMuted();
      doc.text(`+${more} more in the export`, marginX, y);
      y += 14;
    }
    return y + 10;
  }

  async _exportModulePdf(mod, rangeDays = this._config.history_days || 7, includeOpinion = false, includeRawData = true) {
    try {
      const JsPDFCtor = await this._ensureJsPDF();
      const doc = new JsPDFCtor({ unit: 'pt', format: 'a4' });
      const theme = this._pdfTheme(doc);
      const marginX = 40;
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let y = this._pdfMasthead(doc, theme, mod.label, marginX, 50, pageW);

      const row = this._moduleSnapshotRow(mod);
      doc.setFontSize(22); doc.setFont(undefined, 'bold'); theme.setInk();
      doc.text(`${row.value ?? '—'}${row.unit ? ' ' + row.unit : ''}`, marginX, y);
      if (row.note) {
        doc.setFontSize(10); doc.setFont(undefined, 'normal'); theme.setMuted();
        doc.text(row.note, marginX, y + 16);
      }
      y += 36;

      if (includeOpinion) {
        const opinion = await this._fetchModuleOpinion(mod, rangeDays);
        doc.setFontSize(11); doc.setFont(undefined, opinion ? 'normal' : 'italic'); opinion ? theme.setInk() : theme.setMuted();
        const wrapped = doc.splitTextToSize(opinion || 'AI opinion unavailable right now.', pageW - marginX * 2);
        doc.text(wrapped, marginX, y);
        y += wrapped.length * 15 + 20;
      }

      if (includeRawData) {
        if (mod.key === 'sleep_score') {
          const donutItems = [
            { label: 'REM', value: this._numFor('rem_sleep') || 0, color: '#5E5CE6' },
            { label: 'Deep', value: this._numFor('deep_sleep') || 0, color: '#BF5AF2' },
            { label: 'Core', value: this._numFor('core_sleep') || 0, color: '#64D2FF' },
            { label: 'Awake', value: this._numFor('awake') || 0, color: '#8E8E93' },
          ];
          y = this._pdfDrawDonutWithBars(doc, theme, donutItems, marginX, y, pageW, { title: "Tonight's Breakdown" });
          const scores = await this._sleepScoreDailySeries(rangeDays);
          if (scores.length > 1) y = this._pdfDrawBarChart(doc, theme, scores, marginX, y, pageW, { colorHex: mod.color, unitSuffix: ' pts', title: 'Sleep Score — Per Day' });
        } else if (mod.key === 'vitals') {
          const items = this._vitalsChecks();
          y = this._pdfDrawStatusList(doc, theme, items, marginX, y, pageW, { title: 'Vitals' });
        } else if (mod.key === 'blood_pressure') {
          const history = await this._moduleHistorySeries(mod, rangeDays);
          const sysMod = this._getMod('blood_pressure_systolic');
          const diaMod = this._getMod('blood_pressure_diastolic');
          y = this._pdfDrawLineChart(doc, theme, history.systolic, marginX, y, pageW, { colorHex: '#FF2D55', title: 'Systolic', bands: sysMod.bands });
          y = this._pdfDrawLineChart(doc, theme, history.diastolic, marginX, y, pageW, { colorHex: '#FF9F0A', title: 'Diastolic', bands: diaMod.bands });
        } else {
          const history = await this._moduleHistorySeries(mod, rangeDays);
          const series = history.primary || [];
          if (mod.resetsDaily) {
            // Daily-resetting counters get only the daily-totals bar
            // chart — no raw line chart, since intraday partial totals
            // aren't independent samples to plot against each other.
            if (series.length) {
              const dailyTotals = this._dailyLastValues(series);
              if (dailyTotals.length > 0) y = this._pdfDrawBarChart(doc, theme, dailyTotals, marginX, y, pageW, { colorHex: mod.color, unitSuffix: mod.unit ? ' ' + mod.unit : '', title: `${this._rangeLabelFor(rangeDays)} — Daily Totals` });
            }
          } else if (mod.dailyLine) {
            // Already roughly one reading a day — the daily-line chart
            // IS the per-day view, no separate bar chart underneath.
            const daily = this._dailyAverages(series);
            const fmt = mod.format === 'duration_min' ? (v => this._formatMinutes(v)) : null;
            y = this._pdfDrawDailyLineChart(doc, theme, daily, marginX, y, pageW, {
              colorHex: mod.color, unitSuffix: (mod.unit && !fmt) ? ' ' + mod.unit : '', decimals: mod.decimals || 0, formatFn: fmt, title: this._rangeLabelFor(rangeDays), bands: mod.bands,
            });
          } else {
            const fmt = mod.format === 'duration_min' ? (v => this._formatMinutes(v)) : null;
            y = this._pdfDrawLineChart(doc, theme, series, marginX, y, pageW, {
              colorHex: mod.color, unitSuffix: (mod.unit && !fmt) ? ' ' + mod.unit : '', decimals: mod.decimals || 0, formatFn: fmt, title: this._rangeLabelFor(rangeDays), bands: mod.bands,
            });
            if (series.length) {
              const daily = mod.format === 'duration_min' ? this._dailyLastValues(series) : this._dailyAverages(series);
              if (daily.length > 1) y = this._pdfDrawBarChart(doc, theme, daily, marginX, y, pageW, { colorHex: mod.color, unitSuffix: fmt ? '' : (mod.unit ? ' ' + mod.unit : ''), title: 'Per Day', axisFormatFn: fmt });
            }
          }
        }

        // Recent Entries — same color-coded rows shown in the export
        // sheet's on-screen preview, now printed into the report too.
        // Vitals has no time series, so it's skipped there (its status
        // list above already covers it).
        if (mod.key !== 'vitals') {
          const { rows, more } = await this._recentEntriesRows(mod, rangeDays);
          y = this._pdfDrawRecentEntries(doc, theme, rows, more, marginX, y, pageW, pageH, { title: 'Recent Entries' });
        }
      }

      this._pdfFooter(doc, theme, marginX, pageW, pageH);
      this._showPdfPreview(doc, `horse-health-${mod.key.replace(/_/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      alert('Could not generate PDF: ' + e.message);
    }
  }

  // Sleep Score recomputed per day from the underlying sensors' daily-last
  // values — shared by the on-card detail popup and the PDF so both show
  // the same trend.
  async _sleepScoreDailySeries(days) {
    try {
      const durEntity = this._entityFor('sleep_duration');
      if (!durEntity) return [];
      const remEntity = this._entityFor('rem_sleep');
      const deepEntity = this._entityFor('deep_sleep');
      const [durSeries, remSeries, deepSeries] = await Promise.all([
        this._fetchHistorySeries(durEntity, days),
        remEntity ? this._fetchHistorySeries(remEntity, days) : Promise.resolve([]),
        deepEntity ? this._fetchHistorySeries(deepEntity, days) : Promise.resolve([]),
      ]);
      const durByDay = new Map(this._dailyLastValues(durSeries).map(d => [d.date, d.value]));
      const remByDay = new Map(this._dailyLastValues(remSeries).map(d => [d.date, d.value]));
      const deepByDay = new Map(this._dailyLastValues(deepSeries).map(d => [d.date, d.value]));
      return Array.from(durByDay.entries()).sort((a, b) => a[0] - b[0]).map(([date, dur]) => {
        const rem = remByDay.get(date) || 0, deep = deepByDay.get(date) || 0;
        const durationScore = Math.min(70, (dur / 480) * 70);
        const qualityShare = dur > 0 ? (rem + deep) / dur : 0;
        const qualityScore = Math.min(30, qualityShare * 60);
        return { date, value: Math.max(0, Math.min(100, Math.round(durationScore + qualityScore))) };
      });
    } catch (_) { return []; }
  }

  _showPdfPreview(doc, filename) {
    this._closePdfPreview();
    const blobUrl = doc.output('bloburl');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
    overlay.innerHTML = `
      <div class="hh-pdf-card">
        <div class="hh-popup-header">
          <div class="hh-popup-title">${this._escape(filename)}</div>
          <button class="hh-popup-close" id="hhPdfClose">
            <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <iframe src="${blobUrl}" class="hh-pdf-frame"></iframe>
        <button class="hh-pdf-download" id="hhPdfDownload">Download</button>
      </div>
    `;
    const style = document.createElement('style');
    style.textContent = this._popupCss();
    overlay.prepend(style);
    document.body.appendChild(overlay);
    this._pdfPreviewOverlay = overlay;
    overlay.querySelector('#hhPdfClose').addEventListener('click', () => this._closePdfPreview());
    overlay.querySelector('#hhPdfDownload').addEventListener('click', () => doc.save(filename));
  }

  _closePdfPreview() {
    if (this._pdfPreviewOverlay) { this._pdfPreviewOverlay.remove(); this._pdfPreviewOverlay = null; }
  }

  // ── Utilities ─────────────────────────────────────────────────────
  // "Xh Ym" for anything an hour or more, otherwise just "Ym" — used for
  // any module whose sensor reports raw minutes (currently Time Asleep,
  // but any future duration-style module should set format:'duration_min'
  // too rather than showing bare minutes).
  _formatMinutes(mins) {
    if (mins == null || !Number.isFinite(mins)) return '—';
    const total = Math.round(mins);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  _escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Popup/sheet surface — same treatment as the rest of the Crow family:
  // Classic keeps the card's original near-black sheet; Glass swaps it
  // for a soft gradient (silvery-dark or near-white, by theme) so the
  // AI, export and info sheets read as the same material as the card.
  _S() {
    const orig = 'rgba(30,30,32,0.97)';
    if (!this._glassOn()) return orig;
    const dark = this._isDark();
    return dark ? 'linear-gradient(160deg,rgba(74,74,84,0.94),rgba(34,34,40,0.97))' : 'linear-gradient(160deg,rgba(255,255,255,0.97),rgba(244,244,250,0.98))';
  }

  _popupCss() {
    return `
      .hh-chart-empty { color:${this._Wt('0.35')}; font-size:12px; padding:16px 0; text-align:center; }
      .hh-section-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${this._Wt('0.4')}; margin:16px 0 8px; }
      .ai-card { background:${this._W('0.05')}; border:1px solid ${this._W('0.08')}; border-radius:14px; padding:14px; margin-bottom:14px; }
      .ai-card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .ai-card-title { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:${this._Wt('0.55')}; text-transform:uppercase; letter-spacing:0.04em; }
      .ai-card-body { font-size:14px; color:${this._T()}; line-height:1.5; margin:0; }
      .recap-period-pills { display:flex; gap:6px; margin-bottom:10px; }
      .recap-period-pill { background:${this._W('0.08')}; border:none; border-radius:8px; padding:5px 12px; font-size:12px; font-weight:700; color:${this._Wt('0.6')}; }
      .recap-period-pill.selected { background:#0A84FF; color:#fff; }
      .ai-retry-btn { background:none; border:none; color:#0A84FF; font-size:13px; font-weight:600; padding:0; margin-top:8px; }
      .hh-popup-sheet { background:${this._S()}; border:1px solid ${this._W('0.12')}; border-bottom:none; backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%); border-radius:20px 20px 0 0; width:100%; max-width:480px; max-height:85vh; display:flex; flex-direction:column; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; color:${this._T()}; }
      .hh-popup-header { display:flex; align-items:center; justify-content:space-between; padding:18px 18px 12px; }
      .hh-popup-header-nav { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; }
      .hh-popup-close-text { background:none; border:none; color:#0A84FF; font-size:15px; justify-self:start; padding:0; }
      .hh-popup-header-spacer { justify-self:end; }
      .hh-popup-title { font-size:17px; font-weight:700; text-align:center; }
      .hh-popup-subtitle { font-size:12px; color:${this._Wt('0.5')}; margin-top:2px; }
      .hh-popup-close { background:${this._W('0.12')}; border:none; border-radius:50%; width:30px; height:30px; color:${this._T()}; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .hh-popup-body { padding:0 18px 24px; overflow-y:auto; }
      .hh-loading { color:${this._Wt('0.6')}; font-size:14px; padding:24px 0; text-align:center; }
      .hh-chart-wrap { margin:8px 0 16px; }
      .hh-stat-row { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
      .hh-stat { background:${this._W('0.06')}; border-radius:10px; padding:10px 6px; text-align:center; }
      .hh-stat-label { font-size:11px; color:${this._Wt('0.55')}; margin-bottom:2px; }
      .hh-stat-value { font-size:16px; font-weight:700; }
      .hh-stat-clickable { cursor:pointer; }
      .hh-stat-clickable:active { background:${this._W('0.12')}; }
      .hh-stat-info-card { background:${this._S()}; border:1px solid ${this._W('0.12')}; backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%); border-radius:18px; width:100%; max-width:320px; padding:18px 20px 20px; color:${this._T()}; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      .hh-stat-info-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .hh-stat-info-title { font-size:14px; font-weight:700; color:${this._Wt('0.6')}; text-transform:uppercase; letter-spacing:0.04em; }
      .hh-stat-info-value { font-size:26px; font-weight:800; margin-bottom:6px; }
      .hh-stat-info-detail { font-size:13px; color:${this._Wt('0.65')}; line-height:1.4; }
      .hh-ask-card { background:${this._S()}; border:1px solid ${this._W('0.12')}; backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%); border-radius:18px; width:100%; max-width:360px; padding:18px 20px 20px; color:${this._T()}; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      .hh-ask-input { width:100%; background:${this._W('0.08')}; border:1px solid ${this._W('0.15')}; border-radius:10px; padding:10px 12px; color:${this._T()}; font-size:14px; font-family:inherit; resize:none; box-sizing:border-box; margin-bottom:10px; }
      .hh-ask-input::placeholder { color:${this._Wt('0.4')}; }
      .hh-ask-submit-btn { width:100%; background:rgba(48,209,88,0.16); border:none; border-radius:10px; padding:10px; color:#30D158; font-size:14px; font-weight:700; }
      .hh-ask-submit-btn:disabled { opacity:0.5; }
      .hh-range-label { font-size:12px; color:${this._Wt('0.5')}; text-align:center; }
      .hh-pdf-card { background:${this._S()}; border:1px solid ${this._W('0.12')}; border-radius:20px; width:100%; max-width:420px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; color:${this._T()}; font-family:-apple-system,sans-serif; }
      .hh-pdf-frame { flex:1; border:none; background:#fff; min-height:400px; }
      .hh-pdf-download { margin:12px 18px 18px; padding:12px; border-radius:12px; border:none; background:var(--hh-accent, #FF375F); color:#fff; font-weight:700; font-size:15px; }

      /* Headline block — icon + big colored value + sublabel */
      .hh-headline-row { display:flex; align-items:center; gap:14px; margin:4px 0 16px; }
      .hh-headline-icon { width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .hh-headline-label { font-size:22px; font-weight:800; line-height:1.1; }
      .hh-headline-sublabel { font-size:13px; color:${this._Wt('0.5')}; margin-top:2px; }

      /* Preview tiles — 2-up cards that push into another module's detail */
      .hh-tile-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:16px 0; }
      .hh-tile { background:${this._W('0.06')}; border-radius:14px; padding:12px 14px; cursor:pointer; }
      .hh-tile:active { background:${this._W('0.1')}; }
      .hh-tile-header { display:flex; align-items:center; justify-content:space-between; font-size:13px; font-weight:700; color:${this._Wt('0.85')}; margin-bottom:10px; }
      .hh-tile-visual { margin-bottom:8px; }
      .hh-tile-caption { font-size:15px; font-weight:800; }

      /* Time Asleep — big split headline, date, D/W/M/6M segmented control */
      .hh-sleep-big { font-size:40px; font-weight:800; color:${this._T()}; line-height:1.1; margin-top:2px; }
      .hh-sleep-big-unit { font-size:18px; font-weight:600; color:${this._Wt('0.6')}; margin-right:8px; }
      .hh-sleep-date { font-size:13px; color:${this._Wt('0.5')}; margin:2px 0 14px; }
      .hh-segmented { display:flex; background:${this._W('0.08')}; border-radius:10px; padding:3px; margin-bottom:16px; }
      .hh-segmented-btn { flex:1; background:none; border:none; border-radius:8px; padding:8px 0; font-size:13px; font-weight:700; color:${this._Wt('0.6')}; }
      .hh-segmented-btn.selected { background:${this._W('0.18')}; color:${this._T()}; }

      /* AI insight box */
      .hh-insight-text { font-size:14px; color:${this._Wt('0.75')}; line-height:1.4; margin:0 0 16px; }

      /* "Improve This" advice card */
      .hh-advice-card { background:rgba(48,209,88,0.08); border:1px solid rgba(48,209,88,0.25); border-radius:14px; padding:14px 16px; margin:16px 0; }
      .hh-advice-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
      .hh-advice-title { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#30D158; }
      .hh-advice-refresh { background:none; border:none; color:#30D158; font-size:13px; font-weight:600; padding:0; }

      /* Blood Glucose extras */
      .hh-glucose-trend-row { display:flex; align-items:center; gap:10px; background:${this._W('0.05')}; border-radius:12px; padding:10px 14px; margin-bottom:12px; }
      .hh-glucose-trend-label { font-size:14px; font-weight:700; color:${this._T()}; }
      .hh-glucose-card { background:${this._W('0.05')}; border:1px solid ${this._W('0.08')}; border-radius:14px; padding:14px; margin-bottom:12px; }
      .hh-glucose-card-title { font-size:12px; font-weight:700; color:${this._Wt('0.55')}; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px; }
      .hh-glucose-value { font-size:24px; font-weight:800; color:${this._T()}; margin-bottom:4px; }
      .hh-glucose-card-note { font-size:12px; color:${this._Wt('0.5')}; line-height:1.4; }
      .hh-glucose-tir-bar { display:flex; height:14px; border-radius:7px; overflow:hidden; margin-bottom:8px; }
      .hh-glucose-tir-legend { display:flex; justify-content:space-between; font-size:12px; font-weight:700; }

      .hh-divider { height:1px; background:${this._W('0.1')}; margin:18px 0; }

      /* Full-width Export button, under the chart */
      .hh-export-full-btn { width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background:${this._W('0.08')}; border:none; border-radius:14px; padding:14px; color:${this._T()}; font-size:15px; font-weight:600; }

      /* Recent History list */
      .hh-recent-list { display:flex; flex-direction:column; }
      .hh-recent-row { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid ${this._W('0.08')}; }
      .hh-recent-row-clickable { cursor:pointer; }
      .hh-recent-row-clickable:active { background:${this._W('0.06')}; }
      .hh-recent-row:last-child { border-bottom:none; }
      .hh-recent-time { font-size:13px; color:${this._Wt('0.55')}; }
      .hh-recent-pill { font-size:13px; font-weight:700; padding:5px 12px; border-radius:20px; border:1.5px solid; }

      /* Export sheet — range pills + format buttons */
      .hh-range-pills { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 8px; }
      .hh-range-pill { background:${this._W('0.08')}; border:none; border-radius:20px; padding:10px 16px; font-size:14px; font-weight:600; color:${this._Wt('0.85')}; }
      .hh-range-pill.selected { background:#0A84FF; color:#fff; }
      .hh-format-row { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
      .hh-format-btn { display:flex; align-items:center; justify-content:center; gap:6px; background:${this._W('0.08')}; border:none; border-radius:12px; padding:14px 6px; color:${this._T()}; font-size:14px; font-weight:700; }
      .hh-format-btn:disabled { opacity:0.4; }
      .hh-export-status { font-size:12px; color:${this._Wt('0.5')}; text-align:center; margin-top:10px; min-height:14px; }
      .hh-export-preview { max-height:220px; overflow-y:auto; -webkit-overflow-scrolling:touch; margin-bottom:4px; }

      /* Export sheet — Include AI Opinion / Include Raw Data toggles */
      .hh-export-options { background:${this._W('0.05')}; border-radius:12px; margin:8px 0 4px; overflow:hidden; }
      .hh-export-toggle-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid ${this._W('0.08')}; }
      .hh-export-toggle-row:last-child { border-bottom:none; }
      .hh-export-toggle-label { font-size:14px; font-weight:600; color:${this._T()}; }
      .hh-export-toggle-hint { font-size:11.5px; color:${this._Wt('0.5')}; margin-top:2px; line-height:1.35; }
      .hh-mini-toggle { position:relative; width:44px; height:26px; flex-shrink:0; }
      .hh-mini-toggle input { opacity:0; width:0; height:0; position:absolute; }
      .hh-mini-toggle-track { position:absolute; inset:0; border-radius:26px; background:rgba(120,120,128,0.4); cursor:pointer; transition:background 0.2s; }
      .hh-mini-toggle-track::after { content:''; position:absolute; width:22px; height:22px; border-radius:50%; background:#fff; top:2px; left:2px; transition:transform 0.2s; }
      .hh-mini-toggle input:checked + .hh-mini-toggle-track { background:#34C759; }
      .hh-mini-toggle input:checked + .hh-mini-toggle-track::after { transform:translateX(18px); }
    `;
  }

  // ── Appearance: Classic/Glass, Auto/Light/Dark, and a Glass opacity
  // slider — the same helpers, formulas and config keys (card_style,
  // appearance, glass) as the rest of the Crow family, so Glass reads
  // as the same frosted surface everywhere rather than its own look.
  // Classic returns the card exactly as it always was.
  _glassOn() { return this._config?.card_style === 'glass'; }

  _isDark() {
    const mode = this._config?.appearance || 'auto';
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return this._hass?.themes?.darkMode !== false;
  }

  _lightGlass() { return this._glassOn() && !this._isDark(); }

  _W(a) {
    if (!this._lightGlass()) return `rgba(255,255,255,${a})`;
    const x = parseFloat(a);
    return x <= 0.26 ? `rgba(120,120,128,${(x * 1.5).toFixed(2)})` : `rgba(60,60,67,${Math.min(0.92, 0.45 + x * 0.6).toFixed(2)})`;
  }
  _Wt(a) {
    if (!this._glassOn()) return `rgba(255,255,255,${a})`;
    const x = parseFloat(a);
    if (this._lightGlass()) return `rgba(60,60,67,${Math.min(0.94, 0.52 + x * 0.5).toFixed(2)})`;
    return `rgba(255,255,255,${Math.max(x, Math.min(0.96, 0.46 + x * 0.78)).toFixed(2)})`;
  }
  _T() { return this._lightGlass() ? '#1c1c1e' : '#fff'; }

  _gt() {
    const dark = this._isDark();
    let a = parseFloat(this._config?.glass);
    a = isNaN(a) ? 0.5 : Math.min(1, Math.max(0, a / 100));
    const f = n => n.toFixed(3);
    return dark ? {
      dark: true,
      glass1: `rgba(255,255,255,${f(0.10 + a * 0.16)})`, glass2: `rgba(255,255,255,${f(0.03 + a * 0.08)})`,
      edge: 'rgba(255,255,255,0.26)', hi: 'rgba(255,255,255,0.42)', lo: 'rgba(255,255,255,0.07)', shadow: '0 14px 36px rgba(0,0,0,0.32)',
      text: '#ffffff', chip: 'rgba(255,255,255,0.10)', chipEdge: 'rgba(255,255,255,0.16)', fill: 'rgba(255,255,255,0.13)',
    } : {
      dark: false,
      glass1: `rgba(255,255,255,${f(0.50 + a * 0.32)})`, glass2: `rgba(255,255,255,${f(0.34 + a * 0.30)})`,
      edge: 'rgba(255,255,255,0.85)', hi: 'rgba(255,255,255,0.95)', lo: 'rgba(0,0,0,0.04)', shadow: '0 10px 30px rgba(28,36,80,0.14), 0 0 0 0.5px rgba(0,0,0,0.05)',
      text: '#1c1c1e', chip: 'rgba(120,120,128,0.12)', chipEdge: 'rgba(120,120,128,0.14)', fill: 'rgba(120,120,128,0.16)',
    };
  }

  _css(accent) {
    return `
      :host { display:block; --hh-accent:${accent}; }
      .card { background:var(--ha-card-background, var(--card-background-color, #1c1c1e)); border-radius:var(--ha-card-border-radius,16px); padding:16px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif; color:var(--hh-text-primary,#fff); --hh-text-primary:#fff; --hh-text-secondary:rgba(255,255,255,0.6); --hh-text-tertiary:rgba(255,255,255,0.35); }
      @media (prefers-color-scheme: light) { .card { --hh-text-primary:#000; --hh-text-secondary:rgba(0,0,0,0.55); --hh-text-tertiary:rgba(0,0,0,0.3); } }
      .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
      .header-title { font-size:26px; font-weight:800; letter-spacing:-0.02em; }
      .ai-search-bar { width:100%; display:flex; align-items:center; gap:9px; background:rgba(128,128,128,0.14); border:none; border-radius:12px; padding:11px 14px; margin-bottom:14px; color:rgba(255,255,255,0.55); }
      .ai-search-bar:active { background:rgba(128,128,128,0.2); }
      .ai-search-placeholder { font-size:15px; }
      .ai-insights-row { width:100%; display:flex; align-items:center; gap:10px; background:rgba(128,128,128,0.08); border:none; border-radius:14px; padding:12px 14px; margin-bottom:12px; text-align:left; }
      .ai-insights-row:active { background:rgba(128,128,128,0.16); }
      .ai-insights-row-text { flex:1; min-width:0; }
      .ai-insights-row-title { font-size:13px; font-weight:700; color:var(--hh-text-primary); margin-bottom:2px; }
      .ai-insights-row-preview { font-size:13px; color:var(--hh-text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .module-list { display:flex; flex-direction:column; gap:10px; }
      .mod-card { background:rgba(128,128,128,0.08); border-radius:14px; padding:14px; cursor:pointer; transition:background 0.15s; }
      .mod-card:active { background:rgba(128,128,128,0.16); }
      .mod-row-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .mod-row-left { display:flex; align-items:center; gap:8px; }
      .mod-icon { width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; }
      .mod-label { font-size:15px; font-weight:700; }
      .mod-time { font-size:13px; color:var(--hh-text-tertiary); display:flex; align-items:center; gap:2px; }
      .mod-row-bottom { display:flex; align-items:flex-end; justify-content:space-between; }
      .mod-value { font-size:22px; font-weight:800; }
      .mod-unit { font-size:13px; font-weight:600; color:var(--hh-text-secondary); margin-left:4px; }
      .mod-subtitle { font-size:13px; color:var(--hh-text-secondary); margin-top:2px; }
      .mod-widget { flex-shrink:0; }
      .empty-state { color:var(--hh-text-secondary); font-size:14px; text-align:center; padding:32px 12px; }
      ${this._glassOn() ? this._glassCss() : ''}
    `;
  }

  // Everything here only applies in Glass — it sits on top of the
  // original stylesheet above, same as the rest of the Crow family.
  _glassCss() {
    const t = this._gt();
    return `
      .card {
        background: linear-gradient(160deg, ${t.glass1}, ${t.glass2});
        color: ${t.text};
        --hh-text-primary:${t.text}; --hh-text-secondary:${this._Wt('0.6')}; --hh-text-tertiary:${this._Wt('0.35')};
        backdrop-filter: blur(24px) saturate(170%); -webkit-backdrop-filter: blur(24px) saturate(170%);
        border:1px solid ${t.edge}; border-radius:28px;
        box-shadow: inset 0 1px 0 ${t.hi}, inset 0 -1px 0 ${t.lo}, ${t.shadow};
      }
      .ai-search-bar { background:${t.chip}; border:1px solid ${t.chipEdge}; box-shadow: inset 0 1px 0 ${t.hi}; border-radius:999px; color:${this._Wt('0.55')}; }
      .ai-insights-row { background:${t.chip}; border:1px solid ${t.chipEdge}; box-shadow: inset 0 1px 0 ${t.hi}; border-radius:20px; }
      .mod-card { background:${t.chip}; border:1px solid ${t.chipEdge}; box-shadow: inset 0 1px 0 ${t.hi}; border-radius:20px; }
    `;
  }
}

// ── Visual editor ────────────────────────────────────────────────────────
class HorseHealthCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = {
      ...HorseHealthCard.getStubConfig(),
      ...config,
      module_overrides: { ...(config.module_overrides || {}) },
      module_order: (config.module_order && config.module_order.length) ? [...config.module_order] : [...HORSE_MODULE_KEYS],
    };
    this._render();
  }

  connectedCallback() { this._render(); }

  // Only renders on the first hass delivery (or when setConfig explicitly
  // asks for one). hass updates on almost every entity state change
  // anywhere in the house, so re-rendering on every tick here was tearing
  // down and rebuilding the whole form mid-interaction — including while
  // a native <select> picker sheet was open, closing it before a tap
  // could register. Auto-fill and option-building still always read the
  // latest this._hass when they do run, so nothing goes stale — it just
  // doesn't force a redraw the user never asked for.
  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._rendered = true;
      this._render();
    }
  }

  _emit() {
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }

  _conversationAgents() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter(e => e.startsWith('conversation.'))
      .map(e => ({ id: e, name: this._hass.states[e]?.attributes?.friendly_name || e }));
  }

  _getMod(key) {
    return HORSE_MODULES.find(m => m.key === key);
  }

  // Fills in module_overrides for anything unset, auto-selecting the
  // best-scoring candidate per field on render. Runs once per render (idempotent — only ever
  // touches keys that are still empty), so it settles after the first
  // pass and never fights a manual choice.
  _autoFillOverrides() {
    if (!this._hass) return;
    const sensors = Object.keys(this._hass.states).filter(e => e.startsWith('sensor.'));
    const overrides = { ...this._config.module_overrides };
    let changed = false;
    HORSE_MODULES.forEach(mod => {
      if (mod.composite || overrides[mod.key]) return;
      const candidates = horseScoredCandidates(sensors, horseModuleKeywords(mod), this._hass);
      if (candidates[0] && candidates[0].score > 0) { overrides[mod.key] = candidates[0].e; changed = true; }
    });
    if (changed) {
      this._config = { ...this._config, module_overrides: overrides };
      this._emit();
    }
  }

  _moduleEntityHint(mod, candidates) {
    const override = this._config.module_overrides[mod.key];
    if (override) return `Override: ${override}`;
    if (mod.composite) return 'Computed from other modules — nothing to map';
    if (candidates && candidates[0] && candidates[0].score > 0) return `★ Auto-detected: ${candidates[0].e}`;
    return 'Not detected — choose a sensor below';
  }

  // "— Auto —" first, then candidates scoring above zero (starred), a
  // divider, then everything else. Picking "— Auto —" clears the override, so the card
  // (and this editor's own auto-fill, next render) goes back to
  // whatever scores best live.
  _buildHorseOptions(candidates, sel) {
    const sug = candidates.filter(c => c.score > 0);
    const rest = candidates.filter(c => c.score === 0);
    const opt = (e, starred) => {
      const name = this._hass.states[e]?.attributes?.friendly_name || e;
      return `<option value="${e}" ${e === sel ? 'selected' : ''}>${starred ? '★ ' : ''}${this._esc(name)} (${e})</option>`;
    };
    const divider = sug.length && rest.length ? '<option disabled>──────────────────</option>' : '';
    return `<option value="" ${!sel ? 'selected' : ''}>— Auto —</option>${sug.map(c => opt(c.e, true)).join('')}${divider}${rest.map(c => opt(c.e, false)).join('')}`;
  }

  // Modules in the user's saved drag order, falling back to the catalog
  // order and appending any module the saved order doesn't mention yet.
  _orderedModules() {
    const order = (this._config.module_order && this._config.module_order.length) ? this._config.module_order : HORSE_MODULE_KEYS;
    const byKey = new Map(HORSE_MODULES.map(m => [m.key, m]));
    const ordered = order.map(k => byKey.get(k)).filter(Boolean);
    HORSE_MODULES.forEach(m => { if (!m.hidden && !order.includes(m.key)) ordered.push(m); });
    return ordered;
  }

  // A search input + select for one module — used for every ordinary
  // module row and for Blood Pressure's two hidden sub-fields. Registers
  // itself in this._pendingSearchWiring so _wireModuleSearches can hook
  // up the live filter after the DOM exists.
  _pickerRowHtml(mod, sensors) {
    const candidates = horseScoredCandidates(sensors, horseModuleKeywords(mod), this._hass);
    const current = this._config.module_overrides[mod.key] || '';
    this._pendingSearchWiring.push({ key: mod.key, candidates });
    return `
      <div class="hint" style="margin:4px 0 4px;">${this._esc(this._moduleEntityHint(mod, candidates))}</div>
      <input type="text" class="entity-search" data-module="${mod.key}" placeholder="Search sensors…">
      <select class="override-select" data-module="${mod.key}">${this._buildHorseOptions(candidates, current)}</select>
    `;
  }

  _render() {
    if (!this._config) return;
    this._autoFillOverrides();
    this._pendingSearchWiring = []; // [{key, candidates}] — filled by _pickerRowHtml, read by _wireModuleSearches

    const cfg = this._config;
    const enabledSet = new Set(cfg.enabled_modules || []);
    const sensors = this._hass ? Object.keys(this._hass.states).filter(e => e.startsWith('sensor.')) : [];
    const bpSystolicMod = this._getMod('blood_pressure_systolic');
    const bpDiastolicMod = this._getMod('blood_pressure_diastolic');
    const remMod = this._getMod('rem_sleep');
    const deepMod = this._getMod('deep_sleep');
    const coreMod = this._getMod('core_sleep');
    const awakeMod = this._getMod('awake');

    this.shadowRoot.innerHTML = `
      <style>${this._editorCss()}</style>
      <div class="container">

        <div>
          <div class="section-title">Card Title</div>
          <div class="card-block">
            <div class="input-row">
              <input type="text" id="title" placeholder="e.g. Summary" maxlength="60" value="${this._esc(cfg.title)}">
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Appearance</div>
          <div class="hint" style="margin-bottom:6px;">Classic is the card as it was. Glass is a frosted, translucent surface with blur and soft highlights.</div>
          <div class="card-block">
            <div class="input-row">
              <label style="font-size:13px;font-weight:600;color:var(--primary-text-color);">Style</label>
              <div class="segmented" id="styleSegmented">
                <button type="button" class="segmented-btn ${cfg.card_style !== 'glass' ? 'active' : ''}" data-value="classic">Classic</button>
                <button type="button" class="segmented-btn ${cfg.card_style === 'glass' ? 'active' : ''}" data-value="glass">Glass</button>
              </div>
            </div>
            <div class="input-row" id="glassOnly" style="border-top:1px solid rgba(128,128,128,0.12); opacity:${cfg.card_style === 'glass' ? '1' : '0.4'}; pointer-events:${cfg.card_style === 'glass' ? 'auto' : 'none'};">
              <label style="font-size:13px;font-weight:600;color:var(--primary-text-color);">Theme</label>
              <div class="hint">For the Glass card and its pop-ups. Auto follows your Home Assistant theme.</div>
              <div class="segmented" id="themeSegmented">
                <button type="button" class="segmented-btn ${cfg.appearance !== 'light' && cfg.appearance !== 'dark' ? 'active' : ''}" data-value="auto">Auto</button>
                <button type="button" class="segmented-btn ${cfg.appearance === 'light' ? 'active' : ''}" data-value="light">Light</button>
                <button type="button" class="segmented-btn ${cfg.appearance === 'dark' ? 'active' : ''}" data-value="dark">Dark</button>
              </div>
              <label style="font-size:13px;font-weight:600;color:var(--primary-text-color);margin-top:10px;display:block;">Glass — <span id="glassPct">${cfg.glass}</span>%</label>
              <div class="hint">How see-through the card is (needs a wallpaper or coloured view behind it).</div>
              <input type="range" id="glass" min="0" max="100" step="5" value="${cfg.glass}">
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Accent Color</div>
          <div class="hint" style="margin-bottom:6px;">Used for the AI insight card, ring charts, and PDF report headers.</div>
          <div class="card-block">
            <div class="input-row">
              <div class="preset-row">
                ${HORSE_ACCENT_PRESETS.map(c => `<button type="button" class="preset-swatch ${cfg.accent_color.toLowerCase() === c.toLowerCase() ? 'active' : ''}" data-value="${c}" style="background:${c};"></button>`).join('')}
              </div>
            </div>
            <div class="input-row" style="flex-direction:row;align-items:center;gap:10px;border-top:1px solid rgba(128,128,128,0.12);">
              <div class="colour-swatch" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">
                <input type="color" id="accent_color_picker" value="${cfg.accent_color}">
              </div>
              <input type="text" id="accent_color" value="${cfg.accent_color}" style="flex:1;">
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">History Range</div>
          <div class="hint" style="margin-bottom:6px;">How many days of history the detail charts and PDF exports cover.</div>
          <div class="card-block">
            <div class="input-row">
              <input type="number" id="history_days" min="1" max="90" value="${cfg.history_days}">
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Blood Glucose Unit</div>
          <div class="hint" style="margin-bottom:6px;">Whichever your sensor actually reports in — this adjusts the plausible range and target bands to match (mg/dL: 70-180, mmol/L: 3.9-10.0).</div>
          <div class="card-block">
            <div class="input-row">
              <select id="glucose_unit" style="flex:1;">
                <option value="mg/dL" ${cfg.glucose_unit !== 'mmol/L' ? 'selected' : ''}>mg/dL</option>
                <option value="mmol/L" ${cfg.glucose_unit === 'mmol/L' ? 'selected' : ''}>mmol/L</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Modules</div>
          <div class="hint" style="margin-bottom:6px;">Each module auto-detects its best-matching sensor (★) — search to override if it picked the wrong one. Drag the handle to reorder how these appear on the card.</div>
          <div class="card-block">
            <div class="checklist" id="moduleList">
              ${this._orderedModules().map(mod => `
                <div class="check-item" data-module="${mod.key}">
                  <div class="drag-handle">
                    <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#888;display:block;"><path d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V21V19Z"/></svg>
                  </div>
                  <div class="module-row-main">
                    <div class="module-row-top">
                      <div>
                        <div class="toggle-label">${this._esc(mod.label)}</div>
                        <div class="toggle-sublabel">${this._esc(mod.category)}</div>
                      </div>
                      <label class="toggle-switch">
                        <input type="checkbox" class="module-toggle" data-module="${mod.key}" ${enabledSet.has(mod.key) ? 'checked' : ''}><span class="toggle-track"></span>
                      </label>
                    </div>
                    ${!mod.composite ? this._pickerRowHtml(mod, sensors) : ''}
                    ${mod.key === 'blood_pressure' ? `
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">Systolic</div>
                        ${this._pickerRowHtml(bpSystolicMod, sensors)}
                      </div>
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">Diastolic</div>
                        ${this._pickerRowHtml(bpDiastolicMod, sensors)}
                      </div>
                    ` : ''}
                    ${mod.key === 'sleep_score' ? `
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">REM Sleep</div>
                        ${this._pickerRowHtml(remMod, sensors)}
                      </div>
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">Deep Sleep</div>
                        ${this._pickerRowHtml(deepMod, sensors)}
                      </div>
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">Core Sleep</div>
                        ${this._pickerRowHtml(coreMod, sensors)}
                      </div>
                      <div class="bp-sub-row">
                        <div class="toggle-label" style="font-size:12px;">Awake</div>
                        ${this._pickerRowHtml(awakeMod, sensors)}
                      </div>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">AI Features</div>
          <div class="hint" style="margin-bottom:6px;">Off by default. Nothing AI-related runs until Enable AI Features is on and an assistant is selected.</div>
          <div class="card-block">
            <div class="toggle-list">
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Enable AI Features</div>
                  <div class="toggle-sublabel">Master switch for the insight card below</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_features_enabled" ${cfg.ai_features_enabled ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
            </div>
            <div class="select-row" style="border-top:1px solid rgba(128,128,128,0.1)">
              <label>Conversation Agent</label>
              <select id="ai_conversation_agent">${this._agentSelectOptions()}</select>
            </div>
            <div class="toggle-list" style="border-top:1px solid rgba(128,128,128,0.1)">
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Daily Summary</div>
                  <div class="toggle-sublabel">One-line AI summary shown at the top of the card</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_daily_summary" ${cfg.ai_daily_summary !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Trend Notes</div>
                  <div class="toggle-sublabel">Mentions notable week-over-week changes in the summary</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_trend_notes" ${cfg.ai_trend_notes !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">AI Advice</div>
                  <div class="toggle-sublabel">Adds an on-demand "Improve This" tip to modules where general lifestyle advice makes sense (Activity, Sleep, Water, Weight) — never for vitals or anything medical</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_advice_enabled" ${cfg.ai_advice_enabled !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Weekly/Monthly Recap</div>
                  <div class="toggle-sublabel">A longer AI digest covering multiple metrics together, on the summary screen</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_recap_enabled" ${cfg.ai_recap_enabled !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Ask About Your Health</div>
                  <div class="toggle-sublabel">A free-text question box on the summary screen, answered using your recent data</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="ai_ask_enabled" ${cfg.ai_ask_enabled !== false ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-title">Storage</div>
          <div class="card-block">
            <div class="toggle-list">
              <div class="toggle-item">
                <div>
                  <div class="toggle-label">Persistent Storage</div>
                  <div class="toggle-sublabel">Sync preferences via Home Assistant's frontend user data, not just this browser</div>
                </div>
                <label class="toggle-switch"><input type="checkbox" id="persistent_storage" ${cfg.persistent_storage ? 'checked' : ''}><span class="toggle-track"></span></label>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;

    const root = this.shadowRoot;
    const on = (id, evt, fn) => { const el = root.getElementById(id); if (el) el.addEventListener(evt, fn); };

    on('title', 'input', e => { this._config = { ...this._config, title: e.target.value }; this._emit(); });
    on('history_days', 'change', e => {
      const n = parseInt(e.target.value, 10);
      this._config = { ...this._config, history_days: Number.isFinite(n) && n > 0 ? n : 7 };
      this._emit();
    });
    on('glucose_unit', 'change', e => { this._config = { ...this._config, glucose_unit: e.target.value }; this._emit(); });
    on('accent_color', 'change', e => { this._config = { ...this._config, accent_color: e.target.value }; this._emit(); });
    on('accent_color_picker', 'input', e => {
      this._config = { ...this._config, accent_color: e.target.value };
      const hexInput = root.getElementById('accent_color');
      if (hexInput) hexInput.value = e.target.value;
      this._emit();
    });
    root.querySelectorAll('.preset-swatch').forEach(el => {
      el.addEventListener('click', () => {
        this._config = { ...this._config, accent_color: el.dataset.value };
        this._emit();
        root.querySelectorAll('.preset-swatch').forEach(s => s.classList.toggle('active', s.dataset.value.toLowerCase() === el.dataset.value.toLowerCase()));
        const hexInput = root.getElementById('accent_color');
        const picker = root.getElementById('accent_color_picker');
        if (hexInput) hexInput.value = el.dataset.value;
        if (picker) picker.value = el.dataset.value;
      });
    });
    root.querySelectorAll('#styleSegmented .segmented-btn').forEach(el => {
      el.addEventListener('click', () => {
        this._config = { ...this._config, card_style: el.dataset.value };
        this._emit();
        this._syncAppearanceUI();
      });
    });
    root.querySelectorAll('#themeSegmented .segmented-btn').forEach(el => {
      el.addEventListener('click', () => {
        this._config = { ...this._config, appearance: el.dataset.value };
        this._emit();
        this._syncAppearanceUI();
      });
    });
    on('glass', 'input', e => {
      this._config = { ...this._config, glass: parseInt(e.target.value, 10) };
      this._emit();
      const pct = root.getElementById('glassPct');
      if (pct) pct.textContent = this._config.glass;
    });
    on('persistent_storage', 'change', e => { this._config = { ...this._config, persistent_storage: e.target.checked }; this._emit(); });
    on('ai_features_enabled', 'change', e => { this._config = { ...this._config, ai_features_enabled: e.target.checked }; this._emit(); });
    on('ai_conversation_agent', 'change', e => { this._config = { ...this._config, ai_conversation_agent: e.target.value }; this._emit(); });
    on('ai_daily_summary', 'change', e => { this._config = { ...this._config, ai_daily_summary: e.target.checked }; this._emit(); });
    on('ai_trend_notes', 'change', e => { this._config = { ...this._config, ai_trend_notes: e.target.checked }; this._emit(); });
    on('ai_advice_enabled', 'change', e => { this._config = { ...this._config, ai_advice_enabled: e.target.checked }; this._emit(); });
    on('ai_recap_enabled', 'change', e => { this._config = { ...this._config, ai_recap_enabled: e.target.checked }; this._emit(); });
    on('ai_ask_enabled', 'change', e => { this._config = { ...this._config, ai_ask_enabled: e.target.checked }; this._emit(); });

    root.querySelectorAll('.module-toggle').forEach(el => {
      el.addEventListener('change', e => {
        const key = e.target.dataset.module;
        let enabled = [...(this._config.enabled_modules || [])];
        if (e.target.checked) { if (!enabled.includes(key)) enabled.push(key); }
        else { enabled = enabled.filter(k => k !== key); }
        this._config = { ...this._config, enabled_modules: enabled };
        this._emit();
      });
    });

    root.querySelectorAll('.override-select').forEach(el => {
      el.addEventListener('change', e => {
        const key = e.target.dataset.module;
        const overrides = { ...this._config.module_overrides };
        if (e.target.value) overrides[key] = e.target.value;
        else delete overrides[key];
        this._config = { ...this._config, module_overrides: overrides };
        this._emit();
        this._render(); // refresh the hint line above the select to reflect the new override
      });
    });

    this._wireModuleSearches();
    this._setupModuleReordering();
    this._syncAppearanceUI();
  }

  // Flips the segmented-button/enabled-row state in place without
  // rebuilding the DOM — rebuilding on every Style/Theme tap would tear
  // down and redraw mid-interaction the same way a full hass-driven
  // re-render would, per _wireModuleSearches' note above.
  _syncAppearanceUI() {
    const root = this.shadowRoot; if (!root) return;
    const cfg = this._config || {};
    const glassOn = cfg.card_style === 'glass';
    root.querySelectorAll('#styleSegmented .segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.value === (glassOn ? 'glass' : 'classic')));
    root.querySelectorAll('#themeSegmented .segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.value === (cfg.appearance || 'auto')));
    const go = root.getElementById('glassOnly');
    if (go) { go.style.opacity = glassOn ? '1' : '0.4'; go.style.pointerEvents = glassOn ? 'auto' : 'none'; }
    const gl = root.getElementById('glass');
    if (gl) gl.value = Number.isFinite(cfg.glass) ? cfg.glass : 50;
    const pct = root.getElementById('glassPct');
    if (pct) pct.textContent = Number.isFinite(cfg.glass) ? cfg.glass : 50;
  }

  // Live-filters each module's <select> as its search box is typed into
  // — rebuild the option
  // list from the pre-scored candidate set, filtered to whatever matches
  // the typed text, keeping the starred/divider/rest grouping intact.
  _wireModuleSearches() {
    const root = this.shadowRoot;
    (this._pendingSearchWiring || []).forEach(({ key, candidates }) => {
      const searchEl = root.querySelector(`.entity-search[data-module="${key}"]`);
      const selectEl = root.querySelector(`.override-select[data-module="${key}"]`);
      if (!searchEl || !selectEl) return;
      searchEl.addEventListener('input', () => {
        const term = searchEl.value.toLowerCase().trim();
        const cur = selectEl.value;
        const pool = term
          ? candidates.filter(c => c.e.toLowerCase().includes(term) || (this._hass.states[c.e]?.attributes?.friendly_name || '').toLowerCase().includes(term))
          : candidates;
        selectEl.innerHTML = this._buildHorseOptions(pool, cur);
      });
    });
  }

  // Pointer-based drag reordering for the Modules checklist — same
  // technique as a "Manage & Reorder
  // Players" list: a drag handle starts the gesture, a floating ghost
  // clone follows the pointer, and the row is inserted at the drop
  // target's position in the DOM. Every row is draggable regardless of
  // its toggle state — order should survive even for a module that's
  // currently switched off, the same way Apple Health's own Edit screen
  // lets you drag hidden items too.
  _setupModuleReordering() {
    const list = this.shadowRoot.getElementById('moduleList');
    if (!list) return;
    let dragging = null;
    let dragClone = null;
    let offsetY = 0;
    let lastTarget = null;
    let dragBelow = false;

    const getDropTarget = (clientY) => {
      for (const el of list.querySelectorAll('.check-item:not(.dragging)')) {
        const box = el.getBoundingClientRect();
        if (clientY < box.top + box.height / 2) return el;
      }
      return null;
    };

    const onDown = (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const item = handle.closest('.check-item');
      if (!item) return;

      e.preventDefault();
      list.setPointerCapture(e.pointerId);

      dragging = item;
      const box = item.getBoundingClientRect();
      offsetY = e.clientY - box.top;
      item.classList.add('dragging');
      list.style.touchAction = 'none';

      dragClone = document.createElement('div');
      dragClone.textContent = item.querySelector('.toggle-label')?.textContent || item.dataset.module || '';
      dragClone.style.cssText = [
        'position:fixed', 'left:' + box.left + 'px', 'top:' + box.top + 'px',
        'width:' + box.width + 'px', 'height:' + box.height + 'px', 'z-index:9999',
        'pointer-events:none', 'opacity:0.92', 'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
        'border-radius:8px', 'background:#2c2c2e', 'color:#fff', 'font-size:14px',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'display:flex',
        'align-items:center', 'padding:0 16px', 'transition:none',
      ].join(';');
      document.body.appendChild(dragClone);
    };

    const onMove = (e) => {
      if (!dragging) return;
      if (dragClone) dragClone.style.top = (e.clientY - offsetY) + 'px';
      const target = getDropTarget(e.clientY);
      if (lastTarget) lastTarget.style.borderTop = '';
      lastTarget = target;
      dragBelow = !target;
      if (target) target.style.borderTop = '2px solid #0A84FF';
    };

    const onEnd = () => {
      if (!dragging) return;
      if (dragClone) { dragClone.remove(); dragClone = null; }
      const finalTarget = lastTarget;
      const finalBelow = dragBelow;
      if (lastTarget) { lastTarget.style.borderTop = ''; lastTarget = null; }
      dragging.classList.remove('dragging');
      list.style.touchAction = '';

      if (!finalBelow && finalTarget) list.insertBefore(dragging, finalTarget);
      else list.appendChild(dragging);

      dragging = null;
      dragBelow = false;
      this._saveModuleOrder();
    };

    const onCancel = () => {
      if (dragClone) { dragClone.remove(); dragClone = null; }
      if (dragging) { dragging.classList.remove('dragging'); dragging = null; }
      if (lastTarget) { lastTarget.style.borderTop = ''; lastTarget = null; }
      list.style.touchAction = '';
      dragBelow = false;
    };

    list.addEventListener('pointerdown', onDown, { passive: false });
    list.addEventListener('pointermove', onMove, { passive: true });
    list.addEventListener('pointerup', onEnd);
    list.addEventListener('pointercancel', onCancel);
  }

  _saveModuleOrder() {
    const root = this.shadowRoot;
    const newOrder = Array.from(root.querySelectorAll('#moduleList .check-item')).map(i => i.dataset.module);
    this._config = { ...this._config, module_order: newOrder };
    this._emit();
  }

  _agentSelectOptions() {
    const agents = this._conversationAgents();
    const current = this._config.ai_conversation_agent || '';
    const opts = agents.map(a => `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${this._esc(a.name)} (${a.id})</option>`).join('');
    return `<option value="" ${!current ? 'selected' : ''}>— Default —</option>${opts}`;
  }

  _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Consistent visual language: uppercase section
  // titles, bordered card-block groups, native selects with a custom
  // chevron, and the same green iOS toggle switch — so this card's
  // editor reads as part of the same family as the others.
  _editorCss() {
    return `
      * { box-sizing: border-box; }
      :host { display:block; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
      .container { display:flex; flex-direction:column; gap:16px; padding:4px 0 8px; }
      .section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#888; margin-bottom:4px; }
      .card-block { background:var(--card-background-color); border:1px solid rgba(128,128,128,0.18); border-radius:12px; overflow:hidden; }
      .hint { font-size:11px; color:#888; }
      .input-row { padding:12px 16px; display:flex; flex-direction:column; gap:6px; }
      .select-row { padding:12px 16px; display:flex; flex-direction:column; gap:6px; }
      .select-row label { font-size:13px; font-weight:600; color:var(--primary-text-color); }
      select, input[type="text"], input[type="number"] {
        width:100%; background:var(--secondary-background-color,rgba(0,0,0,0.06));
        color:var(--primary-text-color); border:1px solid rgba(128,128,128,0.2);
        border-radius:8px; padding:9px 12px; font-size:13px;
        -webkit-appearance:none; appearance:none;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat:no-repeat; background-position:right 12px center; padding-right:32px;
      }
      input[type="text"], input[type="number"] { background-image:none; padding-right:12px; cursor:text; }
      .entity-search { padding:7px 10px !important; font-size:12px !important; background:rgba(128,128,128,0.08) !important; margin-bottom:6px; }
      .colour-swatch { position:relative; overflow:hidden; border:1px solid rgba(128,128,128,0.25); }
      .colour-swatch input[type="color"] { position:absolute; inset:-4px; width:calc(100% + 8px); height:calc(100% + 8px); border:none; padding:0; cursor:pointer; }
      .segmented { display:flex; background:rgba(128,128,128,0.14); border-radius:9px; padding:2px; gap:2px; }
      .segmented-btn { flex:1; border:none; background:transparent; color:var(--primary-text-color); font-size:13px; font-weight:600; padding:7px 8px; border-radius:7px; cursor:pointer; font-family:inherit; transition:background 0.15s, box-shadow 0.15s; }
      .segmented-btn.active { background:var(--card-background-color,#fff); box-shadow:0 1px 3px rgba(0,0,0,0.25); }
      .preset-row { display:flex; flex-wrap:wrap; gap:8px; }
      .preset-swatch { width:28px; height:28px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; }
      .preset-swatch.active { border-color:var(--primary-text-color); box-shadow:0 0 0 2px var(--card-background-color); }
      input[type="range"] { width:100%; height:30px; -webkit-appearance:none; appearance:none; background:transparent; cursor:pointer; }
      input[type="range"]::-webkit-slider-runnable-track { height:4px; border-radius:2px; background:rgba(128,128,128,0.3); }
      input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:22px; height:22px; margin-top:-9px; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.35); }
      input[type="range"]::-moz-range-track { height:4px; border-radius:2px; background:rgba(128,128,128,0.3); }
      input[type="range"]::-moz-range-thumb { width:22px; height:22px; border:none; border-radius:50%; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,0.35); }
      .toggle-list { display:flex; flex-direction:column; }
      .toggle-item { display:flex; align-items:center; justify-content:space-between; padding:13px 16px; border-bottom:1px solid rgba(128,128,128,0.1); min-height:52px; gap:10px; }
      .toggle-item:last-child { border-bottom:none; }
      .toggle-label { font-size:14px; font-weight:500; }
      .toggle-sublabel { font-size:11px; color:#888; margin-top:1px; }
      .toggle-switch { position:relative; width:51px; height:31px; flex-shrink:0; }
      .toggle-switch input { opacity:0; width:0; height:0; position:absolute; }
      .toggle-track { position:absolute; inset:0; border-radius:31px; background:rgba(120,120,128,0.32); cursor:pointer; transition:background 0.25s; }
      .toggle-track::after { content:''; position:absolute; width:27px; height:27px; border-radius:50%; background:#fff; top:2px; left:2px; box-shadow:0 2px 6px rgba(0,0,0,0.3); transition:transform 0.25s; }
      .toggle-switch input:checked + .toggle-track { background:#34C759; }
      .toggle-switch input:checked + .toggle-track::after { transform:translateX(20px); }
      .module-row-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .override-select { font-size:12px; padding:7px 30px 7px 10px; background-position:right 10px center; margin-top:2px; }
      .bp-sub-row { margin-top:12px; padding-top:12px; border-top:1px solid rgba(128,128,128,0.1); }

      /* Modules checklist — drag-to-reorder,
         "Manage & Reorder Media Players" list. */
      .checklist { max-height:600px; overflow-y:auto; -webkit-overflow-scrolling:touch; }
      .check-item { display:flex; align-items:flex-start; padding:6px 10px 10px 4px; border-bottom:1px solid rgba(128,128,128,0.1); background:var(--card-background-color); }
      .check-item:last-child { border-bottom:none; }
      .check-item.dragging { opacity:0.5; background:rgba(128,128,128,0.15); }
      .drag-handle { cursor:grab; padding:10px 6px; color:#888; flex-shrink:0; touch-action:none; }
      .drag-handle:active { cursor:grabbing; }
      .module-row-main { flex:1; min-width:0; padding:7px 0; }
    `;
  }
}

customElements.define('crow-health-card', HorseHealthCard);
customElements.define('crow-health-card-editor', HorseHealthCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'crow-health-card',
  name: 'Crow Health Card',
  description: 'Apple Health-style dashboard card for HA Companion App health sensors, with AI insights and CSV/JSON/PDF export.'
});
