# The web version of MULTI-PASKER 2 at https://mp2.laanti.fi: the static build (dist-web/) in a
# private S3 bucket behind CloudFront, with its certificate and DNS records in the existing
# laanti.fi zone. Deploying is a manual step, nothing runs on push:
#
#   npm run build:web
#   terraform -chdir=deploy/aws init     (once)
#   terraform -chdir=deploy/aws apply
#
# After a new build, apply again: it uploads the files that changed.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "domain" {
  description = "Where the web version is served."
  type        = string
  default     = "mp2.laanti.fi"
}

variable "zone" {
  description = "The Route 53 hosted zone the domain belongs to."
  type        = string
  default     = "laanti.fi"
}

variable "region" {
  description = "Region of the bucket. CloudFront is global and takes its certificate from us-east-1."
  type        = string
  default     = "eu-north-1"
}

variable "site_dir" {
  description = "The web build (npm run build:web)."
  type        = string
  default     = "../../dist-web"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "multi-pasker-2" }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = { Project = "multi-pasker-2" }
  }
}

data "aws_route53_zone" "zone" {
  name = var.zone
}

# ---------- Files ----------

resource "aws_s3_bucket" "site" {
  bucket_prefix = "mp2-laanti-fi-"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  types = {
    html  = "text/html; charset=utf-8"
    js    = "text/javascript; charset=utf-8"
    css   = "text/css; charset=utf-8"
    json  = "application/json"
    png   = "image/png"
    svg   = "image/svg+xml"
    woff  = "font/woff"
    woff2 = "font/woff2"
    wav   = "audio/wav"
    mp4   = "video/mp4"
    webm  = "video/webm"
  }
  files = { for f in fileset(var.site_dir, "**") : f => try(regex("\\.([a-z0-9]+)$", lower(f))[0], "") }
}

resource "aws_s3_object" "site" {
  for_each = local.files
  bucket   = aws_s3_bucket.site.id
  key      = each.key
  source   = "${var.site_dir}/${each.key}"
  etag     = filemd5("${var.site_dir}/${each.key}")
  # Sounds and voice lines have no extension: they sit at the paths the game asks for.
  content_type = each.value == "" ? "audio/wav" : lookup(local.types, each.value, "application/octet-stream")
  # Hashed build files never change; sounds rarely do; the pages are checked on every load.
  cache_control = (startswith(each.key, "assets/") ? "public, max-age=31536000, immutable"
    : startswith(each.key, "sfx/") || startswith(each.key, "voice/") ? "public, max-age=3600"
  : "no-cache")
}

# ---------- HTTPS certificate (CloudFront takes it from us-east-1) ----------

resource "aws_acm_certificate" "site" {
  provider          = aws.us_east_1
  domain_name       = var.domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each        = { for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o }
  zone_id         = data.aws_route53_zone.zone.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# ---------- CDN ----------

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "mp2-laanti-fi"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "MULTI-PASKER 2, web version"
  default_root_object = "index.html"
  aliases             = [var.domain]
  # North America and Europe edges only: the cheapest class, and it covers Finland.
  price_class = "PriceClass_100"

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Only this distribution may read the bucket.
data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.site.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

# ---------- DNS ----------

resource "aws_route53_record" "site" {
  for_each = toset(["A", "AAAA"])
  zone_id  = data.aws_route53_zone.zone.zone_id
  name     = var.domain
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

output "url" {
  value = "https://${var.domain}/"
}

output "bucket" {
  value = aws_s3_bucket.site.id
}

output "distribution" {
  value = aws_cloudfront_distribution.site.id
}
