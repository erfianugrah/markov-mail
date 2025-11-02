/**
 * Argument Parsing Utility
 */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, boolean>;
  options: Record<string, string>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    positional: [],
    flags: {},
    options: {}
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);

      // Check if next arg is a value (doesn't start with --)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result.options[key] = args[i + 1];
        i++; // Skip next arg
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      result.flags[arg.slice(1)] = true;
    } else {
      result.positional.push(arg);
    }
  }

  return result;
}

export function hasFlag(args: ParsedArgs, ...names: string[]): boolean {
  return names.some(name => args.flags[name]);
}

export function getOption(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    if (args.options[name]) return args.options[name];
  }
  return undefined;
}

export function requireOption(args: ParsedArgs, ...names: string[]): string {
  const value = getOption(args, ...names);
  if (!value) {
    throw new Error(`Missing required option: --${names[0]}`);
  }
  return value;
}
