/**
 * Test utility for path escaping functions
 * Run this to verify rsync SSH path escaping works correctly
 */

import { escapeShellArg, escapeRsyncSSHPath } from "./utils";

interface TestCase {
  input: string;
  description: string;
  expectedPattern?: RegExp;
}

const testCases: TestCase[] = [
  {
    input: "Season 08",
    description: "Simple space in directory name",
    expectedPattern: /Season\\ 08/,
  },
  {
    input: "Movie (2023)",
    description: "Parentheses in name",
    expectedPattern: /Movie\\ \\\(2023\\\)/,
  },
  {
    input: "Director's Cut",
    description: "Single quote in name",
    expectedPattern: /Director\\'s\\ Cut/,
  },
  {
    input: "TV Shows/Season 01/Episode 01",
    description: "Nested path with spaces",
    expectedPattern: /TV\\ Shows\/Season\\ 01\/Episode\\ 01/,
  },
  {
    input: "Collection & More",
    description: "Ampersand character",
    expectedPattern: /Collection\\ \\\&\\ More/,
  },
  {
    input: "no-spaces-or-special-chars",
    description: "Safe path with no special characters",
  },
  {
    input: "/path/with spaces/and$special",
    description: "Complex path with multiple special characters",
    expectedPattern: /\/path\/with\\ spaces\/and\\\$special/,
  },
];

/**
 * Test the escapeRsyncSSHPath function
 */
function testRsyncSSHPathEscaping(): void {
  console.log("🧪 Testing escapeRsyncSSHPath function...\n");

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = escapeRsyncSSHPath(testCase.input);

    console.log(`📁 ${testCase.description}`);
    console.log(`   Input:  "${testCase.input}"`);
    console.log(`   Output: "${result}"`);

    if (testCase.expectedPattern) {
      if (testCase.expectedPattern.test(result)) {
        console.log(`   ✅ PASS - Matches expected pattern`);
        passed++;
      } else {
        console.log(
          `   ❌ FAIL - Expected pattern: ${testCase.expectedPattern}`,
        );
        failed++;
      }
    } else {
      // For safe paths, should be unchanged
      if (result === testCase.input) {
        console.log(`   ✅ PASS - Safe path unchanged`);
        passed++;
      } else {
        console.log(`   ❌ FAIL - Safe path was modified unexpectedly`);
        failed++;
      }
    }
    console.log("");
  }

  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log("🎉 All tests passed!");
  } else {
    console.log("⚠️ Some tests failed. Please review the escaping logic.");
  }
}

/**
 * Compare old vs new escaping for SSH paths
 */
function compareEscapingMethods(): void {
  console.log("\n🔍 Comparing escaping methods for SSH paths...\n");

  const spaceCases = [
    "Season 08",
    "Movie Collection (HD)",
    "TV Shows/Season 01",
    "/remote/path/Season 08",
  ];

  for (const testPath of spaceCases) {
    console.log(`Path: "${testPath}"`);
    console.log(`  Old (escapeShellArg):     "${escapeShellArg(testPath)}"`);
    console.log(
      `  New (escapeRsyncSSHPath): "${escapeRsyncSSHPath(testPath)}"`,
    );
    console.log(
      `  SSH Command would be:     user@host:${escapeRsyncSSHPath(testPath)}`,
    );
    console.log("");
  }
}

/**
 * Run all tests
 */
export function runPathEscapingTests(): void {
  testRsyncSSHPathEscaping();
  compareEscapingMethods();
}

// If run directly, execute tests
if (require.main === module) {
  runPathEscapingTests();
}
