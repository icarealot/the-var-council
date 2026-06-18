require('dotenv').config();

const migrate = require('./migrate');
const backfill = require('./backfill');
const app = require('./app');

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    // Background: generate predictions for any finished matches that lack them.
    backfill({ silent: false }).catch((err) =>
      console.error('Backfill error:', err.message)
    );
  })
  .catch((err) => {
    console.error('Failed to run migrations:', err);
    process.exit(1);
  });
