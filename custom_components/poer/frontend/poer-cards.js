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
 *   show_modes: true                       – Home / Away / Off buttons
 *
 *   type: custom:poer-overview-card        – grid of zones
 *   title: Heating                         – optional, no title when empty
 *   title_icon: mdi:radiator               – optional
 *   columns: 3                             – optional, tiles per row
 *   background: true                       – false = transparent, no padding
 *   show_heating_count: true               – "Heating: N" in the header
 *   groups: [1st floor, 2nd floor]         – optional, group order
 *   entities:                              – optional, defaults to all POER thermostats
 *     - entity: climate.kabinet
 *       group: 2nd floor
 *     - climate.office                     – no group
 */

const VERSION = "1.0.1-dev-5";

// hvac modes of the POER climate entity (see integration translations)
const MODE_LABELS = { auto: "Home", heat: "Away", off: "Off" };
const MODE_CLASS = { auto: "home", heat: "away", off: "off" };
const SET_TEMP_DELAY_MS = 800;

const THERMOSTAT_DEFAULTS = {
  icon: "mdi:thermostat",
  icon_size: 32,
  status_icon: "mdi:fire",
  status_icon_size: 32,
  controls: "vertical",
  show_modes: true,
};
const OVERVIEW_DEFAULTS = { columns: 3, background: true, show_heating_count: true };

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
    unavailable,
  };
}

