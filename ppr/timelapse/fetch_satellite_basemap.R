#!/usr/bin/env Rscript
#
# fetch_satellite_basemap.R
#
# Run this LOCALLY in RStudio (not through Claude) so it uses your machine's
# normal internet access. It downloads a satellite/aerial basemap aligned to
# one of plot30's rasters and saves it as a GeoTIFF you can hand back to
# Claude to composite into the timelapse (satellite background + ponded
# water drawn on top).
#
# Install once: install.packages(c("terra", "maptiles"))

library(terra)
library(maptiles)

# ---- reference raster: defines the exact extent/CRS to match -------------
ref <- rast("ppr/timelapse/plot33/plot33_20220401_20220415.tif")

# ---- fetch a basemap covering that extent ---------------------------------
# Other options worth trying: "OpenStreetMap", "CartoDB.Positron",
# "USGS.USImageryTopo". Esri.WorldImagery is generally the highest-res
# satellite/aerial option and free without an API key.
# zoom ~16-17 gets close to the ~10m native resolution of the plot rasters
# without downloading an enormous number of tiles.
bg <- get_tiles(
  x        = ref,
  provider = "Esri.WorldImagery",
  zoom     = 16,
  crop     = TRUE
)

# ---- align to the reference raster's exact grid ---------------------------
# get_tiles() returns the basemap in Web Mercator (EPSG:3857); reproject +
# resample it onto ref's grid so it lines up pixel-for-pixel with the
# classified rasters.
bg_aligned <- project(bg, ref)

# ---- quick look before saving ----------------------------------------------
plotRGB(bg_aligned)

# ---- save for handing back -------------------------------------------------
out_path <- "ppr/timelapse/plot33/plot33_satellite_basemap.tif"
writeRaster(bg_aligned, out_path, overwrite = TRUE)
cat("Wrote", out_path, "\n")

# Note: this is a single current-day snapshot (Esri doesn't offer per-year
# historical imagery for free), so the same basemap would be reused as the
# backdrop across all 14 x 4 panels -- only the ponded-water overlay changes
# frame to frame. If you want a different look/resolution, tweak `provider`
# or `zoom` above and re-run.

