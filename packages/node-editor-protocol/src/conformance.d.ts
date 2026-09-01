export interface ConformanceReceipt {
  passed: number;
  failed: number;
  failures: string[];
  fixtureFiles: string[];
}

export declare function loadCanonicalFixtures(): Promise<{ positive: unknown[]; negative: unknown[] }>;
export declare function runConformance(options?: { throwOnFailure?: boolean }): Promise<ConformanceReceipt>;
