#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Viral Reddit Story Bot - Startup Script
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

echo -e "${PURPLE}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║       Viral Reddit Story Bot              ║"
echo "  ║       Reddit → Shorts Pipeline            ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 is required but not installed.${NC}"
    exit 1
fi

PYTHON=python3

# Create virtual environment if needed
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    $PYTHON -m venv venv
fi

# Activate virtual environment
source venv/bin/activate
echo -e "${GREEN}Virtual environment activated.${NC}"

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
pip install -q --upgrade pip
pip install -q -r requirements.txt

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}No .env file found. Copying from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env with your API credentials.${NC}"
fi

# Create required directories
mkdir -p output data static/assets/backgrounds

# Check for ffmpeg (required by moviepy)
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${YELLOW}Warning: ffmpeg is not installed. Video editing will not work.${NC}"
    echo -e "${YELLOW}Install with: sudo apt install ffmpeg (Linux) or brew install ffmpeg (Mac)${NC}"
fi

# Start the server
echo ""
echo -e "${GREEN}Starting server...${NC}"
echo -e "${BLUE}Local:    http://localhost:${FLASK_PORT:-5000}${NC}"

if [ "${CLOUDFLARE_TUNNEL}" = "true" ]; then
    echo -e "${BLUE}Cloudflare tunnel will be created automatically.${NC}"
fi

echo ""
$PYTHON app.py
