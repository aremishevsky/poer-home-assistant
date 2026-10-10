/* POER Thermostat cards for Home Assistant.
 *
 *   type: custom:poer-thermostat-card   – one zone, with controls
 *   entity: climate.kabinet
 *
 *   type: custom:poer-overview-card     – grid of all zones
 *   title: Опалення                     – optional
 *   columns: 3                          – optional
 *   entities: [climate.kabinet, ...]    – optional, defaults to all POER thermostats
 */

const VERSION = "1.0.0";

const MODE_LABELS = { auto: "Auto", heat: "Heat", off: "Off" };
const PRESET_LABELS = { home: "Home", away: "Eco" };
const SET_TEMP_DELAY_MS = 800;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (v, digits = 1) => (v === undefined || v === null || isNaN(v) ? "—" : Number(v).toFixed(digits));

const isUnavailable = (st) => !st || st.state === "unavailable" || st.state === "unknown";

function zoneInfo(st) {
  const a = st.attributes;
  return {
    name: a.friendly_name || st.entity_id,
    current: a.current_temperature,
    target: a.temperature,
    humidity: a.current_humidity,
    heating: a.hvac_action === "heating",
    mode: st.state,
    preset: a.preset_mode,
  };
}

function moreInfo(el, entityId) {
  el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
}

const BASE_STYLE = `
  :host {
    --poer-heat: var(--state-climate-heat-color, #ff8100);
    --poer-auto: var(--state-climate-auto-color, #008000);
    --poer-off: var(--state-climate-off-color, #8a8a8a);
    --poer-eco: var(--success-color, #43a047);
    --poer-muted: var(--secondary-text-color);
  }
  ha-card { padding: 16px; box-sizing: border-box; }
  .heating ha-icon.flame { color: var(--poer-heat); animation: pulse 1.6s ease-in-out infinite; }
  ha-icon.flame { color: var(--poer-muted); opacity: .5; --mdc-icon-size: 18px; }
  @keyframes pulse { 50% { opacity: .45; } }
  .badge {
    display: inline-flex; align-items: center; gap: 2px;
    font-size: 11px; font-weight: 500; line-height: 1;
    padding: 3px 7px; border-radius: 10px;
    color: #fff; background: var(--poer-off);
  }
  .badge.heat { background: var(--poer-heat); }
  .badge.auto { background: var(--poer-auto); }
  .badge.eco { background: var(--poer-eco); }
  .muted { color: var(--poer-muted); }
  .unavail { opacity: .45; }
`;

/* ---------------------------------------------------------------- detail -- */

class PoerThermostatCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("climate.")) {
      throw new Error("Вкажіть entity: climate.<назва>");
    }
    this._config = config;
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
    return 4;
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((e) => e.startsWith("climate.")) || "climate.example";
    return { entity };
  }

  _onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const st = this._hass.states[this._config.entity];
    if (isUnavailable(st)) return;
    const { action, value } = btn.dataset;
    const entity_id = this._config.entity;

    if (action === "more-info") moreInfo(this, entity_id);
    else if (action === "mode") this._hass.callService("climate", "set_hvac_mode", { entity_id, hvac_mode: value });
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

  _render() {
    if (!this._config || !this._hass) return;
    const st = this._hass.states[this._config.entity];

    if (!st) {
      this.shadowRoot.innerHTML = `<style>${BASE_STYLE}</style>
        <ha-card><div class="muted">Сутність ${esc(this._config.entity)} не знайдена</div></ha-card>`;
      return;
    }

    const unavailable = isUnavailable(st);
    const z = zoneInfo(st);
    const name = this._config.name || z.name;
    const target = this._pendingTarget ?? z.target;
    const modes = st.attributes.hvac_modes || Object.keys(MODE_LABELS);
    const presets = st.attributes.preset_modes || Object.keys(PRESET_LABELS);

    const modeBtns = modes
      .map(
        (m) => `<button class="seg ${m} ${z.mode === m && !(m === "heat" && z.preset === "away") ? "on" : ""}"
                  data-action="mode" data-value="${esc(m)}">${esc(MODE_LABELS[m] || m)}</button>`
      )
      .join("");
    const presetBtns = presets
      .map(
        (p) => `<button class="seg ${p === "away" ? "eco" : "home"} ${z.preset === p ? "on" : ""}"
                  data-action="preset" data-value="${esc(p)}">${esc(PRESET_LABELS[p] || p)}</button>`
      )
      .join("");

    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        .head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .head .name { font-size: 16px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .main { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 14px; }
        .current { font-size: 44px; font-weight: 300; line-height: 1; }
        .current small { font-size: 18px; vertical-align: top; margin-left: 2px; }
        .meta { margin-top: 6px; display: flex; gap: 12px; font-size: 13px; }
        .meta ha-icon { --mdc-icon-size: 16px; vertical-align: -3px; }
        .setpoint { display: flex; align-items: center; gap: 6px; }
        .setpoint .val { min-width: 64px; text-align: center; font-size: 22px; font-weight: 500; }
        .setpoint .val.pending { color: var(--primary-color); }
        .setpoint .lbl { display: block; font-size: 11px; font-weight: 400; }
        .round {
          width: 36px; height: 36px; border-radius: 50%; border: none; cursor: pointer;
          background: var(--secondary-background-color); color: var(--primary-text-color);
          display: grid; place-items: center;
        }
        .round:active { filter: brightness(.9); }
        .row { display: flex; gap: 6px; margin-top: 8px; }
        .seg {
          flex: 1; padding: 8px 0; border: none; border-radius: 8px; cursor: pointer;
          font: inherit; font-size: 13px;
          background: var(--secondary-background-color); color: var(--primary-text-color);
        }
        .seg.on { color: #fff; background: var(--poer-off); }
        .seg.on.heat { background: var(--poer-heat); }
        .seg.on.auto { background: var(--poer-auto); }
        .seg.on.eco { background: var(--poer-eco); }
        .seg.on.home { background: var(--primary-color); }
        button:disabled { cursor: default; }
      </style>
      <ha-card class="${unavailable ? "unavail" : ""} ${z.heating && !unavailable ? "heating" : ""}">
        <div class="head" data-action="more-info">
          <ha-icon icon="mdi:thermostat"></ha-icon>
          <span class="name">${esc(name)}</span>
          ${unavailable ? `<span class="badge">Offline</span>` : `<ha-icon class="flame" icon="mdi:fire"></ha-icon>`}
        </div>

        <div class="main">
          <div>
            <div class="current">${fmt(z.current)}<small>°C</small></div>
            <div class="meta muted">
              <span><ha-icon icon="mdi:water-percent"></ha-icon>${fmt(z.humidity, 0)}%</span>
              <span>${z.heating ? "Гріє" : "Не гріє"}</span>
            </div>
          </div>
          <div class="setpoint">
            <button class="round" data-action="step" data-value="-1" ${unavailable ? "disabled" : ""}>
              <ha-icon icon="mdi:minus"></ha-icon></button>
            <div class="val ${this._pendingTarget !== null ? "pending" : ""}">
              ${fmt(target)}°<span class="lbl muted">ціль</span></div>
            <button class="round" data-action="step" data-value="1" ${unavailable ? "disabled" : ""}>
              <ha-icon icon="mdi:plus"></ha-icon></button>
          </div>
        </div>

        <div class="row">${modeBtns}</div>
        <div class="row">${presetBtns}</div>
      </ha-card>`;
  }
}

/* -------------------------------------------------------------- overview -- */

class PoerOverviewCard extends HTMLElement {
  setConfig(config) {
    this._config = { columns: 3, ...config };
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
    const ids = this._entityIds();
    // re-render only when one of our entities changed
    const key = ids.map((id) => hass.states[id]?.last_updated).join("|");
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._render();
  }

  getCardSize() {
    const n = this._hass ? this._entityIds().length : 6;
    return 1 + Math.ceil(n / this._config.columns) * 2;
  }

  static getStubConfig() {
    return { title: "Опалення" };
  }

  _entityIds() {
    if (this._config.entities) {
      return this._config.entities.map((e) => (typeof e === "string" ? e : e.entity));
    }
    const reg = this._hass.entities || {};
    return Object.keys(reg)
      .filter((id) => id.startsWith("climate.") && reg[id].platform === "poer" && !reg[id].hidden)
      .sort((a, b) =>
        (this._hass.states[a]?.attributes.friendly_name || a).localeCompare(
          this._hass.states[b]?.attributes.friendly_name || b
        )
      );
  }

  _tile(id) {
    const st = this._hass.states[id];
    if (!st) return `<div class="tile unavail"><div class="name">${esc(id)}</div><div class="muted">не знайдено</div></div>`;
    const unavailable = isUnavailable(st);
    const z = zoneInfo(st);

    let badge;
    if (unavailable) badge = `<span class="badge">Offline</span>`;
    else if (z.preset === "away") badge = `<span class="badge eco">Eco</span>`;
    else badge = `<span class="badge ${esc(z.mode)}">${esc(MODE_LABELS[z.mode] || z.mode)}</span>`;

    return `
      <div class="tile ${unavailable ? "unavail" : ""} ${z.heating && !unavailable ? "heating" : ""}" data-entity="${esc(id)}">
        <div class="top"><span class="name">${esc(z.name)}</span><ha-icon class="flame" icon="mdi:fire"></ha-icon></div>
        <div class="temp">${fmt(z.current)}<small>°</small></div>
        <div class="bottom">
          <span class="muted">→ ${fmt(z.target)}° · ${fmt(z.humidity, 0)}%</span>
          ${badge}
        </div>
      </div>`;
  }

  _render() {
    if (!this._config || !this._hass) return;
    const ids = this._entityIds();
    const heatingCount = ids.filter((id) => this._hass.states[id]?.attributes.hvac_action === "heating").length;

    this.shadowRoot.innerHTML = `
      <style>${BASE_STYLE}
        .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
        .header .title { font-size: 18px; font-weight: 500; }
        .grid { display: grid; grid-template-columns: repeat(${Number(this._config.columns) || 3}, minmax(0, 1fr)); gap: 8px; }
        .tile {
          padding: 10px 12px; border-radius: 12px; cursor: pointer;
          background: var(--secondary-background-color);
          border-left: 3px solid transparent;
        }
        .tile.heating { border-left-color: var(--poer-heat); }
        .top { display: flex; align-items: center; gap: 4px; }
        .name { flex: 1; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .temp { font-size: 26px; font-weight: 300; margin: 4px 0; }
        .temp small { font-size: 14px; vertical-align: top; }
        .bottom { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 12px; }
        .empty { padding: 8px 0; }
      </style>
      <ha-card>
        ${this._config.title || heatingCount ? `
        <div class="header">
          <span class="title">${esc(this._config.title || "")}</span>
          <span class="muted">${heatingCount ? `гріє: ${heatingCount}` : ""}</span>
        </div>` : ""}
        ${ids.length
          ? `<div class="grid">${ids.map((id) => this._tile(id)).join("")}</div>`
          : `<div class="empty muted">Термостати POER не знайдені</div>`}
      </ha-card>`;
  }
}

customElements.get("poer-thermostat-card") || customElements.define("poer-thermostat-card", PoerThermostatCard);
customElements.get("poer-overview-card") || customElements.define("poer-overview-card", PoerOverviewCard);

window.customCards = window.customCards || [];
window.customCards.push(
  { type: "poer-thermostat-card", name: "POER Thermostat", description: "Одна зона POER з керуванням" },
  { type: "poer-overview-card", name: "POER Overview", description: "Сітка всіх термостатів POER" }
);

console.info(`%c POER-CARDS %c ${VERSION} `, "background:#ff8100;color:#fff", "");
