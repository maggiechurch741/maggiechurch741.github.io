#!/usr/bin/env Rscript
#
# make_plot_timelapse.R
#
# Builds a set of 4-panel PNG frames comparing one plot's wetland pond
# status across all four growing seasons (2022-2025) side by side. Each
# frame corresponds to one ~2-week period of the growing season
# (April-October); within a frame, the four panels show 2022 / 2023 / 2024 /
# 2025 for that same period, so stepping through frames lets you compare
# how a given time-of-season looked across years.
#
# These frames are driven by a small interactive HTML/JS player (play/pause
# + slider) embedded directly in research.qmd -- see the <div
# class="plot-timelapse-player"> block there. This script only produces the
# images; it does not touch the HTML/JS.
#
# Input:
#   ppr/timelapse/<plot_id>/<plot_id>_<start>_<end>.tif
#     One classified raster per ~2-week period per year. Each pixel is coded:
#       0 = dry pond basin
#       1 = ponded water (standing water present)
#       2 = upland / other (outside any wetland footprint)
#
#   Values 0 and 2 are both displayed as a single "Dry" class (the
#   distinction between a dry pond basin and non-wetland upland isn't part
#   of the story here -- only wet vs. not-wet is). Colors are assigned by
#   fixed breaks tied to the actual pixel value, not by which classes
#   happen to be present in a given scene: some scenes have no
#   ponded-water pixels at all, and coloring by rank-of-values-present in
#   that situation silently recolors "dry" as "ponded water" and produces
#   a badly misleading frame. Fixed breaks avoid that entirely.
#
#   Not every plot has data for every period/year (e.g. late-season 2025
#   scenes may not be processed yet). A panel with no input file for that
#   period/year is drawn as a "No data yet" placeholder instead of failing.
#
#   If ppr/timelapse/<plot_id>/<plot_id>_satellite_basemap.tif exists (see
#   fetch_satellite_basemap.R -- run that locally, since it needs internet
#   access this environment doesn't have), it's used as the background
#   instead of a flat "Dry" color, with ponded water drawn on top as a
#   solid overlay. That basemap is a single current-day snapshot (free
#   imagery providers don't offer per-year historical coverage), so all 4
#   year panels share the same background image -- only the water overlay
#   changes across years. Without a basemap file, falls back to the flat
#   2-color (Dry / Ponded water) rendering. The satellite background is
#   faded toward white (see fade_amount below) so the blue water overlay
#   still reads clearly on top of it.
#
#   Each frame also gets a scale bar (drawn once, on the first/2022 panel --
#   all 4 panels share the exact same extent, so one is enough) and a small
#   locator inset (bottom-left of the legend row) showing where the plot
#   sits within the US, via the "maps" package's built-in state boundaries
#   (no internet required). The plot's location is computed once up front
#   from one of its rasters' extent.
#
# Output:
#   media/<plot_id>_panels/panel_01.png ... panel_14.png
#   (panel_01 = April 1-15, ... panel_14 = October 16-31)
#
#   Each PNG is auto-trimmed to its content (terra's fixed device size
#   leaves a lot of dead white space around a mostly-square 2x2 grid) with
#   a small uniform margin added back.
#
# Run this script from the project root (where _quarto.yml lives), e.g.:
#   Rscript ppr/timelapse/make_plot_timelapse.R
#
# Requires: terra, magick, maps  (install.packages(c("terra", "magick", "maps")))

library(terra)
library(magick)
library(maps)

# ---- which plot to build ------------------------------------------------
plot_id <- "plot30"   # change to "plot1" to rebuild the plot1 timelapse

# ---- paths ------------------------------------------------------------
tif_dir <- file.path("ppr/timelapse", plot_id)
out_dir <- file.path("media", paste0(plot_id, "_panels"))
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# ---- the within-season periods, in order --------------------------------
# Truncated to end mid-September (a display choice for plot30, matching how
# far its story arc needs to go -- not a data-availability cutoff).
period_codes <- c(
  "0401_0415", "0416_0430", "0501_0515", "0516_0531",
  "0601_0615", "0616_0630", "0701_0715", "0716_0731",
  "0801_0815", "0816_0831", "0901_0915"
)
period_labels <- c(
  "April 1-15", "April 16-30", "May 1-15", "May 16-31",
  "June 1-15", "June 16-30", "July 1-15", "July 16-31",
  "August 1-15", "August 16-31", "September 1-15"
)

years <- 2022:2025

