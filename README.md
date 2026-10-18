# poer-home-assistant

Home Assistant custom integration for POER devices.

## Important note for upgraders

If, after upgrading, your devices suddenly don't work, please delete them via the UI and re-add them again.  There are a number of new features which require
new metadata to be discovered at the setup phase.  This may not be present on existing devices.
If this doesn't work you can roll back to a previous release via HACS, and please log an issue with the details of your problem.

## Supported devices

This integration supports various models of POER devices, which may also be known as:

- PTC10
- PTC20/26
- PTV30

## Installation

### Requirements

You need to have the POER App configured and working in Home Assistant in order to use this integration.

### Manual installation

Clone this repository into `config/` Home Assistant folder.

### HACS

This integration is now available from within HACS.

Search for "poer" and click install.  You will also get notified of future upgrades.

### API Key

The api key is generated on the app. The app needs to be upgraded to at least version 3.2.26.

Use the following steps to generate:

- Go to the user information page, then find Home Assistant and click the Generate button.
<img src="./doc/images/apikey_generate.jpg" width=30%>

- Click the Copy button to copy it for use.
<img src="./doc/images/apikey_copy.jpg" width=30%>

- If you no longer want to use Home Assistant related functions, please click the Release button.

## Modes

Each thermostat is a `climate` entity with three modes, matching the POER app:

| Shown in HA | `hvac_mode` (automations / services) | POER mode |
|---|---|---|
| **Home** | `auto` | `auto` (schedule). A thermostat in manual mode (`heat`) is also shown as Home. |
| **Away** | `heat` | `eco` |
| **Off** | `off` | `off` |

Use `climate.set_hvac_mode` with these values in automations, e.g. `hvac_mode: heat` to switch to Away.
`climate.turn_on` switches to Home. There are no presets.

## Lovelace cards

The integration ships two dashboard cards. They are loaded automatically: no need to add a resource in
*Settings → Dashboards → Resources*. After installing or updating, restart Home Assistant and hard-refresh the browser
(Ctrl/Cmd + Shift + R).

Both cards have a visual editor (*Edit dashboard → Add card → POER Overview / POER Thermostat*), or can be configured in YAML.

**Heating history:** tap the flame icon on either card to open a chart of the last day
with the current temperature, the target temperature and the periods when the zone was heating, plus total heating time.
Ranges: 1h, 3h, 6h, 12h, 1d, 1w, 2w, 1M. Drag the chart left / right to move in time, **Now** jumps back.
It uses the Home Assistant recorder history of the `climate` entity, so nothing extra needs to be set up.
The recorder keeps 10 days by default (`purge_keep_days`), so 2w / 1M show only what is still stored.

### POER Overview — `custom:poer-overview-card`

Grid of thermostat tiles: current temperature, target, status (Home / Away / Off / Offline) and humidity.
Zones that are heating get an orange stripe and background, and their status turns orange. Tap a tile to open its details.

```yaml
type: custom:poer-overview-card
title: Heating
title_icon: mdi:radiator
columns: 3
background: true
show_heating_count: true
mobile_columns: 2
mobile_show_groups: false
groups:
  - 1st floor
  - 2nd floor
  - Basement
entities:
  - entity: climate.zal
    group: 1st floor
  - entity: climate.kabinet
    group: 2nd floor
  - climate.office
```

| Option | Type | Required | Default | Values / description |
|---|---|---|---|---|
| `type` | string | **yes** | — | `custom:poer-overview-card` |
| `title` | string | no | — | Card title. Leave empty for no title. |
| `title_icon` | string | no | — | Icon in front of the title, e.g. `mdi:radiator` |
| `columns` | number | no | `3` | Tiles per row, `1`–`8` |
| `background` | boolean | no | `true` | `false` makes the card transparent, without border, shadow and padding |
| `show_heating_count` | boolean | no | `true` | Show "Heating: N" in the header |
| `mobile_columns` | number | no | `2` | Tiles per row on screens up to 600 px wide, `1`–`8` |
| `mobile_show_groups` | boolean | no | `true` | Show group titles on screens up to 600 px wide |
| `groups` | list of strings | no | — | Zone names, in display order. Thermostats without a group are shown last under "Other". |
| `entities` | list | no | all POER thermostats | Thermostats to show, in display order. Each item is either an entity id (`climate.xxx`) or an object (see below). Thermostats not in the list are hidden. |

`entities` item as an object:

| Option | Type | Required | Description |
|---|---|---|---|
| `entity` | string | **yes** | Entity id, `climate.xxx` |
| `group` | string | no | One of the names from `groups` |

In the visual editor, groups and thermostats can be reordered by dragging the ⠿ handle or with the ▲▼ buttons.
Untick a thermostat to hide it.

### POER Thermostat — `custom:poer-thermostat-card`

One zone: current temperature, humidity, status, target with up/down controls and Home / Away / Off buttons.
The card is highlighted while the zone is heating. Tap the header to open the details.

```yaml
type: custom:poer-thermostat-card
entity: climate.kabinet
name: Office
icon: mdi:thermostat
icon_size: 32
status_icon: mdi:fire
status_icon_size: 32
controls: vertical
show_modes: true
```

| Option | Type | Required | Default | Values / description |
|---|---|---|---|---|
| `type` | string | **yes** | — | `custom:poer-thermostat-card` |
| `entity` | string | **yes** | — | POER thermostat, `climate.xxx` |
| `name` | string | no | entity name | Name shown in the header |
| `icon` | string | no | `mdi:thermostat` | Header icon |
| `icon_size` | number | no | `32` | Header icon size in px, `16`–`96` |
| `status_icon` | string | no | `mdi:fire` | Icon that lights up while heating |
| `status_icon_size` | number | no | `32` | Heating icon size in px, `16`–`96` |
| `controls` | string | no | `vertical` | `vertical`: chevrons above and below the target. `horizontal`: − and + to the left and right. |
| `show_modes` | boolean | no | `true` | Show the Home / Away / Off buttons |


### Config

After setting up, you can config two parameters Settings -> Integrations -> LEDnetWF -> Config.

- Disconnect delay or timeout: Timeout for bluetooth disconnect (0 for never)



Thanks!