/**
 * Scrapling Integration
 * Calls the Python scrapling scraper and returns jobs.
 */

import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '../../../python/scraper.py');

export async function scrapeWithScrapling() {
    return new Promise((resolve) => {
        const python = process.env.PYTHON_BIN || 'python3';

        execFile(python, [PYTHON_SCRIPT], {
            timeout: 300000, // 5 min max
            maxBuffer: 10 * 1024 * 1024, // 10MB output
        }, (err, stdout, stderr) => {
            if (stderr) console.log(stderr); // Show progress logs

            if (err) {
                console.error(`❌ Scrapling error: ${err.message}`);
                resolve([]);
                return;
            }

            try {
                const result = JSON.parse(stdout);
                if (result.error) {
                    console.error(`❌ Scrapling: ${result.error}`);
                    resolve([]);
                    return;
                }
                console.log(`🐍 Scrapling: ${result.total} jobs from ${result.hits} companies`);
                resolve(result.jobs || []);
            } catch (parseErr) {
                console.error(`❌ Scrapling JSON parse error: ${parseErr.message}`);
                resolve([]);
            }
        });
    });
}