# ---- shared styling ------------------------------------------------------
# 2 classes: dry (pond basin + upland/other collapsed together) and ponded water
pal       <- c("#d9b382", "#2b6cb0")   # dry, ponded water
labels    <- c("Dry", "Ponded water")
brks      <- c(-0.5, 0.5, 1.5)
water_col <- "#1a6fc4"

basemap_path <- file.path(tif_dir, paste0(plot_id, "_satellite_basemap.tif"))
use_basemap  <- file.exists(basemap_path)
fade_amount  <- 0.55   # 0 = untouched imagery, 1 = solid white; blended toward
                        # white so the blue water overlay reads clearly on top
if (use_basemap) {
  bg <- rast(basemap_path)
  bg <- bg * (1 - fade_amount) + 255 * fade_amount
}

# ---- scale bar (in map units -- these rasters are in meters) -------------
sbar_m <- 1000   # 1 km bar, drawn once on the first (2022) panel

# ---- locator inset: where is this plot? -----------------------------------
# Find any one of this plot's rasters just to read its extent/CRS (they're
# all on the identical grid), reproject its corner points to lon/lat, and
# average them for an approximate centroid -- precise enough for a dot on a
# national-scale locator map. (A couple of corners can fail to reproject
# right at the edge of the transform's supported grid; na.rm handles that.)
locator_tifs <- list.files(
  tif_dir,
  pattern = paste0("^", plot_id, "_[0-9]{8}_[0-9]{8}\\.tif$"),
  full.names = TRUE
)
plot_lonlat  <- NULL
plot_state   <- NA
ref_r <- if (length(locator_tifs) > 0) rast(locator_tifs[1]) else NULL
if (!is.null(ref_r)) {
  corners  <- as.points(ext(ref_r), crs = crs(ref_r))
  corners  <- project(corners, "EPSG:4326")
  plot_lonlat <- colMeans(crds(corners), na.rm = TRUE)
  plot_state  <- map.where("state", plot_lonlat[1], plot_lonlat[2])
}

# ---- edge-crop: trims each raster's extent before plotting -----------------
# Two different reasons a plot might want this, both handled the same way:
#
#  - plot33: the classifier's real coverage footprint is a rotated rectangle
#    inscribed in the raster's north-up bounding box; cells outside that
#    rotated footprint were filled with the same code as "upland/other" (2),
#    so they're visually indistinguishable from real upland but aren't real
#    predictions -- they show up as a band of flat color (or, in basemap
#    mode, hide real imagery behind that band) along one or more edges.
#    Measured empirically (checked to be identical across every period/year
#    for this plot, since it's a fixed artifact of its swath geometry, not
#    something that varies scene to scene), with a small safety margin added.
#
#  - plot30: a purely cosmetic zoom-in -- the full footprint is mostly bare
#    field with ponds scattered across it, so at panel size the water reads
#    as sparse specks. Trimming a bit off each edge tightens the framing so
#    the ponds that are there read more clearly, without cropping so hard
#    that real ponds near the edges get cut off.
#
# Add an entry for a new plot_id here for either reason; omitted/unlisted
# plots get no crop (left = right = top = bottom = 0).
crop_buffers_m <- list(
  plot33 = c(left = 50, right = 60, top = 350, bottom = 360),
  plot30 = c(left = 900, right = 900, top = 900, bottom = 900)
)
buf <- crop_buffers_m[[plot_id]]
if (is.null(buf)) buf <- c(left = 0, right = 0, top = 0, bottom = 0)

crop_ext <- NULL
if (!is.null(ref_r) && any(buf > 0)) {
  e <- ext(ref_r)
  crop_ext <- ext(e$xmin + buf["left"], e$xmax - buf["right"],
                   e$ymin + buf["bottom"], e$ymax - buf["top"])
  if (use_basemap) bg <- crop(bg, crop_ext)
}

draw_locator_inset <- function() {
  par(mar = c(0.2, 0.2, 0.2, 0.2))
  map("state", col = "grey85", fill = TRUE, lwd = 0.3, mar = c(0, 0, 0, 0))
  if (!is.null(plot_lonlat) && !is.na(plot_state)) {
    map("state", regions = plot_state, col = "#a9c9a4", fill = TRUE,
        add = TRUE, lwd = 0.3)
  }
  if (!is.null(plot_lonlat)) {
    points(plot_lonlat[1], plot_lonlat[2], pch = 8, col = "red", cex = 1.3, lwd = 2)
  }
  box()
}

