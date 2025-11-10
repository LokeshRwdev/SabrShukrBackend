# Script to replace supabaseWithAuth with supabaseServiceRole in all controllers

$controllers = @(
    "src\controllers\cartController.js",
    "src\controllers\wishlistController.js",
    "src\controllers\orderController.js",
    "src\controllers\addressController.js",
    "src\controllers\storyController.js",
    "src\controllers\reviewController.js"
)

foreach ($file in $controllers) {
    Write-Host "Processing $file..."
    
    $content = Get-Content $file -Raw
    
    # Remove token and supabaseWithAuth creation
    $content = $content -replace 'const token = req\.headers\["authorization"\]\?\.split\(" "\)\[1\];[\r\n\s]*const supabaseWithAuth = createClient\([\r\n\s]*process\.env\.SUPABASE_URL,[\r\n\s]*process\.env\.SUPABASE_ANON_KEY,[\r\n\s]*\{ global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \} \}[\r\n\s]*\);', ''
    
    # Replace usage
    $content = $content -replace 'supabaseWithAuth', 'supabaseServiceRole'
    
    # Fix import
    if ($content -notmatch 'serviceRole: supabaseServiceRole') {
        $content = $content -replace 'const \{ createClient \} = require\("@supabase/supabase-js"\);[\r\n]*const supabase = require\("\.\.\/utils\/supabaseClient"\);', 'const { serviceRole: supabaseServiceRole } = require("../utils/supabaseClient");'
    }
    
    Set-Content $file -Value $content -NoNewline
    
    Write-Host "Fixed $file"
}

Write-Host "Done! Restart your server."
