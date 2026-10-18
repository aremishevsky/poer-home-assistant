"""POER Thermostat coordinator."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed


from .const import _LOGGER, HA_TO_POER_MODE, POER_TO_HA_MODE


SCAN_INTERVAL = timedelta(seconds=30)


class DeviceCoordinator(DataUpdateCoordinator):
    """Device data coordinator with persistent session."""

    def __init__(self, hass: HomeAssistant, api_url: str, api_token: str) -> None:
        """Initialize coordinator with API credentials."""
        super().__init__(
            hass, _LOGGER, name="POER Devices", update_interval=SCAN_INTERVAL
        )
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.session = async_get_clientsession(hass)
        self.headers = {
            "Authorization": "beer " + self.api_token,
            "Content-Type": "application/json",
        }

    async def _async_update_data(self) -> list[dict]:
        """Fetch device data from cloud."""

        try:
            # Device list
            devices_url = f"{self.api_url}/speaker/ha/v1.0"
            payload = {
                "requestId": "111",
                "inputs": [{"intent": "action.devices.SYNC"}],
            }
            async with self.session.post(
                devices_url, json=payload, headers=self.headers
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    raise UpdateFailed(
                        f"API request failed: {response.status} {response_text}"
                    )

                rspJson = await response.json()
                devices = rspJson["payload"]["devices"]
        except aiohttp.ClientError as e:
            raise UpdateFailed(f"Network error during update: {e}") from e
        except (KeyError, TypeError, ValueError) as e:
            raise UpdateFailed(f"Unexpected SYNC response: {e}") from e

        # Detailed state of each device
        detailed_devices = []
        for device in devices:
            device_id = device["id"]
            try:
                device_info = await self._async_query_device(device)
            except (aiohttp.ClientError, KeyError, TypeError, ValueError) as e:
                # A failing device does not affect the others; it is shown as unavailable
                _LOGGER.warning("Failed to get status for device %s: %s", device_id, e)
                continue
            if device_info is not None:
                detailed_devices.append(device_info)

        return detailed_devices

    async def _async_query_device(self, device: dict) -> dict | None:
        """Query state of a single device."""
        device_id = device["id"]
        payload = {
            "requestId": "111",
            "inputs": [
                {
                    "intent": "action.devices.QUERY",
                    "payload": {"devices": [{"id": device_id}]},
                }
            ],
        }
        status_url = f"{self.api_url}/speaker/ha/v1.0"
        async with self.session.post(
            status_url, json=payload, headers=self.headers
        ) as response:
            if response.status != 200:
                _LOGGER.warning(
                    "Failed to get status for device %s: %d",
                    device_id,
                    response.status,
                )
                return None
            status_data = await response.json()

        status = status_data["payload"]["devices"][device_id]
        device_info = {
            "device_id": device["id"],
            "name": device["name"]["name"],
            "model": device["deviceInfo"]["model"],
            "firmware": device["deviceInfo"]["swVersion"],
            "hw_version": device["deviceInfo"].get("hwVersion"),
            "online": status.get("online"),
            "current_temp": status.get("thermostatTemperatureAmbient"),
            "current_humidity": status.get("thermostatHumidityAmbient"),
            "target_temp": status.get("thermostatTemperatureSetpoint"),
            "action": status.get("thermostatAction"),
            "min_temp": device["attributes"]["thermostatTemperatureRange"][
                "minThresholdCelsius"
            ],
            "max_temp": device["attributes"]["thermostatTemperatureRange"][
                "maxThresholdCelsius"
            ],
            "mode": None,
        }
        poerMode = status.get("thermostatMode")
        device_info["mode"] = POER_TO_HA_MODE.get(poerMode)
        if device_info["mode"] is None:
            _LOGGER.warning(
                "Unknown thermostat mode for device %s: %s", device_id, poerMode
            )

        # The cloud keeps returning online=true and the last cached data for offline devices;
        # an impossible state (off but heating / target above the range) means offline
        target = device_info["target_temp"]
        if device_info["online"] and (
            (poerMode == "off" and device_info["action"] == "heating")
            or (target is not None and target > device_info["max_temp"])
        ):
            _LOGGER.debug(
                "Device %s reports impossible state, treating as offline", device_id
            )
            device_info["online"] = False
        return device_info

    async def send_command(self, device_id: str, endpoint: str, data: dict) -> bool:
        """Send command to device via API."""
        payload = {
            "requestId": "112",
            "inputs": [
                {
                    "intent": "action.devices.EXECUTE",
                    "payload": {
                        "commands": [
                            {
                                "devices": [{"id": device_id}],
                                "execution": [{}],
                            }
                        ]
                    },
                }
            ],
        }
        if endpoint == "set_temp":
            execution = [
                {
                    "command": "action.devices.commands.ThermostatTemperatureSetpoint",
                    "params": {"thermostatTemperatureSetpoint": data["temperature"]},
                }
            ]
        elif endpoint == "set_mode":
            mode = HA_TO_POER_MODE[data["mode"]]
            execution = [
                {
                    "command": "action.devices.commands.ThermostatSetMode",
                    "params": {"thermostatMode": mode},
                }
            ]
        payload["inputs"][0]["payload"]["commands"][0]["execution"] = execution

        url = f"{self.api_url}/speaker/ha/v1.0"

        try:
            async with self.session.post(
                url, json=payload, headers=self.headers
            ) as resp:
                if resp.status == 200:
                    return True

                response_text = await resp.text()
                _LOGGER.error(
                    "Command failed for %s: %d %s",
                    device_id,
                    resp.status,
                    response_text,
                )
                return False
        except aiohttp.ClientError as e:
            _LOGGER.error("Network error for device %s: %s", device_id, e)
            return False