# ---- render one 4-panel PNG per period -----------------------------------
for (i in seq_along(period_codes)) {
  code <- period_codes[i]
  start_md <- sub("_.*$", "", code)
  end_md   <- sub("^.*_", "", code)
  paths <- file.path(
    tif_dir,
    sprintf("%s_%d%s_%d%s.tif", plot_id, years, start_md, years, end_md)
  )

  frame_path <- file.path(out_dir, sprintf("panel_%02d.png", i))
  png(frame_path, width = 1150, height = 1150, res = 150, bg = "white")

  # layout: the 4 year panels in a 2x2 grid (this plot's footprint is close
  # to square, so a grid reads far better on a web page than a tall vertical
  # stack), with a thin blank row between the two panel rows, then its own
  # row for the scale bar (spanning both columns, below the panels rather
  # than overlaid on one of them), then a bottom row split between the
  # locator inset (left) and the shared legend (right).
  # NOTE: layout() fills regions in the order plots are drawn below (1st
  # call -> region "1", 2nd -> "2", ...), not by the numeric value's visual
  # position -- so these labels must match the actual draw order: the 4
  # year panels, then the scale bar, then the locator inset, then the
  # legend.
  layout(matrix(c(1, 2, 0, 0, 3, 4, 5, 5, 6, 7), nrow = 5, byrow = TRUE),
         heights = c(1, 0.04, 1, 0.09, 0.20))

  for (j in seq_along(years)) {
    par(mar = c(0.3, 0.3, 2, 0.3))
    if (file.exists(paths[j])) {
      r <- rast(paths[j])
      if (!is.null(crop_ext)) r <- crop(r, crop_ext)
      if (use_basemap) {
        plotRGB(bg, axes = FALSE)
        water <- subst(r, c(0, 2), NA)   # keep only ponded water, rest transparent
        plot(water, col = water_col, add = TRUE, legend = FALSE, axes = FALSE)
      } else {
        r <- subst(r, 2, 0)   # fold "upland/other" into "dry"
        plot(r, breaks = brks, col = pal, axes = FALSE, legend = FALSE)
      }
    } else {
      # no data yet for this period/year -- placeholder panel
      plot.new()
      box(col = "grey80")
      text(0.5, 0.5, "No data yet", col = "grey60", cex = 1.2)
    }
    title(main = years[j], cex.main = 2.6, line = 0.3)
  }

  # scale bar row -- a blank plot set up with the same real-world extent as
  # the map panels (so the bar's length is computed in true map units, not
  # arbitrary 0-1 plot units), placed as its own row beneath the panels
  # instead of overlaid on top of one of them
  panel_ext <- if (!is.null(crop_ext)) crop_ext else if (!is.null(ref_r)) ext(ref_r) else NULL
  par(mar = c(0, 1, 0, 1))
  if (!is.null(panel_ext)) {
    # no asp=1 here: this is just a coordinate scaffold so sbar() computes
    # the bar's length using the right x-axis scale (map units per inch) --
    # the y-range doesn't need to preserve shape since nothing is drawn
    # vertically, and forcing asp=1 in this short, wide row was squeezing
    # the usable x-range down to a sliver in the middle.
    # This row spans both grid columns (2x a single panel's width), so the
    # x-range must also span 2x a single panel's width in map units --
    # otherwise the meters-per-pixel scale here doesn't match the panels
    # above and the bar renders at the wrong (roughly double) length.
    panel_width_m <- panel_ext$xmax - panel_ext$xmin
    plot(0, 0, type = "n", xlim = c(panel_ext$xmin, panel_ext$xmin + 2 * panel_width_m),
         ylim = c(panel_ext$ymin, panel_ext$ymax),
         axes = FALSE, xlab = "", ylab = "")
  } else {
    plot.new()
  }
  sbar(sbar_m, xy = "bottomleft", type = "bar", divs = 2,
       label = c("0", "500", "1 km"), cex = 1.6, lwd = 2)

  # locator inset
  draw_locator_inset()

  # shared legend
  par(mar = c(0, 0, 0, 0))
  plot.new()
  if (use_basemap) {
    legend("center", legend = "Ponded water", fill = water_col, bty = "n", cex = 2.0)
  } else {
    legend("center", legend = labels, fill = pal, bty = "n", cex = 2.0,
           x.intersp = 1.2, text.width = NA)
  }

  dev.off()

  # auto-trim the dead white space around the (mostly square) content,
  # then add back a small uniform margin
  img <- image_read(frame_path)
  img <- image_trim(img)
  img <- image_border(img, "white", "10x10")
  image_write(img, frame_path)
}

cat("Wrote", length(period_codes), "panel frames to", out_dir, "\n")
