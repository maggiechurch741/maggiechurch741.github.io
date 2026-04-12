from flask import Flask, Response, send_from_directory, request
from datetime import datetime, timedelta
import requests

app = Flask(__name__)

CAIC_BASE = "https://avalanche.state.co.us/api-proxy/avid?_api_proxy_uri="
CORS_HEADERS = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}

@app.route("/api/caic/zones")
def caic_zones():
    url = CAIC_BASE + "/products/all/area?productType=avalancheforecast&includeExpired=false"
    r = requests.get(url)
    return (r.content, r.status_code, CORS_HEADERS)

@app.route("/api/caic/products")
def caic_products():
    url = CAIC_BASE + "/products/all?productType=avalancheforecast&includeExpired=false"
    r = requests.get(url)
    return (r.content, r.status_code, CORS_HEADERS)

# Serve the static site
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)

SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
SNOTEL_STATION = "551:CO:SNTL"

@app.route("/api/snotel/depth")
def snotel_depth():
    station = request.args.get("station", SNOTEL_STATION)
    end = datetime.now().strftime("%Y-%m-%d")
    begin = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    url = f"{SNOTEL_BASE}?stationTriplets={station}&elements=SNWD&beginDate={begin}&endDate={end}"
    r = requests.get(url)
    return (r.content, r.status_code, CORS_HEADERS)


if __name__ == "__main__":
    app.run(port=8001, debug=True)
