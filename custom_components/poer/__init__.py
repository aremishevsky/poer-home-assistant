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
    # 允许浏览器缓存: 移动端从后台恢复时网络可能尚未就绪, 无缓存会导致卡片脚本加载失败
    # ("Custom element doesn't exist"); ?v= 保证更新后重新加载
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARDS_URL, str(CARDS_PATH), cache_headers=True)]
    )
    # 文件修改时间作为版本号, 更新后浏览器会重新加载
    mtime = await hass.async_add_executor_job(lambda: int(CARDS_PATH.stat().st_mtime))
    add_extra_js_url(hass, f"{CARDS_URL}?v={mtime}")
    return True


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
