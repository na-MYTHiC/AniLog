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
# Tile color is kept in sync with icon.svg — update both when tweaking.

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

  $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

  # Three stacked bars — pill-shaped (r = h/2)
  $bars = @(
    @{ x = 112; y = 148; w = 288; h = 40 },
    @{ x = 112; y = 236; w = 224; h = 40 },
    @{ x = 112; y = 324; w = 160; h = 40 }
  )
  foreach ($bar in $bars) {
    $x = $bar.x * $scale
    $y = $bar.y * $scale
    $w = $bar.w * $scale
    $h = $bar.h * $scale
    $r = 20 * $scale
    $p = New-RoundRect $x $y $w $h $r
    $g.FillPath($wb, $p)
    $p.Dispose()
  }

  # Accent dot — circle at (368, 344), radius 22
  $dotR = 22 * $scale
  $g.FillEllipse($wb,
    [single]((368 * $scale) - $dotR),
    [single]((344 * $scale) - $dotR),
    [single]($dotR * 2),
    [single]($dotR * 2))
  $wb.Dispose()

  $g.Dispose()
  $out = Join-Path $root "icon-$s.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out"
}
