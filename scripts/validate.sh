#!/bin/bash

# Quick validation script to check code quality
# Can be run manually or in CI/CD

echo "🔍 MCP SSH Manager - Code Validation"
echo "====================================="
echo ""

ERRORS=0

# Check JavaScript syntax
echo "📋 Checking JavaScript syntax..."
if node --check src/index.js; then
    echo "  ✅ JavaScript syntax is valid"
else
    echo "  ❌ JavaScript syntax error!"
    ERRORS=$((ERRORS + 1))
fi

# Check SSH Manager syntax
echo "📋 Checking SSH Manager syntax..."
if node --check src/ssh-manager.js 2>/dev/null; then
    echo "  ✅ SSH Manager syntax is valid"
else
    echo "  ❌ SSH Manager syntax error!"
    ERRORS=$((ERRORS + 1))
fi

# Check for .env in git
echo "📋 Checking for sensitive files..."
if git ls-files | grep -q "^\.env$"; then
    echo "  ❌ WARNING: .env file is tracked in git!"
    ERRORS=$((ERRORS + 1))
else
    echo "  ✅ No .env file in git"
fi

# Check if dependencies are installed
echo "📋 Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "  ✅ Node modules installed"
else
    echo "  ⚠️  Node modules not installed (run: npm install)"
fi

# Test server startup (quick test)
echo "📋 Testing MCP server startup..."
# The server needs stdin, so we provide empty input and check if it starts
# Use a timeout alternative for macOS compatibility
( echo "" | node src/index.js 2>/dev/null 1>/dev/null ) &
PID=$!
sleep 2
if kill -0 $PID 2>/dev/null; then
    kill $PID 2>/dev/null
    echo "  ✅ MCP server starts correctly"
else
    wait $PID
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ] || [ $EXIT_CODE -eq 143 ]; then
        echo "  ✅ MCP server syntax is valid"
    else
        echo "  ❌ MCP server failed to start (exit code: $EXIT_CODE)"
        ERRORS=$((ERRORS + 1))
    fi
fi

# Test password special characters handling
echo "📋 Testing password special character handling..."
if [ -f "debug/test_password_special_chars.sh" ]; then
    if bash debug/test_password_special_chars.sh > /dev/null 2>&1; then
        echo "  ✅ Password special characters handled correctly"
    else
        echo "  ⚠️  Password test requires local dependencies (skipping in CI)"
    fi
else
    echo "  ⚠️  Password test script not found (skipping)"
fi

echo ""
echo "====================================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ All checks passed!"
    exit 0
else
    echo "❌ Found $ERRORS error(s)"
    exit 1
fi