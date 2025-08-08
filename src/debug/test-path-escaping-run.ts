import { escapeRsyncSSHPath } from '../lib/ssh/utils';

const testPath = 'American Horror Story 2011 S01 1080p BluRay 10bit EAC3 5 1 x265-iVy/American Horror Story (2011) S01 1080p BluRay 10bit EAC3 5.1 x265-iVy';
console.log('Original path:', testPath);
console.log('Escaped path:', escapeRsyncSSHPath(testPath));

// Test some other problematic cases
const testCases = [
  'simple path',
  'path with spaces',
  'path/with/spaces and/subdirs',
  'path (with) parentheses',
  'path with "quotes"',
  "path with 'single quotes'",
  'American Horror Story (2011) S01'
];

console.log('\nTest cases:');
testCases.forEach(testCase => {
  console.log(`Original: ${testCase}`);
  console.log(`Escaped:  ${escapeRsyncSSHPath(testCase)}`);
  console.log('---');
});
