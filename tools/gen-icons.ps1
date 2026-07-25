# Generate the AniLog home-screen icons at every size iOS asks for.
#
# Draws shapes NATIVE at each target resolution instead of rasterizing a
# single SVG down — no scaling artifacts, crisp on any DPR. Uses only
# System.Drawing (built into Windows), so no external dependencies.
#
# Run from any working directory:
#   powershell -File tools/gen-icons.ps1
#
# Writes icon-{76,120,152,167,180,192,512}.png in the repo root.
# Tile color + monogram geometry are kept in sync with icon.svg — update
# both when tweaking.

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sizes = @(76, 120, 152, 167, 180, 192, 512)

function New-RoundRect($x, $y, $w, $h, $r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [double]($r * 2)
  $path.AddArc([single]$x,                 [single]$y,                 [single]$d, [single]$d, 180, 90)
  $path.AddArc([single]($x + $w - $d),     [single]$y,                 [single]$d, [single]$d, 270, 90)
  $path.AddArc([single]($x + $w - $d),     [single]($y + $h - $d),     [single]$d, [single]$d,   0, 90)
  $path.AddArc([single]$x,                 [single]($y + $h - $d),     [single]$d, [single]$d,  90, 90)
  $path.CloseFigure()
  return $path
}

function New-PointF([double]$x, [double]$y) {
  return New-Object System.Drawing.PointF([single]$x, [single]$y)
}

# Monogram polygon coordinates (in the 512x512 design space). Kept in sync
# with icon.svg — edit both when tweaking geometry.
$outerSpec = @(
  @( 96, 416), @(256,  96), @(416, 416)
)
$innerTriSpec = @(
  @(204, 232), @(168, 296), @(244, 296)
)
$innerBarSpec = @(
  @(244, 296), @(324, 296), @(324, 328), @(244, 328)
)

function ToPolygon($spec, $scale) {
  $arr = New-Object 'System.Drawing.PointF[]' $spec.Count
  for ($i = 0; $i -lt $spec.Count; $i++) {
    $arr[$i] = New-PointF ($spec[$i][0] * $scale) ($spec[$i][1] * $scale)
  }
  return $arr
}

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = [double]$s / 512.0

  $tileColor = [System.Drawing.ColorTranslator]::FromHtml('#1e1e28')
  $tileBrush = New-Object System.Drawing.SolidBrush($tileColor)
  $tileRadius = 112 * $scale
  $tilePath = New-RoundRect 0 0 $s $s $tileRadius
  $g.FillPath($tileBrush, $tilePath)
  $tileBrush.Dispose()
  $tilePath.Dispose()

  # AL monogram as one GraphicsPath. Default fill mode (Alternate) matches
  # SVG evenodd, so the inner polygons carve holes out of the outer.
  $mono = New-Object System.Drawing.Drawing2D.GraphicsPath
  $mono.AddPolygon((ToPolygon $outerSpec $scale))
  $mono.AddPolygon((ToPolygon $innerTriSpec $scale))
  $mono.AddPolygon((ToPolygon $innerBarSpec $scale))

  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPath($whiteBrush, $mono)
  $whiteBrush.Dispose()
  $mono.Dispose()

  $g.Dispose()
  $out = Join-Path $root "icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out"
}
