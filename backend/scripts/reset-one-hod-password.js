'use strict';

require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);

const readline = require('node:readline');
const bcrypt = require('bcryptjs');

const config = require('../src/config/env');
const {
  connectDatabase,
  disconnectDatabase
} = require('../src/config/database');

const User = require('../src/models/User');

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write('Enter new password (minimum 8 characters): ');

    let password = '';
    stdin.setRawMode(true);
    stdin.resume();

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(key) {
      const value = key.toString();

      if (value === '\u0003') {
        cleanup();
        stdout.write('\nCancelled.\n');
        reject(new Error('Password reset cancelled.'));
        return;
      }

      if (value === '\r' || value === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(password);
        return;
      }

      if (value === '\u007f' || value === '\b') {
        password = password.slice(0, -1);
        return;
      }

      if (value.length === 1 && value >= ' ') {
        password += value;
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  if (config.NODE_ENV === 'production') {
    throw new Error('Password reset script is disabled in production.');
  }

  try {
    await connectDatabase();

    const email = 'hod.aiml.degree@college.edu';

    const user = await User.findOne({ email }).select('+passwordHash');

    if (!user || !user.isActive || user.role !== 'HOD') {
      throw new Error('Active HOD account not found.');
    }

    const password = await readHiddenPassword();

    if (password.length < 8) {
      throw new Error('Password must contain at least 8 characters.');
    }

    user.passwordHash = await bcrypt.hash(
      password,
      config.BCRYPT_SALT_ROUNDS
    );

    user.passwordChangedAt = new Date();

    await user.save();

    console.log('SUCCESS: AIML Degree HOD password reset.');
    console.log('Email:', email);
    console.log('Password was not displayed.');
  } finally {
    await disconnectDatabase();
  }
}

main().catch(error => {
  console.error('Reset failed:', error.message);
  process.exitCode = 1;
});