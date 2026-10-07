# Render every raster of the B9 mark set with headless Edge (transparent background, scale 1),
# then check each file's size and whether its corner pixel is transparent.
# Edge writes harmless diagnostics to stderr; Windows PowerShell would turn them into terminating errors under 'Stop'.
$ErrorActionPreference = 'Continue'
$s = Split-Path -Parent $MyInvocation.MyCommand.Path
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$out = Join-Path $s 'png'
New-Item -ItemType Directory -Force $out | Out-Null
$base = 'file:///' + ($s -replace '\\', '/') + '/raster.html'

$jobs = @(
  @('legacy-square', 48, 'android/mipmap-mdpi/ic_launcher.png'),
  @('legacy-square', 72, 'android/mipmap-hdpi/ic_launcher.png'),
  @('legacy-square', 96, 'android/mipmap-xhdpi/ic_launcher.png'),
  @('legacy-square', 144, 'android/mipmap-xxhdpi/ic_launcher.png'),
  @('legacy-square', 192, 'android/mipmap-xxxhdpi/ic_launcher.png'),
  @('legacy-round', 48, 'android/mipmap-mdpi/ic_launcher_round.png'),
  @('legacy-round', 72, 'android/mipmap-hdpi/ic_launcher_round.png'),
  @('legacy-round', 96, 'android/mipmap-xhdpi/ic_launcher_round.png'),
  @('legacy-round', 144, 'android/mipmap-xxhdpi/ic_launcher_round.png'),
  @('legacy-round', 192, 'android/mipmap-xxxhdpi/ic_launcher_round.png'),
  @('favicon', 16, 'web/orderak-favicon-16.png'),
  @('favicon', 32, 'web/orderak-favicon-32.png'),
  @('favicon', 48, 'web/orderak-favicon-48.png'),
  @('full-bleed', 180, 'web/orderak-icon-180.png'),
  @('rounded', 192, 'web/orderak-icon-192.png'),
  @('rounded', 512, 'web/orderak-icon-512.png'),
  @('maskable', 512, 'web/orderak-icon-maskable-512.png'),
  @('full-bleed', 512, 'play/play-icon.png')
)
Add-Type -AssemblyName System.Drawing
foreach ($j in $jobs) {
  $variant, $size, $rel = $j
  $file = Join-Path $out $rel
  New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
  # A window narrower than the browser's minimum still renders; the screenshot is then cropped below.
  $w = [Math]::Max($size, 64)
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 "--window-size=$w,$w" "--user-data-dir=$s\edge-profile" "--screenshot=$file" "$base#$variant/$size" 2>$null | Out-Null
  $img = [System.Drawing.Bitmap]::FromFile($file)
  if ($img.Width -ne $size) {
    # Clone copies the pixels exactly; drawing through Graphics could resample them.
    $crop = $img.Clone((New-Object System.Drawing.Rectangle 0, 0, $size, $size), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $img.Dispose()
    $crop.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $crop.Dispose()
    $img = [System.Drawing.Bitmap]::FromFile($file)
  }
  $corner = $img.GetPixel(0, 0).A
  '{0,-46} {1,4}x{2,-4} corner-alpha={3,3} {4,7} bytes' -f $rel, $img.Width, $img.Height, $corner, (Get-Item $file).Length
  $img.Dispose()
}
