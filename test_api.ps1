$baseUrl = "http://localhost:8000"

# Helper to run curl with file input to avoid quoting issues
function Run-ApiTest($endpoint, $json) {
    $tmpFile = [System.IO.Path]::GetTempFileName()
    $json | Set-Content -Path $tmpFile -Encoding UTF8
    Write-Host "--- Testing $endpoint ---"
    curl.exe -s -X POST "$baseUrl/$endpoint" -H "Content-Type: application/json" -d "@$tmpFile"
    Remove-Item $tmpFile
}

# Test 1: Chat Stream
$chatJson = '{"messages":[{"role":"user","content":"write hello world in python"}],"language":"python"}'
Write-Host "--- Test 1: Chat Stream (First 10 lines) ---"
$tmpFile = [System.IO.Path]::GetTempFileName()
$chatJson | Set-Content -Path $tmpFile -Encoding UTF8
curl.exe -s -X POST "$baseUrl/chat/stream" -H "Content-Type: application/json" -d "@$tmpFile" | select -first 10
Remove-Item $tmpFile

# Test 2: Autocomplete
Run-ApiTest "autocomplete" '{"prefix":"def bubble_sort(arr):\n    ","suffix":"","language":"python","max_tokens":60}'

# Test 3: Generate
Run-ApiTest "generate" '{"instruction":"write binary search function","context":"","language":"python"}'

# Test 4: Index
Run-ApiTest "index/project" '{"project_path":"C:\\Users\\HP\\Downloads\\New folder (5)"}'
