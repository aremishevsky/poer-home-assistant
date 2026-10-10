/* POER Thermostat cards for Home Assistant.
 *
 *   type: custom:poer-thermostat-card      – one zone, with controls
 *   entity: climate.kabinet
 *   name: Office                           – optional
 *   icon: mdi:thermostat                   – optional
 *   icon_size: 32                          – optional, px
 *   status_icon: mdi:fire                  – optional, shown while heating
 *   status_icon_size: 32                   – optional, px
 *   controls: vertical                     – vertical (chevrons) | horizontal (− +)
 *   show_modes: true                       – Auto / Heat / Off buttons
 *   show_presets: true                     – Home / Away buttons
 *
 *   type: custom:poer-overview-card        – grid of zones
 *   title: Heating                         – optional
 *   columns: 3                             – optional, tiles per row
 *   groups: [1st floor, 2nd floor]         – optional, group order
 *   entities:                              – optional, defaults to all POER thermostats
 *     - entity: climate.kabinet
 *       group: 2nd floor
 *     - climate.office                     – no group
 */

const VERSION = "1.0.1-dev";

const MODE_LABELS = { auto: "Auto", heat: "Heat", off: "Off" };
const PRESET_LABELS = { home: "Home", away: "Away" };
const SET_TEMP_DELAY_MS = 800;

const THERMOSTAT_DEFAULTS = {
  icon: "mdi:thermostat",
  icon_size: 32,
  status_icon: "mdi:fire",
  status_icon_size: 32,
  controls: "vertical",
  show_modes: true,
  show_presets: true,
};
const OVERVIEW_DEFAULTS = { columns: 3 };

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (v, digits = 1) => (v === undefined || v === null || isNaN(v) ? "—" : Number(v).toFixed(digits));

const isUnavailable = (st) => !st || st.state === "unavailable" || st.state === "unknown";

function zoneInfo(st) {
  const a = st.attributes;
  const unavailable = isUnavailable(st);
  return {
    name: a.friendly_name || st.entity_id,
    current: a.current_temperature,
    target: a.temperature,
    humidity: a.current_humidity,
    heating: !unavailable && a.hvac_action === "heating",
    mode: st.state,
    preset: a.preset_mode,
    unavailable,
  };
}

// Offline / Away / Auto / Heat / Off, plus css class for the badge colour
function statusOf(z) {
  if (z.unavailable) return { label: "Offline", cls: "offline" };
  if (z.preset === "away") return { label: "Away", cls: "away" };
  return { label: MODE_LABELS[z.mode] || z.mode, cls: z.mode };
}

function moreInfo(el, entityId) {
  el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

function fireConfigChanged(el, config) {
  el.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
}

function stripDefaults(config, defaults) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined || v === "" || v === null) continue;
    if (k in defaults && defaults[k] === v) continue;
    out[k] = v;
  }
  return out;
}

function poerClimates(hass) {
  const reg = hass.entities || {};
  return Object.keys(reg)
    .filter((id) => id.startsWith("climate.") && reg[id].platform === "poer" && !reg[id].hidden)
    .sort((a, b) => nameOf(hass, a).localeCompare(nameOf(hass, b)));
}

const nameOf = (hass, id) => hass.states[id]?.attributes.friendly_name || id;

// ha-form is lazy-loaded by the frontend; force it by loading a built-in card editor
async function loadHaForm() {
  if (customElements.get("ha-form")) return;
  const helpers = await window.loadCardHelpers?.();
  const card = await helpers?.createCardElement({ type: "entities", entities: [] });
  await card?.constructor?.getConfigElement?.();
}

const BASE_STYLE = `
  :host {
    --poer-heat: var(--state-climate-heat-color, #ff8100);
    --poer-auto: var(--state-climate-auto-color, #008000);
    --poer-off: var(--state-climate-off-color, #8a8a8a);
    --poer-away: var(--success-color, #43a047);
    --poer-muted: var(--secondary-text-color);
  }
  ha-card { padding: 16px; box-sizing: border-box; }
  ha-icon.flame { color: var(--poer-muted); opacity: .35; }
  .heating ha-icon.flame { color: var(--poer-heat); opacity: 1; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
  .badge {
    display: inline-flex; align-items: center;
    font-size: 11px; font-weight: 500; line-height: 1;
    padding: 3px 7px; border-radius: 10px;
    color: #fff; background: var(--poer-off);
  }
  .badge.heat { background: var(--poer-heat); }
  .badge.auto { background: var(--poer-auto); }
  .badge.away { background: var(--poer-away); }
  .badge.offline { background: var(--disabled-text-color, #bdbdbd); }
  .muted { color: var(--poer-muted); }
  .unavail { opacity: .45; }
`;

