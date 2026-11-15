
'use strict';

const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const config = require('../src/config/env');
const {
  connectDatabase,
  disconnectDatabase
} = require('../src/config/database');

const Department = require('../src/models/Department');

const DEPARTMENTS = [
  { name: 'Artificial Intelligence and Machine Learning (Degree)', code: 'AIML_DEG' },
  { name: 'Electronics and Telecommunication Engineering (Degree)', code: 'ENTC_DEG' },
  { name: 'Electrical Engineering (Degree)', code: 'ELECTRICAL_DEG' },
  { name: 'Civil Engineering (Degree)', code: 'CIVIL_DEG' },
  { name: 'Mechanical Engineering (Degree)', code: 'MECHANICAL_DEG' },
  { name: 'Computer Science and Engineering (Degree)', code: 'CSE_DEG' },
  { name: 'Artificial Intelligence and Machine Learning (Diploma)', code: 'AIML_DIP' },
  { name: 'Electronics and Telecommunication Engineering (Diploma)', code: 'ENTC_DIP' },
  { name: 'Electrical Engineering (Diploma)', code: 'ELECTRICAL_DIP' },
  { name: 'Civil Engineering (Diploma)', code: 'CIVIL_DIP' },
  { name: 'Mechanical Engineering (Diploma)', code: 'MECHANICAL_DIP' },
  { name: 'Computer Science and Engineering (Diploma)', code: 'CSE_DIP' }
];

async function main() {
  if (config.NODE_ENV === 'production') {
    throw new Error('This setup script is disabled in production.');
  }

  await connectDatabase();

  try {
    let created = 0;
    let existing = 0;

    for (const item of DEPARTMENTS) {
      const result = await Department.updateOne(
        { code: item.code },
        {
          $setOnInsert: {
            name: item.name,
            code: item.code,
            description: '',
            hodId: null,
            isActive: true
          }
        },
        { upsert: true }
      );

      if (result.upsertedCount === 1) {
        created++;
        console.log(`Created: ${item.name} (${item.code})`);
      } else {
        existing++;
        console.log(`Already exists: ${item.name} (${item.code})`);
      }
    }

    console.log('\nDepartment setup completed.');
    console.log(`Created: ${created}`);
    console.log(`Already existing: ${existing}`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch(error => {
  console.error('Department setup failed:', error.message);
  process.exitCode = 1;
});