// Offline / Away / Auto / Heat / Off, plus css class for the badge colour
function statusOf(z) {
  if (z.unavailable) return { label: "Offline", cls: "offline" };
  return { label: MODE_LABELS[z.mode] || z.mode, cls: MODE_CLASS[z.mode] || z.mode };
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
    padding: 2px 6px; border-radius: 10px;
    color: var(--poer-off); border: 1px solid currentColor; background: none;
  }
  .badge.home { color: var(--primary-color, #03a9f4); }
  .badge.away { color: var(--poer-away); }
  .badge.offline { color: var(--disabled-text-color, #bdbdbd); }
  /* icon + value on one line, icon centred on the text */
  .hum { display: inline-flex; align-items: center; gap: 1px; white-space: nowrap; }
  .hum ha-icon { display: inline-flex; }
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
    return 2 + (this._config.show_modes ? 1 : 0);
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
    if (action === "history") return PoerHistoryDialog.open(this._hass, entity_id, this._config.name || zoneInfo(st).name);
    if (isUnavailable(st)) return;
    if (action === "mode") this._hass.callService("climate", "set_hvac_mode", { entity_id, hvac_mode: value });
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

    const modeBtns = modes
      .map(
        (m) => `<button class="seg ${MODE_CLASS[m] || esc(m)} ${!z.unavailable && z.mode === m ? "on" : ""}"
                  data-action="mode" data-value="${esc(m)}">${esc(MODE_LABELS[m] || m)}</button>`
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
        .history { cursor: pointer; }
        .head .name { font-size: 18px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        ha-card { container-type: inline-size; }
        .main { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 14px 0 10px; }
        .current { font-size: 48px; font-weight: 300; line-height: 1; white-space: nowrap; }
        .current small { font-size: 18px; vertical-align: top; margin-left: 2px; }
        /* left column is as wide as the temperature; the meta row ellipsizes instead of widening it */
        .main > .left { flex: 1 1 auto; min-width: min-content; }
        .meta { margin-top: 8px; display: flex; align-items: center; gap: 10px; font-size: 13px; white-space: nowrap; width: 0; min-width: 100%; }
        .meta > * { flex: none; }
        .meta ha-icon { --mdc-icon-size: 16px; }
        .meta .action { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .setpoint { flex: none; margin-left: auto; }
        @container (max-width: 260px) {
          .current { font-size: 38px; }
          .val { font-size: 20px; min-width: 52px; }
          .round { width: 30px; height: 30px; }
        }
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
        .seg.on.away { background: var(--poer-away); }
        .seg.on.home { background: var(--primary-color); }
        button:disabled { cursor: default; opacity: .5; }
      </style>
      <ha-card class="${z.unavailable ? "unavail" : ""} ${z.heating ? "heating" : ""}">
        <div class="head" data-action="more-info">
          <ha-icon class="icon" icon="${esc(c.icon)}"></ha-icon>
          <span class="name">${esc(c.name || z.name)}</span>
          ${z.unavailable
            ? `<span class="badge offline history" data-action="history" title="History">Offline</span>`
            : `<ha-icon class="flame history" data-action="history" title="History" icon="${esc(c.status_icon)}"></ha-icon>`}
        </div>

        <div class="main">
          <div class="left">
            <div class="current">${fmt(z.current)}<small>°C</small></div>
            <div class="meta muted">
              <span class="badge ${status.cls}">${esc(status.label)}</span>
              <span class="hum"><ha-icon icon="mdi:water-percent"></ha-icon>${fmt(z.humidity, 0)}%</span>
              <span class="action">${z.heating ? "Heating" : "Idle"}</span>
            </div>
          </div>
          ${this._setpointHtml(target, z.unavailable)}
        </div>

        ${c.show_modes ? `<div class="row">${modeBtns}</div>` : ""}
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
  { name: "show_modes", selector: { boolean: {} } },
];

const THERMOSTAT_LABELS = {
  entity: "Thermostat",
  name: "Name (optional)",
  icon: "Icon",
  icon_size: "Icon size",
  status_icon: "Heating icon",
  status_icon_size: "Heating icon size",
  controls: "Target buttons layout",
  show_modes: "Show mode buttons (Home / Away / Off)",
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
        if (!tile) return;
        const id = tile.dataset.entity;
        if (e.target.closest("[data-history]")) PoerHistoryDialog.open(this._hass, id, nameOf(this._hass, id));
        else moreInfo(this, id);
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
        <div class="top"><span class="name">${esc(z.name)}</span><ha-icon class="flame" data-history title="History" icon="mdi:fire"></ha-icon></div>
        <div class="temps">
          <span class="temp">${fmt(z.current)}<small>°</small></span>
          <span class="target muted">→ ${fmt(z.target)}°</span>
        </div>
        <div class="bottom">
          <span class="badge ${status.cls}">${esc(status.label)}</span>
          <span class="hum muted"><ha-icon icon="mdi:water-percent"></ha-icon>${fmt(z.humidity, 0)}%</span>
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
    const c = this._config;
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
        .map(([g, list], i) => `<div class="group ${i === 0 ? "first" : ""}">${esc(g)}</div>${this._grid(list)}`)
        .join("");
    }

    const showCount = c.show_heating_count && heatingCount > 0;
    const header = c.title || c.title_icon || showCount
      ? `<div class="header">
          ${c.title_icon ? `<ha-icon class="title-icon" icon="${esc(c.title_icon)}"></ha-icon>` : ""}
          <span class="title">${esc(c.title || "")}</span>
          ${showCount ? `<span class="muted">Heating: ${heatingCount}</span>` : ""}
        </div>`
      : "";

    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        /* outer card invisible; theme --ha-card-* vars stay intact for the tiles */
        ha-card.no-bg { background: none; box-shadow: none; border: none; padding: 0; }
        .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .header .title { flex: 1; min-width: 0; font-size: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .header .title-icon { --mdc-icon-size: 24px; color: var(--state-icon-color, var(--paper-item-icon-color)); }
        .group { font-size: 13px; font-weight: 500; color: var(--poer-muted); text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 8px; }
        .group.first { margin-top: 0; }
        .grid { display: grid; grid-template-columns: repeat(${Number(this._config.columns) || 3}, minmax(0, 1fr)); gap: 8px; }
        .tile {
          padding: 10px 12px; border-radius: 12px; cursor: pointer;
          background: var(--secondary-background-color);
          box-shadow: inset 3px 0 0 transparent;
        }
        .tile.heating { box-shadow: inset 3px 0 0 var(--poer-heat); }
        .no-bg .tile {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
          box-shadow: var(--ha-card-box-shadow, none);
        }
        .no-bg .tile.heating { box-shadow: inset 3px 0 0 var(--poer-heat), var(--ha-card-box-shadow, 0 0 0 transparent); }
        .top { display: flex; align-items: center; gap: 4px; }
        .top ha-icon { --mdc-icon-size: 18px; }
        .top .flame { margin: -6px; padding: 6px; } /* bigger tap target */
        .name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .temps { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin: 4px 0; }
        .temp { font-size: 26px; font-weight: 300; }
        .temp small { font-size: 14px; vertical-align: top; }
        .target { font-size: 13px; white-space: nowrap; }
        .bottom { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; }
        .bottom ha-icon { --mdc-icon-size: 14px; }
        .empty { padding: 8px 0; }
      </style>
      <ha-card class="${c.background === false ? "no-bg" : ""}">
        ${header}
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

  _moveRow(from, to) {
    const rows = this._rows();
    const lastOn = rows.filter((r) => r.on).length - 1;
    if (to < 0 || to > lastOn || from === to) return;
    this._saveRows(moveItem(rows, from, to));
  }

  _moveGroup(from, to) {
    const groups = this._config.groups || [];
    if (to < 0 || to >= groups.length || from === to) return;
    this._update({ groups: moveItem(groups, from, to) });
  }

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
    const { act, idx, list } = el.dataset;
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
      const j = act === "up" ? i - 1 : i + 1;
      if (list === "groups") this._moveGroup(i, j);
      else this._moveRow(i, j);
    }
  }

  // drag by the handle; works with mouse and touch
  _onPointerDown(e) {
    const handle = e.target.closest(".handle");
    if (!handle) return;
    const line = handle.closest(".line");
    const listEl = line.parentElement;
    const lines = [...listEl.querySelectorAll(".line.drag")];
    const from = lines.indexOf(line);
    if (from < 0) return;

    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const rects = lines.map((l) => l.getBoundingClientRect());
    const h = rects[from].height;
    let to = from;
    line.classList.add("dragging");

    const onMove = (ev) => {
      const y = ev.clientY;
      line.style.transform = `translateY(${y - startY}px)`;
      to = rects.filter((r, k) => k !== from && r.top + r.height / 2 < y).length;
      lines.forEach((l, k) => {
        if (k === from) return;
        let shift = 0;
        if (from < to && k > from && k <= to) shift = -h;
        else if (to < from && k >= to && k < from) shift = h;
        l.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const onEnd = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      lines.forEach((l) => (l.style.transform = ""));
      line.classList.remove("dragging");
      if (to === from) return;
      if (listEl.dataset.list === "groups") this._moveGroup(from, to);
      else this._moveRow(from, to);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
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
          .poer-ed .line {
            display: flex; align-items: center; gap: 8px; padding: 4px 0;
            border-bottom: 1px solid var(--divider-color);
            background: var(--card-background-color); transition: transform .15s;
          }
          .poer-ed .line.dragging { transition: none; position: relative; z-index: 1; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
          .poer-ed .line .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .poer-ed .line.off .nm { color: var(--secondary-text-color); }
          .poer-ed .handle {
            cursor: grab; touch-action: none; user-select: none;
            color: var(--secondary-text-color); --mdc-icon-size: 20px;
          }
          .poer-ed .dragging .handle { cursor: grabbing; }
          .poer-ed .handle-gap { width: 20px; flex: none; }
          .poer-ed input[type=text], .poer-ed select {
            font: inherit; padding: 6px 8px; border-radius: 6px;
            border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
          }
          .poer-ed input[type=text] { flex: 1; min-width: 0; }
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
      this._form.computeLabel = (s) => OVERVIEW_LABELS[s.name] || s.name;
      this._form.schema = OVERVIEW_SCHEMA;
      this._form.addEventListener("value-changed", (e) => this._update(e.detail.value));
      this.querySelector(".form").appendChild(this._form);
      const lists = this.querySelector(".lists");
      lists.addEventListener("click", (e) => this._onClick(e));
      lists.addEventListener("change", (e) => this._onChange(e));
      lists.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    }

    this._form.hass = this._hass;
    this._form.data = { ...OVERVIEW_DEFAULTS, ...this._config };

    const groups = this._config.groups || [];
    const rows = this._rows();
    const lastOn = rows.filter((r) => r.on).length - 1;
    const handle = `<ha-icon class="handle" icon="mdi:drag" title="Drag to reorder"></ha-icon>`;
    const arrows = (list, i, last) => `
      <button data-act="up" data-list="${list}" data-idx="${i}" ${i === 0 ? "disabled" : ""} title="Move up">▲</button>
      <button data-act="down" data-list="${list}" data-idx="${i}" ${i === last ? "disabled" : ""} title="Move down">▼</button>`;

    const groupHtml = groups
      .map(
        (g, i) => `
        <div class="line drag">
          ${handle}
          <input type="text" value="${esc(g)}" data-act="rename" data-idx="${i}">
          ${arrows("groups", i, groups.length - 1)}
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
        <div class="line ${r.on ? "drag" : "off"}">
          ${r.on ? handle : `<span class="handle-gap"></span>`}
          <input type="checkbox" data-act="toggle" data-idx="${i}" ${r.on ? "checked" : ""}>
          <span class="nm">${esc(nameOf(this._hass, r.entity))}</span>
          ${r.on && groups.length ? `<select data-act="group" data-idx="${i}">${groupOptions(r.group)}</select>` : ""}
          ${r.on ? arrows("rows", i, lastOn) : ""}
        </div>`
      )
      .join("");

    this.querySelector(".lists").innerHTML = `
      <h3>Groups</h3>
      <p class="hint">E.g. 1st floor, 2nd floor, Basement. Drag or ▲▼ to set the order.</p>
      <div data-list="groups">${groupHtml}</div>
      <button class="add" data-act="add-group">+ Add group</button>

      <h3>Thermostats</h3>
      <p class="hint">Tick to show, drag or ▲▼ to reorder${groups.length ? ", pick a group for each" : ""}.</p>
      <div data-list="rows">${rowHtml || `<p class="hint">No POER thermostats found</p>`}</div>`;
  }
}

const moveItem = (arr, from, to) => {
  const out = [...arr];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
};

const OVERVIEW_SCHEMA = [
  {
    type: "grid",
    name: "",
    schema: [
      { name: "title", selector: { text: {} } },
      { name: "title_icon", selector: { icon: {} } },
    ],
  },
  { name: "columns", selector: { number: { min: 1, max: 8, mode: "box" } } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "background", selector: { boolean: {} } },
      { name: "show_heating_count", selector: { boolean: {} } },
    ],
  },
];

const OVERVIEW_LABELS = {
  title: "Title (empty = no title)",
  title_icon: "Title icon",
  columns: "Tiles per row",
  background: "Card background",
  show_heating_count: "Show \"Heating: N\"",
};

/* =============================================================== history == */

const HISTORY_RANGES = [6, 24, 168];

// climate history -> [{t, cur, tgt, heat}] (t in ms), one entry per recorded change
function parseHistory(states, start) {
  return states.map((st) => {
    const a = st.a || {};
    const unavailable = st.s === "unavailable" || st.s === "unknown";
    return {
      t: Math.max(st.lu * 1000, start),
      cur: unavailable ? null : a.current_temperature ?? null,
      tgt: unavailable ? null : a.temperature ?? null,
      heat: !unavailable && a.hvac_action === "heating",
    };
  });
}

const fmtDuration = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

const pad2 = (n) => String(n).padStart(2, "0");

class PoerHistoryDialog extends HTMLElement {
  static open(hass, entityId, name) {
    document.querySelector("poer-history-dialog")?.remove();
    const d = document.createElement("poer-history-dialog");
    d._hass = hass;
    d._entityId = entityId;
    d._name = name;
    document.body.appendChild(d);
  }

  connectedCallback() {
    this.attachShadow({ mode: "open" });
    this._onKey = (e) => e.key === "Escape" && this.remove();
    document.addEventListener("keydown", this._onKey);
    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        .backdrop {
          position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45);
          display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box;
        }
        .dlg {
          width: min(760px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          border-radius: var(--ha-card-border-radius, 12px); padding: 16px 16px 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,.3); font-family: var(--paper-font-body1_-_font-family, inherit);
        }
        .top { display: flex; align-items: center; gap: 8px; }
        .top .ttl { flex: 1; min-width: 0; font-size: 18px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chips { display: flex; gap: 4px; }
        button {
          font: inherit; font-size: 12px; border: none; border-radius: 12px; padding: 4px 10px; cursor: pointer;
          background: var(--secondary-background-color); color: var(--primary-text-color);
        }
        button.on { background: var(--primary-color); color: #fff; }
        button.x { font-size: 16px; padding: 2px 8px; background: none; }
        .summary { margin: 8px 0 4px; font-size: 13px; }
        .summary b { color: var(--poer-heat); font-weight: 500; }
        .chart { position: relative; height: 260px; margin-top: 4px; }
        .chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
        .chart .msg { position: absolute; inset: 0; display: grid; place-items: center; }
        .axis { fill: var(--poer-muted); font-size: 10px; }
        .grid line { stroke: var(--divider-color, #e0e0e0); stroke-width: 1; }
        .cur { fill: none; stroke: var(--primary-color, #03a9f4); stroke-width: 2; stroke-linejoin: round; }
        .tgt { fill: none; stroke: var(--poer-heat); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: .9; }
        .heat-bg { fill: var(--poer-heat); opacity: .13; }
        .heat-bar { fill: var(--poer-heat); }
        .cursor { stroke: var(--poer-muted); stroke-width: 1; }
        .tip {
          position: absolute; top: 4px; pointer-events: none; white-space: nowrap;
          background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 8px; padding: 6px 8px; font-size: 12px; line-height: 1.5; box-shadow: 0 2px 8px rgba(0,0,0,.15);
        }
        .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12px; }
        .legend i { display: inline-block; width: 16px; height: 0; margin-right: 6px; vertical-align: middle; border-top: 2px solid; }
        .legend .l-cur { border-color: var(--primary-color, #03a9f4); }
        .legend .l-tgt { border-color: var(--poer-heat); border-top-style: dashed; }
        .legend .l-heat { height: 10px; border: none; background: var(--poer-heat); opacity: .35; border-radius: 2px; }
      </style>
      <div class="backdrop">
        <div class="dlg" role="dialog" aria-label="Heating history">
          <div class="top">
            <span class="ttl">${esc(this._name)}</span>
            <div class="chips">${HISTORY_RANGES.map((h) => `<button data-h="${h}">${h < 48 ? `${h}h` : `${h / 24}d`}</button>`).join("")}</div>
            <button class="x" title="Close">✕</button>
          </div>
          <div class="summary muted">&nbsp;</div>
          <div class="chart"><div class="msg muted">Loading…</div></div>
          <div class="legend muted">
            <span><i class="l-cur"></i>Current</span>
            <span><i class="l-tgt"></i>Target</span>
            <span><i class="l-heat"></i>Heating</span>
          </div>
        </div>
      </div>`;
    const root = this.shadowRoot;
    root.querySelector(".backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("backdrop") || e.target.closest(".x")) this.remove();
      const chip = e.target.closest("[data-h]");
      if (chip) this._load(Number(chip.dataset.h));
    });
    this._load(24);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._onKey);
  }

  async _load(hours) {
    this._hours = hours;
    const root = this.shadowRoot;
    root.querySelectorAll("[data-h]").forEach((b) => b.classList.toggle("on", Number(b.dataset.h) === hours));
    root.querySelector(".chart").innerHTML = `<div class="msg muted">Loading…</div>`;

    const end = Date.now();
    const start = end - hours * 3600e3;
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: [this._entityId],
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: false,
        no_attributes: false,
      });
      if (this._hours !== hours) return; // another range was picked meanwhile
      this._data = { points: parseHistory(res[this._entityId] || [], start), start, end };
      this._draw();
    } catch (err) {
      root.querySelector(".chart").innerHTML = `<div class="msg muted">Failed to load history: ${esc(err.message || err.code || err)}</div>`;
    }
  }

  _draw() {
    const { points, start, end } = this._data;
    const root = this.shadowRoot;
    const chart = root.querySelector(".chart");

    // duration of each point = until the next one (or now)
    const segs = points.map((p, i) => ({ ...p, t2: i + 1 < points.length ? points[i + 1].t : end }));
    const heatMs = segs.filter((s) => s.heat).reduce((sum, s) => sum + (s.t2 - s.t), 0);
    root.querySelector(".summary").innerHTML = points.length
      ? `Heating <b>${fmtDuration(heatMs)}</b> (${Math.round((heatMs / (end - start)) * 100)}%) in the last ${this._hours < 48 ? `${this._hours} hours` : `${this._hours / 24} days`}`
      : "&nbsp;";
    if (!points.length) {
      chart.innerHTML = `<div class="msg muted">No history for this period</div>`;
      return;
    }

    const W = chart.clientWidth || 700;
    const H = chart.clientHeight || 260;
    const L = 34, R = 8, T = 8, B = 22, BAR = 5;
    const plotW = W - L - R, plotH = H - T - B - BAR - 2;
    const x = (t) => L + ((t - start) / (end - start)) * plotW;

    const vals = segs.flatMap((s) => [s.cur, s.tgt]).filter((v) => v !== null);
    let lo = vals.length ? Math.floor(Math.min(...vals) - 0.5) : 15;
    let hi = vals.length ? Math.ceil(Math.max(...vals) + 0.5) : 25;
    if (hi - lo < 2) hi = lo + 2;
    const yStep = [0.5, 1, 2, 5, 10].find((st) => (hi - lo) / st <= 6) || 10;
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * plotH;

    // grid + axes
    let grid = "";
    for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-9; v += yStep) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      grid += `<text class="axis" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${+v.toFixed(1)}°</text>`;
    }
    const tickH = this._hours <= 6 ? 1 : this._hours <= 24 ? 3 : 24;
    const first = new Date(start);
    first.setMinutes(0, 0, 0);
    first.setHours(tickH === 24 ? 0 : Math.ceil(first.getHours() / tickH) * tickH);
    let xTicks = "";
    for (let d = new Date(first); d.getTime() <= end; d.setHours(d.getHours() + tickH)) {
      if (d.getTime() < start) continue;
      const label = tickH === 24 ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}` : `${pad2(d.getHours())}:00`;
      xTicks += `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${T + plotH}"/>`;
      xTicks += `<text class="axis" x="${x(d)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    }

    // heating: merged intervals
    const heat = [];
    for (const s of segs) {
      if (!s.heat) continue;
      const last = heat[heat.length - 1];
      if (last && last[1] >= s.t) last[1] = s.t2;
      else heat.push([s.t, s.t2]);
    }
    const heatRects = heat
      .map(([a, b]) => {
        const w = Math.max(1, x(b) - x(a));
        return `<rect class="heat-bg" x="${x(a)}" y="${T}" width="${w}" height="${plotH}"/>
                <rect class="heat-bar" x="${x(a)}" y="${T + plotH + 2}" width="${w}" height="${BAR}" rx="1"/>`;
      })
      .join("");

    // current: polyline through recorded values; target: step line
    const path = (key, step) => {
      let d = "", open = false;
      for (const s of segs) {
        if (s[key] === null) { open = false; continue; }
        const cmd = open ? "L" : "M";
        d += `${cmd}${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`;
        if (step) d += `L${x(s.t2).toFixed(1)},${y(s[key]).toFixed(1)}`;
        open = true;
      }
      const lastSeg = segs[segs.length - 1];
      if (!step && open) d += `L${x(end).toFixed(1)},${y(lastSeg[key]).toFixed(1)}`;
      return d;
    };

    chart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
        <g class="grid">${grid}${xTicks}</g>
        ${heatRects}
        <path class="tgt" d="${path("tgt", true)}"/>
        <path class="cur" d="${path("cur", false)}"/>
        <line class="cursor" y1="${T}" y2="${T + plotH}" visibility="hidden"/>
      </svg>
      <div class="tip" hidden></div>`;

    const svg = chart.querySelector("svg");
    const cursor = chart.querySelector(".cursor");
    const tip = chart.querySelector(".tip");
    svg.addEventListener("pointermove", (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      if (px < L || px > W - R) return;
      const t = start + ((px - L) / plotW) * (end - start);
      const seg = segs.findLast((s) => s.t <= t) || segs[0];
      const d = new Date(t);
      cursor.setAttribute("x1", px);
      cursor.setAttribute("x2", px);
      cursor.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = `
        <div class="muted">${this._hours > 24 ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ` : ""}${pad2(d.getHours())}:${pad2(d.getMinutes())}</div>
        <div>Current: <b>${fmt(seg.cur)}°</b></div>
        <div>Target: <b>${fmt(seg.tgt)}°</b></div>
        <div>${seg.heat ? "Heating" : "Idle"}</div>`;
      const left = (px / W) * rect.width;
      tip.style.left = left > rect.width / 2 ? "" : `${left + 10}px`;
      tip.style.right = left > rect.width / 2 ? `${rect.width - left + 10}px` : "";
    });
    svg.addEventListener("pointerleave", () => {
      cursor.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });
  }
}

/* ============================================================ register == */

const define = (name, cls) => customElements.get(name) || customElements.define(name, cls);
define("poer-thermostat-card", PoerThermostatCard);
define("poer-thermostat-card-editor", PoerThermostatCardEditor);
define("poer-overview-card", PoerOverviewCard);
define("poer-overview-card-editor", PoerOverviewCardEditor);
define("poer-history-dialog", PoerHistoryDialog);

window.customCards = window.customCards || [];
window.customCards.push(
  { type: "poer-thermostat-card", name: "POER Thermostat", description: "One POER zone with controls", preview: true },
  { type: "poer-overview-card", name: "POER Overview", description: "Grid of POER thermostats, grouped by zone", preview: true }
);

console.info(`%c POER-CARDS %c ${VERSION} `, "background:#ff8100;color:#fff", "");
