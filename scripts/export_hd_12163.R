suppressPackageStartupMessages({
  library(Seurat)
  library(jsonlite)
  library(png)
})

arguments <- commandArgs(trailingOnly = TRUE)
if (length(arguments) < 1L) stop("Usage: Rscript scripts/export_hd_12163.R <source-object.RDS> [output-directory] [hires-image.png]")

source_object <- arguments[[1]]
output_dir <- if (length(arguments) >= 2L) arguments[[2]] else "public"
hires_image_path <- if (length(arguments) >= 3L) arguments[[3]] else NA_character_
output_file <- file.path(output_dir, "data", "hd-12163.json")
gene_output_dir <- file.path(output_dir, "data", "hd-12163-genes")

featured_genes <- c("CA9", "VEGFA", "MKI67", "SOX2", "OLIG2", "GFAP", "AIF1", "COL1A1", "CXCL8", "EGFR", "NES", "VIM")
chunk_size <- 128L

visium <- readRDS(source_object)
DefaultAssay(visium) <- "SCT"

data_matrix <- LayerData(visium[["SCT"]], layer = "data")
available_featured_genes <- intersect(featured_genes, rownames(data_matrix))
gene_order <- c(available_featured_genes, sort(setdiff(rownames(data_matrix), available_featured_genes)))
data_by_gene <- as(data_matrix, "RsparseMatrix")
umap <- Embeddings(visium, reduction = "umap")
metadata <- visium@meta.data

shared_image_filename <- "hd-12163.png"
shared_image_path <- sprintf("/%s", shared_image_filename)
hires_image <- if (!is.na(hires_image_path)) readPNG(hires_image_path, native = TRUE) else NULL
image_paths <- list()
image_dimensions <- list()
cell_records <- list()
ordered_cells <- character()

for (slice_index in seq_along(Images(visium))) {
  slice_name <- Images(visium)[slice_index]
  spatial_image <- visium[[slice_name]]
  coordinates <- GetTissueCoordinates(spatial_image)
  image_scale <- if (!is.null(hires_image)) spatial_image@scale.factors$hires else spatial_image@scale.factors$lowres
  image_array <- if (!is.null(hires_image)) hires_image else spatial_image@image

  if (slice_index == 1L) {
    if (!is.null(hires_image)) {
      file.copy(hires_image_path, file.path(output_dir, shared_image_filename), overwrite = TRUE)
    } else {
      writePNG(image_array, file.path(output_dir, shared_image_filename))
    }
  }
  image_paths[[slice_name]] <- shared_image_path
  image_dimensions[[slice_name]] <- list(width = dim(image_array)[2], height = dim(image_array)[1])

  slice_records <- lapply(rownames(coordinates), function(cell_id) {
    meta <- metadata[cell_id, , drop = FALSE]
    cell_index <- length(ordered_cells)
    ordered_cells <<- c(ordered_cells, cell_id)

    list(
      id = cell_id, barcode = cell_id, index = cell_index,
      x = round(coordinates[cell_id, "x"] * image_scale, 3),
      y = round(coordinates[cell_id, "y"] * image_scale, 3),
      fullres_x = round(coordinates[cell_id, "x"], 3),
      fullres_y = round(coordinates[cell_id, "y"], 3),
      umap_x = round(umap[cell_id, 1], 4), umap_y = round(umap[cell_id, 2], 4),
      line = as.character(meta$line), slice = slice_name,
      identity = as.character(meta$identity), cluster = as.character(meta$seurat_clusters),
      counts = as.integer(meta$nCount_Spatial.Polygons),
      features = as.integer(meta$nFeature_Spatial.Polygons), mito = round(as.numeric(meta$perc.mito), 3)
    )
  })

  cell_records <- c(cell_records, slice_records)
}

if (!identical(ordered_cells, colnames(data_by_gene))) {
  stop("Spatial cell order does not match the SCT matrix column order")
}

sparse_quantile <- function(nonzero_values, total_count, probability = 0.95) {
  sorted_values <- sort(nonzero_values)
  zero_count <- total_count - length(sorted_values)
  position <- (total_count - 1) * probability + 1
  lower_index <- floor(position)
  upper_index <- ceiling(position)
  fraction <- position - lower_index
  value_at <- function(index) {
    if (index <= zero_count) return(0)
    sorted_values[index - zero_count]
  }
  value_at(lower_index) + fraction * (value_at(upper_index) - value_at(lower_index))
}

dir.create(gene_output_dir, recursive = TRUE, showWarnings = FALSE)
gene_stats <- vector("list", length(gene_order))

for (chunk_start in seq.int(1L, length(gene_order), by = chunk_size)) {
  chunk_end <- min(length(gene_order), chunk_start + chunk_size - 1L)
  chunk_number <- (chunk_start - 1L) %/% chunk_size
  chunk_filename <- sprintf("chunk-%03d.bin", chunk_number)
  connection <- file(file.path(gene_output_dir, chunk_filename), open = "wb")

  for (gene_position in chunk_start:chunk_end) {
    gene <- gene_order[gene_position]
    matrix_row <- match(gene, rownames(data_by_gene))
    value_start <- data_by_gene@p[matrix_row] + 1L
    value_end <- data_by_gene@p[matrix_row + 1L]

    if (value_end >= value_start) {
      value_range <- value_start:value_end
      cell_indices <- data_by_gene@j[value_range]
      logged_values <- data_by_gene@x[value_range]
      corrected_counts <- as.integer(round(expm1(logged_values)))
    } else {
      cell_indices <- integer()
      logged_values <- numeric()
      corrected_counts <- integer()
    }

    if (length(corrected_counts) > 0L && max(corrected_counts) > 255L) {
      stop(sprintf("%s has a corrected SCT count above 255", gene))
    }

    byte_offset <- seek(connection)
    writeBin(as.integer(cell_indices), connection, size = 2L, endian = "little")
    writeBin(as.raw(corrected_counts), connection)

    gene_stats[[gene_position]] <- list(
      gene = gene,
      min = if (length(logged_values) == ncol(data_by_gene)) round(min(logged_values), 4) else 0,
      max = if (length(logged_values) > 0L) round(max(logged_values), 4) else 0,
      q95 = round(sparse_quantile(logged_values, ncol(data_by_gene)), 4),
      detected = length(logged_values),
      chunk = chunk_filename, offset = byte_offset
    )
  }

  close(connection)
  cat(sprintf("Wrote SCT genes %s-%s of %s\n", chunk_start, chunk_end, length(gene_order)))
}

payload <- list(
  dataset = list(
    name = "UP-12163 CAR-T", cohort = "FF Visium HD October 2025",
    technology = "10x Genomics Visium HD", kind = "hd", observation_label = "cell",
    source_object = basename(source_object), spot_count = nrow(metadata),
    lines = I(sort(unique(as.character(metadata$line)))), slices = I(Images(visium)),
    identities = sort(unique(as.character(metadata$identity))),
    image = shared_image_path, images = image_paths, image_dimensions = image_dimensions,
    gene_data_path = "/data/hd-12163-genes"
  ),
  genes = gene_stats,
  spots = cell_records
)

dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)
write_json(payload, output_file, auto_unbox = TRUE, pretty = FALSE, digits = NA, na = "null")

cat(sprintf("Exported %s cells, %s SCT genes and %s slices to %s\n",
  nrow(metadata), length(gene_order), length(Images(visium)), output_file))
