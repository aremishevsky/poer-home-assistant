"""Constants for Airly integration."""

from __future__ import annotations

import logging
from typing import Final

DOMAIN: Final = "poer"
CNURL: Final = "https://open2.poersmart.com"  # "http://10.11.0.150:6666"
EUURL: Final = "https://open.poersmart.com"  # "http://10.11.0.150:6666"


_LOGGER = logging.getLogger(__name__)

# HA hvac mode <-> POER thermostatMode. HA shows them as Home / Away / Off
# (see translations). POER "heat" (manual) is shown as Home.
HA_TO_POER_MODE: Final = {"auto": "auto", "heat": "eco", "off": "off"}
POER_TO_HA_MODE: Final = {"auto": "auto", "heat": "auto", "eco": "heat", "off": "off"}
