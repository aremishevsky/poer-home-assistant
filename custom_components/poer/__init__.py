"""The POER Thermostat integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .coordinator import DeviceCoordinator

PLATFORMS = [Platform.CLIMATE, Platform.SENSOR, Platform.BINARY_SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARDS_URL = "/poer/poer-cards.js"
CARDS_PATH = Path(__file__).parent / "frontend" / "poer-cards.js"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the Lovelace cards and load them in the frontend."""
    # Let the browser cache the cards: when the mobile app resumes the network may not be ready
    # yet ("Custom element doesn't exist"); ?v= makes it reload after an update
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARDS_URL, str(CARDS_PATH), cache_headers=True)]
    )
    # File modification time as the version, so the browser reloads it after an update
    mtime = await hass.async_add_executor_job(lambda: int(CARDS_PATH.stat().st_mtime))
    add_extra_js_url(hass, f"{CARDS_URL}?v={mtime}")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up POER Thermostat from a config entry."""
    coordinator = DeviceCoordinator(
        hass, entry.data["api_url"], entry.data["api_token"]
    )

    # Initial data refresh
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
