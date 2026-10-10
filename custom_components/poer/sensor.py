"""Sensor platform for POER Thermostat."""

from __future__ import annotations

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import DeviceCoordinator
from .entity import POEREntity

SENSORS: tuple[SensorEntityDescription, ...] = (
    SensorEntityDescription(
        key="current_temp",
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        suggested_display_precision=1,
    ),
    SensorEntityDescription(
        key="current_humidity",
        device_class=SensorDeviceClass.HUMIDITY,
        state_class=SensorStateClass.MEASUREMENT,
        native_unit_of_measurement=PERCENTAGE,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up sensor platform."""
    coordinator: DeviceCoordinator = entry.runtime_data
    async_add_entities(
        POERSensor(coordinator, device["device_id"], description)
        for device in coordinator.data
        for description in SENSORS
    )


class POERSensor(POEREntity, SensorEntity):
    """Temperature / humidity sensor of a POER thermostat."""

    def __init__(
        self,
        coordinator: DeviceCoordinator,
        device_id: str,
        description: SensorEntityDescription,
    ) -> None:
        """Initialize sensor."""
        super().__init__(coordinator, device_id)
        self.entity_description = description
        self._attr_unique_id = f"poer_{device_id}_{description.key}"

    @property
    def native_value(self) -> float | None:
        """Return sensor value."""
        return self.device_data.get(self.entity_description.key)
