// Creates sample accounts for local testing. Run with `npm run seed`.
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./server/db');

const SAMPLE_USERS = [
  { username: 'alice', password: 'poker123', bankroll: 1000 },
  { username: 'bob', password: 'poker123', bankroll: 1000 },
  { username: 'carol', password: 'poker123', bankroll: 1000 },
];

async function main() {
  for (const u of SAMPLE_USERS) {
    if (db.getUserByUsername(u.username)) {
      console.log(`Skipping ${u.username} (already exists).`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 12);
    db.createUser(u.username, hash, u.bankroll);
    console.log(`Created ${u.username} / ${u.password}`);
  }
  console.log('Done seeding sample accounts.');
}

main();
