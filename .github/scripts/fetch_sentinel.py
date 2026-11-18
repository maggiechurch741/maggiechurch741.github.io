"""Fetch recent cloud-free Sentinel-2 L2A clips around each avi_conditions location.

Source: Element 84 Earth Search STAC (Sentinel-2 COGs on AWS, free, no account).
Landsat 8/9 was tried and dropped (Nov 2026): Collection 2 surface reflectance
overcorrects aerosol over snow (a documented USGS known issue), so shaded snow
renders near-black, and uncorrected Level-1 data has no free no-account source.

For each location it keeps the most recent scenes whose *local*
cloud cover (from the scene's own cloud mask, inside the clip box) is below a
threshold, renders a snow-friendly true-colour JPEG in Web Mercator, and writes
a manifest with lat/lon bounds so Leaflet can drop it on the map.

Output: avi_conditions/data/sentinel/{location}_{date}_{sensor}.jpg + manifest.json
        (mirrored into docs/avi_conditions/data/sentinel/)
"""
import json
import os
import shutil
from datetime import datetime, timedelta, timezone

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds
from rasterio.transform import from_origin

EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/search"
OUT_DIRS = ["avi_conditions/data/sentinel", "docs/avi_conditions/data/sentinel"]

# Keep in sync with LOCATIONS in avi_conditions/js/index.js
LOCATIONS = {
    "cameron-pass":  {"lat": 40.5208, "lon": -105.8925},
    "hidden-valley": {"lat": 40.398,  "lon": -105.706},
    "allenspark":    {"lat": 40.1654, "lon": -105.5574},
}

HALF_DEG_LAT = 0.05     # ~5.5 km each way
HALF_DEG_LON = 0.065    # ~5.5 km each way at 40°N
LOOKBACK_DAYS = 45
MAX_LOCAL_CLOUD = 0.25  # fraction of clip flagged cloud / shadow / cirrus
KEEP_SCENES = {"s2": 3}
PIXEL_M = 10            # output resolution in Web Mercator metres

SCL_CLOUDY = {3, 8, 9, 10}  # cloud shadow, cloud med/high prob, thin cirrus
SCL_NODATA = {0}


def expand_to_routes(name, bbox, margin=0.012):
    """Grow bbox (w, s, e, n) so it covers this location's saved routes plus a margin."""
    path = f"avi_conditions/data/routes/{name}.geojson"
    if not os.path.exists(path):
        return bbox
    with open(path) as fh:
        features = json.load(fh).get("features", [])
    pts = []
    for f in features:
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        pts += [p for line in lines for p in line]
    if not pts:
        return bbox
    w, s, e, n = bbox
    return (min(w, min(p[0] for p in pts) - margin), min(s, min(p[1] for p in pts) - margin),
            max(e, max(p[0] for p in pts) + margin), max(n, max(p[1] for p in pts) + margin))


def stac_search(url, collection, lat, lon, query):
    now = datetime.now(timezone.utc)
    body = {
        "collections": [collection],
        "intersects": {"type": "Point", "coordinates": [lon, lat]},
        "datetime": f"{(now - timedelta(days=LOOKBACK_DAYS)).isoformat()}/{now.isoformat()}",
        "query": {"eo:cloud_cover": {"lt": 90}, **query},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        "limit": 50,
    }
    r = requests.post(url, json=body, timeout=60)
    r.raise_for_status()
    return r.json()["features"]


def read_clip(href, bbox_merc, resampling):
    """Read a COG band warped to EPSG:3857 over bbox_merc at PIXEL_M resolution."""
    w = int(round((bbox_merc[2] - bbox_merc[0]) / PIXEL_M))
    h = int(round((bbox_merc[3] - bbox_merc[1]) / PIXEL_M))
    dst_transform = from_origin(bbox_merc[0], bbox_merc[3], PIXEL_M, PIXEL_M)
    with rasterio.open(href) as src, WarpedVRT(src, crs="EPSG:3857", transform=dst_transform,
                                               width=w, height=h, resampling=resampling,
                                               nodata=0) as vrt:
        return vrt.read(1)


def stretch_and_save(refl, path):
    # Stretch that keeps texture in snow (reflectance ~0.6–1.0) and still shows trees
    lo = np.percentile(refl, 1)
    hi = max(np.percentile(refl, 99.7), 0.3)
    scaled = np.clip((refl - lo) / (hi - lo), 0, 1) ** (1 / 1.6)
    Image.fromarray((scaled * 255).astype("uint8")).save(path, quality=88)


