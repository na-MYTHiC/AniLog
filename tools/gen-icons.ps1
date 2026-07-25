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
# Tile color + letter geometry are kept in sync with icon.svg — update
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

  # AL monogram in white — stroke width 56 at 512 canvas, scaled per icon.
  # Butt caps + round joins match the SVG rendering.
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single](56 * $scale))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Flat
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # A — main outline (bottom-left → peak → bottom-right)
  $aOuter = New-Object 'System.Drawing.PointF[]' 3
  $aOuter[0] = New-PointF (108 * $scale) (380 * $scale)
  $aOuter[1] = New-PointF (196 * $scale) (108 * $scale)
  $aOuter[2] = New-PointF (284 * $scale) (380 * $scale)
  $g.DrawLines($pen, $aOuter)

  # A — crossbar
  $g.DrawLine($pen,
    [single](140 * $scale), [single](268 * $scale),
    [single](252 * $scale), [single](268 * $scale))

  # L — vertical + baseline
  $lPts = New-Object 'System.Drawing.PointF[]' 3
  $lPts[0] = New-PointF (336 * $scale) (108 * $scale)
  $lPts[1] = New-PointF (336 * $scale) (380 * $scale)
  $lPts[2] = New-PointF (452 * $scale) (380 * $scale)
  $g.DrawLines($pen, $lPts)

  $pen.Dispose()
  $g.Dispose()
  $out = Join-Path $root "icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out"
}
