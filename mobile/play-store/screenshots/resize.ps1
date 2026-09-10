# Converts any portrait images in this folder to Play Store 1080x1920 (9:16).
# Usage: run from this folder after dropping your screenshots.
Add-Type -AssemblyName System.Drawing
$dir = "C:\Users\User\Documents\Default Project\getinroute\mobile\play-store\screenshots"
$out = "$dir\resized"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$files = Get-ChildItem $dir -Include *.png,*.jpg,*.jpeg -File | Where-Object { $_.DirectoryName -eq $dir }
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $W = 1080; $H = 1920
  $target = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($target)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Black)
  $scale = [Math]::Max($W / $img.Width, $H / $img.Height)
  $nw = [int]($img.Width * $scale); $nh = [int]($img.Height * $scale)
  $g.DrawImage($img, [int](($W - $nw) / 2), [int](($H - $nh) / 2), $nw, $nh)
  $dest = Join-Path $out ($f.BaseName + ".png")
  $target.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("OK  " + (Split-Path $f -Leaf) + " -> resized\" + (Split-Path $dest -Leaf))
  $g.Dispose(); $target.Dispose(); $img.Dispose()
}
Write-Output "Done. Upload the files from the 'resized' folder."
