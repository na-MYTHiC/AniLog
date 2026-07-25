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

# Monogram polygons (in the 512x512 design space). Kept in sync with
# icon.svg — edit both when tweaking geometry.
#
# Interconnected A + L:
#  - leftDiagSpec: A's left leg, tapers to a single point at the apex
#    (a true miter for free — no seam to hide).
#  - lShapeSpec: A's right leg IS the L's vertical stroke (shared geometry),
#    one hexagon whose base extends right into the L's foot.
#  - crossbarSpec: floats between the two legs with a visible gap on both
#    sides instead of touching them.
$leftDiagSpec = @(
  @( 65, 411), @(231, 87), @(281, 113), @(115, 437)
)
$lShapeSpec = @(
  @(228, 88), @(284, 88), @(284, 368), @(420, 368), @(420, 424), @(228, 424)
)
# Crossbar as two segments meeting a visible gap in the middle: left
# segment overlaps into the diagonal (guaranteed contact across its whole
# height band since the diagonal is sloped), right segment touches the
# vertical's flat left edge exactly. Reads as "one crossbar with a
# deliberate gap," not two unrelated shapes.
$crossbarLeftSpec = @(
  @(150, 318), @(195, 318), @(195, 362), @(150, 362)
)
$crossbarRightSpec = @(
  @(210, 318), @(228, 318), @(228, 362), @(210, 362)
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

  # Tile — softer near-black (keep in sync with icon.svg fill)
  $tileColor = [System.Drawing.ColorTranslator]::FromHtml('#1e1e28')
  $tileBrush = New-Object System.Drawing.SolidBrush($tileColor)
  $tileRadius = 112 * $scale
  $tilePath = New-RoundRect 0 0 $s $s $tileRadius
  $g.FillPath($tileBrush, $tilePath)
  $tileBrush.Dispose()
  $tilePath.Dispose()

  # Monogram — three separate solid-white polygons. Same fill color means
  # any tiny overlap at the seams is invisible; no path-union math needed.
  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPolygon($whiteBrush, (ToPolygon $leftDiagSpec $scale))
  $g.FillPolygon($whiteBrush, (ToPolygon $lShapeSpec $scale))
  $g.FillPolygon($whiteBrush, (ToPolygon $crossbarLeftSpec $scale))
  $g.FillPolygon($whiteBrush, (ToPolygon $crossbarRightSpec $scale))
  $whiteBrush.Dispose()

  $g.Dispose()
  $out = Join-Path $root "icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out"
}
