"""Fetch recent cloud-free Sentinel-2 L2A clips around each avi_conditions location.

Uses the public Element 84 Earth Search STAC (Sentinel-2 COGs on AWS, no auth).
For each location it keeps the N most recent scenes whose *local* cloud cover
(from the SCL band, inside the clip box) is below a threshold, renders a
snow-friendly true-colour JPEG in Web Mercator, and writes a manifest with the
lat/lon bounds so Leaflet can drop it on the map as an imageOverlay.

Output: avi_conditions/data/sentinel/{location}_{date}.jpg + manifest.json
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

STAC = "https://earth-search.aws.element84.com/v1/search"
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
KEEP_SCENES = 3
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


def search(lat, lon):
    now = datetime.now(timezone.utc)
    body = {
        "collections": ["sentinel-2-l2a"],
        "intersects": {"type": "Point", "coordinates": [lon, lat]},
        "datetime": f"{(now - timedelta(days=LOOKBACK_DAYS)).isoformat()}/{now.isoformat()}",
        "query": {"eo:cloud_cover": {"lt": 90}},
        "sortby": [{"field": "properties.datetime", "direction": "desc"}],
        "limit": 50,
    }
    r = requests.post(STAC, json=body, timeout=60)
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


def local_cloud_fraction(item, bbox_merc):
    scl = read_clip(item["assets"]["scl"]["href"], bbox_merc, Resampling.nearest)
    valid = ~np.isin(scl, list(SCL_NODATA))
    if valid.mean() < 0.9:          # clip falls off the tile edge
        return None
    return float(np.isin(scl[valid], list(SCL_CLOUDY)).mean())


def render_rgb(item, bbox_merc, path):
    bands = [read_clip(item["assets"][b]["href"], bbox_merc, Resampling.bilinear).astype("float32")
             for b in ("red", "green", "blue")]
    rgb = np.stack(bands, axis=-1)
    # Processing baseline >= 04.00 adds a +1000 DN offset unless Earth Search already removed it
    props = item["properties"]
    if not props.get("earthsearch:boa_offset_applied", False) and \
            float(props.get("s2:processing_baseline", "0")) >= 4.0:
        rgb -= 1000
    refl = np.clip(rgb / 10000.0, 0, None)
    # Stretch that keeps texture in snow (reflectance ~0.6–1.0) and still shows trees
    lo = np.percentile(refl, 1)
    hi = max(np.percentile(refl, 99.7), 0.3)
    scaled = np.clip((refl - lo) / (hi - lo), 0, 1) ** (1 / 1.6)
    Image.fromarray((scaled * 255).astype("uint8")).save(path, quality=88)


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

        def keep(item, cf):
            date = item["properties"]["datetime"][:10]
            fname = f"{name}_{date}.jpg"
            render_rgb(item, bbox_merc, os.path.join(OUT_DIRS[0], fname))
            seen_dates.add(date)
            scenes.append({"date": date, "file": fname, "local_cloud": round(cf, 3),
                           "scene_cloud": item["properties"].get("eo:cloud_cover"), "id": item["id"]})

        scenes, seen_dates = [], set()
        newest = None                       # most recent scene covering the clip, cloudy or not
        for item in search(lat, lon):
            date = item["properties"]["datetime"][:10]
            if date in seen_dates:          # same pass split across tiles / reprocessing
                continue
            try:
                cf = local_cloud_fraction(item, bbox_merc)
            except Exception as exc:        # noqa: BLE001 — one bad COG shouldn't kill the run
                print(f"  {name} {date}: skip ({exc})")
                continue
            print(f"  {name} {date} {item['id']}: local cloud {cf}")
            if cf is None:
                continue
            if newest is None:
                newest = (item, cf)
            if cf > MAX_LOCAL_CLOUD:
                continue
            keep(item, cf)
            if len(scenes) >= KEEP_SCENES:
                break

        # Nothing clear enough — still show the most recent pass so the map isn't empty
        if not scenes and newest:
            keep(*newest)

        manifest["locations"][name] = {"bounds": [[s, w], [n, e]], "scenes": scenes}
        print(f"{name}: kept {[sc['date'] for sc in scenes]}")

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
