#!/usr/bin/env Rscript
#
# make_plot1_timelapse.R
#
# Builds an animated GIF timelapse of "plot1" pond/water classification
# rasters, showing how wetland ponds in the Prairie Pothole Region fill and
# dry out across each growing season (April-October), 2022-2025.
#
# Input:
#   ppr/timelapse/julia/plot1_<start>_<end>.tif
#     One classified raster per ~2-week period. Each pixel is coded:
#       0 = dry pond basin (wetland footprint without standing water)
#       1 = ponded water (standing water present)
#       2 = upland (outside any wetland footprint)
#
#   Some scenes were re-exported with an extra "_YYYY_MM_DD_HH_MM_SS" suffix
#   on the filename (identical content to the canonical file). Those are
#   skipped so each period only contributes one frame.
#
# Output:
#   media/plot1_timelapse.gif
#
# Run this script from the project root (where _quarto.yml lives), e.g.:
#   Rscript ppr/timelapse/make_plot1_timelapse.R
#
# Requires: terra, magick  (install.packages(c("terra", "magick")))

library(terra)
library(magick)

# ---- paths ------------------------------------------------------------
tif_dir    <- "ppr/timelapse/julia"
out_gif    <- "media/plot1_timelapse.gif"
frames_dir <- file.path(tempdir(), "plot1_frames")

dir.create(frames_dir, showWarnings = FALSE, recursive = TRUE)
dir.create(dirname(out_gif), showWarnings = FALSE, recursive = TRUE)

# ---- find + sort input rasters -----------------------------------------
# Keep only the canonical "plot1_<start>_<end>.tif" name (8-digit dates),
# which excludes the duplicate re-exported files with a timestamp suffix.
tifs <- list.files(
  tif_dir,
  pattern    = "^plot1_[0-9]{8}_[0-9]{8}\\.tif$",
  full.names = TRUE
)

if (length(tifs) == 0) {
  stop("No plot1_*.tif files found in ", tif_dir)
}

info <- data.frame(
  path  = tifs,
  start = as.Date(sub("^plot1_([0-9]{8})_.*$", "\\1", basename(tifs)), "%Y%m%d"),
  stringsAsFactors = FALSE
)
info <- info[order(info$start), ]

# ---- shared styling ------------------------------------------------------
# value -> color / label
pal    <- c("#d9b382", "#2b6cb0", "#f2efe9")   # dry basin, ponded water, upland
labels <- c("Dry pond basin", "Ponded water", "Upland")

# ---- render one PNG frame per time period --------------------------------
for (i in seq_len(nrow(info))) {
  r <- rast(info$path[i])

  frame_path <- file.path(frames_dir, sprintf("frame_%03d.png", i))
  png(frame_path, width = 900, height = 850, res = 150)

  plot(
    r,
    type    = "classes",
    levels  = labels,
    col     = pal,
    axes    = FALSE,
    legend  = TRUE,
    mar     = c(1, 1, 2.5, 8),
    plg     = list(cex = 0.9)
  )
  title(main = paste0("Plot 1 - ", format(info$start[i], "%B %Y")),
        cex.main = 1.6, line = 0.5)

  dev.off()
}

# ---- assemble frames into an animated GIF --------------------------------
frame_files <- sprintf(file.path(frames_dir, "frame_%03d.png"), seq_len(nrow(info)))
imgs <- image_read(frame_files)
gif  <- image_animate(imgs, fps = 4, loop = 0)
image_write(gif, out_gif)

unlink(frames_dir, recursive = TRUE)

cat("Wrote", out_gif, "with", nrow(info), "frames (",
    format(min(info$start), "%b %Y"), "to", format(max(info$start), "%b %Y"), ")\n")
