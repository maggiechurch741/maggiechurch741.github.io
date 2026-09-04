import requests
import os
from datetime import datetime, timedelta

for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
    os.makedirs(d, exist_ok=True)

CAIC_BASE = "https://avalanche.state.co.us/api-proxy/avid?_api_proxy_uri="

for name, path in [
    ('caic-zones',    '/products/all/area?productType=avalancheforecast&includeExpired=false'),
    ('caic-products', '/products/all?productType=avalancheforecast&includeExpired=false'),
]:
    r = requests.get(CAIC_BASE + path)
    r.raise_for_status()
    for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
        with open(f'{d}/{name}.json', 'w') as f:
            f.write(r.text)
    print(f"Fetched {name}")

SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
end   = datetime.now().strftime("%Y-%m-%d")
begin = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

for station in ["551:CO:SNTL", "322:CO:SNTL"]:
    station_id = station.split(':')[0]
    url = f"{SNOTEL_BASE}?stationTriplets={station}&elements=SNWD&beginDate={begin}&endDate={end}"
    r = requests.get(url)
    r.raise_for_status()
    for d in ['avi_conditions/data', 'docs/avi_conditions/data']:
        with open(f'{d}/snotel-{station_id}.json', 'w') as f:
            f.write(r.text)
    print(f"Fetched SNOTEL {station_id}")

print("Done.")
