#!/bin/bash
# Build script for SSH Manager CLI
# This script prepares and packages the CLI for distribution

set -e  # Exit on error

# Colors for output
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
NC=$'\033[0m'

# Directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR"
TARGET_DIR="$HOME/.ssh-manager-cli"
TEMP_BUILD="/tmp/ssh-manager-build-$$"

# Version
VERSION="2.0.2"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     SSH Manager CLI Build Script v$VERSION    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Clean up on exit
cleanup() {
    if [ -d "$TEMP_BUILD" ]; then
        rm -rf "$TEMP_BUILD"
    fi
}
trap cleanup EXIT

# Step 1: Validate source files
echo -e "${YELLOW}Step 1: Validating source files...${NC}"
if [ ! -f "$SOURCE_DIR/ssh-manager" ]; then
    print_error "ssh-manager script not found!"
    exit 1
fi

if [ ! -d "$SOURCE_DIR/lib" ]; then
    print_error "lib directory not found!"
    exit 1
fi

if [ ! -d "$SOURCE_DIR/commands" ]; then
    print_error "commands directory not found!"
    exit 1
fi
print_status "Source files validated"
echo

# Step 2: Check syntax
echo -e "${YELLOW}Step 2: Checking shell syntax...${NC}"
for file in "$SOURCE_DIR/ssh-manager" "$SOURCE_DIR"/lib/*.sh "$SOURCE_DIR"/commands/*.sh; do
    if [ -f "$file" ]; then
        bash -n "$file" || {
            print_error "Syntax error in $file"
            exit 1
        }
    fi
done
print_status "Shell syntax check passed"
echo

# Step 3: Create build directory
echo -e "${YELLOW}Step 3: Creating build directory...${NC}"
mkdir -p "$TEMP_BUILD"
print_status "Build directory created: $TEMP_BUILD"
echo

# Step 4: Copy files to build directory
echo -e "${YELLOW}Step 4: Copying files to build directory...${NC}"
cp -r "$SOURCE_DIR"/* "$TEMP_BUILD/"
print_status "Files copied to build directory"
echo

# Step 5: Set executable permissions
echo -e "${YELLOW}Step 5: Setting permissions...${NC}"
chmod +x "$TEMP_BUILD/ssh-manager"
chmod +x "$TEMP_BUILD/install.sh"
chmod +x "$TEMP_BUILD/migrate.sh"
chmod +x "$TEMP_BUILD/demo.sh" 2>/dev/null || true
print_status "Executable permissions set"
echo

# Step 6: Update version in files
echo -e "${YELLOW}Step 6: Updating version number...${NC}"
sed -i.bak "s/VERSION=\".*\"/VERSION=\"$VERSION\"/" "$TEMP_BUILD/ssh-manager"
rm -f "$TEMP_BUILD/ssh-manager.bak"
print_status "Version updated to $VERSION"
echo

# Step 7: Validate configuration
echo -e "${YELLOW}Step 7: Validating configuration...${NC}"
if [ ! -f "$HOME/mcp/mcp-ssh-manager/.env" ] && [ ! -f "$HOME/.ssh-manager/.env" ]; then
    print_info "No .env file found. You'll need to configure servers after installation."
else
    print_status "Configuration file found"
fi
echo

# Step 8: Create installation package
echo -e "${YELLOW}Step 8: Creating installation package...${NC}"
if [ "$1" == "--package" ]; then
    PACKAGE_FILE="$SCRIPT_DIR/ssh-manager-cli-${VERSION}.tar.gz"
    cd "$TEMP_BUILD"
    tar -czf "$PACKAGE_FILE" .
    print_status "Package created: $PACKAGE_FILE"
    echo
fi

# Step 9: Install to system (optional)
if [ "$1" == "--install" ] || [ "$1" == "" ]; then
    echo -e "${YELLOW}Step 9: Installing to system...${NC}"
    
    # Backup existing installation if present
    if [ -d "$TARGET_DIR" ]; then
        BACKUP_DIR="$TARGET_DIR.backup.$(date +%Y%m%d_%H%M%S)"
        print_info "Backing up existing installation to $BACKUP_DIR"
        mv "$TARGET_DIR" "$BACKUP_DIR"
    fi
    
    # Install new version
    mkdir -p "$TARGET_DIR"
    cp -r "$TEMP_BUILD"/* "$TARGET_DIR/"
    
    # Create symlink in PATH if not exists
    if [ ! -L "/usr/local/bin/ssh-manager" ]; then
        if ln -sf "$TARGET_DIR/ssh-manager" "/usr/local/bin/ssh-manager" 2>/dev/null; then
            print_status "Symlink created in /usr/local/bin"
        else
            print_info "Could not create symlink in /usr/local/bin (may need sudo)"
            print_info "You can manually add $TARGET_DIR to your PATH"
        fi
    else
        print_status "Symlink already exists in /usr/local/bin"
    fi
    
    print_status "Installation complete!"
    echo
fi

# Step 10: Run tests (optional)
if [ "$1" == "--test" ]; then
    echo -e "${YELLOW}Step 10: Running tests...${NC}"
    
    # Test help command
    if "$TARGET_DIR/ssh-manager" --help >/dev/null 2>&1; then
        print_status "Help command works"
    else
        print_error "Help command failed"
    fi
    
    # Test version command
    if "$TARGET_DIR/ssh-manager" --version >/dev/null 2>&1; then
        print_status "Version command works"
    else
        print_error "Version command failed"
    fi
    
    echo
fi

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Build Complete!               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo
echo "Usage:"
echo "  ./build.sh              # Build and install"
echo "  ./build.sh --install    # Build and install"
echo "  ./build.sh --package    # Create tar.gz package"
echo "  ./build.sh --test       # Build, install and test"
echo
echo "To use SSH Manager CLI:"
echo "  ssh-manager             # Interactive mode"
echo "  ssh-manager --help      # Show help"
echo

# Clean up
cleanup

exit 0