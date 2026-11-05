#!/usr/bin/env node
import { startMcpServer } from '@agenthouse-org/autotour-runtime/mcp';
startMcpServer({ toursDir: process.env.AH_WEBTOUR_DIR || process.argv[2] || './tours' });
