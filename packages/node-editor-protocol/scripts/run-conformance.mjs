#!/usr/bin/env node

import { runConformance } from '../src/conformance.js';

const receipt = await runConformance();
console.log(JSON.stringify(receipt, null, 2));
