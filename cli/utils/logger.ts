/**
 * CLI Logger Utility
 */

export const logger = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  success: (msg: string) => console.log(`✅ ${msg}`),
  warn: (msg: string) => console.log(`⚠️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG) {
      console.log(`🐛 ${msg}`);
    }
  },

  section: (title: string) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'='.repeat(60)}\n`);
  },

  subsection: (title: string) => {
    console.log(`\n${title}`);
    console.log(`${'-'.repeat(title.length)}`);
  },

  step: (step: number, total: number, msg: string) => {
    console.log(`[${step}/${total}] ${msg}`);
  },

  progress: (current: number, total: number, label: string = '') => {
    const percent = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percent / 2)) + '░'.repeat(50 - Math.floor(percent / 2));
    process.stdout.write(`\r${label} [${bar}] ${percent}% (${current.toLocaleString()}/${total.toLocaleString()})`);
    if (current === total) console.log();  // New line when complete
  },

  table: (data: Record<string, any>[]) => {
    if (data.length === 0) {
      console.log('  (no data)');
      return;
    }
    console.table(data);
  },

  json: (data: any) => {
    console.log(JSON.stringify(data, null, 2));
  }
};
