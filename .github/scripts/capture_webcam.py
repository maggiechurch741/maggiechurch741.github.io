"""Save a "dusk" webcam frame ~30 min before sunset for each location with a webcam.

The page shows this saved frame from sunset-30min until sunrise instead of the
live (dark) image. Runs every 10 min in the evening via capture-webcam.yml and
only saves once per day, on the first run inside the capture window.

    python .github/scripts/capture_webcam.py          # capture if in window
    python .github/scripts/capture_webcam.py --force  # capture now regardless

Output: avi_conditions/data/webcam/<location>-<view>-dusk.jpg + <location>-dusk.json (mirrored to docs/)
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from astral import LocationInfo
from astral.sun import sun

OUT_DIRS = ["avi_conditions/data/webcam", "docs/avi_conditions/data/webcam"]
TZ = "America/Denver"

# Keep in sync with LOCATIONS (webcams) in avi_conditions/js/index.js
WEBCAMS = {
    "cameron-pass": {
        "lat": 40.5208, "lon": -105.8925,
        "views": {
            "west": "https://cocam.carsprogram.org/Cellular/001E00000CAM2POR-W.jpg",
            "east": "https://cocam.carsprogram.org/Cellular/001E00000CAM2POR-E.jpg",
        },
    },
}

LEAD = timedelta(minutes=30)      # target: 30 min before sunset
WINDOW = timedelta(minutes=35)    # accept runs up to 35 min late (Actions cron often lags)


def main(force=False):
    now = datetime.now(timezone.utc)
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)

    for name, cam in WEBCAMS.items():
        loc = LocationInfo(name, "", TZ, cam["lat"], cam["lon"])
        today_local = now.astimezone(loc.tzinfo).date()
        sunset = sun(loc.observer, date=today_local, tzinfo=loc.tzinfo)["sunset"]
        target = sunset - LEAD

        meta_path = os.path.join(OUT_DIRS[0], f"{name}-dusk.json")
        already = False
        if os.path.exists(meta_path):
            with open(meta_path) as fh:
                already = json.load(fh).get("date") == today_local.isoformat()

        in_window = target <= now <= target + WINDOW
        print(f"{name}: sunset {sunset:%H:%M %Z}, target {target:%H:%M}, "
              f"in_window={in_window}, already={already}")
        if not force and (already or not in_window):
            continue

        frames = {}
        for view, url in cam["views"].items():
            try:
                r = requests.get(url, params={"t": int(now.timestamp())}, timeout=30)
                r.raise_for_status()
                if not r.headers.get("content-type", "").startswith("image/"):
                    raise RuntimeError(f"returned {r.headers.get('content-type')}")
                frames[view] = r.content
            except Exception as exc:   # noqa: BLE001 — keep whichever views worked
                print(f"{name}/{view}: failed ({exc})")
        if not frames:
            raise RuntimeError(f"{name}: no webcam views could be fetched")

        meta = {
            "date": today_local.isoformat(),
            "captured": now.isoformat(timespec="seconds"),
            "sunset": sunset.astimezone(timezone.utc).isoformat(timespec="seconds"),
            "views": sorted(frames),
        }
        for d in OUT_DIRS:
            for view, content in frames.items():
                with open(os.path.join(d, f"{name}-{view}-dusk.jpg"), "wb") as fh:
                    fh.write(content)
            with open(os.path.join(d, f"{name}-dusk.json"), "w") as fh:
                json.dump(meta, fh, indent=2)
        print(f"{name}: saved dusk frames {sorted(frames)}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
