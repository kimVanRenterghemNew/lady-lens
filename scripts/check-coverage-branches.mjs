import fs from 'fs';
import path from 'path';

const reportPath = path.resolve('outputs/coverage/coverage-final.json');
if (!fs.existsSync(reportPath)) {
    console.error(`Coverage report not found: ${reportPath}`);
    process.exit(1);
}

const useColor = !process.env.NO_COLOR && (process.env.FORCE_COLOR || process.stdout.isTTY || process.stderr.isTTY);
const paint = code => text => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = paint('31');
const orange = paint('38;5;208');
const green = paint('32');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const failures = [];
const warning = [];
for (const [file, data] of Object.entries(report)) {
    if (file.replace(/\\/g, '/').includes('/core/eval/')) continue;
    const branches = Object.values(data.b || {}).flat();
    if (!branches.length) continue;
    const covered = branches.filter(count => count > 0).length;
    const percentage = covered / branches.length * 100;
    if (percentage < 70)
         failures.push({ file, percentage });
    if (percentage >= 70 && percentage < 90)
         warning.push({ file, percentage });
}

for (const { file, percentage } of warning.sort((a, b) => a.percentage - b.percentage)) {
    console.warn(orange(`Some files need extra coverige! new and updates files can not be in this list!`));
    console.warn(orange(`Warning Branch coverage below 90%: ${path.relative(process.cwd(), file)} (${percentage.toFixed(2)}%)`));
}

if (failures.length) {
    for (const { file, percentage } of failures.sort((a, b) => a.percentage - b.percentage)) {
        console.error(red(`Branch coverage below 70%: ${path.relative(process.cwd(), file)} (${percentage.toFixed(2)}%)`));
    }
    process.exit(1);
}

if (!warning.length) console.log(green('Per-file branch coverage: all files with branches are at least 90%'));
