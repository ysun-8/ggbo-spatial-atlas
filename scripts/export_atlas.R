suppressPackageStartupMessages({library(Seurat); library(jsonlite); library(png)})

# Read source objects only. Write new web assets into an empty staging directory.
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) stop('Usage: Rscript scripts/export_atlas.R <dataset-id> <source-root> <empty-output-directory>')
id <- args[[1]]
source_root <- normalizePath(args[[2]], mustWork = TRUE)
output_root <- args[[3]]
if (dir.exists(output_root) && length(list.files(output_root, all.files = TRUE, no.. = TRUE))) stop('Output directory must be empty')
catalog <- fromJSON('atlas/catalog.json', simplifyVector = FALSE)
recipe <- fromJSON('scripts/export-config.json', simplifyVector = FALSE)[[id]]
entries <- Filter(function(entry) identical(entry$id, id), catalog$datasets)
if (length(entries) != 1L || is.null(recipe)) stop('Dataset needs one catalog entry and one export recipe')
entry <- entries[[1]]
if (!identical(entry$expression$layer, 'data')) stop('Initial exporter supports nonnegative normalized data layers only')
source_path <- file.path(source_root, recipe$source)
cat('Reading', basename(source_path), '\n'); flush.console()
object <- readRDS(source_path)
assay <- object[[entry$expression$assay]]
if (!entry$expression$layer %in% Layers(assay)) stop('Requested exact expression layer is unavailable')
metadata <- object@meta.data
required <- unlist(recipe[c('identity_field', 'cluster_field', 'count_field', 'feature_field', 'mito_field')])
if (!all(required %in% names(metadata))) stop('Missing required metadata fields')
if (is.null(recipe$line_value) && !recipe$line_field %in% names(metadata)) stop('Missing line metadata or explicit sample label')
if (!entry$embedding %in% Reductions(object)) stop('Requested embedding is unavailable')
umap <- Embeddings(object, entry$embedding)
if (ncol(umap) < 2L) stop('Embedding needs two dimensions')
records <- list()
ordered_cells <- character()
geometry_checks <- list()
image_sources <- list()
for (capture in entry$captures) {
  image_recipe <- recipe$captures[[capture$id]]
  if (is.null(image_recipe) || !image_recipe$scale %in% c('hires', 'lowres')) stop('Each capture needs an explicit source image and scale')
  image_path <- file.path(source_root, image_recipe$image)
  raster <- readPNG(image_path, native = TRUE)
  if (!identical(as.integer(c(capture$height, capture$width)), as.integer(dim(raster)))) stop('Catalog dimensions do not match the source PNG')
  rm(raster)
  image_sources[[capture$image]] <- image_path
  capture_scale <- NULL
  for (region in capture$regions) {
    if (!region$id %in% Images(object)) stop('Configured region is absent from source object')
    spatial <- object[[region$id]]
    coords <- GetTissueCoordinates(spatial, scale = NULL)
    cells <- as.character(coords$cell)
    if (anyNA(match(cells, rownames(metadata))) || anyNA(match(cells, rownames(umap)))) stop('Spatial observations missing metadata or embedding')
    if (anyDuplicated(cells) || length(intersect(cells, ordered_cells))) stop('Duplicate observations across regions')
    scale <- as.numeric(spatial@scale.factors[[image_recipe$scale]])
    if (length(scale) != 1L || !is.finite(scale) || scale <= 0) stop('Invalid image scale')
    if (!is.null(capture_scale) && abs(capture_scale - scale) > 1e-10) stop('Regions sharing an image have different scales')
    capture_scale <- scale
    xx <- coords$x * scale
    yy <- coords$y * scale
    if (any(!is.finite(c(xx, yy))) || any(xx < 0 | xx > capture$width | yy < 0 | yy > capture$height)) stop('Coordinates outside configured image')
    start <- length(ordered_cells)
    part <- lapply(seq_along(cells), function(j) {
      cell <- cells[j]
      meta <- metadata[cell, , drop = FALSE]
      identity <- as.character(meta[[recipe$identity_field]])
      if (is.na(identity) || !nzchar(identity)) identity <- 'Unannotated'
      line <- if (!is.null(recipe$line_value)) recipe$line_value else as.character(meta[[recipe$line_field]])
      if (is.na(line) || !nzchar(line)) stop('Missing observation line or sample')
      annotation_fields <- intersect(c('ident', 'identity', 'myeloid_ident', 'immune_ident'), names(meta))
      list(id = paste(id, cell, sep = ':'), barcode = cell, index = start + j - 1L,
        x = xx[j], y = yy[j], fullres_x = coords$x[j], fullres_y = coords$y[j],
        umap_x = umap[cell, 1], umap_y = umap[cell, 2], line = line, slice = region$id, capture = capture$id,
        identity = identity, annotations = lapply(meta[annotation_fields], as.character), cluster = as.character(meta[[recipe$cluster_field]]),
        counts = as.numeric(meta[[recipe$count_field]]), features = as.numeric(meta[[recipe$feature_field]]), mito = as.numeric(meta[[recipe$mito_field]])) })
    records <- c(records, part)
    ordered_cells <- c(ordered_cells, cells)
    geometry_checks[[region$id]] <- list(capture = capture$id, count = length(cells), scale = scale, x_range = range(xx), y_range = range(yy))
  }
}
if (!length(ordered_cells)) stop('No observations selected')
if (any(!is.finite(umap[ordered_cells, 1:2]))) stop('Nonfinite embedding coordinates')
mat <- LayerData(assay, layer = entry$expression$layer)
if (anyNA(match(ordered_cells, colnames(mat)))) stop('Expression layer does not cover every selected observation')
genes <- if (!is.null(recipe$genes)) unlist(recipe$genes) else c(intersect('CA9', rownames(mat)), sort(setdiff(rownames(mat), 'CA9')))
if (anyDuplicated(genes) || !all(genes %in% rownames(mat))) stop('Requested genes missing or duplicated')
mat <- as(mat[genes, ordered_cells, drop = FALSE], 'RsparseMatrix')
if (any(!is.finite(mat@x)) || any(mat@x < 0)) stop('Expression data must be finite and nonnegative')
if (!is.null(recipe$genes) && length(genes) <= 24L) {
  for (j in seq_along(records)) {
    records[[j]]$expression <- setNames(as.list(as.numeric(mat[, j])), genes)
  }
}
if (ncol(mat) > .Machine$integer.max) stop('Observation count exceeds this exporter implementation')

