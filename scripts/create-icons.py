#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"
SOURCE_DIR = ASSETS_DIR / "iconset"
LIGHT_SOURCE = SOURCE_DIR / "va_light_mode.png"
DARK_SOURCE = SOURCE_DIR / "va_dark_mode.png"
LIGHT_OUTPUT = ASSETS_DIR / "icon-light.png"
DARK_OUTPUT = ASSETS_DIR / "icon-dark.png"
ICONSET_DIR = ASSETS_DIR / "icon.iconset"
ICNS_OUTPUT = ASSETS_DIR / "icon.icns"
MASTER_SIZE = 1024
ICONSET_SPECS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def run(*args: str) -> None:
    subprocess.run(list(args), check=True)


def read_image_dimensions(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )

    width = height = None
    for line in result.stdout.splitlines():
        if "pixelWidth:" in line:
            width = int(line.split(":", 1)[1].strip())
        if "pixelHeight:" in line:
            height = int(line.split(":", 1)[1].strip())

    if width is None or height is None:
        raise RuntimeError(f"Unable to read dimensions for {path}")

    return width, height


def build_square_png(source: Path, destination: Path) -> None:
    width, height = read_image_dimensions(source)
    crop_size = min(width, height)
    temp_square = destination.with_name(f"{destination.stem}.square.png")

    run("sips", "-c", str(crop_size), str(crop_size), str(source), "--out", str(temp_square))
    run(
        "sips",
        str(temp_square),
        "-s",
        "format",
        "png",
        "--resampleHeightWidth",
        str(MASTER_SIZE),
        str(MASTER_SIZE),
        "--out",
        str(destination),
    )
    temp_square.unlink(missing_ok=True)


def build_iconset(master_icon: Path) -> None:
    if ICONSET_DIR.exists():
      shutil.rmtree(ICONSET_DIR)
    ICONSET_DIR.mkdir(parents=True, exist_ok=True)

    for filename, size in ICONSET_SPECS:
        run(
            "sips",
            str(master_icon),
            "-s",
            "format",
            "png",
            "--resampleHeightWidth",
            str(size),
            str(size),
            "--out",
            str(ICONSET_DIR / filename),
        )


def main() -> None:
    if not LIGHT_SOURCE.exists() or not DARK_SOURCE.exists():
        raise FileNotFoundError("Expected both light and dark icon PNGs in assets/iconset")

    build_square_png(LIGHT_SOURCE, LIGHT_OUTPUT)
    build_square_png(DARK_SOURCE, DARK_OUTPUT)
    build_iconset(LIGHT_OUTPUT)
    run("iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(ICNS_OUTPUT))
    print(f"Created {LIGHT_OUTPUT.name}, {DARK_OUTPUT.name}, and {ICNS_OUTPUT.name}")


if __name__ == "__main__":
    main()
