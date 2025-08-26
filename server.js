const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple room logic (1–to–1)
io.on('connection', (socket) => {
  // Join a room
  socket.on('join', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const numClients = room ? room.size : 0;

    if (numClients >= 2) {
      socket.emit('room_full');
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    const newCount = (io.sockets.adapter.rooms.get(roomId) || { size: 0 }).size;

    // Notify others that a new peer joined
    if (newCount === 2) {
      socket.to(roomId).emit('ready'); // existing peer tells: I'm ready for offer/answer
      socket.emit('ready');
    }
  });

  // Signaling relay
  socket.on('signal', ({ roomId, data }) => {
    socket.to(roomId).emit('signal', data);
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('peer_disconnect');
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