dir.create(file.path(output_root, 'data'), recursive = TRUE, showWarnings = FALSE)
for (destination in names(image_sources)) {
  target <- file.path(output_root, sub('^/', '', destination))
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
  if (!file.copy(image_sources[[destination]], target)) stop('Image copy failed')
}
chunk_path <- file.path(output_root, 'data', paste0(id, '-genes'))
dir.create(chunk_path, recursive = TRUE)
stats <- vector('list', length(genes))
max_roundtrip_error <- 0
# Quantile across the complete sparse row, including implicit zeros.
quantile95 <- function(values, n) {
  sorted <- sort(values)
  zeros <- n - length(sorted)
  position <- (n - 1) * 0.95 + 1
  at <- function(i) if (i <= zeros) 0 else sorted[i - zeros]
  lo <- floor(position); hi <- ceiling(position)
  at(lo) + (position - lo) * (at(hi) - at(lo)) }
for (chunk_start in seq.int(1L, length(genes), by = 128L)) {
  end <- min(length(genes), chunk_start + 127L)
  filename <- sprintf('chunk-%03d.bin', (chunk_start - 1L) %/% 128L)
  connection <- file(file.path(chunk_path, filename), 'wb')
  for (g in chunk_start:end) {
    from <- mat@p[g] + 1L; to <- mat@p[g + 1L]
    positions <- if (to >= from) from:to else integer()
    values <- mat@x[positions]; indices <- mat@j[positions]
    nonzero <- values != 0
    values <- values[nonzero]; indices <- indices[nonzero]
    offset <- seek(connection)
    writeBin(as.integer(indices), connection, size = 4L, endian = 'little')
    writeBin(as.numeric(values), connection, size = 4L, endian = 'little')
    stats[[g]] <- list(gene = genes[g], min = if (length(values) < ncol(mat)) 0 else min(values),
      max = if (length(values)) max(values) else 0, q95 = quantile95(values, ncol(mat)),
      detected = length(values), chunk = filename, offset = offset)
  }
  close(connection)
  # Read every encoded gene back and compare IDs and values against the source matrix.
  connection <- file(file.path(chunk_path, filename), 'rb')
  for (g in chunk_start:end) {
    n <- stats[[g]]$detected
    decoded_indices <- readBin(connection, integer(), n = n, size = 4L, endian = 'little')
    decoded_values <- readBin(connection, numeric(), n = n, size = 4L, endian = 'little')
    from <- mat@p[g] + 1L; to <- mat@p[g + 1L]
    positions <- if (to >= from) from:to else integer()
    positions <- positions[mat@x[positions] != 0]
    if (!identical(decoded_indices, mat@j[positions]) || length(decoded_values) != n) stop('Binary index round-trip mismatch')
    error <- if (n) max(abs(decoded_values - mat@x[positions])) else 0
    max_roundtrip_error <- max(max_roundtrip_error, error)
    if (error > 1e-6) stop('Expression round-trip exceeds float32 tolerance')
  }
  close(connection)
}
if (isTRUE(recipe$gzip)) {
  for (filename in unique(vapply(stats, function(stat) stat$chunk, character(1)))) {
    source <- file.path(chunk_path, filename)
    bytes <- readBin(source, 'raw', n = file.info(source)$size)
    compressed <- gzfile(paste0(source, '.gz'), 'wb', compression = 9)
    writeBin(bytes, compressed); close(compressed)
    check <- gzfile(paste0(source, '.gz'), 'rb')
    restored <- readBin(check, 'raw', n = length(bytes)); close(check)
    if (!identical(bytes, restored)) stop('Compressed chunk differs from validated binary')
    unlink(source)
  }
  stats <- lapply(stats, function(stat) { stat$chunk <- paste0(stat$chunk, '.gz'); stat })
}
entry$expression$encoding <- 'uint32-float32-v2'
entry$path <- paste0('/data/', id, '.json')
entry$source_object <- basename(source_path)
entry$technology <- if (entry$kind == 'hd') '10x Genomics Visium HD' else '10x Genomics Visium'
entry$spot_count <- length(records)
entry$lines <- I(sort(unique(vapply(records, function(r) r$line, character(1)))))
entry$slices <- I(unlist(lapply(entry$captures, function(capture) vapply(capture$regions, function(region) region$id, character(1)))))
entry$identities <- I(sort(unique(vapply(records, function(r) r$identity, character(1)))))
entry$gene_data_path <- paste0('/data/', id, '-genes')
write_json(list(schema_version = 2L, dataset = entry, genes = stats, spots = records), file.path(output_root, 'data', paste0(id, '.json')), auto_unbox = TRUE, digits = NA, na = 'null')
write_json(list(dataset = id, source_object = recipe$source, observations = length(records), source_observations = ncol(object),
  intentionally_excluded = ncol(object) - length(records), genes = length(genes), geometry = geometry_checks,
  encoding = entry$expression$encoding, max_expression_roundtrip_error = max_roundtrip_error),
  file.path(output_root, 'validation.json'), auto_unbox = TRUE, pretty = TRUE, digits = NA)
cat('Validated', length(records), 'observations,', length(genes), 'genes; max float32 error', max_roundtrip_error, '\n')
