suppressPackageStartupMessages({
  library(Seurat)
  library(jsonlite)
})

arguments <- commandArgs(trailingOnly = TRUE)
if (length(arguments) < 1L) stop("Usage: Rscript scripts/export_visium_a.R <source-object.RDS> [output.json]")

source_object <- arguments[[1]]
output_file <- if (length(arguments) >= 2L) arguments[[2]] else file.path("public", "data", "visium-a.json")

genes <- c("CA9", "VEGFA", "MKI67", "SOX2", "OLIG2", "GFAP", "AIF1", "COL1A1", "CXCL8", "EGFR", "NES", "VIM")
image_scale <- 0.29498526

visium <- readRDS(source_object)
visium <- subset(visium, subset = sliceid %in% c("slice2", "slice8"))
DefaultAssay(visium) <- "SCT"

available_genes <- intersect(genes, rownames(visium[["SCT"]]))
expression <- FetchData(visium, vars = available_genes, layer = "data")
umap <- Embeddings(visium, reduction = "umap.cca")
metadata <- visium@meta.data

spot_records <- lapply(seq_len(nrow(metadata)), function(i) {
  cell_id <- rownames(metadata)[i]
  values <- as.list(as.numeric(expression[cell_id, available_genes, drop = TRUE]))
  names(values) <- available_genes

  list(
    id = cell_id,
    barcode = sub("_[0-9]+$", "", cell_id),
    x = round(metadata$x.coord[i] * image_scale, 3),
    y = round(metadata$y.coord[i] * image_scale, 3),
    fullres_x = round(metadata$x.coord[i], 3),
    fullres_y = round(metadata$y.coord[i], 3),
    umap_x = round(umap[cell_id, 1], 4),
    umap_y = round(umap[cell_id, 2], 4),
    line = as.character(metadata$line[i]),
    slice = as.character(metadata$sliceid[i]),
    identity = as.character(metadata$ident[i]),
    cluster = as.character(metadata$cca_clusters[i]),
    counts = as.integer(metadata$nCount_Spatial[i]),
    features = as.integer(metadata$nFeature_Spatial[i]),
    mito = round(as.numeric(metadata$perc.mito[i]), 3),
    expression = values
  )
})

gene_stats <- lapply(available_genes, function(gene) {
  values <- expression[[gene]]
  list(
    gene = gene,
    min = round(min(values, na.rm = TRUE), 4),
    max = round(max(values, na.rm = TRUE), 4),
    q95 = round(as.numeric(quantile(values, 0.95, na.rm = TRUE)), 4),
    detected = sum(values > 0, na.rm = TRUE)
  )
})

payload <- list(
  dataset = list(
    name = "Visium A",
    cohort = "FF Visium October 2024",
    technology = "10x Genomics Visium",
    image_width = 2000,
    image_height = 2000,
    spot_diameter = round(51.75543117184885 * image_scale, 3),
    source_object = basename(source_object),
    spot_count = nrow(metadata),
    lines = sort(unique(as.character(metadata$line))),
    identities = sort(unique(as.character(metadata$ident)))
  ),
  genes = gene_stats,
  spots = spot_records
)

dir.create(dirname(output_file), recursive = TRUE, showWarnings = FALSE)
write_json(payload, output_file, auto_unbox = TRUE, pretty = FALSE, digits = NA, na = "null")

cat(sprintf("Exported %s spots and %s genes to %s\n", nrow(metadata), length(available_genes), output_file))