/* ================================================================ detail == */

class PoerThermostatCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("climate.")) {
      throw new Error("Set entity: climate.<name>");
    }
    this._config = { ...THERMOSTAT_DEFAULTS, ...config };
    this._pendingTarget = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    }
    this._lastState = undefined;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    if (st === this._lastState) return;
    this._lastState = st;
    this._render();
  }

  getCardSize() {
    return 2 + (this._config.show_modes ? 1 : 0) + (this._config.show_presets ? 1 : 0);
  }

  static getConfigElement() {
    return document.createElement("poer-thermostat-card-editor");
  }

  static getStubConfig(hass) {
    const entity = poerClimates(hass)[0] || Object.keys(hass.states).find((e) => e.startsWith("climate.")) || "";
    return { entity };
  }

  _onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const st = this._hass.states[this._config.entity];
    const { action, value } = btn.dataset;
    const entity_id = this._config.entity;

    if (action === "more-info") return moreInfo(this, entity_id);
    if (isUnavailable(st)) return;
    if (action === "mode") this._hass.callService("climate", "set_hvac_mode", { entity_id, hvac_mode: value });
    else if (action === "preset") this._hass.callService("climate", "set_preset_mode", { entity_id, preset_mode: value });
    else if (action === "step") this._stepTarget(st, Number(value));
  }

  _stepTarget(st, dir) {
    const a = st.attributes;
    const step = a.target_temp_step || 0.5;
    const base = this._pendingTarget ?? a.temperature ?? a.min_temp;
    const next = Math.min(a.max_temp, Math.max(a.min_temp, Math.round((base + dir * step) / step) * step));
    this._pendingTarget = Number(next.toFixed(1));
    this._render();

    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const temperature = this._pendingTarget;
      this._hass
        .callService("climate", "set_temperature", { entity_id: this._config.entity, temperature })
        .finally(() => {
          this._pendingTarget = null;
        });
    }, SET_TEMP_DELAY_MS);
  }

  _setpointHtml(target, disabled) {
    const c = this._config;
    const vertical = c.controls !== "horizontal";
    const dis = disabled ? "disabled" : "";
    const value = `
      <div class="val ${this._pendingTarget !== null ? "pending" : ""}">
        ${fmt(target)}°<span class="lbl muted">Target</span></div>`;
    if (vertical) {
      return `
        <div class="setpoint vertical">
          <button class="chev" data-action="step" data-value="1" ${dis}><ha-icon icon="mdi:chevron-up"></ha-icon></button>
          ${value}
          <button class="chev" data-action="step" data-value="-1" ${dis}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        </div>`;
    }
    return `
      <div class="setpoint">
        <button class="round" data-action="step" data-value="-1" ${dis}><ha-icon icon="mdi:minus"></ha-icon></button>
        ${value}
        <button class="round" data-action="step" data-value="1" ${dis}><ha-icon icon="mdi:plus"></ha-icon></button>
      </div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const c = this._config;
    const st = this._hass.states[c.entity];

    if (!st) {
      this.shadowRoot.innerHTML = `<style>${BASE_STYLE}</style>
        <ha-card><div class="muted">Entity ${esc(c.entity)} not found</div></ha-card>`;
      return;
    }

    const z = zoneInfo(st);
    const status = statusOf(z);
    const target = this._pendingTarget ?? z.target;
    const modes = st.attributes.hvac_modes || Object.keys(MODE_LABELS);
    const presets = st.attributes.preset_modes || Object.keys(PRESET_LABELS);

    const modeBtns = modes
      .map(
        (m) => `<button class="seg ${m} ${!z.unavailable && z.mode === m && z.preset !== "away" ? "on" : ""}"
                  data-action="mode" data-value="${esc(m)}">${esc(MODE_LABELS[m] || m)}</button>`
      )
      .join("");
    const presetBtns = presets
      .map(
        (p) => `<button class="seg ${esc(p)} ${!z.unavailable && z.preset === p ? "on" : ""}"
                  data-action="preset" data-value="${esc(p)}">${esc(PRESET_LABELS[p] || p)}</button>`
      )
      .join("");

    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        ha-card.heating {
          box-shadow: inset 4px 0 0 var(--poer-heat), var(--ha-card-box-shadow, none);
          background:
            linear-gradient(90deg, color-mix(in srgb, var(--poer-heat) 10%, transparent), transparent 55%),
            var(--ha-card-background, var(--card-background-color, #fff));
        }
        .head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .head .icon { --mdc-icon-size: ${Number(c.icon_size) || 32}px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .heating .head .icon { color: var(--poer-heat); }
        .head .flame { --mdc-icon-size: ${Number(c.status_icon_size) || 32}px; }
        .head .name { font-size: 18px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .main { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0 10px; }
        .current { font-size: 48px; font-weight: 300; line-height: 1; }
        .current small { font-size: 18px; vertical-align: top; margin-left: 2px; }
        .meta { margin-top: 8px; display: flex; align-items: center; gap: 10px; font-size: 13px; }
        .meta ha-icon { --mdc-icon-size: 16px; vertical-align: -3px; }
        .setpoint { display: flex; align-items: center; gap: 6px; }
        .setpoint.vertical { flex-direction: column; gap: 0; }
        .val { min-width: 64px; text-align: center; font-size: 24px; font-weight: 500; line-height: 1.1; }
        .val.pending { color: var(--primary-color); }
        .val .lbl { display: block; font-size: 11px; font-weight: 400; }
        button { font: inherit; color: var(--primary-text-color); cursor: pointer; }
        .round, .chev {
          border: none; display: grid; place-items: center;
          background: var(--secondary-background-color);
        }
        .round { width: 36px; height: 36px; border-radius: 50%; }
        .chev { width: 48px; height: 28px; border-radius: 14px; background: transparent; }
        .chev ha-icon { --mdc-icon-size: 28px; }
        .chev:hover:not(:disabled) { background: var(--secondary-background-color); }
        .round:active, .chev:active { filter: brightness(.9); }
        .row { display: flex; gap: 6px; margin-top: 8px; }
        .seg {
          flex: 1; padding: 8px 0; border: none; border-radius: 8px; font-size: 13px;
          background: var(--secondary-background-color);
        }
        .seg.on { color: #fff; background: var(--poer-off); }
        .seg.on.heat { background: var(--poer-heat); }
        .seg.on.auto { background: var(--poer-auto); }
        .seg.on.away { background: var(--poer-away); }
        .seg.on.home { background: var(--primary-color); }
        button:disabled { cursor: default; opacity: .5; }
      </style>
      <ha-card class="${z.unavailable ? "unavail" : ""} ${z.heating ? "heating" : ""}">
        <div class="head" data-action="more-info">
          <ha-icon class="icon" icon="${esc(c.icon)}"></ha-icon>
          <span class="name">${esc(c.name || z.name)}</span>
          ${z.unavailable ? `<span class="badge offline">Offline</span>` : `<ha-icon class="flame" icon="${esc(c.status_icon)}"></ha-icon>`}
        </div>

        <div class="main">
          <div>
            <div class="current">${fmt(z.current)}<small>°C</small></div>
            <div class="meta muted">
              <span class="badge ${status.cls}">${esc(status.label)}</span>
              <span><ha-icon icon="mdi:water-percent"></ha-icon>${fmt(z.humidity, 0)}%</span>
              <span>${z.heating ? "Heating" : "Idle"}</span>
            </div>
          </div>
          ${this._setpointHtml(target, z.unavailable)}
        </div>

        ${c.show_modes ? `<div class="row">${modeBtns}</div>` : ""}
        ${c.show_presets ? `<div class="row">${presetBtns}</div>` : ""}
      </ha-card>`;
  }
}

class PoerThermostatCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    loadHaForm().then(() => this._render());
  }

  _render() {
    if (!this._hass || !this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => THERMOSTAT_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (e) => {
        const config = { type: this._config.type, ...stripDefaults(e.detail.value, THERMOSTAT_DEFAULTS) };
        fireConfigChanged(this, config);
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = THERMOSTAT_SCHEMA;
    this._form.data = { ...THERMOSTAT_DEFAULTS, ...this._config };
  }
}

const THERMOSTAT_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: "climate", integration: "poer" } } },
  { name: "name", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "icon", selector: { icon: {} } },
      { name: "icon_size", selector: { number: { min: 16, max: 96, mode: "box", unit_of_measurement: "px" } } },
      { name: "status_icon", selector: { icon: {} } },
      { name: "status_icon_size", selector: { number: { min: 16, max: 96, mode: "box", unit_of_measurement: "px" } } },
    ],
  },
  {
    name: "controls",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "vertical", label: "Up / down (chevrons)" },
          { value: "horizontal", label: "Left / right (− +)" },
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "show_modes", selector: { boolean: {} } },
      { name: "show_presets", selector: { boolean: {} } },
    ],
  },
];

const THERMOSTAT_LABELS = {
  entity: "Thermostat",
  name: "Name (optional)",
  icon: "Icon",
  icon_size: "Icon size",
  status_icon: "Heating icon",
  status_icon_size: "Heating icon size",
  controls: "Target buttons layout",
  show_modes: "Show mode buttons (Auto / Heat / Off)",
  show_presets: "Show preset buttons (Home / Away)",
};

