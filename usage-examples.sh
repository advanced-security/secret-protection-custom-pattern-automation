#!/bin/bash

# Example usage script for the Secret Scanning Custom Pattern Automation tool

echo "🔐 Secret Scanning Custom Pattern Automation Tool"
echo "=================================================="
echo ""

# Check if built
if [ ! -f "dist/cli.js" ]; then
    echo "📦 Building the project..."
    npm run build
fi

echo "🆘 Usage Examples:"
echo ""

echo "1. Show help:"
echo "   npm start -- --help"
echo ""

echo "2. Validate example patterns:"
echo "   npm start -- --pattern example-patterns.yml --validate-only owner/repo"
echo ""

echo "3. Upload patterns with push protection:"
echo "   npm start -- --pattern example-patterns.yml --enable-push-protection owner/repo"
echo ""

echo "4. Download existing patterns:"
echo "   npm start -- --download-existing owner/repo"
echo ""

echo "5. Upload patterns with custom threshold (non-headless):"
echo "   npm start -- --pattern example-patterns.yml --dry-run-threshold 25 --no-headless owner/repo"
echo ""

echo "6. Work with organizations:"
echo "   npm start -- --pattern example-patterns.yml --scope org myorg"
echo ""

echo "📋 Available pattern files:"
if [ -f "example-patterns.yml" ]; then
    echo "   ✓ example-patterns.yml (included example patterns)"
else
    echo "   ❌ example-patterns.yml (missing - should be created)"
fi

echo ""
echo "🔍 To validate your patterns without uploading:"
echo "   npm start -- --pattern your-patterns.yml --validate-only owner/repo"
echo ""

echo "🚀 Ready to use! Replace 'owner/repo' with your actual repository."
