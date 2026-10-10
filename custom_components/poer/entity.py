"""Base entity for POER devices."""

from __future__ import annotations

from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import DeviceCoordinator

MANUFACTURER = "POER Inc"


class POEREntity(CoordinatorEntity[DeviceCoordinator]):
    """Common base for all entities of one POER device."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: DeviceCoordinator, device_id: str) -> None:
        """Initialize entity."""
        super().__init__(coordinator)
        self.device_id = device_id
        data = self.device_data
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, device_id)},
            name=data.get("name"),
            manufacturer=MANUFACTURER,
            model=data.get("model"),
            sw_version=data.get("firmware"),
            hw_version=data.get("hw_version"),
        )

    @property
    def device_data(self) -> dict:
        """Get current device data."""
        return next(
            (
                device
                for device in self.coordinator.data or []
                if device["device_id"] == self.device_id
            ),
            {},
        )

    @property
    def available(self) -> bool:
        """Return True if the device is present and reported online."""
        data = self.device_data
        return super().available and bool(data) and data.get("online") is not False
