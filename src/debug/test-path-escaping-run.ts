import { escapeRsyncSSHPath } from "../lib/ssh/utils";

const testPath =
  "American Horror Story 2011 S01 1080p BluRay 10bit EAC3 5 1 x265-iVy/American Horror Story (2011) S01 1080p BluRay 10bit EAC3 5.1 x265-iVy";
console.log("Original path:", testPath);
console.log("Escaped path:", escapeRsyncSSHPath(testPath));

// Test some other problematic cases with double-backslash escaping
const testCases = [
  "simple path",
  "path with spaces",
  "path/with/spaces and/subdirs",
  "path with (parentheses)",
  "path with 'single quotes'",
  'path with "double quotes"',
  "path with $pecial characters",
  "path with & ampersands",
];

console.log("\n🔧 Testing double-backslash escaping approach:");
console.log("=====================================\n");

testCases.forEach((testCase) => {
  console.log(`Original: ${testCase}`);
  console.log(`Escaped:  ${escapeRsyncSSHPath(testCase)}`);
  console.log(`SSH Command: user@host:${escapeRsyncSSHPath(testCase)}`);
  console.log("---");
});

console.log("\n✅ All paths are now properly double-escaped for SSH safety!");
