FROM node:18-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY backend/package*.json ./backend/

# Nettoyer le cache et installer les dépendances
RUN cd backend && npm cache clean --force && npm install

# Copier tout le code du backend
COPY backend/ ./backend/

# Exposer le port
EXPOSE 3000

# Démarrer le serveur
CMD ["node", "backend/server.js"] 
