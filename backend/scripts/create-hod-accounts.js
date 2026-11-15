
'use strict';

const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const config = require('../src/config/env');
const {
  connectDatabase,
  disconnectDatabase
} = require('../src/config/database');

const User = require('../src/models/User');
const Department = require('../src/models/Department');

const DEPARTMENTS = [
  { name: 'Artificial Intelligence and Machine Learning (Degree)', code: 'AIML_DEG', key: 'aiml.degree' },
  { name: 'Electronics and Telecommunication Engineering (Degree)', code: 'ENTC_DEG', key: 'entc.degree' },
  { name: 'Electrical Engineering (Degree)', code: 'ELECTRICAL_DEG', key: 'electrical.degree' },
  { name: 'Civil Engineering (Degree)', code: 'CIVIL_DEG', key: 'civil.degree' },
  { name: 'Mechanical Engineering (Degree)', code: 'MECHANICAL_DEG', key: 'mechanical.degree' },
  { name: 'Computer Science and Engineering (Degree)', code: 'CSE_DEG', key: 'cse.degree' },
  { name: 'Artificial Intelligence and Machine Learning (Diploma)', code: 'AIML_DIP', key: 'aiml.diploma' },
  { name: 'Electronics and Telecommunication Engineering (Diploma)', code: 'ENTC_DIP', key: 'entc.diploma' },
  { name: 'Electrical Engineering (Diploma)', code: 'ELECTRICAL_DIP', key: 'electrical.diploma' },
  { name: 'Civil Engineering (Diploma)', code: 'CIVIL_DIP', key: 'civil.diploma' },
  { name: 'Mechanical Engineering (Diploma)', code: 'MECHANICAL_DIP', key: 'mechanical.diploma' },
  { name: 'Computer Science and Engineering (Diploma)', code: 'CSE_DIP', key: 'cse.diploma' }
];

function emailFor(item) {
  return `hod.${item.key}@college.edu`;
}

function generatePassword() {
  // 18 characters, using letters, digits, and symbols.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < 18; i++) {
    password += chars[crypto.randomInt(chars.length)];
  }
  return password;
}

async function main() {
  if (config.NODE_ENV === 'production') {
    throw new Error('This setup script is disabled in production.');
  }

  await connectDatabase();

  const session = await mongoose.startSession();

  try {
    const createdCredentials = [];

    await session.withTransaction(async () => {
      for (const item of DEPARTMENTS) {
        const email = emailFor(item);

        const department = await Department.findOne({
          code: item.code,
          isActive: true
        }).session(session);

        if (!department) {
          throw new Error(`Active department not found: ${item.code}`);
        }

        if (department.hodId) {
          throw new Error(`Department already has an HOD: ${item.code}`);
        }

        if (await User.exists({ email }).session(session)) {
          throw new Error(`HOD email already exists: ${email}`);
        }

        const password = generatePassword();
        const passwordHash = await bcrypt.hash(
          password,
          config.BCRYPT_SALT_ROUNDS
        );

        const [hod] = await User.create([{
          name: `HOD - ${item.name}`,
          email,
          passwordHash,
          role: 'HOD',
          departmentIds: [department._id],
          committeeIds: [],
          isActive: true
        }], { session });

        department.hodId = hod._id;
        await department.save({ session });

        createdCredentials.push({
          department: item.name,
          email,
          password
        });
      }
    });

    console.log('\nSUCCESS: All 12 HOD accounts created.');
    console.log('Save these credentials securely. They will not be shown again.\n');

    for (const item of createdCredentials) {
      console.log(`Department: ${item.department}`);
      console.log(`Email: ${item.email}`);
      console.log(`Password: ${item.password}`);
      console.log('----------------------------------------');
    }
  } finally {
    await session.endSession();
    await disconnectDatabase();
  }
}

main().catch(error => {
  console.error('HOD account setup failed:', error.message);
  process.exitCode = 1;
});
