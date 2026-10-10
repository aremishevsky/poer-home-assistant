"""Climate platform for POER Thermostat."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.climate import (
    ATTR_PRESET_MODE,
    ATTR_TARGET_TEMP_HIGH,
    ATTR_TARGET_TEMP_LOW,
    ATTR_TEMPERATURE,
    PRESET_AWAY,
    PRESET_ECO,
    PRESET_HOME,
    PRESET_NONE,
    PRESET_SLEEP,
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PRECISION_TENTHS, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import _LOGGER
from .coordinator import DeviceCoordinator
from .entity import POEREntity

DEFAULT_MIN_TEMP = 5.0
DEFAULT_MAX_TEMP = 35.0
DEFAULT_TEMP_STEP = 0.1


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up climate platform."""
    coordinator: DeviceCoordinator = entry.runtime_data

    # 为每个设备创建实体
    entities = [
        POERThermostat(coordinator, device["device_id"]) for device in coordinator.data
    ]

    if entities:
        async_add_entities(entities)


class POERThermostat(POEREntity, ClimateEntity):
    """POER Thermostat entity."""

    # 使用设备名称作为实体名称
    _attr_name = None
    _attr_min_temp = DEFAULT_MIN_TEMP
    _attr_max_temp = DEFAULT_MAX_TEMP
    _attr_target_temperature_step = DEFAULT_TEMP_STEP
    _attr_precision = PRECISION_TENTHS
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_hvac_modes = [
        HVACMode.AUTO,
        #  HVACMode.COOL,
        HVACMode.HEAT,
        HVACMode.OFF,
    ]
    _attr_preset_modes = [
        # PRESET_NONE,
        PRESET_HOME,
        PRESET_AWAY,
        # PRESET_SLEEP,
        # PRESET_ECO,
    ]
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        # | ClimateEntityFeature.TARGET_TEMPERATURE_RANGE
        | ClimateEntityFeature.PRESET_MODE
    )

    def __init__(self, coordinator: DeviceCoordinator, device_id: str) -> None:
        """Initialize thermostat."""
        super().__init__(coordinator, device_id)
        self._attr_unique_id = f"poer_thermostat_{device_id}"
        self._update_attributes()

    @callback
    def _handle_coordinator_update(self) -> None:
        """Update entity when coordinator updates."""
        self._update_attributes()
        self.async_write_ha_state()

    def _update_attributes(self) -> None:
        """Update entity attributes from device data."""
        data = self.device_data

        # 基本属性
        self._attr_current_temperature = data.get("current_temp")
        self._attr_current_humidity = data.get("current_humidity")
        self._attr_target_temperature = data.get("target_temp")
        self._attr_min_temp = data.get("min_temp", DEFAULT_MIN_TEMP)
        self._attr_max_temp = data.get("max_temp", DEFAULT_MAX_TEMP)
        # self._attr_target_temperature_low = data.get("temp_low")
        # self._attr_target_temperature_high = data.get("temp_high")

        # 状态映射
        self._attr_hvac_mode = self._map_hvac_mode(data.get("mode"))
        self._attr_preset_mode = self._map_preset_mode(data.get("preset"))
        self._attr_hvac_action = self._map_hvac_action(data.get("action"))
        # mode = data.get("mode")
        # if mode is not None:
        #     self._attr_hvac_mode = self._map_hvac_mode(mode)
        # preset = data.get("preset")
        # if preset is not None:
        #     self._attr_preset_mode = self._map_preset_mode(preset)

    def _map_hvac_mode(self, mode: str | None) -> HVACMode | None:
        """Map HVAC mode from device value."""
        mode_map = {
            "auto": HVACMode.AUTO,
            # "cool": HVACMode.COOL,
            "heat": HVACMode.HEAT,
            "off": HVACMode.OFF,
        }
        return mode_map.get(mode)

    def _map_hvac_action(self, action: str) -> HVACAction:
        """Map HVAC action from device value."""
        action_map = {
            # "cooling": HVACAction.COOLING,
            "heating": HVACAction.HEATING,
            "idle": HVACAction.IDLE,
        }
        return action_map.get(action, HVACAction.IDLE)

    def _map_preset_mode(self, preset: str | None) -> str | None:
        """Map preset mode from device value."""
        preset_map = {
            "home": PRESET_HOME,
            "away": PRESET_AWAY,
            # "sleep": PRESET_SLEEP,
            # "eco": PRESET_ECO,
            # "none": PRESET_NONE,
        }
        return preset_map.get(preset)

    async def async_set_temperature(self, **kwargs) -> None:
        """Set target temperature."""
        temp = kwargs.get(ATTR_TEMPERATURE)
        # target_temp_low = kwargs.get(ATTR_TARGET_TEMP_LOW)
        # target_temp_high = kwargs.get(ATTR_TARGET_TEMP_HIGH)

        # 准备API请求数据
        endpoint, payload = None, None

        if temp is not None:
            endpoint = "set_temp"
            payload = {"temperature": temp}
            self._attr_target_temperature = temp  # 乐观更新
            self.async_write_ha_state()
        # elif target_temp_low is not None and target_temp_high is not None:
        #     endpoint = "set_temp_range"
        #     payload = {"low": target_temp_low, "high": target_temp_high}
        #     self._attr_target_temperature_low = target_temp_low  # 乐观更新
        #     self._attr_target_temperature_high = target_temp_high  # 乐观更新

        if endpoint and payload:
            success = await self.coordinator.send_command(
                self.device_id, endpoint, payload
            )

            if not success:
                self._update_attributes()  # 失败时恢复之前状态
                self.async_write_ha_state()

            # 刷新数据以获取最新状态
            await self.coordinator.async_request_refresh()

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Set HVAC mode."""
        mode_map = {
            HVACMode.AUTO: "auto",
            # HVACMode.COOL: "cool",
            HVACMode.HEAT: "heat",
            HVACMode.OFF: "off",
        }

        if (device_mode := mode_map.get(hvac_mode)) is None:
            _LOGGER.error("Unsupported mode: %s", hvac_mode)
            return

        # 乐观更新 (选择模式会退出 away/eco)
        self._attr_hvac_mode = hvac_mode
        self._attr_preset_mode = PRESET_HOME
        self.async_write_ha_state()

        # 发送命令
        success = await self.coordinator.send_command(
            self.device_id,
            "set_mode",
            {"mode": device_mode, "preset": "home"},
        )

        if not success:
            self._update_attributes()  # 失败时恢复之前状态
            self.async_write_ha_state()

        await self.coordinator.async_request_refresh()

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set preset mode."""
        preset_map = {
            PRESET_HOME: "home",
            PRESET_AWAY: "away",
            # PRESET_SLEEP: "sleep",
            # PRESET_ECO: "eco",
            # PRESET_NONE: "none",
        }

        if (device_preset := preset_map.get(preset_mode)) is None:
            _LOGGER.error("Unsupported preset: %s", preset_mode)
            return

        # 乐观更新
        self._attr_preset_mode = preset_mode
        self.async_write_ha_state()

        # 发送命令
        success = await self.coordinator.send_command(
            self.device_id,
            "set_mode",
            {"mode": self._attr_hvac_mode or "heat", "preset": device_preset},
        )

        if not success:
            self._update_attributes()  # 失败时恢复之前状态
            self.async_write_ha_state()

        await self.coordinator.async_request_refresh()
