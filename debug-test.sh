#!/bin/bash

# Debug test script for the dry run issue

echo "🐛 Running debug mode test for dry run functionality"
echo "=================================================="

# Build the project
npm run build

echo ""
echo "🧪 Starting test with debug mode enabled..."
echo "This will:"
echo "- Run in non-headless mode so you can see what's happening"
echo "- Take screenshots at key points"
echo "- Show verbose logging"
echo ""

# Run with debug flags
npm start -- octodemo/demo-ghas-python-aegilops --pattern example-patterns.yml --no-headless --debug

echo ""
echo "🔍 Check the current directory for debug screenshots if any were taken"
echo "Look for files like: debug-before-dryrun-*.png and debug-after-dryrun-*.png"
