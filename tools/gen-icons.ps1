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

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = [double]$s / 512.0

  # Tile — softer near-black (keep in sync with icon.svg fill)
  $tileColor = [System.Drawing.ColorTranslator]::FromHtml('#1e1e28')
  $tileBrush = New-Object System.Drawing.SolidBrush($tileColor)
  $tileRadius = 112 * $scale
  $tilePath = New-RoundRect 0 0 $s $s $tileRadius
  $g.FillPath($tileBrush, $tilePath)
  $tileBrush.Dispose()
  $tilePath.Dispose()

  # AL monogram — one GraphicsPath with three sub-polygons. Default fill
  # mode (Alternate) is equivalent to SVG's evenodd, so the two inner
  # polygons carve holes out of the outer.
  $mono = New-Object System.Drawing.Drawing2D.GraphicsPath

  # Outer silhouette: A triangle + L-foot extension
  $outer = New-Object 'System.Drawing.PointF[]' 5
  $outer[0] = New-PointF ( 88 * $scale) (428 * $scale)
  $outer[1] = New-PointF (256 * $scale) ( 88 * $scale)
  $outer[2] = New-PointF (348 * $scale) (388 * $scale)
  $outer[3] = New-PointF (440 * $scale) (388 * $scale)
  $outer[4] = New-PointF (440 * $scale) (428 * $scale)
  $mono.AddPolygon($outer)

  # Upper triangle cut — A's negative space above the crossbar
  $tri = New-Object 'System.Drawing.PointF[]' 3
  $tri[0] = New-PointF (256 * $scale) (200 * $scale)
  $tri[1] = New-PointF (218 * $scale) (292 * $scale)
  $tri[2] = New-PointF (294 * $scale) (292 * $scale)
  $mono.AddPolygon($tri)

  # Trapezoid cut — A's negative space below the crossbar, opens to base
  $trap = New-Object 'System.Drawing.PointF[]' 4
  $trap[0] = New-PointF (210 * $scale) (322 * $scale)
  $trap[1] = New-PointF (302 * $scale) (322 * $scale)
  $trap[2] = New-PointF (271 * $scale) (428 * $scale)
  $trap[3] = New-PointF (168 * $scale) (428 * $scale)
  $mono.AddPolygon($trap)

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
