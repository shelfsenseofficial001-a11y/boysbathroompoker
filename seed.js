// Creates sample accounts for local testing. Run with `npm run seed`.
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./server/db');

// No starting chips here: a stack belongs to a room, and the host sets it
// when they open one.
const SAMPLE_USERS = [
  { username: 'alice', password: 'poker123' },
  { username: 'bob', password: 'poker123' },
  { username: 'carol', password: 'poker123' },
];

async function main() {
  for (const u of SAMPLE_USERS) {
    if (db.getUserByUsername(u.username)) {
      console.log(`Skipping ${u.username} (already exists).`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 12);
    db.createUser(u.username, hash);
    console.log(`Created ${u.username} / ${u.password}`);
  }
  console.log('Done seeding sample accounts.');
}

main();
