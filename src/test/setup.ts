import 'fake-indexeddb/auto'

// A non-UTC zone so any code that splits days in UTC fails loudly.
process.env.TZ = 'Australia/Sydney'
