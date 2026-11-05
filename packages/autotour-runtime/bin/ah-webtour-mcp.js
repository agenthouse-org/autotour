#!/usr/bin/env node
import { startMcpServer } from '../mcp/server.js';

const toursDir = process.env.AH_WEBTOUR_DIR || process.argv[2] || './tours';
startMcpServer({ toursDir });
