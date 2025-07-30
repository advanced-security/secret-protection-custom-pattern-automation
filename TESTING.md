# Validator Tests

This tests the pattern validation functionality.

## Running Tests

### Unit Tests

```bash
npm run test:validator
```

This runs a comprehensive test suite that covers:

- Pattern validation (valid/invalid patterns)
- Pattern file validation
- Error, warning, and suggestion detection
- Integration tests with sample pattern files

### Validation Testing with Sample Files

Test with valid patterns:

```bash
npm run validate -- --pattern test-patterns-valid.yml
```

Test with invalid patterns:

```bash
npm run validate -- --pattern test-patterns-invalid.yml
```

## Test Files

- `validator.test.ts` - Main unit test file with simple testing framework
- `test-patterns-valid.yml` - Sample file with valid patterns for integration testing
- `test-patterns-invalid.yml` - Sample file with invalid patterns for testing error detection

## Test Framework

The tests use a simple, lightweight testing framework built into the test file that provides:

- Basic assertions (`assertEquals`, `assertTrue`, `assertFalse`, `assertContains`)
- Test organization and reporting
- Colored output for easy reading
- Error handling and reporting

## Adding New Tests

To add new tests, add them to the `runTests()` function in `validator.test.ts`:

```typescript
test.test('your test name', () => {
    // Your test logic here
    test.assertTrue(someCondition);
    test.assertEquals(actualValue, expectedValue);
});
```

For async tests, use:

```typescript
await test.testAsync('async test name', async () => {
    // Your async test logic here
});
```
