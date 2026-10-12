$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
Start-Process -FilePath (Join-Path $ProjectDir "node_modules\electron\dist\electron.exe") -ArgumentList "." -WorkingDirectory $ProjectDir
