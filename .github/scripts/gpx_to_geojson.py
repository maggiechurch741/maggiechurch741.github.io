"""Combine GPX route files into one GeoJSON per location for the Sentinel map.

Usage:  python .github/scripts/gpx_to_geojson.py

Expects one subfolder per location in avi_conditions/data/gpx_routes/, named
like the location key with spaces allowed ("cameron pass" -> cameron-pass).
Each file becomes one feature named after its filename (onX exports often have
generic internal names like "Route 11/17/26 14:55"); files don't need a .gpx
extension. Output: avi_conditions/data/routes/<location>.geojson, mirrored
into docs/. Re-run fetch_sentinel.py afterwards so the imagery covers new routes.
"""
import json
import os
import xml.etree.ElementTree as ET

SRC = "avi_conditions/data/gpx_routes"
OUT_DIRS = ("avi_conditions/data/routes", "docs/avi_conditions/data/routes")


def local(tag):
    return tag.rsplit("}", 1)[-1]


def read_gpx(path):
    lines = []
    for el in ET.parse(path).getroot().iter():
        if local(el.tag) in ("trkseg", "rte"):
            pts = [[round(float(p.get("lon")), 6), round(float(p.get("lat")), 6)]
                   for p in el if local(p.tag) in ("trkpt", "rtept")]
            if len(pts) > 1:
                lines.append(pts)
    return lines


for folder in sorted(os.listdir(SRC)):
    folder_path = os.path.join(SRC, folder)
    if not os.path.isdir(folder_path):
        continue
    loc = folder.strip().lower().replace(" ", "-")
    features = []
    for fname in sorted(os.listdir(folder_path)):
        path = os.path.join(folder_path, fname)
        if fname.startswith(".") or not os.path.isfile(path):
            continue
        lines = read_gpx(path)
        if not lines:
            print(f"  skip {fname}: no track/route points")
            continue
        name = fname[:-4] if fname.lower().endswith(".gpx") else fname
        geom = ({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1
                else {"type": "MultiLineString", "coordinates": lines})
        features.append({"type": "Feature", "properties": {"name": name}, "geometry": geom})
        print(f"  {name}: {sum(len(l) for l in lines)} points")

    out = json.dumps({"type": "FeatureCollection", "features": features})
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{loc}.geojson"), "w") as fh:
            fh.write(out)
    print(f"{loc}: wrote {len(features)} routes")
