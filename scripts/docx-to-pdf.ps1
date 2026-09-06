# Word(.docx) を Microsoft Word 経由で PDF に変換する（Word がインストールされている PC 専用）。
#   powershell -ExecutionPolicy Bypass -File scripts/docx-to-pdf.ps1 <docx ファイル または フォルダ> [-DeleteSource]
# フォルダを渡すと配下の *.docx をすべて変換。-DeleteSource を付けると変換後に .docx を削除する。
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$DeleteSource
)

$files = if (Test-Path $Path -PathType Container) {
  Get-ChildItem -Path $Path -Filter *.docx -Recurse | Where-Object { -not $_.Name.StartsWith('~$') }
} else {
  @(Get-Item $Path)
}
if ($files.Count -eq 0) { Write-Host "変換対象の .docx がありません: $Path"; exit 0 }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  foreach ($f in $files) {
    $pdf = [System.IO.Path]::ChangeExtension($f.FullName, '.pdf')
    $doc = $word.Documents.Open($f.FullName, $false, $true)
    # 17 = wdFormatPDF
    $doc.SaveAs([ref]$pdf, [ref]17)
    $doc.Close([ref]0)
    Write-Host "$($f.Name) -> $([System.IO.Path]::GetFileName($pdf))"
    if ($DeleteSource) { Remove-Item $f.FullName -Force }
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
