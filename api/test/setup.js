// Runs before any test module imports config. Pins a known admin password.
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-secret';
process.env.MATCH_THRESHOLD = '0.6';