class Sentinel2:
    key, label, resolution = "s2", "Sentinel-2", 10

    def search(self, lat, lon):
        return stac_search(EARTH_SEARCH, "sentinel-2-l2a", lat, lon, {})

    def platform(self, item):
        return {"sentinel-2a": "Sentinel-2A", "sentinel-2b": "Sentinel-2B",
                "sentinel-2c": "Sentinel-2C"}.get(item["properties"].get("platform"), self.label)

    def cloud_fraction(self, item, bbox_merc):
        scl = read_clip(item["assets"]["scl"]["href"], bbox_merc, Resampling.nearest)
        valid = ~np.isin(scl, list(SCL_NODATA))
        if valid.mean() < 0.9:          # clip falls off the tile edge
            return None
        return float(np.isin(scl[valid], list(SCL_CLOUDY)).mean())

    def render(self, item, bbox_merc, path):
        rgb = np.stack([read_clip(item["assets"][b]["href"], bbox_merc, Resampling.bilinear)
                        .astype("float32") for b in ("red", "green", "blue")], axis=-1)
        # Processing baseline >= 04.00 adds a +1000 DN offset unless Earth Search removed it
        props = item["properties"]
        if not props.get("earthsearch:boa_offset_applied", False) and \
                float(props.get("s2:processing_baseline", "0")) >= 4.0:
            rgb -= 1000
        stretch_and_save(np.clip(rgb / 10000.0, 0, None), path)


SENSORS = [Sentinel2()]


def collect(sensor, name, lat, lon, bbox_merc):
    """Most recent clear scenes for one sensor (or the newest pass if none are clear)."""
    scenes, seen_dates, newest = [], set(), None

    def keep(item, cf):
        date = item["properties"]["datetime"][:10]
        fname = f"{name}_{date}_{sensor.key}.jpg"
        sensor.render(item, bbox_merc, os.path.join(OUT_DIRS[0], fname))
        seen_dates.add(date)
        scenes.append({"date": date, "file": fname, "sensor": sensor.key,
                       "platform": sensor.platform(item), "resolution_m": sensor.resolution,
                       "local_cloud": round(cf, 3),
                       "scene_cloud": item["properties"].get("eo:cloud_cover"), "id": item["id"]})

    for item in sensor.search(lat, lon):
        date = item["properties"]["datetime"][:10]
        if date in seen_dates:          # same pass split across tiles / reprocessing
            continue
        try:
            cf = sensor.cloud_fraction(item, bbox_merc)
        except Exception as exc:        # noqa: BLE001 — one bad COG shouldn't kill the run
            print(f"  {name} {sensor.key} {date}: skip ({exc})")
            continue
        print(f"  {name} {sensor.key} {date} {item['id']}: local cloud {cf}")
        if cf is None:
            continue
        if newest is None:
            newest = (item, cf)
        if cf > MAX_LOCAL_CLOUD:
            continue
        keep(item, cf)
        if len(scenes) >= KEEP_SCENES[sensor.key]:
            break

    # Nothing clear enough — still show the most recent pass so the map isn't empty
    if not scenes and newest:
        keep(*newest)
    return scenes


def main():
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
    manifest = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "locations": {}}

    for name, loc in LOCATIONS.items():
        lat, lon = loc["lat"], loc["lon"]
        bbox_ll = expand_to_routes(name, (lon - HALF_DEG_LON, lat - HALF_DEG_LAT,
                                          lon + HALF_DEG_LON, lat + HALF_DEG_LAT))
        bbox_merc = transform_bounds("EPSG:4326", "EPSG:3857", *bbox_ll)
        # Leaflet bounds must be the lat/lon of the Mercator box we actually rendered
        w, s, e, n = transform_bounds("EPSG:3857", "EPSG:4326", *bbox_merc)

        scenes = []
        for sensor in SENSORS:
            try:
                scenes += collect(sensor, name, lat, lon, bbox_merc)
            except Exception as exc:    # noqa: BLE001 — keep other locations going
                print(f"{name}: {sensor.label} failed ({exc})")
        scenes.sort(key=lambda sc: (sc["date"], sc["resolution_m"] == 10), reverse=True)

        manifest["locations"][name] = {"bounds": [[s, w], [n, e]], "scenes": scenes}
        print(f"{name}: kept {[(sc['date'], sc['sensor']) for sc in scenes]}")

    # Drop images no longer referenced, then mirror into docs/
    keep = {sc["file"] for loc in manifest["locations"].values() for sc in loc["scenes"]}
    for f in os.listdir(OUT_DIRS[0]):
        if f.endswith(".jpg") and f not in keep:
            os.remove(os.path.join(OUT_DIRS[0], f))
    with open(os.path.join(OUT_DIRS[0], "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    shutil.rmtree(OUT_DIRS[1], ignore_errors=True)
    shutil.copytree(OUT_DIRS[0], OUT_DIRS[1])


if __name__ == "__main__":
    main()
