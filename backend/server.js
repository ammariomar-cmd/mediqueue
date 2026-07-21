const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();

const { db, initializeDatabase } = require('./database');
const { setupWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api', limiter);

// ==================== ROUTES ====================

// ---- LOGIN ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔐 Tentative de connexion:', email);
    
    const user = await db('users').where({ email }).first();
    if (!user) {
      console.log('❌ Utilisateur non trouvé:', email);
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      console.log('❌ Mot de passe invalide pour:', email);
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
    
    console.log('✅ Connexion réussie:', email);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        cabinet_name: user.cabinet_name,
        cabinet_address: user.cabinet_address,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('❌ Erreur login:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- REGISTER ----
// ---- REGISTER ----
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone, cabinet_name, cabinet_address, role } = req.body;
    console.log('📝 Tentative d\'inscription:', email, 'Rôle:', role || 'patient');
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nom, email et mot de passe requis' });
    }
    
    const existingUser = await db('users').where({ email }).first();
    if (existingUser) {
      console.log('❌ Email déjà utilisé:', email);
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userRole = role || 'patient';
    
    let finalCabinetName = cabinet_name || '';
    let finalCabinetAddress = cabinet_address || '';
    
    if (userRole === 'doctor' && !finalCabinetName) {
      finalCabinetName = `${name} - Cabinet Médical`;
    }
    
    const [userId] = await db('users').insert({
      name,
      email,
      password: hashedPassword,
      phone: phone || '',
      cabinet_name: finalCabinetName,
      cabinet_address: finalCabinetAddress || '',
      role: userRole
    });
    
    const user = await db('users').where({ id: userId }).first();
    console.log('✅ Inscription réussie:', email, 'Rôle:', userRole);
    
    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        cabinet_name: user.cabinet_name,
        cabinet_address: user.cabinet_address,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('❌ Erreur inscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- TICKETS ----
app.post('/api/tickets', async (req, res) => {
  try {
    const { patient_name, reason, cabinet_name, priority } = req.body;
    console.log('🎫 Nouveau ticket pour:', patient_name);
    
    const last = await db('tickets').orderBy('ticket_number', 'desc').first();
    const ticketNumber = (last?.ticket_number || 0) + 1;
    
    const [id] = await db('tickets').insert({
      ticket_number: ticketNumber,
      patient_name,
      reason,
      cabinet_name: cabinet_name || 'Cabinet Médical',
      priority: priority || 'normal',
      status: 'waiting',
      arrival_time: new Date().toISOString()
    });
    
    const ticket = await db('tickets').where({ id }).first();
    res.status(201).json(ticket);
  } catch (error) {
    console.error('❌ Erreur création ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tickets/waiting', async (req, res) => {
  try {
    const tickets = await db('tickets')
      .whereIn('status', ['waiting', 'called'])
      .orderBy('position', 'asc');
    res.json(tickets);
  } catch (error) {
    console.error('❌ Erreur récupération tickets:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/call', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📢 Appel du patient:', id);
    
    await db('tickets').where({ id }).update({
      status: 'called',
      called_time: new Date().toISOString()
    });
    const ticket = await db('tickets').where({ id }).first();
    res.json(ticket);
  } catch (error) {
    console.error('❌ Erreur appel patient:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tickets/:id/finish', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('✅ Fin consultation:', id);
    
    const ticket = await db('tickets').where({ id }).first();
    await db('tickets').where({ id }).update({
      status: 'done',
      end_time: new Date().toISOString()
    });
    await db('consultations').insert({
      ticket_id: id,
      patient_name: ticket.patient_name,
      reason: ticket.reason,
      cabinet_name: ticket.cabinet_name,
      status: 'done',
      start_time: ticket.called_time || ticket.arrival_time,
      end_time: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erreur fin consultation:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    console.log('🔄 Mise à jour ticket:', id, status);
    
    await db('tickets').where({ id }).update({
      status: status || 'waiting',
      updated_at: new Date().toISOString()
    });
    const ticket = await db('tickets').where({ id }).first();
    res.json(ticket);
  } catch (error) {
    console.error('❌ Erreur mise à jour ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Annulation ticket:', id);
    
    await db('tickets').where({ id }).update({ status: 'cancelled' });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erreur annulation ticket:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- STATS ----
app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [total] = await db('tickets').where('arrival_time', '>=', today).count('* as count');
    const [waiting] = await db('tickets').where({ status: 'waiting' }).count('* as count');
    const [done] = await db('tickets').where({ status: 'done' }).andWhere('arrival_time', '>=', today).count('* as count');
    const avg = await db('tickets').whereNotNull('called_time').whereNotNull('arrival_time')
      .select(db.raw('AVG((julianday(called_time) - julianday(arrival_time)) * 1440) as avg')).first();
    
    const stats = {
      totalToday: parseInt(total.count) || 0,
      waiting: parseInt(waiting.count) || 0,
      done: parseInt(done.count) || 0,
      avgWait: Math.round(avg?.avg || 0)
    };
    console.log('📊 Stats:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- QR CODE GENERATOR ----
const QRCode = require('qrcode');

app.get('/api/qr/:cabinetId', async (req, res) => {
  try {
    const { cabinetId } = req.params;
    
    // Récupérer les infos du cabinet
    const cabinet = await db('cabinets').where({ id: cabinetId }).first();
    if (!cabinet) {
      return res.status(404).json({ error: 'Cabinet non trouvé' });
    }
    
    // Générer l'URL complète pour le patient
    const patientUrl = `http://localhost:3000/patient.html?cabinet=${cabinetId}`;
    
    // Générer le QR Code en base64
    const qrImage = await QRCode.toDataURL(patientUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: {
        dark: '#0ea5e9',
        light: '#ffffff'
      }
    });
    
    res.json({
      cabinet: cabinet,
      qrCode: qrImage,
      url: patientUrl
    });
  } catch (error) {
    console.error('❌ Erreur QR Code:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---- ROUTE POUR OBTENIR TOUS LES CABINETS ----
app.get('/api/cabinets', async (req, res) => {
  try {
    const cabinets = await db('cabinets').select('*');
    res.json(cabinets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---- STATIC FILES ----
app.use(express.static(path.join(__dirname, 'frontend')));

// ---- WEBSOCKET ----
const wss = new WebSocket.Server({ server });
setupWebSocket(wss, db);

// ---- START SERVER ----
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  🏥  MEDIQUEUE - Serveur démarré avec succès !          ║
║                                                          ║
║  📡  HTTP:  http://localhost:${PORT}                     ║
║  🔌  WS:    ws://localhost:${PORT}                      ║
║  💾  DB:    SQLite (./database/mediqueue.db)            ║
║                                                          ║
║  👤  Compte test: dr.martin@cabinet.fr                  ║
║  🔑  Mot de passe: password123                          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('❌ Erreur:', error);
  }
}

startServer();