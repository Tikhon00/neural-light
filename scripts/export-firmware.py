#!/usr/bin/env python3
"""Build the ESP Web Tools payload from an already compiled ESP32 image.

Run with the firmware virtualenv Python. No device or serial port is opened.
The generated installer payload is intentionally not tracked by Git.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def export(output: Path) -> None:
    version = (ROOT / "firmware/version.txt").read_text().strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("firmware/version.txt must contain a semantic version")
    config = (ROOT / "firmware/platformio.ini").read_text()
    defined_version = re.search(r'NEURAL_FIRMWARE_VERSION=\\?"([^"\\]+)', config)
    if not defined_version or defined_version.group(1) != version:
        raise ValueError("version.txt and NEURAL_FIRMWARE_VERSION in platformio.ini must match")
    info = json.loads(subprocess.check_output(
        [sys.executable, "-m", "platformio", "system", "info", "--json-output"],
        text=True,
    ))
    packages = Path(info["core_dir"]["value"]) / "packages"
    build = ROOT / "firmware/.pio/build/esp32dev"
    parts = [
        (0x1000, build / "bootloader.bin"),
        (0x8000, build / "partitions.bin"),
        (0xE000, packages / "framework-arduinoespressif32/tools/partitions/boot_app0.bin"),
        (0x10000, build / "firmware.bin"),
    ]
    for _, path in parts:
        if not path.is_file():
            raise FileNotFoundError(f"Missing {path}. Run pio run -d firmware -e esp32dev first.")
    output.mkdir(parents=True, exist_ok=True)
    name = f"neural-light-node-{version}-esp32.bin"
    binary = output / name
    command = [sys.executable, "-m", "esptool", "--chip", "esp32", "merge_bin",
               "--output", str(binary), "--flash_mode", "dio", "--flash_freq", "40m",
               "--flash_size", "4MB"]
    for offset, path in parts:
        command.extend([hex(offset), str(path)])
    subprocess.run(command, check=True)
    data = binary.read_bytes()
    if len(data) > 4 * 1024 * 1024 or data[0x1000] != 0xE9 or data[0x10000] != 0xE9:
        raise ValueError("Merged ESP32 image has an invalid size or header")
    digest = hashlib.sha256(data).hexdigest()
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True))
    manifest = {
        "name": "NEURAL LIGHT NODE",
        "version": version,
        "new_install_prompt_erase": False,
        "new_install_improv_wait_time": 0,
        "builds": [{"chipFamily": "ESP32", "parts": [{"path": name, "offset": 0}]}],
    }
    metadata = {
        "name": "NEURAL LIGHT NODE", "version": version,
        "commit": revision, "dirty": dirty,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "board": "esp32dev", "chipFamily": "ESP32",
        "flash": {"mode": "dio", "frequency": "40m", "size": "4MB"},
        "file": name, "sha256": digest, "bytes": len(data),
        "hardwareVerified": False,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "build-info.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (output / "checksums.txt").write_text(f"{digest}  {name}\n")
    print(f"Exported {name} ({len(data)} bytes), SHA-256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "installer/public/firmware")
    args = parser.parse_args()
    export(args.output.resolve())
