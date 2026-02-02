#!/bin/bash

# Wednesday Agent Skills Installer
# Installs agent skills to .wednesday/skills directory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default installation directory (current working directory)
INSTALL_DIR="${1:-.}"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         Wednesday Agent Skills Installer                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if we're in a project directory
if [[ ! -f "$INSTALL_DIR/package.json" && ! -f "$INSTALL_DIR/pyproject.toml" && ! -f "$INSTALL_DIR/Cargo.toml" && ! -f "$INSTALL_DIR/go.mod" ]]; then
    echo -e "${YELLOW}Warning: No package.json, pyproject.toml, Cargo.toml, or go.mod found.${NC}"
    echo -e "${YELLOW}Are you sure you want to install here? (y/N)${NC}"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo -e "${RED}Installation cancelled.${NC}"
        exit 1
    fi
fi

# Create .wednesday/skills directory
SKILLS_DIR="$INSTALL_DIR/.wednesday/skills"
echo -e "${BLUE}Creating skills directory: ${SKILLS_DIR}${NC}"
mkdir -p "$SKILLS_DIR"

# Copy skills
echo -e "${BLUE}Installing wednesday-dev skill...${NC}"
if [[ -d "$SCRIPT_DIR/wednesday-dev" ]]; then
    cp -r "$SCRIPT_DIR/wednesday-dev" "$SKILLS_DIR/"
    echo -e "${GREEN}  ✓ wednesday-dev installed${NC}"
else
    echo -e "${RED}  ✗ wednesday-dev not found in package${NC}"
fi

echo -e "${BLUE}Installing wednesday-design skill...${NC}"
if [[ -d "$SCRIPT_DIR/wednesday-design" ]]; then
    cp -r "$SCRIPT_DIR/wednesday-design" "$SKILLS_DIR/"
    echo -e "${GREEN}  ✓ wednesday-design installed${NC}"
else
    echo -e "${RED}  ✗ wednesday-design not found in package${NC}"
fi

# Check if .gitignore exists and suggest adding .wednesday if needed
if [[ -f "$INSTALL_DIR/.gitignore" ]]; then
    if ! grep -q "^\.wednesday" "$INSTALL_DIR/.gitignore"; then
        echo ""
        echo -e "${YELLOW}Note: .wednesday is not in your .gitignore${NC}"
        echo -e "${YELLOW}You may want to add it if you don't want to commit the skills:${NC}"
        echo -e "${BLUE}  echo '.wednesday/' >> .gitignore${NC}"
        echo ""
        echo -e "${YELLOW}Or keep it tracked to share with your team.${NC}"
    fi
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Installation complete!                            ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Installed skills:${NC}"
echo "  • wednesday-dev     - Technical development guidelines"
echo "  • wednesday-design  - Design & UX guidelines (492+ components)"
echo ""
echo -e "${BLUE}Skills location:${NC} $SKILLS_DIR"
echo ""
echo -e "${BLUE}What's next:${NC}"
echo "  1. AI assistants will automatically discover these skills"
echo "  2. Try: 'Create a shimmer button' - AI will use approved components"
echo "  3. Read: .wednesday/skills/wednesday-design/references/COMPONENT-LIBRARY.md"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
