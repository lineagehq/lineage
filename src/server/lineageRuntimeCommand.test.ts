import { afterEach, describe, expect, it } from 'vitest';
import { lineageCliCommand, lineageCliLauncher, lineageRuntimeSelector } from './lineageRuntimeCommand';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('lineage runtime commands', () => {
  it('uses only receipt-bound launchers for published channels', () => {
    expect(lineageCliLauncher('stable')).toBe('lineage-stable');
    expect(lineageCliLauncher('preview')).toBe('lineage-preview');
    expect(() => lineageCliLauncher('next')).toThrow('must be stable, preview, or dev');
    expect(() => lineageCliLauncher(undefined)).toThrow('must be stable, preview, or dev');
  });

  it('uses checkout code directly for dev', () => {
    const launcher = lineageCliLauncher('dev');
    expect(launcher).toContain('lineage-dev.ts');
    expect(launcher).not.toContain('npx');
  });

  it('pins generated commands to the active profile', () => {
    process.env.LINEAGE_CHANNEL = 'preview';
    process.env.LINEAGE_PROFILE_MANIFEST = '/tmp/preview profile/profile.json';
    expect(lineageRuntimeSelector()).toBe("--profile '/tmp/preview profile/profile.json'");
    expect(lineageCliCommand("next --project 'demo' --root 'root' --json")).toBe(
      "lineage-preview next --project 'demo' --root 'root' --profile '/tmp/preview profile/profile.json' --json",
    );
  });

  it.each([
    {
      name: 'preserves an embedded --json flag',
      command: "next --json --project 'demo'",
      expected: "next --json --project 'demo'",
    },
    {
      name: 'accepts a command with no --json suffix',
      command: "next --project 'demo'",
      expected: "next --project 'demo'",
    },
    {
      name: 'removes a trailing --json suffix',
      command: "next --project 'demo' --json",
      expected: "next --project 'demo'",
    },
    {
      name: 'removes a trailing --json suffix followed by whitespace',
      command: "next --project 'demo' --json \t\n",
      expected: "next --project 'demo'",
    },
  ])('$name', ({ command, expected }) => {
    process.env.LINEAGE_CHANNEL = 'preview';
    process.env.LINEAGE_PROFILE_MANIFEST = '/tmp/preview profile/profile.json';
    expect(lineageCliCommand(command)).toBe(
      `lineage-preview ${expected} --profile '/tmp/preview profile/profile.json' --json`,
    );
  });

  it('handles very long whitespace before a trailing --json suffix', () => {
    process.env.LINEAGE_CHANNEL = 'preview';
    process.env.LINEAGE_PROFILE_MANIFEST = '/tmp/preview profile/profile.json';
    const command = `next --project 'demo'${' '.repeat(100_000)}--json`;
    expect(lineageCliCommand(command)).toBe(
      "lineage-preview next --project 'demo' --profile '/tmp/preview profile/profile.json' --json",
    );
  });
});
