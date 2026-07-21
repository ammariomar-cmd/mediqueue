
const clients = new Map();
const connections = new Map();

function setupWebSocket(wss, db) {
  wss.on('connection', (ws, req) => {
    console.log('🔌 Nouvelle connexion WebSocket');

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        switch (data.type) {
          case 'auth':
            clients.set(data.userId, ws);
            connections.set(ws, data.userId);
            ws.send(JSON.stringify({
              type: 'auth_success',
              userId: data.userId,
              timestamp: new Date().toISOString()
            }));
            await sendCurrentState(ws, db);
            break;
          
          case 'ticket_created':
          case 'ticket_updated':
          case 'patient_called':
          case 'consultation_finished':
            await handleTicketEvent(data, db);
            broadcast(wss, data);
            break;
          
          case 'sync_request':
            await sendCurrentState(ws, db);
            break;
        }
      } catch (error) {
        console.error('❌ Erreur WebSocket:', error);
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });

    ws.on('close', () => {
      const userId = connections.get(ws);
      if (userId) clients.delete(userId);
      connections.delete(ws);
      console.log(`🔌 Client déconnecté: ${userId}`);
    });
  });
}

async function sendCurrentState(ws, db) {
  try {
    const tickets = await db('tickets')
      .whereIn('status', ['waiting', 'called'])
      .orderBy('position', 'asc');
    
    const history = await db('tickets')
      .whereIn('status', ['done', 'cancelled'])
      .orderBy('arrival_time', 'desc')
      .limit(20);
    
    const stats = await getStats(db);
    
    ws.send(JSON.stringify({
      type: 'sync_response',
      data: { tickets, history, stats, timestamp: new Date().toISOString() }
    }));
  } catch (error) {
    console.error('❌ Erreur sync:', error);
  }
}

async function handleTicketEvent(data, db) {
  const { ticket } = data;
  await db('activity_logs').insert({
    action: data.type,
    details: `Ticket ${ticket.ticket_number} - ${ticket.patient_name}`,
    user: 'System',
    timestamp: new Date().toISOString()
  });
  await updatePositions(db);
}

async function updatePositions(db) {
  const tickets = await db('tickets')
    .where({ status: 'waiting' })
    .orderBy('arrival_time', 'asc');
  
  for (let i = 0; i < tickets.length; i++) {
    await db('tickets')
      .where({ id: tickets[i].id })
      .update({ position: i + 1 });
  }
}

async function getStats(db) {
  const today = new Date().toISOString().split('T')[0];
  
  const [totalToday] = await db('tickets')
    .where('arrival_time', '>=', today)
    .count('* as count');
  
  const [waiting] = await db('tickets')
    .where({ status: 'waiting' })
    .count('* as count');
  
  const [done] = await db('tickets')
    .where({ status: 'done' })
    .andWhere('arrival_time', '>=', today)
    .count('* as count');

  const avgWait = await db('tickets')
    .whereNotNull('called_time')
    .whereNotNull('arrival_time')
    .select(db.raw('AVG((julianday(called_time) - julianday(arrival_time)) * 1440) as avg_wait'))
    .first();

  return {
    totalToday: parseInt(totalToday.count) || 0,
    waiting: parseInt(waiting.count) || 0,
    done: parseInt(done.count) || 0,
    avgWait: Math.round(avgWait?.avg_wait || 0)
  };
}

function broadcast(wss, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

module.exports = { setupWebSocket };