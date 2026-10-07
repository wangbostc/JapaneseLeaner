// A non-UTC zone so any code that splits days in UTC fails loudly (as in the web app's tests).
process.env.TZ = 'Australia/Sydney'