/* ============================================================== overview == */

// [{entity, group}] in display order; all POER thermostats when not configured
function overviewItems(hass, config) {
  if (!config.entities) return poerClimates(hass).map((entity) => ({ entity }));
  return config.entities.map((e) => (typeof e === "string" ? { entity: e } : { entity: e.entity, group: e.group }));
}

class PoerOverviewCard extends HTMLElement {
  setConfig(config) {
    this._config = { ...OVERVIEW_DEFAULTS, ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => {
        const tile = e.target.closest("[data-entity]");
        if (tile) moreInfo(this, tile.dataset.entity);
      });
    }
    this._lastKey = undefined;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const ids = overviewItems(hass, this._config).map((i) => i.entity);
    // re-render only when one of our entities changed
    const key = ids.map((id) => hass.states[id]?.last_updated).join("|");
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._render();
  }

  getCardSize() {
    const n = this._hass ? overviewItems(this._hass, this._config).length : 6;
    return 1 + Math.ceil(n / (Number(this._config.columns) || 3)) * 2;
  }

  static getConfigElement() {
    return document.createElement("poer-overview-card-editor");
  }

  static getStubConfig() {
    return { title: "Heating" };
  }

  _tile(id) {
    const st = this._hass.states[id];
    if (!st) return `<div class="tile unavail"><div class="name">${esc(id)}</div><div class="muted">not found</div></div>`;
    const z = zoneInfo(st);
    const status = statusOf(z);

    return `
      <div class="tile ${z.unavailable ? "unavail" : ""} ${z.heating ? "heating" : ""}" data-entity="${esc(id)}">
        <div class="top"><span class="name">${esc(z.name)}</span><ha-icon class="flame" icon="mdi:fire"></ha-icon></div>
        <div class="temps">
          <span class="temp">${fmt(z.current)}<small>°</small></span>
          <span class="target muted">→ ${fmt(z.target)}°</span>
        </div>
        <div class="bottom">
          <span class="badge ${status.cls}">${esc(status.label)}</span>
          <span class="muted"><ha-icon icon="mdi:water-percent"></ha-icon>${fmt(z.humidity, 0)}%</span>
        </div>
      </div>`;
  }

  _grid(items) {
    return `<div class="grid">${items.map((i) => this._tile(i.entity)).join("")}</div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const items = overviewItems(this._hass, this._config);
    const groups = this._config.groups || [];
    const heatingCount = items.filter((i) => this._hass.states[i.entity]?.attributes.hvac_action === "heating"
      && !isUnavailable(this._hass.states[i.entity])).length;

    let body;
    if (!items.length) {
      body = `<div class="empty muted">No POER thermostats</div>`;
    } else if (!groups.length) {
      body = this._grid(items);
    } else {
      const sections = groups
        .map((g) => [g, items.filter((i) => i.group === g)])
        .filter(([, list]) => list.length);
      const rest = items.filter((i) => !groups.includes(i.group));
      if (rest.length) sections.push(["Other", rest]);
      body = sections
        .map(([g, list]) => `<div class="group">${esc(g)}</div>${this._grid(list)}`)
        .join("");
    }

    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
        .header .title { font-size: 18px; font-weight: 500; }
        .group { font-size: 13px; font-weight: 500; color: var(--poer-muted); text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 8px; }
        .group:first-of-type { margin-top: 0; }
        .grid { display: grid; grid-template-columns: repeat(${Number(this._config.columns) || 3}, minmax(0, 1fr)); gap: 8px; }
        .tile {
          padding: 10px 12px; border-radius: 12px; cursor: pointer;
          background: var(--secondary-background-color);
          box-shadow: inset 3px 0 0 transparent;
        }
        .tile.heating { box-shadow: inset 3px 0 0 var(--poer-heat); }
        .top { display: flex; align-items: center; gap: 4px; }
        .top ha-icon { --mdc-icon-size: 18px; }
        .name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .temps { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin: 4px 0; }
        .temp { font-size: 26px; font-weight: 300; }
        .temp small { font-size: 14px; vertical-align: top; }
        .target { font-size: 13px; white-space: nowrap; }
        .bottom { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; }
        .bottom ha-icon { --mdc-icon-size: 14px; vertical-align: -2px; }
        .empty { padding: 8px 0; }
      </style>
      <ha-card>
        ${this._config.title || heatingCount ? `
        <div class="header">
          <span class="title">${esc(this._config.title || "")}</span>
          <span class="muted">${heatingCount ? `Heating: ${heatingCount}` : ""}</span>
        </div>` : ""}
        ${body}
      </ha-card>`;
  }
}

class PoerOverviewCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._render();
    else if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    loadHaForm().then(() => this._render());
  }

  _update(patch) {
    const merged = { ...this._config, ...patch };
    this._config = { type: merged.type, ...stripDefaults(merged, OVERVIEW_DEFAULTS) };
    fireConfigChanged(this, this._config);
    this._render();
  }

  // checked items in config order, then unchecked thermostats by name
  _rows() {
    const checked = overviewItems(this._hass, this._config);
    const checkedIds = new Set(checked.map((i) => i.entity));
    const unchecked = poerClimates(this._hass).filter((id) => !checkedIds.has(id));
    return [...checked.map((i) => ({ ...i, on: true })), ...unchecked.map((entity) => ({ entity, on: false }))];
  }

  _saveRows(rows) {
    const entities = rows.filter((r) => r.on).map((r) => (r.group ? { entity: r.entity, group: r.group } : r.entity));
    this._update({ entities });
  }

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
    const { act, idx } = el.dataset;
    const i = Number(idx);
    const groups = [...(this._config.groups || [])];

    if (act === "add-group") {
      groups.push(`Group ${groups.length + 1}`);
      this._update({ groups });
    } else if (act === "del-group") {
      const [removed] = groups.splice(i, 1);
      const rows = this._rows().map((r) => (r.group === removed ? { ...r, group: undefined } : r));
      this._config = { ...this._config, groups: groups.length ? groups : undefined };
      this._saveRows(rows);
    } else if (act === "up" || act === "down") {
      const rows = this._rows();
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= rows.length || !rows[j].on) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      this._saveRows(rows);
    }
  }

  _onChange(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const { act, idx } = el.dataset;
    const i = Number(idx);

    if (act === "toggle") {
      const rows = this._rows();
      rows[i].on = el.checked;
      // keep checked rows above unchecked ones
      this._saveRows([...rows.filter((r) => r.on), ...rows.filter((r) => !r.on)]);
    } else if (act === "group") {
      const rows = this._rows();
      rows[i].group = el.value || undefined;
      this._saveRows(rows);
    } else if (act === "rename") {
      const groups = [...(this._config.groups || [])];
      const old = groups[i];
      const name = el.value.trim();
      if (!name || name === old || groups.includes(name)) return this._render();
      groups[i] = name;
      const rows = this._rows().map((r) => (r.group === old ? { ...r, group: name } : r));
      this._config = { ...this._config, groups };
      this._saveRows(rows);
    }
  }

  _render() {
    if (!this._hass || !this._config || !customElements.get("ha-form")) return;

    if (!this._form) {
      this.innerHTML = `
        <style>
          .poer-ed h3 { font-size: 14px; font-weight: 500; margin: 20px 0 6px; }
          .poer-ed .hint { font-size: 12px; color: var(--secondary-text-color); margin: 0 0 8px; }
          .poer-ed .line { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--divider-color); }
          .poer-ed .line .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .poer-ed .line.off .nm { color: var(--secondary-text-color); }
          .poer-ed input[type=text], .poer-ed select {
            font: inherit; padding: 6px 8px; border-radius: 6px;
            border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
          }
          .poer-ed input[type=text] { flex: 1; }
          .poer-ed select { max-width: 40%; }
          .poer-ed input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--primary-color); }
          .poer-ed button {
            font: inherit; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;
            background: var(--secondary-background-color); color: var(--primary-text-color);
          }
          .poer-ed button:disabled { opacity: .3; cursor: default; }
          .poer-ed .add { margin-top: 8px; }
        </style>
        <div class="poer-ed"><div class="form"></div><div class="lists"></div></div>`;
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => ({ title: "Title", columns: "Tiles per row" })[s.name] || s.name;
      this._form.schema = [
        {
          type: "grid",
          name: "",
          schema: [
            { name: "title", selector: { text: {} } },
            { name: "columns", selector: { number: { min: 1, max: 8, mode: "box" } } },
          ],
        },
      ];
      this._form.addEventListener("value-changed", (e) => this._update(e.detail.value));
      this.querySelector(".form").appendChild(this._form);
      const lists = this.querySelector(".lists");
      lists.addEventListener("click", (e) => this._onClick(e));
      lists.addEventListener("change", (e) => this._onChange(e));
    }

    this._form.hass = this._hass;
    this._form.data = { ...OVERVIEW_DEFAULTS, ...this._config };

    const groups = this._config.groups || [];
    const rows = this._rows();
    const lastOn = rows.filter((r) => r.on).length - 1;

    const groupHtml = groups
      .map(
        (g, i) => `
        <div class="line">
          <input type="text" value="${esc(g)}" data-act="rename" data-idx="${i}">
          <button data-act="del-group" data-idx="${i}" title="Remove">✕</button>
        </div>`
      )
      .join("");

    const groupOptions = (sel) =>
      `<option value="">— no group —</option>` +
      groups.map((g) => `<option value="${esc(g)}" ${g === sel ? "selected" : ""}>${esc(g)}</option>`).join("");

    const rowHtml = rows
      .map(
        (r, i) => `
        <div class="line ${r.on ? "" : "off"}">
          <input type="checkbox" data-act="toggle" data-idx="${i}" ${r.on ? "checked" : ""}>
          <span class="nm">${esc(nameOf(this._hass, r.entity))}</span>
          ${r.on && groups.length ? `<select data-act="group" data-idx="${i}">${groupOptions(r.group)}</select>` : ""}
          ${r.on ? `
            <button data-act="up" data-idx="${i}" ${i === 0 ? "disabled" : ""} title="Move up">▲</button>
            <button data-act="down" data-idx="${i}" ${i === lastOn ? "disabled" : ""} title="Move down">▼</button>` : ""}
        </div>`
      )
      .join("");

    this.querySelector(".lists").innerHTML = `
      <h3>Groups</h3>
      <p class="hint">E.g. 1st floor, 2nd floor, Basement. Shown in this order.</p>
      ${groupHtml}
      <button class="add" data-act="add-group">+ Add group</button>

      <h3>Thermostats</h3>
      <p class="hint">Tick to show, ▲▼ to reorder${groups.length ? ", pick a group for each" : ""}.</p>
      ${rowHtml || `<p class="hint">No POER thermostats found</p>`}`;
  }
}

/* ============================================================ register == */

const define = (name, cls) => customElements.get(name) || customElements.define(name, cls);
define("poer-thermostat-card", PoerThermostatCard);
define("poer-thermostat-card-editor", PoerThermostatCardEditor);
define("poer-overview-card", PoerOverviewCard);
define("poer-overview-card-editor", PoerOverviewCardEditor);

window.customCards = window.customCards || [];
window.customCards.push(
  { type: "poer-thermostat-card", name: "POER Thermostat", description: "One POER zone with controls", preview: true },
  { type: "poer-overview-card", name: "POER Overview", description: "Grid of POER thermostats, grouped by zone", preview: true }
);

console.info(`%c POER-CARDS %c ${VERSION} `, "background:#ff8100;color:#fff", "");
