param(
    [string]$RepoName = "signcanvas-pdf",
    [ValidateSet("public", "private")]
    [string]$Visibility = "public"
)

$ghPath = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $ghPath)) {
    throw "GitHub CLI not found at: $ghPath"
}

& $ghPath auth status
if ($LASTEXITCODE -ne 0) {
    throw "Not logged into GitHub. Run: `"$ghPath`" auth login"
}

$visibilityFlag = "--$Visibility"
& $ghPath repo create $RepoName $visibilityFlag --source . --remote origin --push
