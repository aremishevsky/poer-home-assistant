"""Binary sensor platform for POER Thermostat."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import DeviceCoordinator
from .entity import POEREntity


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up binary sensor platform."""
    coordinator: DeviceCoordinator = entry.runtime_data
    async_add_entities(
        POERHeatingSensor(coordinator, device["device_id"])
        for device in coordinator.data
    )


class POERHeatingSensor(POEREntity, BinarySensorEntity):
    """On while the thermostat is actively heating."""

    _attr_name = "Heating"
    _attr_icon = "mdi:radiator"
    _attr_device_class = BinarySensorDeviceClass.RUNNING

    def __init__(self, coordinator: DeviceCoordinator, device_id: str) -> None:
        """Initialize binary sensor."""
        super().__init__(coordinator, device_id)
        self._attr_unique_id = f"poer_{device_id}_heating"

    @property
    def is_on(self) -> bool | None:
        """Return True if heating."""
        action = self.device_data.get("action")
        if action is None:
            return None
        return action == "heating"
