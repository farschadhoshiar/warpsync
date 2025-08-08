"use strict";
/**
 * Test utility for path escaping functions
 * Run this to verify rsync SSH path escaping works correctly
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPathEscapingTests = runPathEscapingTests;
const utils_1 = require("./utils");
const testCases = [
    {
        input: "Season 08",
        description: "Simple space in directory name",
        expectedPattern: /'Season 08'/,
    },
    {
        input: "Movie (2023)",
        description: "Parentheses in name",
        expectedPattern: /'Movie \(2023\)'/,
    },
    {
        input: "Director's Cut",
        description: "Single quote in name",
        expectedPattern: /'Director'\\''s Cut'/,
    },
    {
        input: "TV Shows/Season 01/Episode 01",
        description: "Nested path with spaces",
        expectedPattern: /'TV Shows\/Season 01\/Episode 01'/,
    },
    {
        input: "Collection & More",
        description: "Ampersand character",
        expectedPattern: /'Collection & More'/,
    },
    {
        input: "no-spaces-or-special-chars",
        description: "Safe path with no special characters",
        expectedPattern: /'no-spaces-or-special-chars'/,
    },
    {
        input: "/path/with spaces/and$special",
        description: "Complex path with multiple special characters",
        expectedPattern: /'\/path\/with spaces\/and\$special'/,
    },
];
/**
 * Test the escapeRsyncSSHPath function
 */
function testRsyncSSHPathEscaping() {
    console.log("🧪 Testing escapeRsyncSSHPath function...\n");
    let passed = 0;
    let failed = 0;
    for (const testCase of testCases) {
        const result = (0, utils_1.escapeRsyncSSHPath)(testCase.input);
        console.log(`📁 ${testCase.description}`);
        console.log(`   Input:  "${testCase.input}"`);
        console.log(`   Output: "${result}"`);
        if (testCase.expectedPattern) {
            if (testCase.expectedPattern.test(result)) {
                console.log(`   ✅ PASS - Matches expected pattern`);
                passed++;
            }
            else {
                console.log(`   ❌ FAIL - Expected pattern: ${testCase.expectedPattern}`);
                failed++;
            }
        }
        else {
            // For safe paths, should be quoted for consistency
            const expectedQuoted = `'${testCase.input}'`;
            if (result === expectedQuoted) {
                console.log(`   ✅ PASS - Safe path properly quoted`);
                passed++;
            }
            else {
                console.log(`   ❌ FAIL - Expected: ${expectedQuoted}, Got: ${result}`);
                failed++;
            }
        }
        console.log("");
    }
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log("🎉 All tests passed!");
    }
    else {
        console.log("⚠️ Some tests failed. Please review the escaping logic.");
    }
}
/**
 * Compare old vs new escaping for SSH paths
 */
function compareEscapingMethods() {
    console.log("\n🔍 Comparing escaping methods for SSH paths...\n");
    const spaceCases = [
        "Season 08",
        "Movie Collection (HD)",
        "TV Shows/Season 01",
        "/remote/path/Season 08",
        "Director's Cut",
    ];
    for (const testPath of spaceCases) {
        console.log(`Path: "${testPath}"`);
        console.log(`  Old (escapeShellArg):     "${(0, utils_1.escapeShellArg)(testPath)}"`);
        console.log(`  New (escapeRsyncSSHPath): "${(0, utils_1.escapeRsyncSSHPath)(testPath)}"`);
        console.log(`  SSH Command would be:     user@host:${(0, utils_1.escapeRsyncSSHPath)(testPath)}`);
        console.log("");
    }
}
/**
 * Run all tests
 */
function runPathEscapingTests() {
    testRsyncSSHPathEscaping();
    compareEscapingMethods();
}
// If run directly, execute tests
if (require.main === module) {
    runPathEscapingTests();
}
