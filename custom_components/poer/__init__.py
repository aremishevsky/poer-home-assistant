"""The POER Thermostat integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .coordinator import DeviceCoordinator

PLATFORMS = [Platform.CLIMATE, Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up POER Thermostat from a config entry."""
    coordinator = DeviceCoordinator(
        hass, entry.data["api_url"], entry.data["api_token"]
    )

    # 初始数据刷新
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    # 设置平台
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
