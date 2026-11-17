import requests
import os
from datetime import datetime, timedelta

for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
    os.makedirs(d, exist_ok=True)

# CAIC moved off /api-proxy/avid?_api_proxy_uri=… (now a 404 page) in fall 2026;
# these are the endpoints avalanche.state.co.us itself calls.
CAIC_BASE = "https://avalanche.state.co.us/avid"

for name, path in [
    ('caic-zones',               '/products/all/area?productType=avalancheforecast&includeExpired=true'),
    ('caic-products',            '/products/all?productType=avalancheforecast&includeExpired=true'),
    ('caic-discussion-zones',    '/products/all/area?productType=regionaldiscussion&includeExpired=true'),
    ('caic-discussion-products', '/products/all?productType=regionaldiscussion&includeExpired=true'),
]:
    r = requests.get(CAIC_BASE + path, timeout=60)
    r.raise_for_status()
    r.json()  # fail loudly if CAIC serves an HTML page instead of data
    for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
        with open(f'{d}/{name}.json', 'w') as f:
            f.write(r.text)
    print(f"Fetched {name}")

SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
end   = datetime.now().strftime("%Y-%m-%d")
begin = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

for station in ["551:CO:SNTL", "322:CO:SNTL", "1251:CO:SNTL"]:
    station_id = station.split(':')[0]
    url = f"{SNOTEL_BASE}?stationTriplets={station}&elements=SNWD&beginDate={begin}&endDate={end}"
    r = requests.get(url)
    r.raise_for_status()
    for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
        with open(f'{d}/snotel-{station_id}.json', 'w') as f:
            f.write(r.text)
    print(f"Fetched SNOTEL {station_id}")

print("Done.")
