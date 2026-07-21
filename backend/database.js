
const knex = require('knex');
const path = require('path');

const db = knex({
  client: 'sqlite3',
  connection: {
    filename: path.join(__dirname, '../database/mediqueue.db')
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, cb) => {
      conn.run('PRAGMA foreign_keys = ON', cb);
    }
  }
});

async function initializeDatabase() {
  // Table des utilisateurs (médecins)
  await db.schema.createTableIfNotExists('users', (table) => {
    table.increments('id').primary();
    table.string('email').unique().notNullable();
    table.string('password').notNullable();
    table.string('name').notNullable();
    table.string('role').defaultTo('doctor');
    table.string('cabinet_name');
    table.string('cabinet_address');
    table.string('phone');
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  // Table des tickets
  await db.schema.createTableIfNotExists('tickets', (table) => {
    table.increments('id').primary();
    table.integer('ticket_number').notNullable();
    table.string('patient_name').notNullable();
    table.string('reason').notNullable();
    table.string('cabinet_name').notNullable();
    table.string('status').defaultTo('waiting');
    table.string('priority').defaultTo('normal');
    table.integer('position');
    table.timestamp('arrival_time').defaultTo(db.fn.now());
    table.timestamp('called_time');
    table.timestamp('end_time');
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  // Table des consultations (historique)
  await db.schema.createTableIfNotExists('consultations', (table) => {
    table.increments('id').primary();
    table.integer('ticket_id');
    table.string('patient_name');
    table.string('reason');
    table.string('cabinet_name');
    table.string('status');
    table.timestamp('start_time');
    table.timestamp('end_time');
    table.text('notes');
    table.timestamp('created_at').defaultTo(db.fn.now());
  });

  // Table d'activité
  await db.schema.createTableIfNotExists('activity_logs', (table) => {
    table.increments('id').primary();
    table.string('action');
    table.string('details');
    table.string('user');
    table.timestamp('timestamp').defaultTo(db.fn.now());
  });

  console.log('✅ Base de données initialisée');
  
  // Créer un médecin par défaut
  const doctorExists = await db('users').where({ email: 'dr.martin@cabinet.fr' }).first();
  if (!doctorExists) {
    const bcrypt = require('bcrypt');
    const hashed = await bcrypt.hash('password123', 10);
    await db('users').insert({
      email: 'dr.martin@cabinet.fr',
      password: hashed,
      name: 'Dr. Martin',
      role: 'doctor',
      cabinet_name: 'Dr. Martin - Médecine Générale',
      cabinet_address: '12 Rue de la Santé, 75014 Paris',
      phone: '01 23 45 67 89'
    });
    console.log('✅ Compte médecin par défaut créé');
  }
// Créer des cabinets de test
const cabinetCount = await db('cabinets').count('* as count');
if (parseInt(cabinetCount[0].count) === 0) {
  await db('cabinets').insert([
    {
      name: 'Dr. Martin - Médecine Générale',
      address: '12 Rue de la Santé, 75014 Paris',
      phone: '01 23 45 67 89',
      doctor_id: 1
    },
    {
      name: 'Dr. Sophie Bernard - Cardiologie',
      address: '45 Avenue des Champs, 75008 Paris',
      phone: '01 23 45 67 90',
      doctor_id: 1
    },
    {
      name: 'Clinique du Parc - Multi-spécialités',
      address: '8 Boulevard Voltaire, 75011 Paris',
      phone: '01 23 45 67 91',
      doctor_id: 1
    }
  ]);
  console.log('✅ 3 cabinets de test créés');
}
  return db;
}

module.exports = { db, initializeDatabase };